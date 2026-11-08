"""Validator for results/<dataset>/results.json (organizers' format, schema 1.0). Standard library only.

python -m app.validate_results results/prod/results.json --dataset prod [--group-id <ID>]
Exit code 0 = valid, 1 = errors. Transcript lengths and the ID list come from the saved dataset
(datasets/<dataset>.json, the raw API response written by app.batch).
"""
import argparse
import json
import sys
from decimal import ROUND_HALF_UP, Decimal
from pathlib import Path

TEAM = "master_cheeks"
SCHEMA = "1.0"
ROOT = Path(__file__).resolve().parent.parent
MODES = {"local", "external_api", "hybrid"}


CRITERIA = [
    ("contact", "c1", "yesno", {True, False}, 10),
    ("discovery", "c2", "yesno", {True, False, None}, 15),
    ("identification", "c3", "yesno", {True, False, None}, 20),
    ("consultation", "c4", "scale", {0, 5, 10, 15, 20, None}, 20),
    ("empathy", "c5", "yesno", {True, False}, 15),
    ("dialogue", "c6", "scale", {0, 4, 7, 10}, 15),
    ("closure", "c7", "yesno", {True, False, None}, 5),
    ("critical", "c8", "flag", {True, False}, 0),
]
CODES = [c[0] for c in CRITERIA]


def dataset_path(dataset: str) -> Path:
    return ROOT / "datasets" / f"{dataset}.json"


def load_dataset(dataset: str) -> dict:
    """Raw API response saved by app.batch: {"isSuccess", "data": {"dataset_group_id", "records": [...]}}."""
    return json.loads(dataset_path(dataset).read_text(encoding="utf-8"))["data"]


def final_score(values: dict) -> float:
    """Σ earned / Σ weights of applicable criteria × 100; scale = value / max × weight; None is excluded."""
    earned = total = Decimal(0)
    for code, _, kind, allowed, weight in CRITERIA:
        v = values.get(code)
        if kind == "flag" or v is None:
            continue
        top = max(x for x in allowed if type(x) is int) if kind == "scale" else 1
        earned += Decimal(weight) * (Decimal(int(v)) / Decimal(top))
        total += weight
    return float((earned / total * 100).quantize(Decimal("0.01"), ROUND_HALF_UP)) if total else 0.0


def _is_int(x) -> bool:
    return type(x) is int


def _same(v, allowed: set) -> bool:
    return any(v is a if a is None or isinstance(a, bool) else (_is_int(v) and v == a) for a in allowed)


def check_record(r, n_turns: int | None) -> list[str]:
    cid = r.get("conversation_id") if isinstance(r, dict) else None
    p = f"[{cid}]"
    if not isinstance(r, dict):
        return [f"{p} запись не объект"]
    errs = []
    if not isinstance(cid, str) or not cid:
        errs.append(f"{p} conversation_id должен быть непустой строкой")
    st = r.get("status")
    if st == "error":
        if r.get("criteria") != []:
            errs.append(f"{p} у error должно быть criteria: []")
        if r.get("score") is not None:
            errs.append(f"{p} у error должно быть score: null")
        if not isinstance(r.get("error"), str) or not r["error"].strip():
            errs.append(f"{p} у error нужна непустая причина в поле error")
        return errs
    if st != "ok":
        return errs + [f"{p} status должен быть \"ok\" или \"error\", а не {st!r}"]
    crit = r.get("criteria")
    if not isinstance(crit, list):
        return errs + [f"{p} criteria должен быть массивом"]
    got = [c.get("criterion_id") if isinstance(c, dict) else None for c in crit]
    if got != CODES:
        errs.append(f"{p} нужны ровно 8 критериев в порядке {', '.join(CODES)}, а есть: {got}")
    values = {}
    for c in crit:
        if not isinstance(c, dict) or c.get("criterion_id") not in CODES:
            continue
        code, v = c["criterion_id"], c.get("value", "<нет>")
        allowed = next(a for k, _, _, a, _ in CRITERIA if k == code)
        if not _same(v, allowed):
            shown = sorted("null" if a is None else json.dumps(a) for a in allowed)
            errs.append(f"{p} {code}: value {json.dumps(v, ensure_ascii=False)} недопустимо, можно {', '.join(shown)}")
        else:
            values[code] = v
        ra = c.get("rationale")
        if not isinstance(ra, str) or not ra.strip():
            errs.append(f"{p} {code}: rationale должен быть непустой строкой")
        elif "\n" in ra or "\r" in ra:
            errs.append(f"{p} {code}: rationale без переносов строк")
        ev = c.get("evidence_turns")
        if not isinstance(ev, list) or not ev or not all(_is_int(x) for x in ev):
            errs.append(f"{p} {code}: evidence_turns — непустой массив целых чисел")
        else:
            if ev != sorted(set(ev)):
                errs.append(f"{p} {code}: evidence_turns должны быть уникальными и отсортированными: {ev}")
            if n_turns is not None and not all(1 <= x <= n_turns for x in ev):
                errs.append(f"{p} {code}: evidence_turns вне 1..{n_turns}: {ev}")
    sc = r.get("score")
    if not isinstance(sc, dict):
        return errs + [f"{p} score должен быть объектом"]
    fs = sc.get("final_score")
    if type(fs) not in (int, float):
        errs.append(f"{p} final_score должен быть числом, а не {type(fs).__name__}")
    else:
        if not 0 <= fs <= 100:
            errs.append(f"{p} final_score {fs} вне 0..100")
        if Decimal(str(fs)).as_tuple().exponent < -2:
            errs.append(f"{p} final_score {fs}: больше 2 знаков после запятой")
        if len(values) == len(CODES) and abs(fs - final_score(values)) > 0.005:
            errs.append(f"{p} final_score {fs} не совпадает с пересчётом по формуле: {final_score(values)}")
    cf = sc.get("critical_flag")
    if not isinstance(cf, bool):
        errs.append(f"{p} critical_flag должен быть boolean")
    elif "critical" in values and cf is not values["critical"]:
        errs.append(f"{p} critical_flag {json.dumps(cf)} не равен value критерия critical ({json.dumps(values['critical'])})")
    return errs


