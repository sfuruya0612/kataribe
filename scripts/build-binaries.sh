#!/usr/bin/env bash
# Kataribe が同梱する whisper-cli、ffmpeg、sherpa-onnx の話者分離をビルドする。
#
# 依存: Xcode Command Line Tools、cmake、curl、tar
# 生成物: resources/bin/<arch>/{whisper-cli,ffmpeg,sherpa-onnx-offline-speaker-diarization}
#         resources/bin/lib/libonnxruntime.dylib
#
# 版は固定する。上げるときは文字起こしの進捗解析、ffmpeg の進捗出力、
# 話者分離の出力形式を再検証すること。

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ARCH="$(uname -m)"
OUT_DIR="$ROOT/resources/bin/$ARCH"
WORK_ROOT="${KATARIBE_BINARY_BUILD_DIR:-$(mktemp -d "${TMPDIR:-/tmp}/kataribe-binaries.XXXXXX")}"

WHISPER_VERSION="v1.9.5"
FFMPEG_VERSION="7.1.1"
LAME_VERSION="3.100"
SHERPA_ONNX_VERSION="v2.0.1"
SHERPA_ONNX_ARCHIVE_SHA256="4fcc6c77c8d8d2e2f04cfdc17c6fd224c01469b78529370eb9d8e0e5ec97ac79"

mkdir -p "$OUT_DIR" "$WORK_ROOT"

echo "== whisper.cpp $WHISPER_VERSION =="
if [ ! -d "$WORK_ROOT/whisper.cpp" ]; then
  git clone --depth 1 --branch "$WHISPER_VERSION" https://github.com/ggml-org/whisper.cpp "$WORK_ROOT/whisper.cpp"
fi
cmake -S "$WORK_ROOT/whisper.cpp" -B "$WORK_ROOT/whisper-build" \
  -DCMAKE_BUILD_TYPE=Release \
  -DBUILD_SHARED_LIBS=OFF \
  -DGGML_METAL=ON \
  -DWHISPER_BUILD_TESTS=OFF \
  -DWHISPER_BUILD_SERVER=OFF
cmake --build "$WORK_ROOT/whisper-build" -j "$(sysctl -n hw.ncpu)" --target whisper-cli
cp "$WORK_ROOT/whisper-build/bin/whisper-cli" "$OUT_DIR/whisper-cli"
chmod +x "$OUT_DIR/whisper-cli"

echo "== LAME $LAME_VERSION =="
if [ ! -d "$WORK_ROOT/lame-$LAME_VERSION" ]; then
  curl -fsSL -o "$WORK_ROOT/lame.tar.gz" \
    "https://downloads.sourceforge.net/project/lame/lame/$LAME_VERSION/lame-$LAME_VERSION.tar.gz"
  tar xzf "$WORK_ROOT/lame.tar.gz" -C "$WORK_ROOT"
fi
if [ ! -f "$WORK_ROOT/lame/lib/libmp3lame.a" ]; then
  (
    cd "$WORK_ROOT/lame-$LAME_VERSION"
    ./configure --prefix="$WORK_ROOT/lame" --disable-shared --enable-static --disable-frontend --disable-decoder
    make -j "$(sysctl -n hw.ncpu)"
    make install
  )
fi

echo "== FFmpeg $FFMPEG_VERSION =="
if [ ! -d "$WORK_ROOT/ffmpeg-$FFMPEG_VERSION" ]; then
  curl -fsSL -o "$WORK_ROOT/ffmpeg.tar.xz" "https://ffmpeg.org/releases/ffmpeg-$FFMPEG_VERSION.tar.xz"
  tar xJf "$WORK_ROOT/ffmpeg.tar.xz" -C "$WORK_ROOT"
