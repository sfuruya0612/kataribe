# 同梱バイナリとモデルのライセンス

Kataribe は、文字起こし、音声変換、話者分離のために次のバイナリを `bin/<arch>/` に同梱します。
バイナリはリポジトリの `scripts/build-binaries.sh` で再生成できます。

## sherpa-onnx

- 版: v2.0.1
- 配布物: `sherpa-onnx-v2.0.1-osx-arm64-shared-no-tts.tar.bz2`
- ビルド: 公式の macOS arm64 共有ライブラリ版から `sherpa-onnx-offline-speaker-diarization` と `libonnxruntime.dylib` を取り出す
- ライセンス: Apache-2.0
- 著作権表示: `sherpa-onnx-LICENSE.txt`
- 配布元: https://github.com/k2-fsa/sherpa-onnx

## ONNX Runtime

- 版: sherpa-onnx v2.0.1 に同梱
- ライセンス: MIT
- 著作権表示: `onnxruntime-LICENSE.txt`
- 配布元: https://github.com/microsoft/onnxruntime

## 話者分離モデル

話者分離モデルは初回利用時にダウンロードし、アプリには同梱しません。

- pyannote segmentation 3.0
  - ライセンス: MIT
  - 著作権表示: `pyannote-segmentation-LICENSE.txt`
  - 配布元: https://github.com/k2-fsa/sherpa-onnx/releases/tag/speaker-segmentation-models
- 3D-Speaker ERes2Net Base
  - ライセンス: Apache-2.0
  - 著作権表示: `3dspeaker-LICENSE.txt`
  - 配布元: https://github.com/k2-fsa/sherpa-onnx/releases/tag/speaker-recongition-models

## whisper.cpp

- 版: v1.9.5 (commit d1be6fde11ac6e0407606b4e42fe72d34add8037)
- ビルド: `-DGGML_METAL=ON -DBUILD_SHARED_LIBS=OFF`
- ライセンス: MIT
- 著作権表示: `whisper.cpp-LICENSE.txt`
- 配布元: https://github.com/ggml-org/whisper.cpp

## FFmpeg

- 版: 7.1.1
- ビルド: 最小構成 (file/pipe protocol、wav/mp3 demuxer、pcm_s16le/mp3 decoder、libmp3lame/pcm_s16le encoder、wav/mp3 muxer)
- ライセンス: LGPL v2.1 以降
- 著作権表示: `ffmpeg-LICENSE.txt`、`ffmpeg-LGPLv3.txt`
- 配布元: https://ffmpeg.org/

## LAME

- 版: 3.100
- 用途: FFmpeg の libmp3lame エンコーダ
- ライセンス: LGPL
- 著作権表示: `lame-LICENSE.txt`
- 配布元: https://lame.sourceforge.io/

## RE-USE の WebGPU エンジン

- 出典: https://github.com/geronimi73/re-use-demo
- Commit: 0d54dca074597b111a8e8c78f6067a6fa0231f75
- 対象: STFT と iSTFT、safetensors の読み込み、重みのパッキング、WGSL カーネル、モデルの実行、チャンク処理
- ライセンス: MIT
- 著作権表示: `reuse-webgpu-engine-LICENSE.txt`

## 音声強調モデル

音声強調モデルは初回利用時にダウンロードし、アプリには同梱しません。

- NVIDIA NemotronLabs RE-USE
  - 配布元: https://huggingface.co/nvidia/NVIDIA-NemotronLabs-RE-USE
  - ライセンス: OpenMDW-1.1
  - 著作権表示: `nvidia-nemotronlabs-re-use-LICENSE.txt`
  - アプリが扱うのは商用利用が可能なこのモデルだけであり、研究および教育用の `nvidia/RE-USE` は含めない
