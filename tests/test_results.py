import copy
import json

import pytest

from app import export_results as ex
from app.validate_results import final_score, validate

CHAT = [{"timestamp": "00:01", "speaker": "client", "text": "Как пополнить счёт?"},
        {"timestamp": "00:10", "speaker": "system", "text": "Эскалация на оператора."},
        {"timestamp": "00:30", "speaker": "operator", "text": "Здравствуйте! Меня зовут Алина."},
        {"timestamp": "00:40", "speaker": "operator", "text": "В разделе «Счета». Хорошего дня!"}]
CALL = [{"timestamp": "2026-11-03T12:00:00+00:00", "speaker": "client", "text": "Алло."},
        {"timestamp": "2026-11-03T12:00:05+00:00", "speaker": "operator", "text": "Здравствуйте, меня зовут Ая."},
        {"timestamp": "2026-11-03T12:00:09+00:00", "speaker": "operator", "text": "Чем помочь?"}]
RECORDS = [
    {"conversation_id": "t-ok", "channel": "agent chat", "language": "RU", "transcript": CHAT, "audio_url": None},
    {"conversation_id": "T-NA", "channel": "voice call", "language": "RU", "transcript": CALL, "audio_url": "https://x"},
    {"conversation_id": "t-err", "channel": "agent chat", "language": "RU", "transcript": CHAT, "audio_url": None},
]


def crit(cid, answer, value=None, ev=(), rng=None):
    return {"id": cid, "answer": answer, "value": value, "explanation": "Обоснование.\nВторая строка.",
            "evidence": [dict(e) for e in ev], "checked_range": rng}


def evaluation(cid, items, total):
    return {"conversation_id": cid, "total": total, "model": "gemma-test", "llm_host": "10.0.0.5", "criteria": items}


EVALS = {
    "t-ok": evaluation("t-ok", [
        crit("c1", "yes", ev=[{"index": 2}]), crit("c2", "yes", ev=[{"index": 0}]), crit("c3", "na"),
        crit("c4", "score", 15.0, ev=[{"index": 3}]), crit("c5", "yes", ev=[{"index": 2}]),
        crit("c6", "score", 7.0, ev=[{"index": 3}]), crit("c7", "no", rng={"from": 2, "to": 3}),
        crit("c8", "no", rng={"from": 0, "to": 3})], 81.88),
    "T-NA": evaluation("T-NA", [
        crit("c1", "yes", ev=[{"index": 1, "index_to": 2}]), crit("c2", "na", ev=[{"index": 0}]), crit("c3", "na"),
        crit("c4", "na"), crit("c5", "yes", ev=[{"index": 1}]), crit("c6", "score", 10.0, ev=[{"index": 1, "index_to": 2}]),
        crit("c7", "na"), crit("c8", "no", rng={"from": 0, "to": 2})], 90.0),
}


@pytest.fixture
def doc(monkeypatch, tmp_path):
    monkeypatch.setattr(ex, "ROOT", tmp_path)
    monkeypatch.setattr(ex, "_saved_transcripts", lambda: {})
    d, warns = ex.export("dev", records=RECORDS, evals=copy.deepcopy(EVALS))
    d["_warns"] = warns
    return d


def check(d, dataset="dev", group="G"):
    d = {k: v for k, v in d.items() if k != "_warns"}
    return validate(json.dumps(d, ensure_ascii=False), dataset, group, records=RECORDS)[0]


def test_export_passes_validator(doc):
    assert check(doc) == []
    ok, na, err = doc["results"]
    assert [r["conversation_id"] for r in doc["results"]] == ["t-ok", "T-NA", "t-err"]
    assert doc["model"] == {"mode": "local", "name": "gemma-test"}
    assert ok["status"] == "ok" and ok["score"] == {"final_score": 81.88, "critical_flag": False}
    assert [c["criterion_id"] for c in ok["criteria"]][:3] == ["contact", "discovery", "identification"]
    assert ok["criteria"][2]["value"] is None and ok["criteria"][3]["value"] == 15 and type(ok["criteria"][3]["value"]) is int
    assert ok["criteria"][6]["evidence_turns"] == [3, 4]  # missed action -> checked range
    assert "\n" not in ok["criteria"][0]["rationale"]
    assert na["criteria"][0]["evidence_turns"] == [2, 3]  # merged call turn -> all its source messages
    assert na["criteria"][3]["evidence_turns"] == [1]  # N/A without evidence -> fallback, with a warning
    assert any("T-NA" in w for w in doc["_warns"])
    assert err == {"conversation_id": "t-err", "status": "error", "criteria": [], "score": None, "error": err["error"]} and err["error"]


def test_score_example_from_checklist():
    v = {"contact": True, "discovery": True, "identification": None, "consultation": 15,
         "empathy": True, "dialogue": 7, "closure": False, "critical": False}
    assert final_score(v) == 81.88


def test_merged_turn_numbers():
    assert ex.to_turns([10, 11], 20) == [11, 12]


def test_not_evaluated_is_error(monkeypatch, tmp_path):
    monkeypatch.setattr(ex, "ROOT", tmp_path)
    monkeypatch.setattr(ex, "_saved_transcripts", lambda: {})
    evs = copy.deepcopy(EVALS)
    evs["t-ok"]["criteria"][3]["answer"] = "not_evaluated"
    d, _ = ex.export("dev", records=RECORDS, evals=evs)
    assert d["results"][0]["status"] == "error" and "consultation" in d["results"][0]["error"]


def broken(doc, fn):
    d = copy.deepcopy({k: v for k, v in doc.items() if k != "_warns"})
    fn(d)
    return d


@pytest.mark.parametrize("name,fn,needle", [
    ("dup id", lambda d: d["results"].append(copy.deepcopy(d["results"][0])), "повторяются"),
    ("missing id", lambda d: d["results"].pop(), "нет записей"),
    ("string value", lambda d: d["results"][0]["criteria"][0].update(value="Да"), "contact: value"),
    ("null contact", lambda d: d["results"][0]["criteria"][0].update(value=None), "contact: value null"),
    ("7 criteria", lambda d: d["results"][0]["criteria"].pop(), "ровно 8"),
    ("critical flag", lambda d: d["results"][0]["score"].update(critical_flag=True), "critical_flag"),
    ("score string", lambda d: d["results"][0]["score"].update(final_score="81.88"), "числом"),
    ("score mismatch", lambda d: d["results"][0]["score"].update(final_score=80.0), "пересчётом"),
    ("turn out of range", lambda d: d["results"][0]["criteria"][0].update(evidence_turns=[99]), "вне 1..4"),
    ("bool as scale", lambda d: d["results"][0]["criteria"][5].update(value=True), "dialogue: value"),
])
def test_validator_catches(doc, name, fn, needle):
    errs = check(broken(doc, fn))
    assert any(needle in e for e in errs), (name, errs)


def test_validator_prod_count_and_strict_json(doc):
    assert any("ровно 10" in e for e in check(doc, "prod"))
    assert "строгим JSON" in validate('{"a": NaN}', "dev", records=RECORDS)[0][0]
    assert "строгим JSON" in validate(b"\xff", "dev", records=RECORDS)[0][0]
