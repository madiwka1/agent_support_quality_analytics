from datetime import datetime

import pytest
from fastapi import HTTPException

from app import batch, schedule, validate_results


@pytest.fixture(autouse=True)
def tmp_db(monkeypatch, tmp_path):
    monkeypatch.setattr(schedule, "DB_PATH", str(tmp_path / "t.db"))
    monkeypatch.delenv("CQA_DATASET_URL", raising=False)
    schedule._state.update(running=False, done=0, total=0, current=None)


def test_next_run():
    now = datetime(2026, 11, 8, 10, 0)
    assert schedule._next_run(schedule.Schedule(enabled=False), now) is None
    assert schedule._next_run(schedule.Schedule(enabled=True, time="23:30"), now) == "2026-11-08T23:30"
    assert schedule._next_run(schedule.Schedule(enabled=True, time="02:00"), now) == "2026-11-09T02:00"
    schedule._put("schedule_last_auto", "2026-11-08")
    assert schedule._next_run(schedule.Schedule(enabled=True, time="23:30"), now) == "2026-11-09T23:30"


def test_job_records_progress_and_result(monkeypatch):
    monkeypatch.setattr(validate_results, "load_dataset", lambda d: {"dataset_group_id": "DEV", "records": [{}, {}, {}]})
    monkeypatch.setattr(batch, "base_version", lambda arg: (1, 2))

    def run(dataset, records, version, only_missing, workers, progress):
        assert (dataset, version, only_missing, workers) == ("dev", (1, 2), True, 1)
        progress(0, 2, None, None)
        progress(1, 2, "a", None)
        progress(2, 2, "b", "модель недоступна")
        return {"b": "модель недоступна"}

    monkeypatch.setattr(batch, "run", run)
    schedule._state["running"] = True
    schedule._job(schedule.Schedule(), "manual")
    last = schedule._get("schedule_last_run")
    assert last["status"] == "partial" and last["evaluated"] == 1 and last["errors"] == 1
    assert last["source"] == "saved" and last["total"] == 3 and last["trigger"] == "manual"
    assert schedule._state["running"] is False and schedule._state["done"] == 2


def test_job_reports_wrong_saved_dataset(monkeypatch):
    monkeypatch.setattr(validate_results, "load_dataset", lambda d: {"dataset_group_id": "DEV", "records": []})
    schedule._job(schedule.Schedule(group_id="PROD-7"), "auto")
    last = schedule._get("schedule_last_run")
    assert last["status"] == "error" and "PROD-7" in last["message"]


def test_settings_and_double_start(monkeypatch):
    st = schedule.save_schedule(schedule.Schedule(enabled=True, time="03:15", dataset="prod", group_id="X1"))
    assert (st["enabled"], st["time"], st["dataset"], st["group_id"]) == (True, "03:15", "prod", "X1")
    assert schedule.get_schedule()["time"] == "03:15"
    with pytest.raises(ValueError):
        schedule.Schedule(time="25:00")
    schedule._state["running"] = True
    with pytest.raises(HTTPException) as e:
        schedule.run_now()
    assert e.value.status_code == 409