def validate(text: bytes | str, dataset: str, group_id: str | None = None, records: list | None = None) -> tuple[list[str], list[str]]:
    """Returns (errors, warnings). records = dataset records; loaded from datasets/<dataset>.json if None."""
    errs, warns = [], []
    try:
        raw = text.decode("utf-8") if isinstance(text, bytes) else text
        doc = json.loads(raw, parse_constant=lambda c: (_ for _ in ()).throw(ValueError(f"{c} запрещён в JSON")),
                         object_pairs_hook=_no_dupes)
    except (UnicodeDecodeError, ValueError) as e:
        return [f"файл не является строгим JSON в UTF-8: {e}"], warns
    if not isinstance(doc, dict):
        return ["корень файла должен быть объектом"], warns
    if doc.get("schema_version") != SCHEMA:
        errs.append(f"schema_version должен быть \"{SCHEMA}\", а не {doc.get('schema_version')!r}")
    if doc.get("team_name") != TEAM:
        errs.append(f"team_name должен быть \"{TEAM}\", а не {doc.get('team_name')!r}")
    m = doc.get("model")
    if not isinstance(m, dict) or m.get("mode") not in MODES:
        errs.append(f"model.mode должен быть одним из {sorted(MODES)}")
    if not isinstance(m, dict) or not isinstance(m.get("name"), str) or not m["name"].strip():
        errs.append("model.name должен быть непустой строкой")
    res = doc.get("results")
    if not isinstance(res, list):
        return errs + ["results должен быть массивом"], warns

    if records is None:
        try:
            data = load_dataset(dataset)
        except FileNotFoundError:
            return errs + [f"нет сохранённого набора {dataset_path(dataset)}: загрузите его (python -m app.batch --fetch)"], warns
        if group_id and data.get("dataset_group_id") != group_id:
            errs.append(f"сохранённый набор {dataset} относится к group_id {data.get('dataset_group_id')!r}, а не {group_id!r}")
        records = data["records"]
    lengths = {x["conversation_id"]: len(x["transcript"]) for x in records}

    ids = [r.get("conversation_id") if isinstance(r, dict) else None for r in res]
    dupes = sorted({i for i in ids if ids.count(i) > 1}, key=str)
    if dupes:
        errs.append(f"conversation_id повторяются: {dupes}")
    if dataset == "prod" and len(res) != 10:
        errs.append(f"в prod должно быть ровно 10 записей, а их {len(res)}")
    if group_id:
        want = [x["conversation_id"] for x in records]
        missing, extra = [i for i in want if i not in ids], [i for i in ids if i not in lengths]
        if missing:
            errs.append(f"нет записей для ID набора: {missing}")
        if extra:
            errs.append(f"ID не из набора {group_id}: {extra}")
        if not missing and not extra and not dupes and ids != want:
            warns.append("порядок записей отличается от порядка в ответе API")
    for r in res:
        cid = r.get("conversation_id") if isinstance(r, dict) else None
        if cid not in lengths and not group_id:
            warns.append(f"[{cid}] нет в сохранённом наборе, диапазон evidence_turns не проверен")
        errs += check_record(r, lengths.get(cid))
    return errs, warns


def _no_dupes(pairs):
    keys = [k for k, _ in pairs]
    dup = {k for k in keys if keys.count(k) > 1}
    if dup:
        raise ValueError(f"повторяющиеся ключи {sorted(dup)}")
    return dict(pairs)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Проверка results.json по формату организаторов")
    ap.add_argument("path")
    ap.add_argument("--dataset", required=True, choices=["dev", "prod"])
    ap.add_argument("--group-id")
    a = ap.parse_args(argv)
    try:
        text = Path(a.path).read_bytes()
    except OSError as e:
        print(f"ОШИБКА: не удалось прочитать файл: {e}")
        return 1
    errs, warns = validate(text, a.dataset, a.group_id)
    try:
        res = json.loads(text.decode("utf-8")).get("results") or []
        ok = sum(1 for r in res if isinstance(r, dict) and r.get("status") == "ok")
        print(f"Записей: {len(res)}, ok: {ok}, error: {len(res) - ok}")
    except Exception:
        pass
    for w in warns:
        print("ПРЕДУПРЕЖДЕНИЕ:", w)
    for e in errs:
        print("ОШИБКА:", e)
    print("Файл корректен." if not errs else f"Найдено ошибок: {len(errs)}.")
    return 1 if errs else 0


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.exit(main())
