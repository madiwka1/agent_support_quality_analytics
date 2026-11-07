import re
from dataclasses import dataclass, field
from datetime import datetime

CONFIG = {
    "merge_calls": True,
    "collapse_masks": True,
    "collapse_repeats": True,
    "templates": True,
    "template_rules": [
        ("bot", r"Я AIM, AI-ассистент Freedom Broker", "[шаблон: приветствие бота]"),
        ("bot", r"Продолжая разговор,? [Вв]ы соглашаетесь", "[шаблон: согласие на обработку данных]"),
        ("bot", r"нажмите\s+(\d|ноль|один|два|три|четыре|пять|шесть|семь|восемь|девять)", "[голосовое меню]"),
    ],
    "menu_choice": r"^(\s*(\d|ноль|нөл|zero)[.,!]?)+\s*$",
    "events": [
        (r"Эскалация на оператора|Агент присоединился", "operator_joined", "[система: оператор подключился]"),
        (r"Клиент завершил разговор", "client_ended", "[система: клиент завершил разговор]"),
        (r"приостановлен", "recording_paused", "[система: запись приостановлена]"),
        (r"возобновлен", "recording_resumed", "[система: запись возобновлена]"),
        (r"запущены|басталды|recording started", "recording_started", "[система: запись начата]"),
        (r"language|язык", "language_changed", "[система: язык диалога изменён]"),
        (r"переведен.*представител|transfer", "transfer", "[система: перевод на представителя]"),
    ],
}

CALL_NOTE = ("Это автоматическая расшифровка телефонного звонка, возможны ошибки распознавания. "
             "Интерпретируй по смыслу и не штрафуй оператора за искажённые слова. "
             "[Имя скрыто] после \"меня зовут\" означает, что оператор представился.")


@dataclass
class CleanTurn:
    idx: int
    source_indices: list[int]
    speaker: str
    ts_rel: str
    ts_original: str
    text: str
    text_llm: str
    event_type: str | None = None
    flags: dict = field(default_factory=dict)


@dataclass
class CleanDialog:
    conversation_id: str | None
    channel: str
    language: str
    turns: list[CleanTurn]
    meta: dict


def _secs(ts: str) -> float:
    m = re.fullmatch(r"(\d+):(\d{2})(?::(\d{2}))?", ts.strip())
    if m:
        a, b, c = m.groups()
        return int(a) * 3600 + int(b) * 60 + int(c) if c else int(a) * 60 + int(b)
    try:
        return datetime.fromisoformat(ts.replace("Z", "+00:00")).timestamp()
    except ValueError:
        return 0.0


def _mmss(s: float) -> str:
    s = max(int(s), 0)
    return f"{s // 60:02d}:{s % 60:02d}"


def _collapse_masks(t: str) -> str:
    def rep(m: re.Match) -> str:
        n = len(re.findall(re.escape(m.group(1)), m.group(0)))
        return f"{m.group(1)[:-1]} ×{n}]"
    return re.sub(r"(\[[^\]]*скрыт[^\]]*\])(?:[\s,.]*\1)+", rep, t)


def _collapse_repeats(t: str) -> str:
    t = re.sub(r"\b((?:\w+[\s,]+){1,7}\w+)(?:[\s,.]+\1\b){2,}", r"\1 \1", t, flags=re.I)
    t = re.sub(r"\b(\w+)(?:[\s,]+\1\b){2,}", r"\1 \1", t, flags=re.I)
    return re.sub(r"(.)\1{4,}", r"\1\1\1", t)


