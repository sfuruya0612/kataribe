#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

APP_NAME="Kataribe M0"
BUNDLE_ID="com.example.kataribe-m0"
ELECTRON_VERSION="45.1.0"
OUT_DIR="$ROOT/out"
APP="$OUT_DIR/$APP_NAME-darwin-arm64/$APP_NAME.app"
LOG_DIR="$HOME/Library/Logs/$APP_NAME"
LOG="$LOG_DIR/m0.log"
TONE="$ROOT/m0-tone.wav"

IDENTITY="${DEVELOPER_ID_APPLICATION:-}"
if [[ -z "$IDENTITY" ]]; then
  IDENTITY="$(security find-identity -v -p codesigning 2>/dev/null | sed -n 's/.*"\(Developer ID Application:.*\)"/\1/p' | head -1)"
fi

if [[ -z "$IDENTITY" ]]; then
  echo "Developer ID Application signing identity not found."
  echo "Install the certificate and private key in Keychain."
  echo "Check with:"
  echo "  security find-identity -v -p codesigning"
  echo "Then run one of the following:"
  echo "  DEVELOPER_ID_APPLICATION=\"Developer ID Application: ...\" ./run.sh"
  exit 1
fi

echo "signing identity: $IDENTITY"

rm -rf "$OUT_DIR"
mkdir -p "$LOG_DIR"
rm -f "$LOG"

npx --yes @electron/packager@latest . "$APP_NAME" \
  --platform=darwin \
  --arch=arm64 \
  --electron-version="$ELECTRON_VERSION" \
  --out="$OUT_DIR" \
  --overwrite \
  --app-bundle-id="$BUNDLE_ID" \
  --app-version=1.0.0 >/dev/null

if [[ ! -d "$APP" ]]; then
  echo "App bundle not found: $APP"
  exit 1
fi

add_plist_string() {
  local key="$1"
  local value="$2"
  /usr/libexec/PlistBuddy -c "Add :$key string \"$value\"" "$APP/Contents/Info.plist" 2>/dev/null || true
}

add_plist_string "NSAudioCaptureUsageDescription" "Kataribe M0 needs to record system audio for the M0 verification"
add_plist_string "NSScreenCaptureUsageDescription" "Kataribe M0 needs screen capture access to test system audio"
add_plist_string "NSMicrophoneUsageDescription" "Kataribe M0 needs microphone access to test audio mixing"
add_plist_string "NSDocumentsFolderUsageDescription" "Kataribe M0 needs access to the Documents folder to test storage"

codesign --force --deep --sign "$IDENTITY" "$APP"
codesign --verify --deep --strict --verbose=2 "$APP"

LSREGISTER="/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister"
if [[ -x "$LSREGISTER" ]]; then
  "$LSREGISTER" -f "$APP"
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

afplay "$TONE" >/dev/null 2>&1 &
TONE_PID=$!
cleanup() {
  kill "$TONE_PID" 2>/dev/null || true
}
trap cleanup EXIT

open "$APP"

for _ in $(seq 1 180); do
  if [[ -f "$LOG" ]] && grep -q '"done":true' "$LOG"; then
    break
  fi
  sleep 1
done

cleanup

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

summaries = [row for row in rows if row.get("phase") == "summary" and row.get("done")]
if not summaries:
    print("summary not found. Check the permission dialog.")
    sys.exit(3)

last = summaries[-1]
print("--- summary ---")
print(json.dumps(last, ensure_ascii=False, indent=2))
sys.exit(0 if last.get("ok") else 2)
PY