fi
(
  cd "$WORK_ROOT/ffmpeg-$FFMPEG_VERSION"
  ./configure \
    --prefix="$WORK_ROOT/ffmpeg" \
    --disable-shared --enable-static \
    --disable-all --disable-autodetect --disable-doc --disable-debug --disable-network \
    --enable-ffmpeg --enable-avformat --enable-avcodec --enable-avutil --enable-swresample --enable-avfilter \
    --enable-protocol=file --enable-protocol=pipe \
    --enable-demuxer=wav --enable-demuxer=mp3 \
    --enable-decoder=pcm_s16le --enable-decoder=mp3 \
    --enable-encoder=libmp3lame --enable-encoder=pcm_s16le \
    --enable-muxer=mp3 --enable-muxer=wav \
    --enable-filter=aresample --enable-filter=anull --enable-filter=format \
    --enable-parser=mpegaudio \
    --enable-libmp3lame \
    --extra-cflags="-I$WORK_ROOT/lame/include" \
    --extra-ldflags="-L$WORK_ROOT/lame/lib"
  make -j "$(sysctl -n hw.ncpu)" ffmpeg
)
cp "$WORK_ROOT/ffmpeg-$FFMPEG_VERSION/ffmpeg" "$OUT_DIR/ffmpeg"
chmod +x "$OUT_DIR/ffmpeg"

echo "== Multi-Output Device helper =="
swiftc -O -parse-as-library -framework CoreAudio \
  "$ROOT/resources/native/multi-output.swift" \
  -o "$OUT_DIR/kataribe-multi-output"
chmod +x "$OUT_DIR/kataribe-multi-output"

echo "== sherpa-onnx $SHERPA_ONNX_VERSION =="
if [ "$ARCH" != "arm64" ]; then
  echo "sherpa-onnx の同梱バイナリは arm64 のみ対応です。" >&2
  exit 1
fi
SHERPA_ARCHIVE="$WORK_ROOT/sherpa-onnx-$SHERPA_ONNX_VERSION-osx-arm64-shared-no-tts.tar.bz2"
if [ ! -f "$SHERPA_ARCHIVE" ]; then
  curl -fsSL -o "$SHERPA_ARCHIVE" \
    "https://github.com/k2-fsa/sherpa-onnx/releases/download/$SHERPA_ONNX_VERSION/sherpa-onnx-$SHERPA_ONNX_VERSION-osx-arm64-shared-no-tts.tar.bz2"
fi
echo "$SHERPA_ONNX_ARCHIVE_SHA256  $SHERPA_ARCHIVE" | shasum -a 256 -c -
tar xjf "$SHERPA_ARCHIVE" -C "$WORK_ROOT"
SHERPA_ROOT="$WORK_ROOT/sherpa-onnx-$SHERPA_ONNX_VERSION-osx-arm64-shared-no-tts"
cp "$SHERPA_ROOT/bin/sherpa-onnx-offline-speaker-diarization" "$OUT_DIR/sherpa-onnx-offline-speaker-diarization"
mkdir -p "$ROOT/resources/bin/lib"
cp "$SHERPA_ROOT/lib/libonnxruntime.dylib" "$ROOT/resources/bin/lib/libonnxruntime.dylib"
strip -x "$ROOT/resources/bin/lib/libonnxruntime.dylib"
chmod +x "$OUT_DIR/sherpa-onnx-offline-speaker-diarization"
codesign --force --sign - "$OUT_DIR/sherpa-onnx-offline-speaker-diarization"
codesign --force --sign - "$ROOT/resources/bin/lib/libonnxruntime.dylib"

echo "generated:"
ls -lh "$OUT_DIR/whisper-cli" "$OUT_DIR/ffmpeg" "$OUT_DIR/kataribe-multi-output" \
  "$OUT_DIR/sherpa-onnx-offline-speaker-diarization" \
  "$ROOT/resources/bin/lib/libonnxruntime.dylib"
"$OUT_DIR/ffmpeg" -version | head -1
"$OUT_DIR/whisper-cli" --help 2>&1 | head -1
"$OUT_DIR/kataribe-multi-output" list >/dev/null
