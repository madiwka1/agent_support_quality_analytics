import json
import sqlite3
import time
import uuid
from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field, model_validator

from app.checklist import DB_PATH

router = APIRouter(prefix="/api/conversations", tags=["conversations"])


class Message(BaseModel):
    timestamp: str  # kept exactly as received: MM:SS for chats, ISO 8601 for calls
    speaker: Literal["client", "operator", "bot", "system"]
    text: str


class Conversation(BaseModel):
    conversation_id: str | None = None
    channel: Literal["agent chat", "voice call"] = "agent chat"
    language: Literal["RU", "KZ", "EN"]
    transcript: list[Message] = Field(min_length=1)
    audio_url: str | None = None

    @model_validator(mode="after")
    def _has_operator(self):
        if not any(m.speaker == "operator" for m in self.transcript):
            raise ValueError("в диалоге нет реплик оператора")
        return self


def _db() -> sqlite3.Connection:
    con = sqlite3.connect(DB_PATH)
    con.row_factory = sqlite3.Row
    con.execute(
        "CREATE TABLE IF NOT EXISTS conversations("
        "conversation_id TEXT PRIMARY KEY, record_json TEXT NOT NULL, created_at TEXT NOT NULL)"
    )
    return con


@router.post("")
def save(conv: Conversation):
    """Stores (or replaces) a conversation. Missing ids are generated."""
    cid = conv.conversation_id or "upl-" + uuid.uuid4().hex[:8]
    rec = {**conv.model_dump(), "conversation_id": cid}
    with _db() as con:
        con.execute(
            "INSERT OR REPLACE INTO conversations VALUES(?, ?, ?)",
            (cid, json.dumps(rec, ensure_ascii=False), time.strftime("%Y-%m-%dT%H:%M:%S%z")),
        )
    return rec


@router.get("")
def list_all():
    with _db() as con:
        rows = con.execute("SELECT * FROM conversations ORDER BY created_at DESC").fetchall()
    out = []
    for r in rows:
        rec = json.loads(r["record_json"])
        out.append({"conversation_id": r["conversation_id"], "channel": rec["channel"],
                    "language": rec["language"], "messages": len(rec["transcript"]), "created_at": r["created_at"]})
    return out


@router.get("/{conversation_id}")
def get_one(conversation_id: str):
    with _db() as con:
        r = con.execute("SELECT record_json FROM conversations WHERE conversation_id = ?", (conversation_id,)).fetchone()
    if not r:
        raise HTTPException(404, "Диалог не найден")
    return json.loads(r["record_json"])