def clean_dialog(record: dict, cfg: dict = CONFIG) -> CleanDialog:
    is_call = record.get("channel") == "voice call"
    src = record["transcript"]
    order = sorted(range(len(src)), key=lambda i: _secs(src[i]["timestamp"]))
    t0 = _secs(src[order[0]]["timestamp"]) if order else 0.0

    turns: list[CleanTurn] = []
    seen: dict[tuple, CleanTurn] = {}
    n_dupes = n_merged = 0
    for i in order:
        m = src[i]
        key = (m["timestamp"], m["speaker"], m["text"])
        if key in seen:
            seen[key].flags["deduped"] = True
            n_dupes += 1
            continue
        prev = turns[-1] if turns else None
        if (is_call and cfg["merge_calls"] and prev and prev.speaker == m["speaker"] != "system"):
            prev.source_indices.append(i)
            prev.text += " " + m["text"]
            prev.flags["merged"] = True
            n_merged += 1
            seen[key] = prev
            continue
        ts_rel = _mmss(_secs(m["timestamp"]) - t0) if is_call else m["timestamp"]
        turns.append(CleanTurn(0, [i], m["speaker"], ts_rel, m["timestamp"], m["text"], ""))
        seen[key] = turns[-1]

    meta = {"operator_joined_idx": None, "client_ended_idx": None, "n_source_turns": len(src),
            "n_clean_turns": len(turns),
            "stats": {"deduped": n_dupes, "merged": n_merged, "masks_collapsed": 0, "repeats_collapsed": 0,
                      "templates": 0, "events": 0, "after_end": 0}}
    st = meta["stats"]
    ended = False
    for n, t in enumerate(turns, 1):
        t.idx, t.flags = n, {"merged": False, "deduped": False, "masks_collapsed": False,
                             "repeats_collapsed": False, "template": False, "after_end": ended, **t.flags}
        x = t.text
        if cfg["collapse_masks"] and (y := _collapse_masks(x)) != x:
            x, t.flags["masks_collapsed"] = y, True
            st["masks_collapsed"] += 1
        if cfg["collapse_repeats"] and (y := _collapse_repeats(x)) != x:
            x, t.flags["repeats_collapsed"] = y, True
            st["repeats_collapsed"] += 1
        if cfg["templates"]:
            for spk, rx, label in cfg["template_rules"]:
                if t.speaker == spk and re.search(rx, x, re.I):
                    x, t.flags["template"] = label, True
                    break
            prev = turns[n - 2] if n > 1 else None
            if (t.speaker == "client" and prev and prev.text_llm in ("[голосовое меню]", "[выбор в меню]")
                    and re.match(cfg["menu_choice"], x, re.I)):
                x, t.flags["template"] = "[выбор в меню]", True
            st["templates"] += t.flags["template"]
        if t.speaker == "system":
            for rx, ev, label in cfg["events"]:
                if re.search(rx, x, re.I):
                    x, t.event_type = label, ev
                    st["events"] += 1
                    break
            if t.event_type == "operator_joined" and meta["operator_joined_idx"] is None:
                meta["operator_joined_idx"] = n
            if t.event_type == "client_ended" and not ended:
                meta["client_ended_idx"], ended = n, True
        st["after_end"] += t.flags["after_end"]
        t.text_llm = x
    return CleanDialog(record.get("conversation_id"), record.get("channel", "agent chat"),
                       record.get("language", ""), turns, meta)


def render_for_llm(cd: CleanDialog, window: tuple[int, int] | None = None) -> str:
    a, b = window or (1, len(cd.turns))
    lines = [CALL_NOTE] if cd.channel == "voice call" else []
    if a > 1:
        lines.append(f"[реплики T1–T{a - 1} опущены]")
    for t in cd.turns[a - 1:b]:
        mark = "[после завершения звонка] " if t.flags["after_end"] else ""
        lines.append(f"[T{t.idx} | {t.speaker} | {t.ts_rel}] {mark}{t.text_llm}")
    if b < len(cd.turns):
        lines.append(f"[реплики T{b + 1}–T{len(cd.turns)} опущены]")
    return "\n".join(lines)


def to_source_indices(cd: CleanDialog, llm_turn_idx: int) -> list[int]:
    if 1 <= llm_turn_idx <= len(cd.turns):
        return sorted(cd.turns[llm_turn_idx - 1].source_indices)
    return []
