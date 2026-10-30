# 同梱バイナリのライセンス

Kataribe は、文字起こしと音声変換のために次のバイナリを `bin/<arch>/` に同梱します。
バイナリはリポジトリの `scripts/build-binaries.sh` で再生成できます。

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
