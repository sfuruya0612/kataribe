#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

LOG="$HOME/Library/Logs/Kataribe M0/m0.log"
TONE="$ROOT/m0-tone.wav"
DEVICE_TOOL="$ROOT/audio-device"
MULTI_TOOL="$ROOT/multi-output"
MEASURE_MS="${KATARIBE_M0_MEASURE_MS:-5000}"
TONE_SECONDS="${KATARIBE_M0_TONE_SECONDS:-60}"
OUTPUT_NAME="${KATARIBE_M0_OUTPUT_NAME:-MacBook Proのスピーカー}"
OLD_OUTPUT_NAME=""
OLD_MUTED="false"
AGGREGATE_NAME="Kataribe Multi-Output"

cleanup() {
  if [[ -n "${TONE_PID:-}" ]]; then
    kill "$TONE_PID" 2>/dev/null || true
    wait "$TONE_PID" 2>/dev/null || true
  fi
  if [[ -n "$AGGREGATE_NAME" ]]; then
    "$MULTI_TOOL" destroy-name "$AGGREGATE_NAME" >/dev/null 2>&1 || true
  fi
  if [[ -n "$OLD_OUTPUT_NAME" ]]; then
    "$DEVICE_TOOL" set-output "$OLD_OUTPUT_NAME" >/dev/null 2>&1 || true
  fi
  osascript -e "set volume output muted $OLD_MUTED" >/dev/null 2>&1 || true
}
trap cleanup EXIT

if [[ ! -x "$DEVICE_TOOL" ]]; then
  swiftc -O -parse-as-library -framework CoreAudio audio-device.swift -o audio-device
fi
if [[ ! -x "$MULTI_TOOL" ]]; then
  swiftc -O -parse-as-library -framework CoreAudio multi-output.swift -o multi-output
fi

if [[ "$TONE_SECONDS" -gt 0 ]]; then
  python3 - "$TONE" "$TONE_SECONDS" <<'PY'
import math
import struct
import sys
import wave

path = sys.argv[1]
duration = int(sys.argv[2])
sample_rate = 48000
with wave.open(path, "wb") as output:
    output.setnchannels(1)
    output.setsampwidth(2)
    output.setframerate(sample_rate)
    for index in range(sample_rate * duration):
        value = int(0.15 * 32767 * math.sin(2 * math.pi * 440 * index / sample_rate))
        output.writeframesraw(struct.pack("<h", value))
PY
fi

OLD_OUTPUT_NAME="$("$DEVICE_TOOL" current | sed -n 's/^defaultOutput=[0-9]*\t//p')"
OLD_MUTED="$(osascript -e 'output muted of (get volume settings)' 2>/dev/null || echo false)"
CREATE_OUTPUT="$("$MULTI_TOOL" create "$OUTPUT_NAME" "BlackHole 2ch")"
echo "$CREATE_OUTPUT"
CURRENT_OUTPUT_NAME="$("$DEVICE_TOOL" current | sed -n 's/^defaultOutput=[0-9]*\t//p')"

if [[ "$CURRENT_OUTPUT_NAME" != *"Kataribe Multi-Output"* ]]; then
  echo "aggregate device could not be created: $CURRENT_OUTPUT_NAME"
  exit 1
fi

osascript -e 'set volume output muted false' >/dev/null 2>&1 || true

rm -f "$LOG"
mkdir -p "$(dirname "$LOG")"

sleep 1
if [[ "$TONE_SECONDS" -gt 0 ]]; then
  afplay "$TONE" >/dev/null 2>&1 &
  TONE_PID=$!
else
  echo "test tone disabled"
fi

echo "マイク + BlackHole 2ch のミックスを測定する。measureMs=$MEASURE_MS toneSeconds=$TONE_SECONDS output=$OUTPUT_NAME"
KATARIBE_M0_MODE=mix KATARIBE_M0_MEASURE_MS="$MEASURE_MS" npx --yes electron@45.1.0 . || true

WAIT_SECONDS="${KATARIBE_M0_WAIT_SECONDS:-$(( MEASURE_MS / 1000 + 120 ))}"
for _ in $(seq 1 "$WAIT_SECONDS"); do
  if [[ -f "$LOG" ]] && grep -q '"phase":"mix_summary"' "$LOG"; then
    break
  fi
  sleep 1
done

echo "--- m0.log ---"
tail -100 "$LOG" 2>/dev/null || true

python3 - "$LOG" <<'PY'
import json
import sys

path = sys.argv[1]
rows = []
try:
    with open(path, encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if not line.startswith("{"):
                continue
            try:
                rows.append(json.loads(line))
            except json.JSONDecodeError:
                pass
except FileNotFoundError:
    print("m0.log not found")
    sys.exit(3)

summaries = [
    row for row in rows
    if row.get("phase") == "mix_summary" and row.get("done")
]
if not summaries:
    print("mix_summary not found. Check the microphone permission dialog.")
    sys.exit(3)

last = summaries[-1]
print("--- mix summary ---")
print(json.dumps(last, ensure_ascii=False, indent=2))
sys.exit(0 if last.get("ok") else 2)
PY
