"""Evaluation of a conversation against a checklist version.

The LLM only judges each criterion (answer + explanation + evidence message numbers).
All arithmetic (weights, N/A redistribution, rounding, sections) is done here in code,
using the `settings` stored in the checklist version.

Env:
  CQA_LLM_URL      base URL of the OpenAI-compatible API, e.g. http://<host>:<port>/v1
  CQA_LLM_KEY      bearer token (do NOT commit it)
  CQA_LLM_MODEL    model id; if empty, the first model from GET /models is used
  CQA_LLM_TIMEOUT  seconds per call (default 300)
  CQA_LLM_CTX      model context, prompt + answer, in tokens (default 6144)
"""
import json
import os
import re
import sqlite3
import time
import urllib.error
import urllib.request
import uuid

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.checklist import DB_PATH, load_checklist
from app.clean import CleanDialog, clean_dialog, render_for_llm, to_source_indices
from app.conversations import _db as _conv_db

import logging
from pathlib import Path

log = logging.getLogger("uvicorn.error")


def _load_env() -> None:
    """Minimal .env loader; real env vars win unless they are empty."""
    for p in (Path.cwd() / ".env", Path(__file__).resolve().parent.parent / ".env"):
        if p.is_file():
            for line in p.read_text(encoding="utf-8-sig").splitlines():
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, v = line.split("=", 1)
                k, v = k.strip(), v.strip().strip('"').strip("'")
                if v and not os.environ.get(k):
                    os.environ[k] = v
            log.info(".env loaded from %s", p)
            return
    log.warning(".env not found (looked in %s and project root)", Path.cwd())


_load_env()

router = APIRouter(prefix="/api/evaluations", tags=["evaluations"])

LLM_URL = os.getenv("CQA_LLM_URL", "").rstrip("/")
LLM_KEY = os.getenv("CQA_LLM_KEY", "")
LLM_MODEL = os.getenv("CQA_LLM_MODEL", "")
LLM_TIMEOUT = int(os.getenv("CQA_LLM_TIMEOUT", "300"))
LLM_CTX = int(os.getenv("CQA_LLM_CTX", "6144"))
OUT_TOKENS = 1500
MAX_ATTEMPTS = 3
_model_cache: str | None = None

SYSTEM = """Ты эксперт по контролю качества диалогов контакт-центра компании Freedom Broker. Оцениваешь ТОЛЬКО работу оператора (speaker=operator) по заданному чек-листу. Реплики client, bot и system служат контекстом.

Правила:
- Диалог может быть на русском, казахском или английском. Чек-лист один для всех языков. Приветствие должно быть на языке клиента.
- Опирайся только на текст диалога, ничего не домысливай. Каждый вывод подтверждай номерами реплик.
- «no» означает: действие было нужно, но оператор его пропустил или выполнил неправильно. «na» ставь только если N/A разрешён у критерия и выполнено его условие; в объяснении назови выполненное условие.
- Если требовалась проверка личности перед защищённым действием и она не подтверждена в чате, ставь «no». Общий вопрос (например, о тарифах) идентификации не требует.
- Для шкального критерия выбирай ровно одну из перечисленных ступеней.
- Консультация оценивает правильность и полноту решения запроса. Ведение диалога оценивает ясность и последовательность. Не наказывай дважды за одно и то же.
- Флаг грубых ошибок: «yes» означает, что нарушение выявлено. К нарушениям относятся оскорбление клиента, предложение платной услуги в обход компании (перевести деньги оператору лично для инвестирования или дать личный номер клиента для частной платной консультации) и раскрытие конфиденциальной информации. Достаточно самого предложения в переписке, согласие клиента и перевод денег не нужны.
- Порог первой реакции в 3 минуты, теги и вложения в оценку не входят.
- Объяснения пиши по-русски, 1-3 предложения. Цитировать реплики не нужно, достаточно их номеров.
- Отвечай только одним JSON-объектом, без пояснений и без markdown."""

