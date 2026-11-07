import json
import re
from pathlib import Path

import pytest

from app import evaluate as ev
from app.clean import clean_dialog, render_for_llm, to_source_indices

DATA = Path(__file__).parent.parent / "transcripts_json"
CHAT = {
    "conversation_id": "t-chat", "channel": "agent chat", "language": "RU", "audio_url": None,
    "transcript": [
        {"timestamp": "00:00", "speaker": "client", "text": "Как пополнить счёт?"},
        {"timestamp": "00:01", "speaker": "bot", "text": "Здравствуйте! Я AIM, AI-ассистент Freedom Broker. Чем помочь?"},
        {"timestamp": "00:02", "speaker": "bot", "text": "Продолжая разговор, Вы соглашаетесь на обработку данных."},
        {"timestamp": "00:10", "speaker": "system", "text": "Эскалация на оператора."},
        {"timestamp": "00:40", "speaker": "operator", "text": "Здравствуйте! Меня зовут Алина."},
        {"timestamp": "00:41", "speaker": "operator", "text": "Пополнить можно в разделе «Счета»."},
        {"timestamp": "01:00", "speaker": "client", "text": "Спасибо"},
    ],
}
CFG = {"name": "t", "version": 1, "sections": ["s"], "settings": {},
       "criteria": [{"id": "c1", "name": "Контакт", "section": "s", "type": "yesno", "weight": 10,
                     "scale": None, "na_allowed": False, "na_condition": "", "description": "длинное правило"}]}


def load(name: str) -> dict:
    return json.loads((DATA / f"{name}.json").read_text(encoding="utf-8"))


def test_call_001_dedup_and_after_end():
    cd = clean_dialog(load("p4-ru-001"))
    assert cd.meta["stats"]["deduped"] == 1
    end = cd.meta["client_ended_idx"]
    after = [t for t in cd.turns if t.idx > end]
    assert after and all(t.flags["after_end"] for t in after)
    assert any(t.speaker == "client" for t in after)
    assert "[после завершения звонка]" in render_for_llm(cd)


def test_call_004_merge_masks_and_size():
    rec = load("p4-ru-004")
    cd = clean_dialog(rec)
    assert 75 <= len(cd.turns) <= 90
    assert not re.search(r"(\[Данные идентификации скрыты\][\s,.]*){2}", render_for_llm(cd))
    assert cd.meta["stats"]["masks_collapsed"] > 0
    assert len(render_for_llm(cd)) <= 0.55 * len(json.dumps(rec, ensure_ascii=False))


@pytest.mark.parametrize("name", ["p4-ru-001", "p4-ru-004", "p1-ru-001"])
def test_index_map_covers_source(name):
    rec = load(name)
    cd = clean_dialog(rec)
    all_idx = [i for t in cd.turns for i in to_source_indices(cd, t.idx)]
    assert all(to_source_indices(cd, t.idx) for t in cd.turns)
    assert len(all_idx) == len(set(all_idx))
    assert len(all_idx) == len(rec["transcript"]) - cd.meta["stats"]["deduped"]
    assert to_source_indices(cd, 0) == [] and to_source_indices(cd, len(cd.turns) + 1) == []


def test_chat_no_merge_only_bot_templates_change():
    cd = clean_dialog(CHAT)
    assert len(cd.turns) == len(CHAT["transcript"])
    for t in cd.turns:
        if t.speaker in ("client", "operator"):
            assert t.text_llm == t.text == CHAT["transcript"][t.source_indices[0]]["text"]
    assert cd.turns[1].text_llm == "[шаблон: приветствие бота]"
    assert cd.turns[2].text_llm == "[шаблон: согласие на обработку данных]"
    assert cd.meta["operator_joined_idx"] == 4
    assert cd.turns[4].ts_rel == "00:40"


@pytest.mark.parametrize("name", ["p4-ru-001", "p4-ru-004"])
def test_render_has_no_raw_parts(name):
    out = render_for_llm(clean_dialog(load(name)))
    assert "audio_url" not in out and "http" not in out and '{"' not in out
    assert not re.search(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}", out)
    assert re.search(r"^\[T1 \| \w+ \| \d{2}:\d{2}\] ", out, re.M)


def test_window():
    cd = clean_dialog(CHAT)
    out = render_for_llm(cd, (4, 5))
    assert "[T3 " not in out and "[T4 " in out and "[T5 " in out and "[T6 " not in out


def _fake_answer(_messages, _max_tokens=0):
    return json.dumps({"criteria": [{"id": "c1", "answer": "yes", "explanation": "ok", "evidence": [5]}]})


def test_overflow_walks_levels(monkeypatch):
    sizes = iter([9000, 9000, 1000, 1000])
    monkeypatch.setattr(ev, "count_tokens", lambda m: next(sizes))
    monkeypatch.setattr(ev, "_chat", _fake_answer)
    items, trace = ev._judge(CHAT, CFG)
    assert trace["compression_level"] == 2 and trace["prompt_tokens"] == 1000
    assert items["c1"]["answer"] == "yes"
    assert items["c1"]["evidence"][0]["index"] == 4


def test_overflow_400_goes_to_next_level(monkeypatch):
    calls = []

    def chat(messages, max_tokens=0):
        calls.append(max_tokens)
        if len(calls) == 1:
            raise ev.LLMError(400, "This model's maximum context length is 6144 tokens")
        return _fake_answer(messages)

    monkeypatch.setattr(ev, "count_tokens", lambda m: 1000)
    monkeypatch.setattr(ev, "_chat", chat)
    _, trace = ev._judge(CHAT, CFG)
    assert trace["compression_level"] == 1 and len(calls) == 2


def test_too_long_is_not_evaluated(monkeypatch):
    monkeypatch.setattr(ev, "count_tokens", lambda m: 99999)
    with pytest.raises(ev.ContextTooLong):
        ev._judge(CHAT, CFG)
    res = ev.score(CFG, ev._not_evaluated(CFG, "длинный"))
    assert res["incomplete"] and res["total"] is None
    assert res["criteria"][0]["answer"] == "not_evaluated" and res["criteria"][0]["points"] is None
