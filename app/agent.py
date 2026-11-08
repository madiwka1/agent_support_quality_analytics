"""AI helper for the checklist constructor: a free-text request -> a checklist draft.

Only drafts JSON. The draft is normalized and validated here with the same Checklist model
that versions are saved with, and it is never stored: the constructor loads it as unsaved changes.
"""
import json
import re

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field, ValidationError

from app.checklist import BLANK, Checklist
from app.evaluate import LLM_CTX, LLMError, _chat, _http, _model, _parse_json, count_tokens, log

router = APIRouter(prefix="/api/agent", tags=["agent"])
MAX_ATTEMPTS = 3
OUT_TOKENS = 3000

SYSTEM = """Ты помогаешь сотруднику оценки качества брокера составить чек-лист для оценки работы оператора в чатах и звонках.
По запросу пользователя верни ОДИН JSON-объект — полный чек-лист — без пояснений и без markdown.

Формат:
{"notes":"<1-2 предложения для пользователя: что ты сделал, простыми словами>","name":"<название>","sections":["<секция>",...],
 "criteria":[{"id":"c1","name":"<коротко>","description":"<правило оценки>","section":"<одна из sections>",
   "type":"yesno|scale|flag","weight":<число>,"scale":[{"value":<число>,"desc":"<когда ставится>"}] или null,
   "na_allowed":true|false,"na_condition":"<когда критерий неприменим>" или ""}]}

Правила:
- yesno: description начинай с «Да — …», описывая, что должен сделать оператор. scale: null.
- scale: 2-6 ступеней с разными значениями по убыванию, верхняя ступень равна весу, нижняя 0; у каждой ступени desc.
- flag: грубое нарушение (оскорбление, мошенничество, раскрытие данных). weight 0, scale null, na_allowed false.
- Сумма весов всех критериев кроме flag должна быть ровно 100.
- na_allowed true только если критерий бывает неприменим, тогда na_condition обязателен.
- Каждая секция из sections используется хотя бы одним критерием. Пиши по-русски, кратко и проверяемо по тексту диалога.
- Если дан текущий чек-лист, измени только то, о чём просит пользователь, остальное верни без изменений.
- В notes не используй технические слова (flag, yesno, scale, JSON, id, weight): пиши «флаг грубых нарушений», «шкала», «вес»."""


_STR = {"type": "string", "maxLength": 600}

SCHEMA = {
    "type": "object", "additionalProperties": False,
    "required": ["notes", "name", "sections", "criteria"],
    "properties": {
        "notes": _STR, "name": {"type": "string", "maxLength": 120},
        "sections": {"type": "array", "minItems": 1, "maxItems": 8, "items": {"type": "string", "maxLength": 80}},
        "criteria": {"type": "array", "minItems": 1, "maxItems": 20, "items": {
            "type": "object", "additionalProperties": False,
            "required": ["id", "name", "description", "section", "type", "weight", "scale", "na_allowed", "na_condition"],
            "properties": {
                "id": {"type": "string", "maxLength": 8}, "name": {"type": "string", "maxLength": 120},
                "description": _STR, "section": {"type": "string", "maxLength": 80},
                "type": {"enum": ["yesno", "scale", "flag"]}, "weight": {"type": "number"},
                "scale": {"anyOf": [{"type": "null"}, {"type": "array", "maxItems": 6, "items": {
                    "type": "object", "additionalProperties": False, "required": ["value", "desc"],
                    "properties": {"value": {"type": "number"}, "desc": {"type": "string", "maxLength": 300}}}}]},
                "na_allowed": {"type": "boolean"}, "na_condition": {"type": "string", "maxLength": 300},
            }}},
    },
}


def _ask(messages: list[dict], max_tokens: int) -> str:
    """Like evaluate._chat, but with the checklist JSON schema; falls back to plain JSON mode if the server rejects it."""
    body = {"model": _model(), "messages": messages, "temperature": 0, "max_tokens": max_tokens,
            "response_format": {"type": "json_schema", "json_schema": {"name": "checklist", "schema": SCHEMA}}}
    try:
        data = _http("/chat/completions", body)
    except LLMError as e:
        if e.code not in (400, 422) or e.context_overflow:
            raise
        log.warning("json_schema rejected (%s), falling back to json_object", e.msg[:200])
        return _chat(messages, max_tokens)
    try:
        return data["choices"][0]["message"]["content"] or ""
    except (KeyError, IndexError, TypeError):
        raise LLMError(0, "неожиданный формат ответа модели")