FORMAT = """Формат ответа:
{"criteria":[{"id":"<id критерия>","answer":<см. ниже>,"explanation":"<обоснование>","evidence":[<номера реплик>],"checked_range":[<от>,<до>]}]}
- Номер реплики — число после T: для [T12 | operator | 01:17] это 12.
- Ровно одна запись на каждый критерий, id как в списке.
- answer: для типа yesno и flag это "yes" или "no" (или "na", если разрешено); для типа scale это число-ступень (или "na", если разрешено).
- evidence: номера реплик, на которых основан вывод (до 5). Для пропущенного действия укажи ближайшие реплики, где оно ожидалось. Для N/A можно оставить пустым.
- checked_range: [первая, последняя] реплика проверенного участка. Обязательно, если evidence пуст (пропущенное действие или отсутствие нарушения)."""


class LLMError(Exception):
    def __init__(self, code: int, msg: str):
        super().__init__(f"{code or 'сеть'}: {msg}")
        self.code, self.msg = code, msg

    @property
    def context_overflow(self) -> bool:
        return self.code == 400 and "maximum context length" in self.msg


class ContextTooLong(Exception):
    pass


# ---------------------------------------------------------------- LLM client
def _http(path: str, body: dict | None = None, base: str | None = None) -> dict:
    if not LLM_URL:
        raise LLMError(0, "CQA_LLM_URL не задан (.env)")
    req = urllib.request.Request(
        (base or LLM_URL) + path,
        data=json.dumps(body).encode() if body is not None else None,
        headers={"Authorization": f"Bearer {LLM_KEY}", "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=LLM_TIMEOUT) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        raise LLMError(e.code, e.read().decode(errors="replace")[:500])
    except (urllib.error.URLError, TimeoutError, OSError) as e:
        raise LLMError(0, str(e))


def _model() -> str:
    global _model_cache
    if LLM_MODEL:
        return LLM_MODEL
    if not _model_cache:
        data = _http("/models").get("data") or []
        if not data:
            raise LLMError(0, "сервер не вернул ни одной модели")
        _model_cache = data[0]["id"]
    return _model_cache


def count_tokens(messages: list[dict]) -> int:
    try:
        return int(_http("/tokenize", {"model": _model(), "messages": messages},
                         base=re.sub(r"/v1$", "", LLM_URL))["count"])
    except (LLMError, KeyError, TypeError, ValueError) as e:
        log.warning("tokenize unavailable (%s), estimating", e)
        return int(sum(len(m["content"]) for m in messages) / 2.5)


def _chat(messages: list[dict], max_tokens: int = OUT_TOKENS) -> str:
    body = {"model": _model(), "messages": messages, "temperature": 0, "max_tokens": max_tokens,
            "response_format": {"type": "json_object"}}
    try:
        data = _http("/chat/completions", body)
    except LLMError as e:
        if e.code not in (400, 422) or e.context_overflow:
            raise
        body.pop("response_format")  # server without JSON mode
        data = _http("/chat/completions", body)
    try:
        return data["choices"][0]["message"]["content"] or ""
    except (KeyError, IndexError, TypeError):
        raise LLMError(0, "неожиданный формат ответа модели")


def _parse_json(text: str):
    text = re.sub(r"<think>.*?</think>", "", text, flags=re.S).strip()
    text = re.sub(r"^```(?:json)?|```$", "", text, flags=re.M).strip()
    a, b = text.find("{"), text.rfind("}")
    if a < 0 or b < a:
        raise ValueError("JSON не найден")
    return json.loads(text[a:b + 1])


# ---------------------------------------------------------------- prompt
def _criteria_text(cfg: dict, short: bool = False) -> str:
    out = []
    for k in cfg["criteria"]:
        lines = [f'[{k["id"]}] {k["name"]} (секция: {k["section"]})']
        if k["type"] == "flag":
            lines.append('Тип: flag. answer "yes" = нарушение выявлено, "no" = не выявлено. Баллов нет.')
        elif k["type"] == "yesno":
            lines.append(f'Тип: yesno. Вес {k["weight"]}. "yes" даёт полный вес, "no" ноль.')
        else:
            steps = "; ".join(f'{s["value"]:g} = {s["desc"] or "без описания"}' for s in k["scale"])
            lines.append(f'Тип: scale. Вес {k["weight"]}. Ступени: {steps}.')
        if k.get("description") and not short:
            lines.append("Правило: " + k["description"])
        if k.get("na_allowed"):
            lines.append("N/A допустим, если: " + k["na_condition"])
        else:
            lines.append("N/A недопустим.")
        out.append("\n".join(lines))
    return "\n\n".join(out)


def _messages(cd: CleanDialog, cfg: dict, short: bool = False, window: tuple[int, int] | None = None) -> list[dict]:
    user = (f'Чек-лист «{cfg["name"]}», версия {cfg["version"]}.\n\n=== КРИТЕРИИ ===\n{_criteria_text(cfg, short)}\n\n'
            f'=== ДИАЛОГ (канал: {cd.channel}, язык: {cd.language}) ===\n{render_for_llm(cd, window)}\n\n{FORMAT}')
    return [{"role": "system", "content": SYSTEM}, {"role": "user", "content": user}]


def _levels(cd: CleanDialog) -> list[tuple[bool, tuple[int, int] | None]]:
    start = cd.meta["operator_joined_idx"] or 1
    return [(False, None), (True, None), (True, (start, len(cd.turns)))]


# ---------------------------------------------------------------- validation
_YES, _NO, _NA = {"yes", "да", "true", "y"}, {"no", "нет", "false", "n"}, {"na", "n/a", "н/а", "none", "null"}


def _evidence(raw, cd: CleanDialog, tr: list[dict]) -> list[dict]:
    seen, out = set(), []
    for i in raw if isinstance(raw, list) else []:
        try:
            src = to_source_indices(cd, int(i))
        except (TypeError, ValueError):
            continue
        if src and src[0] not in seen and len(out) < 5:
            seen.add(src[0])
            out.append({"index": src[0], "index_to": src[-1], **tr[src[0]]})
    return out


def _range(raw, cd: CleanDialog, tr: list[dict]) -> dict | None:
    try:
        a, b = sorted(int(x) for x in raw[:2])
    except (TypeError, ValueError, IndexError):
        return None
    a, b = max(a, 1), min(b, len(cd.turns))
    if a > b:
        return None
    a, b = to_source_indices(cd, a)[0], to_source_indices(cd, b)[-1]
    return {"from": a, "to": b, "from_ts": tr[a]["timestamp"], "to_ts": tr[b]["timestamp"]}


def _normalize(raw, cfg: dict, cd: CleanDialog, tr: list[dict]) -> tuple[dict, list[str]]:
    rows = raw.get("criteria") if isinstance(raw, dict) else raw
    by_id = {str(r.get("id")): r for r in rows or [] if isinstance(r, dict)}
    items, errors = {}, []
    for k in cfg["criteria"]:
        r = by_id.get(k["id"])
        if r is None:
            errors.append(f'нет записи для критерия {k["id"]}')
            continue
        s = str(r.get("answer")).strip().lower()
        it = {"answer": None, "value": None}
        if s in _NA:
            if k["type"] == "flag" or not k.get("na_allowed"):
                errors.append(f'{k["id"]}: N/A недопустим')
                continue
            it["answer"] = "na"
        elif k["type"] in ("yesno", "flag"):
            if s in _YES:
                it["answer"] = "yes"
            elif s in _NO:
                it["answer"] = "no"
            else:
                errors.append(f'{k["id"]}: answer должен быть "yes" или "no"')
                continue
        else:
            vals = [x["value"] for x in k["scale"]]
            try:
                v = float(r.get("answer"))
            except (TypeError, ValueError):
                errors.append(f'{k["id"]}: answer должен быть одной из ступеней {vals}')
                continue
            it["answer"], it["value"] = "score", min(vals, key=lambda x: abs(x - v))  # snap to nearest step
        if not str(r.get("explanation") or "").strip():
            errors.append(f'{k["id"]}: пустое объяснение')
            continue
        it["explanation"] = str(r["explanation"]).strip()
        it["evidence"] = _evidence(r.get("evidence"), cd, tr)
        it["checked_range"] = _range(r.get("checked_range"), cd, tr)
        if it["answer"] != "na" and not it["evidence"] and not it["checked_range"]:
            it["checked_range"] = _range([1, len(cd.turns)], cd, tr)
        items[k["id"]] = it
    return items, errors


def _ask(messages: list[dict], cfg: dict, cd: CleanDialog, tr: list[dict]) -> dict:
    errors: list[str] = []
    for _ in range(MAX_ATTEMPTS):
        room = LLM_CTX - count_tokens(messages) - 50
        if room < OUT_TOKENS // 3:
            if errors:
                break
            raise ContextTooLong()
        try:
            text = _chat(messages, min(OUT_TOKENS, room))
        except LLMError as e:
            if e.context_overflow:
                raise ContextTooLong()
            log.error("LLM call failed: %s (url=%s, key set=%s)", e, LLM_URL, bool(LLM_KEY))
            raise HTTPException(502, f"Модель недоступна: {e}")
        try:
            items, errors = _normalize(_parse_json(text), cfg, cd, tr)
        except ValueError as e:
            items, errors = {}, [f"ответ не является корректным JSON ({e})"]
        if not errors:
            return items
        messages = messages + [{"role": "assistant", "content": text},
                               {"role": "user", "content": "Ответ не принят: " + "; ".join(errors) + ". Верни исправленный JSON целиком."}]
    raise HTTPException(502, "Некорректный ответ модели: " + "; ".join(errors))


def _judge(conv: dict, cfg: dict) -> tuple[dict, dict]:
    cd = clean_dialog(conv)
    for level, (short, window) in enumerate(_levels(cd)):
        messages = _messages(cd, cfg, short, window)
        n = count_tokens(messages)
        if n > LLM_CTX - OUT_TOKENS - 50:
            continue
        try:
            items = _ask(messages, cfg, cd, conv["transcript"])
        except ContextTooLong:
            continue
        return items, {"prompt_tokens": n, "compression_level": level,
                       "clean_turns": cd.meta["n_clean_turns"], "source_turns": cd.meta["n_source_turns"]}
    raise ContextTooLong()


def _not_evaluated(cfg: dict, reason: str) -> dict:
    return {k["id"]: {"answer": "not_evaluated", "value": None, "explanation": reason,
                      "evidence": [], "checked_range": None} for k in cfg["criteria"]}


# ---------------------------------------------------------------- scoring
def score(cfg: dict, items: dict) -> dict:
    st = cfg.get("settings") or {}
    nd, mx = int(st.get("rounding", 2)), float(st.get("max_total", 100))
    scored = [k for k in cfg["criteria"] if k["type"] != "flag"]
    applicable = [k for k in scored if items[k["id"]]["answer"] not in ("na", "not_evaluated")]
    app_w = sum(k["weight"] for k in applicable)
    base = app_w if st.get("redistribute_na", True) else sum(k["weight"] for k in scored)
    f = mx / base if base and app_w else 0.0

    sections = {s: {"name": s, "points": 0.0, "max": 0.0} for s in cfg["sections"]}
    rows, total = [], 0.0
    for k in cfg["criteria"]:
        it = items[k["id"]]
        row = {"id": k["id"], "name": k["name"], "section": k["section"], "type": k["type"], "weight": k["weight"],
               "answer": it["answer"], "value": it["value"], "explanation": it["explanation"],
               "evidence": it["evidence"], "checked_range": it["checked_range"],
               "points": None, "effective_weight": None}
        if k["type"] != "flag" and it["answer"] not in ("na", "not_evaluated"):
            if k["type"] == "yesno":
                ratio = 1.0 if it["answer"] == "yes" else 0.0
            else:
                ratio = max(it["value"], 0) / max(x["value"] for x in k["scale"])
            pts, ew = ratio * k["weight"] * f, k["weight"] * f
            row["points"], row["effective_weight"] = round(pts, nd), round(ew, nd)
            total += pts
            sections[k["section"]]["points"] += pts
            sections[k["section"]]["max"] += ew
        rows.append(row)

    flags = [r for r in rows if r["type"] == "flag"]
    return {
        "total": round(total, nd) if app_w else None,
        "max_total": mx,
        "gross_violation": any(r["answer"] == "yes" for r in flags),
        "incomplete": any(r["answer"] == "not_evaluated" for r in rows),
        "sections": [{**s, "points": round(s["points"], nd), "max": round(s["max"], nd), "applicable": s["max"] > 0}
                     for s in sections.values() if any(k["section"] == s["name"] for k in cfg["criteria"])],
        "criteria": rows,
    }


# ---------------------------------------------------------------- storage + API
def _db() -> sqlite3.Connection:
    con = sqlite3.connect(DB_PATH)
    con.row_factory = sqlite3.Row
    con.execute("CREATE TABLE IF NOT EXISTS evaluations(id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, "
                "checklist_id INTEGER NOT NULL, checklist_version INTEGER NOT NULL, "
                "created_at TEXT NOT NULL, result_json TEXT NOT NULL)")
    return con


class EvaluateRequest(BaseModel):
    conversation_id: str
    checklist_id: int
    version: int | None = None  # None = latest; the resolved number is stored


@router.post("")
def evaluate(req: EvaluateRequest):
    with _conv_db() as con:
        r = con.execute("SELECT record_json FROM conversations WHERE conversation_id = ?", (req.conversation_id,)).fetchone()
    if not r:
        raise HTTPException(404, "Диалог не найден")
    conv = json.loads(r["record_json"])
    cfg = load_checklist(req.checklist_id, req.version)
    if not cfg:
        raise HTTPException(404, "Чек-лист или версия не найдены")

    try:
        items, trace = _judge(conv, cfg)
    except ContextTooLong:
        items = _not_evaluated(cfg, "Диалог слишком длинный: не помещается в контекст модели даже после сжатия.")
        trace = {"prompt_tokens": None, "compression_level": None}
    result = {
        "id": uuid.uuid4().hex[:12],
        "conversation_id": req.conversation_id,
        "checklist_id": cfg["id"],
        "checklist_version": cfg["version"],
        "checklist_name": cfg["name"],
        "model": LLM_MODEL or _model_cache,
        "created_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        **trace,
        **score(cfg, items),
    }
    with _db() as con:
        con.execute("INSERT INTO evaluations VALUES(?, ?, ?, ?, ?, ?)",
                    (result["id"], result["conversation_id"], cfg["id"], cfg["version"], result["created_at"],
                     json.dumps(result, ensure_ascii=False)))
    return result


@router.get("")
def list_evaluations(conversation_id: str | None = None):
    q, args = "SELECT result_json FROM evaluations", []
    if conversation_id:
        q, args = q + " WHERE conversation_id = ?", [conversation_id]
    with _db() as con:
        rows = con.execute(q + " ORDER BY created_at DESC", args).fetchall()
    out = []
    for r in rows:
        e = json.loads(r["result_json"])
        out.append({k: e[k] for k in ("id", "conversation_id", "checklist_id", "checklist_name",
                                      "checklist_version", "created_at", "total", "max_total",
                                      "gross_violation")})
    return out


@router.get("/{eid}")
def get_evaluation(eid: str):
    with _db() as con:
        r = con.execute("SELECT result_json FROM evaluations WHERE id = ?", (eid,)).fetchone()
    if not r:
        raise HTTPException(404, "Оценка не найдена")
    return json.loads(r["result_json"])
