#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
OUT="$(mktemp -t kataribe-display-sleep.XXXXXX)"

KATARIBE_M0_MEASURE_MS="${KATARIBE_M0_MEASURE_MS:-90000}" \
KATARIBE_M0_TONE_SECONDS="${KATARIBE_M0_TONE_SECONDS:-30}" \
"$ROOT/run-mix.sh" >"$OUT" 2>&1 &
RUN_PID=$!

cleanup() {
  if kill -0 "$RUN_PID" 2>/dev/null; then
    kill "$RUN_PID" 2>/dev/null || true
    wait "$RUN_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

echo "10 秒後にディスプレイをスリープさせ、10 秒後に復帰させます。"
sleep 10
pmset displaysleepnow || echo "pmset displaysleepnow failed"
sleep 10
caffeinate -u -t 2 || true

set +e
wait "$RUN_PID"
STATUS=$?
set -e
cat "$OUT"
exit "$STATUS"