class AgentRequest(BaseModel):
    prompt: str = Field(min_length=3, max_length=2000)
    current: dict | None = None


def _normalize(raw: dict, settings: dict) -> dict:
    """Mechanical fixes the model often gets wrong; real rule violations are left to validation."""
    if "criteria" not in raw:
        raw = next((v for v in raw.values() if isinstance(v, dict) and "criteria" in v), raw)
    crit = [c for c in raw.get("criteria") or [] if isinstance(c, dict)]
    ids = [str(c.get("id", "")) for c in crit]
    if len(set(ids)) != len(ids) or not all(re.fullmatch(r"c\d+", i) for i in ids):
        ids = [f"c{i}" for i in range(1, len(crit) + 1)]
    sections = [str(s) for s in raw.get("sections") or [] if str(s).strip()]
    for c, cid in zip(crit, ids):
        c["id"] = cid
        c["section"] = str(c.get("section") or (sections[0] if sections else "Основное"))
        if c["section"] not in sections:
            sections.append(c["section"])
        c.setdefault("description", "")
        c["na_condition"] = c.get("na_condition") or ""
        if c.get("type") == "flag":
            c.update(weight=0, scale=None, na_allowed=False, na_condition="")
        elif c.get("type") == "scale" and isinstance(c.get("scale"), list):
            steps = {float(s["value"]): s for s in c["scale"] if isinstance(s, dict) and "value" in s}
            c["scale"] = [{"value": v, "desc": str(steps[v].get("desc") or "")} for v in sorted(steps, reverse=True)]
        else:
            c["scale"] = None
    used = {c["section"] for c in crit}
    return {"name": str(raw.get("name") or "Чек-лист").strip(), "sections": [s for s in sections if s in used],
            "criteria": crit, "settings": settings}


def _errors(e: ValidationError) -> str:
    def where(loc) -> str:
        return ".".join(str(x) for x in loc)
    return "; ".join(f"{where(err['loc']) + ': ' if err['loc'] else ''}{err['msg'].removeprefix('Value error, ')}"
                     for err in e.errors())[:800]


@router.post("/checklist")
def draft_checklist(req: AgentRequest):
    settings = (req.current or {}).get("settings") or BLANK["settings"]
    current = None
    if req.current:
        current = {k: req.current.get(k) for k in ("name", "sections", "criteria")}
    user = (f"Текущий чек-лист:\n{json.dumps(current, ensure_ascii=False, separators=(',', ':'))}\n\n" if current else
            "Текущего чек-листа нет, составь новый.\n\n") + f"Запрос пользователя: {req.prompt.strip()}"
    messages = [{"role": "system", "content": SYSTEM}, {"role": "user", "content": user}]
    errors = ""
    for _ in range(MAX_ATTEMPTS):
        room = LLM_CTX - count_tokens(messages) - 50
        if room < 1200:
            raise HTTPException(422, "Запрос вместе с текущим чек-листом слишком длинный для модели. "
                                     "Сократите описания критериев или начните с нуля.")
        try:
            text = _ask(messages, min(OUT_TOKENS, room))
        except LLMError as e:
            log.error("agent LLM call failed: %s", e)
            raise HTTPException(502, f"Модель недоступна: {e}")
        try:
            raw = _parse_json(text)
            if not isinstance(raw, dict):
                raise ValueError("ожидался JSON-объект")
            draft = Checklist.model_validate(_normalize(raw, settings)).model_dump(exclude={"version", "created_at"})
            weights = sum(c["weight"] for c in draft["criteria"] if c["type"] != "flag")
            return {"checklist": draft, "notes": str(raw.get("notes") or "")[:500], "weight_sum": weights}
        except ValueError as e:
            errors = _errors(e) if isinstance(e, ValidationError) else f"ответ не является корректным JSON ({e})"
            log.warning("agent draft rejected: %s | model answer: %s", errors, " ".join(text[:1500].split()))
        messages = messages[:2] + [{"role": "user", "content": f"Прошлый вариант не принят: {errors}. Учти это и верни JSON целиком."}]
    raise HTTPException(502, "Модель не смогла составить корректный чек-лист: " + errors)
