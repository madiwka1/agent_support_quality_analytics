"""Scheduled auto-evaluation: once a day at the set time the dataset is re-fetched by group_id and every
dialog without an evaluation is evaluated with the base checklist (app.batch), one at a time so the
model stays free for the UI. results/<dataset>/results.json is refreshed after each dialog as usual.
"""
import asyncio
import json
import os
import sqlite3
import threading
from datetime import datetime, timedelta
from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.checklist import DB_PATH
from app.evaluate import log

router = APIRouter(prefix="/api/schedule", tags=["schedule"])
WINDOW = timedelta(hours=1)
_lock = threading.Lock()
_state = {"running": False, "done": 0, "total": 0, "current": None, "trigger": None}


class Schedule(BaseModel):
    enabled: bool = False
    time: str = Field("02:00", pattern=r"^([01]\d|2[0-3]):[0-5]\d$")
    dataset: Literal["dev", "prod"] = "dev"
    group_id: str = Field("DEV", min_length=1, max_length=100)


def _db() -> sqlite3.Connection:
    con = sqlite3.connect(DB_PATH)
    con.execute("CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT NOT NULL)")
    return con


def _get(key: str, default=None):
    with _db() as con:
        r = con.execute("SELECT value FROM settings WHERE key = ?", (key,)).fetchone()
    return json.loads(r[0]) if r else default


def _put(key: str, value) -> None:
    with _db() as con:
        con.execute("INSERT OR REPLACE INTO settings VALUES(?, ?)", (key, json.dumps(value, ensure_ascii=False)))


def _cfg() -> Schedule:
    return Schedule(**_get("schedule", {}))


def _next_run(cfg: Schedule, now: datetime) -> str | None:
    if not cfg.enabled:
        return None
    h, m = map(int, cfg.time.split(":"))
    at = now.replace(hour=h, minute=m, second=0, microsecond=0)
    if at <= now or _get("schedule_last_auto") == now.date().isoformat():
        at += timedelta(days=1)
    return at.isoformat(timespec="minutes")


def _job(cfg: Schedule, trigger: str) -> None:
    from app import batch
    from app.validate_results import load_dataset

    started, ok, failed = datetime.now(), 0, 0

    def progress(done: int, total: int, cid: str | None, err: str | None) -> None:
        nonlocal ok, failed
        if cid:
            ok, failed = ok + (err is None), failed + (err is not None)
        _state.update(done=done, total=total, current=cid)

    last = {"trigger": trigger, "started": started.isoformat(timespec="seconds"), "dataset": cfg.dataset}
    try:
        if os.getenv("CQA_DATASET_URL"):
            data, last["source"] = batch.fetch(cfg.dataset, cfg.group_id), "api"
        else:
            data, last["source"] = load_dataset(cfg.dataset), "saved"
            if data.get("dataset_group_id") not in (None, cfg.group_id):
                raise RuntimeError(f"сохранённый набор относится к {data.get('dataset_group_id')}, а не к {cfg.group_id}")
        batch.run(cfg.dataset, data["records"], batch.base_version(None), only_missing=True, workers=1, progress=progress)
        last.update(status="ok" if not failed else "partial", evaluated=ok, errors=failed, total=len(data["records"]))
    except (Exception, SystemExit) as e:
        log.error("scheduled evaluation failed: %s", e)
        last.update(status="error", evaluated=ok, errors=failed, message=str(e)[:300])
    finally:
        last["finished"] = datetime.now().isoformat(timespec="seconds")
        _put("schedule_last_run", last)
        _state.update(running=False, current=None)


def _start(trigger: str) -> bool:
    with _lock:
        if _state["running"]:
            return False
        _state.update(running=True, done=0, total=0, current=None, trigger=trigger)
    threading.Thread(target=_job, args=(_cfg(), trigger), daemon=True).start()
    return True


async def loop() -> None:
    """Started from the app lifespan: checks twice a minute whether today's run is due."""
    while True:
        await asyncio.sleep(30)
        try:
            cfg, now = _cfg(), datetime.now()
            h, m = map(int, cfg.time.split(":"))
            at = now.replace(hour=h, minute=m, second=0, microsecond=0)
            if cfg.enabled and at <= now < at + WINDOW and _get("schedule_last_auto") != now.date().isoformat():
                _put("schedule_last_auto", now.date().isoformat())
                _start("auto")
        except Exception as e:
            log.warning("scheduler tick failed: %s", e)


def _status() -> dict:
    cfg = _cfg()
    return {**cfg.model_dump(), "next_run": _next_run(cfg, datetime.now()), "last_run": _get("schedule_last_run"),
            "running": _state["running"], "progress": {k: _state[k] for k in ("done", "total", "current", "trigger")},
            "source": "api" if os.getenv("CQA_DATASET_URL") else "saved"}


@router.get("")
def get_schedule():
    return _status()


@router.put("")
def save_schedule(cfg: Schedule):
    _put("schedule", cfg.model_dump())
    return _status()


@router.post("/run")
def run_now():
    if not _start("manual"):
        raise HTTPException(409, "Оценка уже идёт")
    return _status()
