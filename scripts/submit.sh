#!/usr/bin/env bash
# Last-hour submission: fetch -> evaluate -> retry failures -> export -> validate -> commit -> push.
# Usage: scripts/submit.sh <dev|prod> <group_id>     (PYTHON=... to pick the interpreter)
set -euo pipefail

dataset=${1:?usage: scripts/submit.sh <dev|prod> <group_id>}
group=${2:?usage: scripts/submit.sh <dev|prod> <group_id>}
cd "$(dirname "$0")/.."
py=${PYTHON:-python}
out="results/$dataset/results.json"

echo "== 1-2/6 загрузка набора $group и оценка всех диалогов"
"$py" -m app.batch --dataset "$dataset" --group-id "$group" --fetch
echo "== 3/6 повтор для диалогов с ошибками"
"$py" -m app.batch --dataset "$dataset" --only-missing
echo "== 4/6 экспорт и проверка"
"$py" -m app.export_results --dataset "$dataset" --group-id "$group"
"$py" -m app.validate_results "$out" --dataset "$dataset" --group-id "$group"

echo "== 5/6 коммит и push"
git add "$out"
if git diff --cached --quiet -- "$out"; then
  echo "Файл не изменился, коммит не нужен."
else
  git commit -m "results: $dataset" -- "$out"
fi
git push

echo "== 6/6 итог"
repo=$(git remote get-url origin | sed -e 's/\.git$//' -e 's#^git@github.com:#https://github.com/#')
echo "Файл: $repo/blob/$(git rev-parse --abbrev-ref HEAD)/$out"
"$py" -c "import json,sys; r=json.load(open(sys.argv[1],encoding='utf-8'))['results']; ok=sum(x['status']=='ok' for x in r); print(f'ok: {ok}, error: {len(r)-ok}')" "$out"
