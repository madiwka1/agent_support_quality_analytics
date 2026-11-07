"""Appeals against evaluation results.

The original evaluation is never modified. Accepted decisions are stored on the appeal and the
final result is recomputed on demand with the same score() as the original evaluation.
"""
import json
import sqlite3
import time
import uuid
from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.checklist import DB_PATH, load_checklist
from app.evaluate import get_evaluation, score

router = APIRouter(prefix="/api", tags=["appeals"])


class AppealItem(BaseModel):
    criterion_id: str
    comment: str


class NewAppeal(BaseModel):
    evaluation_id: str
    items: list[AppealItem] = Field(min_length=1)
    author: str = ""


class Decision(BaseModel):
    criterion_id: str
    decision: Literal["accept", "reject"]
    answer: Literal["yes", "no", "na", "score"] | None = None
    value: float | None = None
    reason: str = ""


class DecisionBody(BaseModel):
    items: list[Decision] = Field(min_length=1)
    reviewer: str = ""


def _db() -> sqlite3.Connection:
    con = sqlite3.connect(DB_PATH)
    con.row_factory = sqlite3.Row
    con.execute(
        "CREATE TABLE IF NOT EXISTS appeals(id TEXT PRIMARY KEY, evaluation_id TEXT NOT NULL, "
        "status TEXT NOT NULL, created_at TEXT NOT NULL, resolved_at TEXT, "
        "author TEXT NOT NULL DEFAULT '', reviewer TEXT NOT NULL DEFAULT '', "
        "items_json TEXT NOT NULL, result_json TEXT)"
    )
    return con


def _now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%S%z")


def _cfg(ev: dict) -> dict:
    cfg = load_checklist(ev["checklist_id"], ev["checklist_version"])
    if not cfg:
        raise HTTPException(409, "Чек-лист этой оценки удалён, пересчёт невозможен")
    return cfg


def _valid(k: dict, answer: str | None, value: float | None) -> bool:
    if answer == "na":
        return k["type"] != "flag" and bool(k.get("na_allowed"))
    if k["type"] in ("yesno", "flag"):
        return answer in ("yes", "no")
    return answer == "score" and value in [s["value"] for s in k["scale"]]


def _final(ev: dict, cfg: dict) -> dict:
    """Original evaluation + all accepted decisions of resolved appeals, rescored."""
    with _db() as con:
        rows = con.execute(
            "SELECT id, items_json FROM appeals WHERE evaluation_id = ? AND status != 'pending' "
            "ORDER BY resolved_at, rowid", (ev["id"],)
        ).fetchall()
    changes, reviews = {}, {}
    for r in rows:
        for it in json.loads(r["items_json"]):
            if it.get("decision") == "accept":
                changes[it["criterion_id"]] = {"answer": it["answer"], "value": it.get("value")}
                reviews[it["criterion_id"]] = {"reason": it.get("reason", ""), "appeal_id": r["id"]}
    items = {c["id"]: {"answer": c["answer"], "value": c["value"], "explanation": c["explanation"],
                       "evidence": c["evidence"], "checked_range": c["checked_range"]} for c in ev["criteria"]}
    for cid, ch in changes.items():
        items[cid].update(ch)
    res = score(cfg, items)
    orig = {c["id"]: c for c in ev["criteria"]}
    for row in res["criteria"]:
        o = orig[row["id"]]
        row["original"] = {"answer": o["answer"], "value": o["value"], "points": o["points"]}
        row["changed"] = row["id"] in changes
        if row["changed"]:
            row["review"] = reviews[row["id"]]
    return {**ev, **res, "original_total": ev["total"], "original_gross_violation": ev["gross_violation"],
            "changed": bool(changes)}


def _summary(r: sqlite3.Row, ev: dict) -> dict:
    names = {c["id"]: c["name"] for c in ev["criteria"]}
    res = json.loads(r["result_json"]) if r["result_json"] else None
    return {
        "id": r["id"], "evaluation_id": r["evaluation_id"], "conversation_id": ev["conversation_id"],
        "checklist_name": ev["checklist_name"], "status": r["status"], "created_at": r["created_at"],
        "resolved_at": r["resolved_at"], "author": r["author"], "reviewer": r["reviewer"],
        "original_total": ev["total"], "max_total": ev["max_total"],
        "final_total": res["total"] if res else None,
        "items": [{"criterion_id": i["criterion_id"], "name": names.get(i["criterion_id"], i["criterion_id"]),
                   "comment": i["comment"], "decision": i.get("decision"), "reason": i.get("reason")}
                  for i in json.loads(r["items_json"])],
    }


def _one(con: sqlite3.Connection, aid: str) -> sqlite3.Row:
    r = con.execute("SELECT * FROM appeals WHERE id = ?", (aid,)).fetchone()
    if not r:
        raise HTTPException(404, "Апелляция не найдена")
    return r


