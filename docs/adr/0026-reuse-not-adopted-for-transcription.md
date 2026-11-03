# ADR-0026: RE-USE を録音の入力時にも文字起こしの前処理にも採用しない

- Status: Amended by [ADR-0027](0027-reuse-webgpu-enhancement.md)

この ADR のうち、文字起こし前処理の不採用と、再生品質の機能を追加しない判断を ADR-0027 が改訂する。録音の入力時に適用しない判断、先行モデルをアプリの選択肢にしない判断、PyTorch と MPS の移植を依存に含めない判断は維持する。再検討の条件は、既定の文字起こし処理として採用する条件として維持する。文字起こし精度が改善しないという検証結果も維持する。

## Context

利用者から、NVIDIA の音声強調モデル RE-USE で会議音声のノイズを減らし、文字起こしの精度を上げられるかを検証したいという要求がある。
適用する位置として、録音の入力時と、文字起こしの前処理の 2 つが考えられる。

RE-USE は 9.6M パラメータの双方向 Mamba を使うオフラインモデルで、8 kHz から 48 kHz のモノラル音声を入力にする。
公式の推論は Linux と NVIDIA Ampere の GPU を前提とする。
macOS で動かすには、非公式の PyTorch 移植か、WebGPU の実装が必要になる。
商用利用が可能な `nvidia/NVIDIA-NemotronLabs-RE-USE` と、研究および教育用の `nvidia/RE-USE` がある。
先行モデルの NSCLv1 は、第 3.3 条で利用を非商用の研究および教育目的に限る。
個人の会議メモは、この目的に含まれないと解釈するのが自然である。
モデルカードは、重なった発話で主話者を保持し、他の話者を抑制すると述べている。

検証の条件と結果は `docs/testing/reuse-speech-enhancement.md` に記録した。
日本語の会議風音声に白色ノイズを加え、whisper.cpp の large-v3-turbo で文字起こしした。
SNR が 5 dB 以上のときは強調の有無で精度がほとんど変わらなかった。
SNR が 0 dB 以下のときは、強調すると文字誤り率 (CER) が大きくなり、幻覚が増えた。
同じ移植先で先行モデルも動かしたが、0 dB と -5 dB の CER は NemotronLabs 版よりさらに悪化した。
16 kHz の音声で、5 秒チャンクの強調は実時間の約 2.4 倍の速さ、34 秒の全体推論は約 4.3 から 4.9 倍の速さだった。
44.1 kHz の全体推論は音声長の約 0.7 から 1.1 倍の時間がかかった。
60 分の音声ではメモリの制約で全体推論を使えず、5 秒チャンクで約 25 分かかる。

## Decision

- RE-USE を録音の入力時に適用しない。
  モデルは入力中の音声を遅延なく処理する設計ではない。
  録音中の音声を不可逆に変え、重なった発話で主話者以外を抑制する。
- RE-USE を文字起こしの前処理に採用しない。
  今回の検証では、文字起こしの精度が上がらず、低い SNR では悪化した。
- 先行モデル `nvidia/RE-USE` をアプリの選択肢にしない。
  NSCLv1 が利用を非商用の研究および教育目的に限るため、個人の会議メモには使えない。
  商用利用と個人利用の両方に使える `nvidia/NVIDIA-NemotronLabs-RE-USE` を選ぶ。
- macOS の PyTorch と MPS の非公式移植をアプリの依存に含めない。
  PyTorch と MPS の実行環境 (数 GB)、約 38.6 MB の重み、非公式のコードを同梱または自動導入することになり、アプリのサイズと保守の負担が増える。
- RE-USE を音声の再生品質を上げる機能としても、現時点では追加しない。
  利用者の目的は文字起こしの精度を上げることであり、再生品質の改善は別の要求として扱う。
- 検証の手順と結果を `docs/testing/reuse-speech-enhancement.md` に残す。
- 次のいずれかを満たしたときに、既定の文字起こし処理として採用するかを再検討する。
  実会議の音声で CER の改善を複数の会議で確認する。
  NVIDIA が Core ML または ONNX の公式な推論経路を提供する。
  重なった発話を抑制しないモデル、または話者ごとに適用できるモデルが提供される。

## Consequences

- 生の音声のノイズは録音時のまま残る。
  ADR-0027 は強調した音声を別ファイルで保存する。
  文字起こしの精度は、whisper.cpp のモデル、用語集、マイクの設定で改善する。
- 先行モデルを研究や教育の目的で使う場合も、NSCLv1 の目的と再配布の条件を確認する必要がある。
  アプリは先行モデルを同梱も自動導入もしない。
- 音声を端末内に置く方針を維持できる。
  OpenAI の文字起こし API を使う場合の音声送信は、ADR-0024 の確認手順に従う。
- WebGPU 実装の同梱は ADR-0027 が決めた。
  アプリは WebGPU エンジンの非公式コードの保守と GPU 差異の追跡の負担を負う。
  PyTorch と MPS の移植は依存に含めない。
- ADR-0027 は非公式の WebGPU 実装で追加する。
  公式の推論経路が提供されたら、その経路に置き換える。

## References

- `docs/adr/0027-reuse-webgpu-enhancement.md`
- `docs/prd/kataribe.md`
- `docs/adr/0006-whisper-cpp-and-model-management.md`
- `docs/testing/reuse-speech-enhancement.md`
- NVIDIA, "NVIDIA NemotronLabs RE-USE", https://huggingface.co/nvidia/NVIDIA-NemotronLabs-RE-USE
- NVIDIA, "RE-USE", https://huggingface.co/nvidia/RE-USE
- `yani-/re-use-mac-unofficial`, https://github.com/yani-/re-use-mac-unofficial
