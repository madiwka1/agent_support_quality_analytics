"""Fetch an organizers' dataset and evaluate every dialog with the base checklist (used by scripts/submit.sh).

python -m app.batch --dataset dev|prod --group-id ID --fetch     # download, save, evaluate all
python -m app.batch --dataset dev|prod --only-missing            # retry dialogs without a complete evaluation
Env CQA_DATASET_URL: the organizers' GET link without &group_id=... (it is signed, keep it in .env, not in git).
The raw API response is saved to datasets/<dataset>.json; failures to datasets/<dataset>.errors.json.
"""
import argparse
import json
import os
import sqlite3
import sys
import time
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed

from fastapi import HTTPException
from pydantic import ValidationError

from app.checklist import DB_PATH
from app.conversations import Conversation, save
from app.evaluate import EvaluateRequest, evaluate
from app.export_results import base_problem, latest_evaluations, parse_version
from app.validate_results import ROOT, dataset_path, load_dataset

WORKERS = 2


def fetch(dataset: str, group_id: str) -> dict:
    base = os.getenv("CQA_DATASET_URL", "")
    if not base:
        raise SystemExit("Задайте CQA_DATASET_URL в .env: ссылка GET организаторов без параметра group_id.")
    parts = urllib.parse.urlsplit(base)
    q = [(k, v) for k, v in urllib.parse.parse_qsl(parts.query) if k != "group_id"] + [("group_id", group_id)]
    url = urllib.parse.urlunsplit(parts._replace(query=urllib.parse.urlencode(q)))
    with urllib.request.urlopen(url, timeout=180) as r:
        doc = json.loads(r.read().decode("utf-8-sig"))
    data = doc.get("data") or {}
    if not doc.get("isSuccess") or not isinstance(data.get("records"), list):
        raise SystemExit(f"API вернул ошибку: {doc.get('error') or 'нет data.records'}")
    if data.get("dataset_group_id") not in (None, group_id):
        raise SystemExit(f"API вернул набор {data.get('dataset_group_id')!r} вместо {group_id!r}")
    data.setdefault("dataset_group_id", group_id)
    p = dataset_path(dataset)
    p.parent.mkdir(exist_ok=True)
    p.write_text(json.dumps(doc, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"Набор {group_id}: {len(data['records'])} диалогов, сохранён в {p}")
    return data


def base_version(arg: str | None) -> tuple[int, int]:
    if v := parse_version(arg):
        return v
    with sqlite3.connect(DB_PATH) as con:
        rows = con.execute("SELECT v.checklist_id, v.version, v.config_json FROM checklist_versions v "
                           "JOIN checklist_meta m ON m.id = v.checklist_id WHERE m.deleted = 0 "
                           "ORDER BY v.checklist_id, v.version DESC").fetchall()
    for cid, ver, js in rows:
        if base_problem(json.loads(js)) is None:
            return cid, ver
    raise SystemExit("Нет чек-листа с базовыми 8 критериями. Укажите --checklist-version ЧЕКЛИСТ:ВЕРСИЯ.")


def run(dataset: str, records: list, version: tuple[int, int], only_missing: bool, workers: int = WORKERS,
        progress=None) -> dict:
    """progress(done, total, conversation_id, error) is called before the first and after every dialog."""
    errs_path = ROOT / "datasets" / f"{dataset}.errors.json"
    errors = json.loads(errs_path.read_text(encoding="utf-8")) if errs_path.exists() else {}
    done = latest_evaluations(version) if only_missing else {}
    todo = [r for r in records if not (r["conversation_id"] in done and not done[r["conversation_id"]].get("incomplete"))]
    print(f"Чек-лист {version[0]}, версия {version[1]}. К оценке: {len(todo)} из {len(records)}")
    if progress:
        progress(0, len(todo), None, None)

    def one(rec: dict) -> tuple[str, str | None, str]:
        cid, t0 = rec["conversation_id"], time.time()
        try:
            save(Conversation.model_validate(rec))
            res = evaluate(EvaluateRequest(conversation_id=cid, checklist_id=version[0], version=version[1]))
            if res.get("incomplete"):
                return cid, "диалог слишком длинный: часть критериев не оценена", f"{time.time() - t0:.0f} с"
            return cid, None, f"итог {res['total']}, {time.time() - t0:.0f} с"
        except ValidationError as e:
            return cid, f"запись не прошла проверку: {e.errors()[0]['msg']}", ""
        except HTTPException as e:
            return cid, str(e.detail), f"{time.time() - t0:.0f} с"

    with ThreadPoolExecutor(workers) as pool:
        for n, fut in enumerate(as_completed([pool.submit(one, r) for r in todo]), 1):
            cid, err, info = fut.result()
            if err:
                errors[cid] = err
            else:
                errors.pop(cid, None)
            print(f"[{n}/{len(todo)}] {cid}: {'ОШИБКА ' + err if err else 'ok'} {info}", flush=True)
            if progress:
                progress(n, len(todo), cid, err)
            errs_path.parent.mkdir(exist_ok=True)
            errs_path.write_text(json.dumps(errors, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"Готово. С ошибками: {len(errors)}")
    return errors


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Загрузка набора и пакетная оценка")
    ap.add_argument("--dataset", required=True, choices=["dev", "prod"])
    ap.add_argument("--group-id")
    ap.add_argument("--fetch", action="store_true", help="заново загрузить набор по API")
    ap.add_argument("--only-missing", action="store_true", help="оценить только диалоги без полной оценки")
    ap.add_argument("--checklist-version")
    ap.add_argument("--workers", type=int, default=WORKERS, help="сколько диалогов оценивать одновременно")
    a = ap.parse_args(argv)
    if a.fetch:
        if not a.group_id:
            ap.error("--fetch требует --group-id")
        data = fetch(a.dataset, a.group_id)
    else:
        data = load_dataset(a.dataset)
    run(a.dataset, data["records"], base_version(a.checklist_version), a.only_missing, max(1, a.workers))
    return 0


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.exit(main())
