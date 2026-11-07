import json
import os
import sqlite3
import time
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field, model_validator

DB_PATH = os.getenv("CQA_DB", "cqa.db")
SEED = Path(__file__).with_name("seed_checklist.json")
router = APIRouter(prefix="/api/checklists", tags=["checklists"])


class ScaleStep(BaseModel):
    value: float
    desc: str = ""


class Criterion(BaseModel):
    id: str
    name: str
    description: str = ""
    section: str
    type: Literal["yesno", "scale", "flag"]  # flag: "yes" = violation found, no points
    weight: float = Field(ge=0)
    scale: list[ScaleStep] | None = None
    na_allowed: bool = False
    na_condition: str = ""

    @model_validator(mode="after")
    def _check(self):
        if not self.name.strip():
            raise ValueError(f"{self.id}: пустое название")
        if self.type == "flag":
            if self.weight != 0 or self.na_allowed or self.scale:
                raise ValueError(f"{self.id}: флаг без веса, N/A и шкалы")
        elif self.weight <= 0:
            raise ValueError(f"{self.id}: вес должен быть больше 0")
        if self.type == "scale":
            vals = [s.value for s in self.scale or []]
            if len(vals) < 2 or len(set(vals)) != len(vals) or max(vals) <= 0:
                raise ValueError(f"{self.id}: нужна шкала из 2+ уникальных ступеней, максимум > 0")
        elif self.scale:
            raise ValueError(f"{self.id}: шкала допустима только для типа scale")
        if self.na_allowed and not self.na_condition.strip():
            raise ValueError(f"{self.id}: для N/A нужно условие")
        return self


class Checklist(BaseModel):
    version: int | None = None
    created_at: str | None = None
    name: str = Field(min_length=1)
    sections: list[str]
    criteria: list[Criterion] = Field(min_length=1)
    settings: dict = Field(default_factory=dict)

    @model_validator(mode="after")
    def _check(self):
        ids = [c.id for c in self.criteria]
        if len(set(ids)) != len(ids):
            raise ValueError("id критериев повторяются")
        if len(set(self.sections)) != len(self.sections):
            raise ValueError("названия секций повторяются")
        for c in self.criteria:
            if c.section not in self.sections:
                raise ValueError(f"{c.id}: секция «{c.section}» не найдена")
        return self


BLANK = {
    "name": "",
    "sections": ["Основное"],
    "criteria": [{
        "id": "c1", "name": "Новый критерий", "description": "", "section": "Основное",
        "type": "yesno", "weight": 100, "scale": None, "na_allowed": False, "na_condition": "",
    }],
    "settings": {"rounding": 2, "max_total": 100, "redistribute_na": True},
}


def _db() -> sqlite3.Connection:
    con = sqlite3.connect(DB_PATH)
    con.row_factory = sqlite3.Row
    con.executescript(
        "CREATE TABLE IF NOT EXISTS checklist_meta("
        "id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, created_at TEXT NOT NULL, "
        "deleted INTEGER NOT NULL DEFAULT 0);"
        "CREATE TABLE IF NOT EXISTS checklist_versions("
        "checklist_id INTEGER NOT NULL, version INTEGER NOT NULL, config_json TEXT NOT NULL, "
        "created_at TEXT NOT NULL, PRIMARY KEY(checklist_id, version));"
    )
    return con


def _now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%S%z")


def _cfg(r: sqlite3.Row) -> dict:
    return {**json.loads(r["config_json"]), "id": r["checklist_id"], "version": r["version"], "created_at": r["created_at"]}


def _row(con, cid: int, version: int | None = None):
    q = ("SELECT v.* FROM checklist_versions v JOIN checklist_meta m ON m.id = v.checklist_id "
         "WHERE v.checklist_id = ? AND m.deleted = 0")
    args: list = [cid]
    if version is not None:
        q += " AND v.version = ?"
        args.append(version)
    return con.execute(q + " ORDER BY v.version DESC LIMIT 1", args).fetchone()


