import json

import pytest
from fastapi import HTTPException

from app import agent

GOOD = {
    "notes": "Добавил критерий про вежливость.",
    "name": "Продажи", "sections": ["Начало", "Итог"],
    "criteria": [
        {"id": "x", "name": "Приветствие", "description": "Да — поздоровался.", "section": "Начало",
         "type": "yesno", "weight": 40, "scale": [{"value": 1, "desc": ""}], "na_allowed": False},
        {"id": "x", "name": "Решение", "description": "", "section": "Итог", "type": "scale", "weight": 60,
         "scale": [{"value": 0, "desc": "нет"}, {"value": 60, "desc": "да"}, {"value": 30, "desc": "частично"}],
         "na_allowed": False},
        {"id": "x", "name": "Грубость", "section": "Лишняя", "type": "flag", "weight": 15, "na_allowed": True},
    ],
}


def run(monkeypatch, answers, current=None, tokens=1000):
    calls = []

    def chat(messages, max_tokens=0):
        calls.append(messages)
        return answers[min(len(calls), len(answers)) - 1]

    monkeypatch.setattr(agent, "_ask", chat)
    monkeypatch.setattr(agent, "count_tokens", lambda m: tokens)
    return agent.draft_checklist(agent.AgentRequest(prompt="сделай чек-лист продаж", current=current)), calls


def test_normalizes_and_validates(monkeypatch):
    res, calls = run(monkeypatch, [json.dumps(GOOD, ensure_ascii=False)])
    cl = res["checklist"]
    assert [c["id"] for c in cl["criteria"]] == ["c1", "c2", "c3"]
    assert cl["sections"] == ["Начало", "Итог", "Лишняя"]
    yes, scale, flag = cl["criteria"]
    assert yes["scale"] is None
    assert [s["value"] for s in scale["scale"]] == [60, 30, 0]
    assert flag["weight"] == 0 and flag["na_allowed"] is False and flag["scale"] is None
    assert res["weight_sum"] == 100 and res["notes"]
    assert cl["settings"] == agent.BLANK["settings"] and len(calls) == 1


def test_invalid_draft_is_retried_with_errors(monkeypatch):
    bad = {**GOOD, "criteria": [{**GOOD["criteria"][0], "na_allowed": True, "na_condition": ""}]}
    res, calls = run(monkeypatch, ["не json", json.dumps(bad, ensure_ascii=False), json.dumps(GOOD, ensure_ascii=False)])
    assert len(calls) == 3 and res["checklist"]["name"] == "Продажи"
    assert "JSON" in calls[1][-1]["content"] and "N/A" in calls[2][-1]["content"]
    assert len(calls[2]) == 3  # the rejected answer is not resent


def test_current_checklist_and_settings_are_passed(monkeypatch):
    cur = {"name": "Старый", "sections": ["A"], "criteria": [], "settings": {"rounding": 1, "max_total": 10}, "id": 5}
    res, calls = run(monkeypatch, [json.dumps(GOOD, ensure_ascii=False)], current=cur)
    assert '"name":"Старый"' in calls[0][1]["content"] and '"id":5' not in calls[0][1]["content"]
    assert res["checklist"]["settings"] == {"rounding": 1, "max_total": 10}


def test_gives_up_and_too_long(monkeypatch):
    with pytest.raises(HTTPException) as e:
        run(monkeypatch, ["[]"])
    assert e.value.status_code == 502
    with pytest.raises(HTTPException) as e:
        run(monkeypatch, ["{}"], tokens=6000)
    assert e.value.status_code == 422


def test_wrapped_answer_and_error_paths(monkeypatch):
    res, _ = run(monkeypatch, [json.dumps({"notes": "ok", "checklist": GOOD}, ensure_ascii=False)])
    assert len(res["checklist"]["criteria"]) == 3
    _, calls = run(monkeypatch, [json.dumps({"notes": "x", "name": "n", "sections": ["a"], "criteria": []}),
                                 json.dumps(GOOD, ensure_ascii=False)])
    assert "criteria:" in calls[1][-1]["content"]


def test_schema_falls_back_to_json_mode(monkeypatch):
    sent = []

    def http(path, body):
        sent.append(body["response_format"]["type"])
        raise agent.LLMError(400, "unsupported response_format")

    monkeypatch.setattr(agent, "_http", http)
    monkeypatch.setattr(agent, "_model", lambda: "m")
    monkeypatch.setattr(agent, "_chat", lambda m, t: "{}")
    assert agent._ask([], 100) == "{}" and sent == ["json_schema"]
    monkeypatch.setattr(agent, "_http", lambda p, b: (_ for _ in ()).throw(agent.LLMError(400, "maximum context length")))
    with pytest.raises(agent.LLMError):
        agent._ask([], 100)
