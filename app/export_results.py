"""Export evaluations to results/<dataset>/results.json in the organizers' format (schema 1.0).

python -m app.export_results --dataset dev|prod [--group-id ID] [--checklist-version [CID:]VER] [--use-final] [--out PATH]
Run from the repository root (the database is ./cqa.db unless CQA_DB is set).
By default the system's own (AI) evaluation is exported, not the result after appeals, and only
evaluations made with the base 8-criterion checklist are used.
"""
import argparse
import json
import os
import sqlite3
import sys
import tempfile
import threading
from pathlib import Path

from app.checklist import DB_PATH
from app.clean import clean_dialog
from app.validate_results import CRITERIA, ROOT, SCHEMA, TEAM, final_score, load_dataset

_LOCK = threading.Lock()  # batch evaluation runs 2 threads that may refresh the same file
CLOUD_HOSTS = ("openai.com", "anthropic.com", "googleapis.com", "groq.com", "openrouter.ai", "together.xyz",
               "mistral.ai", "deepseek.com", "x.ai", "azure.com", "cohere.com", "fireworks.ai")


def base_problem(cfg: dict) -> str | None:
    """None if this checklist version has all 8 base criteria (ids, types, weights, scale steps), else why not."""
    by_id = {k["id"]: k for k in cfg["criteria"]}
    for code, iid, kind, allowed, weight in CRITERIA:
        k = by_id.get(iid)
        if not k or k["type"] != kind:
            return f"нет критерия {code} ({iid}, тип {kind})"
        if kind != "flag" and k["weight"] != weight:
            return f"у {code} вес {k['weight']:g}, а не {weight}"
        if kind == "scale" and {int(s["value"]) for s in k["scale"]} != {a for a in allowed if a is not None}:
            return f"у {code} ступени {[s['value'] for s in k['scale']]} не совпадают с базовыми"
    return None


def _versions() -> dict[tuple[int, int], dict]:
    with sqlite3.connect(DB_PATH) as con:
        rows = con.execute("SELECT checklist_id, checklist_version FROM evaluations GROUP BY 1, 2").fetchall()
        out = {}
        for cid, ver in rows:  # deleted checklists still count: their evaluations stay valid
            r = con.execute("SELECT config_json FROM checklist_versions WHERE checklist_id = ? AND version = ?", (cid, ver)).fetchone()
            if r:
                out[(cid, ver)] = json.loads(r[0])
    return out


def parse_version(arg: str | None) -> tuple[int, int] | None:
    if not arg:
        return None
    cid, _, ver = arg.rpartition(":")
    return int(cid or 1), int(ver)


def latest_evaluations(version: tuple[int, int] | None) -> dict[str, dict]:
    """conversation_id -> the latest evaluation made with `version`, or with any base version if None."""
    cfgs = _versions()
    if version is not None:
        with sqlite3.connect(DB_PATH) as con:
            r = con.execute("SELECT config_json FROM checklist_versions WHERE checklist_id = ? AND version = ?", version).fetchone()
        if not r:
            raise SystemExit(f"Чек-лист {version[0]}, версия {version[1]} не найден.")
        if why := base_problem(json.loads(r[0])):
            raise SystemExit(f"Чек-лист {version[0]}, версия {version[1]} не подходит для выгрузки: {why}.")
        ok = {version}
    else:
        ok = {v for v, cfg in cfgs.items() if base_problem(cfg) is None}
    with sqlite3.connect(DB_PATH) as con:
        rows = con.execute("SELECT checklist_id, checklist_version, result_json FROM evaluations ORDER BY created_at, rowid").fetchall()
    return {e["conversation_id"]: e for cid, ver, js in rows if (cid, ver) in ok for e in [json.loads(js)]}


def to_turns(source_indices, n: int) -> list[int]:
    """0-based indices of the original transcript -> 1-based, unique, sorted, in range."""
    return sorted({i + 1 for i in source_indices if 0 <= i < n})


def _value(kind: str, k: dict):
    a = k["answer"]
    if a == "na":
        return None
    if kind == "scale":
        return int(k["value"]) if k["value"] == int(k["value"]) else k["value"]
    return a == "yes"


def build_record(rec: dict, ev: dict, warns: list[str]) -> dict:
    cid, tr = rec["conversation_id"], rec["transcript"]
    by_id = {k["id"]: k for k in ev["criteria"]}
    missing = [code for code, iid, *_ in CRITERIA if by_id.get(iid, {}).get("answer") in (None, "not_evaluated")]
    if missing:
        return {"conversation_id": cid, "status": "error", "criteria": [], "score": None,
                "error": f"не оценены критерии: {', '.join(missing)}; перезапустите оценку этого диалога"}
    groups = {i: t.source_indices for t in clean_dialog(rec).turns for i in t.source_indices}
    crit, values = [], {}
    for code, iid, kind, allowed, _ in CRITERIA:
        k = by_id[iid]
        v = _value(kind, k)
        if not any(v is a if a is None or isinstance(a, bool) else (type(v) is int and v == a) for a in allowed):
            return {"conversation_id": cid, "status": "error", "criteria": [], "score": None,
                    "error": f"{code}: значение {v!r} вне допустимых для формата"}
        # a merged (cleaned) turn gives all of its source messages; older evaluations point at single messages
        src = [j for x in k["evidence"] for j in (groups.get(x["index"], [x["index"]]) if "index_to" in x else [x["index"]])]
        if not src and k.get("checked_range"):
            src = range(k["checked_range"]["from"], k["checked_range"]["to"] + 1)
        turns = to_turns(src, len(tr))
        if not turns:
            first_client = next((i for i, m in enumerate(tr) if m["speaker"] == "client"), 0)
            turns = [first_client + 1]
            warns.append(f"[{cid}] {code}: модель не указала реплики, подставлена первая реплика клиента №{turns[0]}")
        values[code] = v
        crit.append({"criterion_id": code, "value": v, "rationale": " ".join(str(k["explanation"]).split()),
                     "evidence_turns": turns})
    fs = final_score(values)
    if ev.get("total") is None or abs(fs - ev["total"]) > 0.01:
        warns.append(f"[{cid}] итог в БД {ev.get('total')} ≠ пересчёт {fs}; в файл записан пересчёт")
    return {"conversation_id": cid, "status": "ok", "criteria": crit,
            "score": {"final_score": fs, "critical_flag": values["critical"]}}