def _add_version(con, cid: int, cfg: Checklist) -> dict:
    data = cfg.model_dump(exclude={"version", "created_at"})
    data.pop("id", None)
    v = con.execute("SELECT COALESCE(MAX(version), 0) + 1 FROM checklist_versions WHERE checklist_id = ?", (cid,)).fetchone()[0]
    ts = _now()
    con.execute("INSERT INTO checklist_versions VALUES(?, ?, ?, ?)", (cid, v, json.dumps(data, ensure_ascii=False), ts))
    con.execute("UPDATE checklist_meta SET name = ? WHERE id = ?", (cfg.name, cid))
    return {**data, "id": cid, "version": v, "created_at": ts}


def _create(con, name: str, base: dict) -> dict:
    cfg = Checklist.model_validate({**base, "name": name})
    cid = con.execute("INSERT INTO checklist_meta(name, created_at) VALUES(?, ?)", (name, _now())).lastrowid
    return _add_version(con, cid, cfg)


def load_checklist(checklist_id: int, version: int | None = None) -> dict | None:
    """For the evaluation endpoint: the latest version unless one is pinned.
    Store both checklist_id and the resolved version on every evaluation."""
    with _db() as con:
        r = _row(con, checklist_id, version)
    return _cfg(r) if r else None


def seed_if_empty() -> None:
    with _db() as con:
        if con.execute("SELECT COUNT(*) FROM checklist_meta").fetchone()[0] == 0:
            seed = json.loads(SEED.read_text(encoding="utf-8"))
            _create(con, seed["name"], seed)


class NewChecklist(BaseModel):
    name: str
    copy_from: int | None = None


@router.get("")
def list_checklists():
    with _db() as con:
        rows = con.execute(
            "SELECT m.id, m.name, MAX(v.version) AS latest_version, MAX(v.created_at) AS updated_at "
            "FROM checklist_meta m JOIN checklist_versions v ON v.checklist_id = m.id "
            "WHERE m.deleted = 0 GROUP BY m.id ORDER BY m.id"
        ).fetchall()
    return [dict(r) for r in rows]


@router.post("")
def create_checklist(body: NewChecklist):
    name = body.name.strip()
    if not name:
        raise HTTPException(422, "Укажите название чек-листа")
    with _db() as con:
        base = BLANK
        if body.copy_from is not None:
            src = _row(con, body.copy_from)
            if not src:
                raise HTTPException(404, "Исходный чек-лист не найден")
            base = json.loads(src["config_json"])
        return _create(con, name, base)


@router.get("/{cid}")
def get_latest(cid: int):
    cfg = load_checklist(cid)
    if not cfg:
        raise HTTPException(404, "Чек-лист не найден")
    return cfg


@router.delete("/{cid}")
def delete_checklist(cid: int):
    """Soft delete: past evaluations keep their (checklist_id, version) reference."""
    with _db() as con:
        if con.execute("SELECT COUNT(*) FROM checklist_meta WHERE deleted = 0").fetchone()[0] < 2:
            raise HTTPException(409, "Нельзя удалить последний чек-лист")
        if not con.execute("UPDATE checklist_meta SET deleted = 1 WHERE id = ? AND deleted = 0", (cid,)).rowcount:
            raise HTTPException(404, "Чек-лист не найден")
    return {"deleted": cid}


@router.get("/{cid}/versions")
def list_versions(cid: int):
    with _db() as con:
        rows = con.execute(
            "SELECT v.version, v.created_at FROM checklist_versions v JOIN checklist_meta m ON m.id = v.checklist_id "
            "WHERE v.checklist_id = ? AND m.deleted = 0 ORDER BY v.version DESC", (cid,)
        ).fetchall()
    if not rows:
        raise HTTPException(404, "Чек-лист не найден")
    return [dict(r) for r in rows]


@router.get("/{cid}/versions/{version}")
def get_version(cid: int, version: int):
    cfg = load_checklist(cid, version)
    if not cfg:
        raise HTTPException(404, "Версия не найдена")
    return cfg


@router.post("/{cid}/versions")
def save_version(cid: int, cfg: Checklist):
    """Every save creates a new immutable version of this checklist."""
    with _db() as con:
        if not _row(con, cid):
            raise HTTPException(404, "Чек-лист не найден")
        return _add_version(con, cid, cfg)

