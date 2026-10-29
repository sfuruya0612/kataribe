#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

LOG="$HOME/Library/Logs/Kataribe M0/m0.log"
TONE="$ROOT/m0-tone.wav"
DEVICE_TOOL="$ROOT/audio-device"
OLD_OUTPUT_ID=""
OUTPUT_CHANGED=0

cleanup() {
  if [[ -n "${TONE_PID:-}" ]]; then
    kill "$TONE_PID" 2>/dev/null || true
    wait "$TONE_PID" 2>/dev/null || true
  fi
  if [[ "$OUTPUT_CHANGED" == "1" && -n "$OLD_OUTPUT_ID" ]]; then
    "$DEVICE_TOOL" set-output-id "$OLD_OUTPUT_ID" >/dev/null || true
  fi
}
trap cleanup EXIT

if [[ ! -x "$DEVICE_TOOL" ]]; then
  echo "audio-device をビルドする。"
  swiftc -O -parse-as-library -framework CoreAudio audio-device.swift -o audio-device
fi

if [[ ! -f "$TONE" ]]; then
  python3 - "$TONE" <<'PY'
import math
import struct
import sys
import wave

path = sys.argv[1]
sample_rate = 48000
duration = 60
with wave.open(path, "wb") as output:
    output.setnchannels(1)
    output.setsampwidth(2)
    output.setframerate(sample_rate)
    for index in range(sample_rate * duration):
        value = int(0.15 * 32767 * math.sin(2 * math.pi * 440 * index / sample_rate))
        output.writeframesraw(struct.pack("<h", value))
PY
fi

OLD_OUTPUT_ID="$("$DEVICE_TOOL" current | sed -n 's/^defaultOutput=\([0-9]*\).*/\1/p')"

if [[ "${KATARIBE_M0_SET_OUTPUT:-0}" == "1" ]]; then
  echo "出力を BlackHole 2ch に切り替える。終了後に元へ戻す。"
  "$DEVICE_TOOL" set-output "BlackHole 2ch"
  OUTPUT_CHANGED=1
else
  CURRENT_OUTPUT="$("$DEVICE_TOOL" current | sed -n 's/^defaultOutput=[0-9]*\t//p')"
  if [[ "$CURRENT_OUTPUT" != *"BlackHole 2ch"* ]]; then
    echo "現在の出力は BlackHole 2ch ではない: $CURRENT_OUTPUT"
    echo "macOS の出力を BlackHole 2ch、または BlackHole 2ch を含む Multi-Output Device に設定する。"
    echo "自動で切り替える場合は KATARIBE_M0_SET_OUTPUT=1 を付けて再実行する。"
    exit 1
  fi
fi

rm -f "$LOG"
mkdir -p "$(dirname "$LOG")"

afplay "$TONE" >/dev/null 2>&1 &
TONE_PID=$!

echo "Electron を BlackHole モードで起動する。マイク権限のダイアログが出たら許可する。"
KATARIBE_M0_MODE=blackhole npx --yes electron@45.1.0 . || true

for _ in $(seq 1 60); do
  if [[ -f "$LOG" ]] && grep -q '"phase":"blackhole_summary"' "$LOG"; then
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
    if row.get("phase") == "blackhole_summary" and row.get("done")
]
if not summaries:
    print("blackhole_summary not found. Check the microphone permission dialog.")
    sys.exit(3)

last = summaries[-1]
print("--- blackhole summary ---")
print(json.dumps(last, ensure_ascii=False, indent=2))
sys.exit(0 if last.get("ok") else 2)
PY