def _detail(aid: str) -> dict:
    with _db() as con:
        r = _one(con, aid)
    ev = get_evaluation(r["evaluation_id"])
    cfg = _cfg(ev)
    rows = {c["id"]: c for c in ev["criteria"]}
    metas = {k["id"]: k for k in cfg["criteria"]}
    items = []
    for i in json.loads(r["items_json"]):
        k = metas[i["criterion_id"]]
        items.append({**i, "criterion": rows[i["criterion_id"]],
                      "meta": {"type": k["type"], "scale": k.get("scale"),
                               "na_allowed": bool(k.get("na_allowed")) and k["type"] != "flag"}})
    return {**_summary(r, ev), "items": items, "current_total": _final(ev, cfg)["total"],
            "result": json.loads(r["result_json"]) if r["result_json"] else None}


@router.post("/appeals")
def create_appeal(body: NewAppeal):
    ev = get_evaluation(body.evaluation_id)
    known = {c["id"] for c in ev["criteria"]}
    with _db() as con:
        pending = {i["criterion_id"]
                   for r in con.execute("SELECT items_json FROM appeals WHERE evaluation_id = ? AND status = 'pending'",
                                        (ev["id"],)).fetchall()
                   for i in json.loads(r["items_json"])}
        seen, items = set(), []
        for it in body.items:
            if it.criterion_id not in known:
                raise HTTPException(422, f"Критерий {it.criterion_id} не найден в этой оценке")
            if it.criterion_id in seen:
                raise HTTPException(422, "Критерии в апелляции повторяются")
            if it.criterion_id in pending:
                raise HTTPException(409, f"По критерию {it.criterion_id} уже есть апелляция на рассмотрении")
            comment = it.comment.strip()
            if len(comment) < 5:
                raise HTTPException(422, "Опишите причину апелляции (минимум 5 символов)")
            seen.add(it.criterion_id)
            items.append({"criterion_id": it.criterion_id, "comment": comment})
        aid = uuid.uuid4().hex[:10]
        con.execute("INSERT INTO appeals(id, evaluation_id, status, created_at, author, items_json) "
                    "VALUES(?, ?, 'pending', ?, ?, ?)",
                    (aid, ev["id"], _now(), body.author.strip(), json.dumps(items, ensure_ascii=False)))
        r = _one(con, aid)
    return _summary(r, ev)


@router.get("/appeals")
def list_appeals(evaluation_id: str | None = None, status: str | None = None):
    q, where, args = "SELECT * FROM appeals", [], []
    if evaluation_id:
        where.append("evaluation_id = ?"); args.append(evaluation_id)
    if status:
        where.append("status = ?"); args.append(status)
    if where:
        q += " WHERE " + " AND ".join(where)
    with _db() as con:
        rows = con.execute(q + " ORDER BY (status = 'pending') DESC, created_at DESC", args).fetchall()
    cache, out = {}, []
    for r in rows:
        if r["evaluation_id"] not in cache:
            cache[r["evaluation_id"]] = get_evaluation(r["evaluation_id"])
        out.append(_summary(r, cache[r["evaluation_id"]]))
    return out


@router.get("/appeals/{aid}")
def get_appeal(aid: str):
    return _detail(aid)


@router.post("/appeals/{aid}/decision")
def decide(aid: str, body: DecisionBody):
    with _db() as con:
        r = _one(con, aid)
        if r["status"] != "pending":
            raise HTTPException(409, "Решение по этой апелляции уже сохранено")
        ev = get_evaluation(r["evaluation_id"])
        cfg = _cfg(ev)
        cur = {c["id"]: c for c in _final(ev, cfg)["criteria"]}
        metas = {k["id"]: k for k in cfg["criteria"]}
        items = json.loads(r["items_json"])
        by = {d.criterion_id: d for d in body.items}
        if set(by) != {i["criterion_id"] for i in items}:
            raise HTTPException(422, "Нужно решение по каждому критерию апелляции")
        for i in items:
            d, cid = by[i["criterion_id"]], i["criterion_id"]
            reason = d.reason.strip()
            if len(reason) < 3:
                raise HTTPException(422, f"Укажите причину решения по критерию {cid}")
            i.update(decision=d.decision, reason=reason)
            if d.decision == "accept":
                if not _valid(metas[cid], d.answer, d.value):
                    raise HTTPException(422, f"Недопустимый новый ответ для критерия {cid}")
                value = d.value if d.answer == "score" else None
                if d.answer == cur[cid]["answer"] and value == cur[cid]["value"]:
                    raise HTTPException(422, f"Новый ответ по критерию {cid} совпадает с текущим, отклоните апелляцию")
                i.update(answer=d.answer, value=value)
        accepted = sum(1 for i in items if i["decision"] == "accept")
        status = "accepted" if accepted == len(items) else "rejected" if accepted == 0 else "partial"
        con.execute("UPDATE appeals SET status = ?, resolved_at = ?, reviewer = ?, items_json = ? WHERE id = ?",
                    (status, _now(), body.reviewer.strip(), json.dumps(items, ensure_ascii=False), aid))
    fin = _final(ev, cfg)  # after commit, so it includes this decision
    with _db() as con:
        con.execute("UPDATE appeals SET result_json = ? WHERE id = ?",
                    (json.dumps({"total": fin["total"], "max_total": fin["max_total"],
                                 "gross_violation": fin["gross_violation"]}), aid))
    return _detail(aid)


@router.get("/evaluations/{eid}/final")
def final_result(eid: str):
    ev = get_evaluation(eid)
    return _final(ev, _cfg(ev))