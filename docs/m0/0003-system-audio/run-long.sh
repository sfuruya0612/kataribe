#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"

export KATARIBE_M0_MEASURE_MS="${KATARIBE_M0_MEASURE_MS:-3600000}"
export KATARIBE_M0_TONE_SECONDS="${KATARIBE_M0_TONE_SECONDS:-15}"

exec caffeinate -dimsu "$ROOT/run-mix.sh"