def model_block(evs: list[dict]) -> dict:
    names = sorted({e["model"] for e in evs if e.get("model")}) or [os.getenv("CQA_LLM_MODEL") or "не определена"]
    # evaluations before llm_host was recorded all ran on the team's own vLLM server
    cloud = {any(str(e.get("llm_host") or "").endswith(h) for h in CLOUD_HOSTS) for e in evs} or {False}
    return {"mode": "hybrid" if cloud == {True, False} else "external_api" if cloud == {True} else "local",
            "name": ", ".join(names)}


def export(dataset: str, group_id: str | None = None, version: str | None = None, use_final: bool = False,
           records: list | None = None, evals: dict | None = None) -> tuple[dict, list[str]]:
    warns: list[str] = []
    if records is None:
        data = load_dataset(dataset)
        if group_id and data.get("dataset_group_id") != group_id:
            raise SystemExit(f"Сохранённый набор {dataset} относится к group_id {data.get('dataset_group_id')!r}, "
                             f"а не {group_id!r}. Загрузите нужный: python -m app.batch --dataset {dataset} --group-id {group_id} --fetch")
        records = data["records"]
    if evals is None:
        evals = latest_evaluations(parse_version(version))
    errs_path = ROOT / "datasets" / f"{dataset}.errors.json"
    run_errors = json.loads(errs_path.read_text(encoding="utf-8")) if errs_path.exists() else {}
    saved = _saved_transcripts()
    results, used = [], []
    for rec in records:
        cid = rec["conversation_id"]
        ev = evals.get(cid)
        if ev is None:
            why = run_errors.get(cid) or "диалог не оценён базовым чек-листом"
            results.append({"conversation_id": cid, "status": "error", "criteria": [], "score": None, "error": why})
            continue
        if use_final:
            ev = _final(ev)
        if cid in saved and saved[cid] != rec["transcript"]:
            warns.append(f"[{cid}] транскрипт в БД отличается от набора: номера реплик могут не совпадать")
        used.append(ev)
        results.append(build_record(rec, ev, warns))
    doc = {"schema_version": SCHEMA, "team_name": TEAM, "model": model_block(used), "results": results}
    return doc, warns


def _final(ev: dict) -> dict:
    from app.appeals import _cfg, _final as final  # imported lazily: pulls in the LLM client config
    return final(ev, _cfg(ev))


def _saved_transcripts() -> dict:
    try:
        with sqlite3.connect(DB_PATH) as con:
            rows = con.execute("SELECT conversation_id, record_json FROM conversations").fetchall()
    except sqlite3.OperationalError:
        return {}
    return {cid: json.loads(js)["transcript"] for cid, js in rows}


def refresh_for(conversation_id: str) -> list[Path]:
    """Re-export every saved dataset (dev / prod) that contains this dialog; called after each evaluation."""
    written = []
    for dataset in ("dev", "prod"):
        try:
            records = load_dataset(dataset)["records"]
        except FileNotFoundError:
            continue
        if any(r["conversation_id"] == conversation_id for r in records):
            with _LOCK:
                doc, _ = export(dataset, records=records)
                write(doc, path := ROOT / "results" / dataset / "results.json")
            written.append(path)
    return written


def write(doc: dict, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=path.parent, suffix=".tmp")  # write then rename: readers never see half a file
    with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as f:
        f.write(json.dumps(doc, ensure_ascii=False, indent=2, allow_nan=False) + "\n")
    os.replace(tmp, path)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Выгрузка результатов оценки в results.json")
    ap.add_argument("--dataset", required=True, choices=["dev", "prod"])
    ap.add_argument("--group-id")
    ap.add_argument("--checklist-version", help="ВЕРСИЯ или ЧЕКЛИСТ:ВЕРСИЯ; по умолчанию любая базовая версия")
    ap.add_argument("--use-final", action="store_true", help="значения после решений по апелляциям")
    ap.add_argument("--out")
    a = ap.parse_args(argv)
    doc, warns = export(a.dataset, a.group_id, a.checklist_version, a.use_final)
    out = Path(a.out) if a.out else ROOT / "results" / a.dataset / "results.json"
    write(doc, out)
    res = doc["results"]
    ok = sum(r["status"] == "ok" for r in res)
    print(f"Записано: {out}\nМодель: {doc['model']['name']} ({doc['model']['mode']})\n"
          f"Записей: {len(res)}, ok: {ok}, error: {len(res) - ok}")
    for w in warns:
        print("ПРЕДУПРЕЖДЕНИЕ:", w)
    retry = [r["conversation_id"] for r in res if r["status"] == "error"]
    if retry:
        print(f"Не оценены ({len(retry)}): {', '.join(retry[:15])}{' …' if len(retry) > 15 else ''}\n"
              f"Перезапустите оценку: python -m app.batch --dataset {a.dataset} --only-missing")
    return 0


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.exit(main())
