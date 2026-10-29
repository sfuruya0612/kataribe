#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
OUT="$(mktemp -t kataribe-system-sleep.XXXXXX)"

export KATARIBE_M0_MEASURE_MS="${KATARIBE_M0_MEASURE_MS:-180000}"
export KATARIBE_M0_TONE_SECONDS="${KATARIBE_M0_TONE_SECONDS:-30}"
export KATARIBE_M0_WATCHDOG_MS="${KATARIBE_M0_WATCHDOG_MS:-900000}"
export KATARIBE_M0_WAIT_SECONDS="${KATARIBE_M0_WAIT_SECONDS:-900}"
"$ROOT/run-mix.sh" >"$OUT" 2>&1 &
RUN_PID=$!

cleanup() {
  if kill -0 "$RUN_PID" 2>/dev/null; then
    kill "$RUN_PID" 2>/dev/null || true
    wait "$RUN_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

echo "20 秒後にシステムスリープします。"
echo "スリープしてから 20 秒ほどで、何かキーを押して起こしてください。"
echo "起床が遅れても、最大 15 分待って結果を回収します。"
sleep 20
pmset sleepnow || echo "pmset sleepnow failed. 手動でスリープしてください。"

set +e
wait "$RUN_PID"
STATUS=$?
set -e
cat "$OUT"
exit "$STATUS"
