# 録音中の powerSaveBlocker とスリープ復帰処理を実装する

Created: 2026-10-29
Model: DeepSeek V4.1 Flash 1017
優先度: P0
対応 ADR: ADR-0003 (docs/adr/0003-system-audio-virtual-device.md)、ADR-0002 (docs/adr/0002-web-audio-recording-and-chunks.md)
関連 PRD: 非機能要件の録音の信頼性、データ耐久性
依存: 0001、0002

## 背景

録音中にシステムスリープを発生させたテストでは、19 秒のスリープの後にキャプチャが再開した。
復帰後の測定フレーム数は 3,684,352 で、180 秒の期待値 3,686,400 との差は 2,048 だった。
しかし、スリープ中の約 19 秒は音声が途切れている。
録音中のスリープを防がなければ、会議の音声が欠落する。

## 目的

録音中はシステムスリープを抑止し、強制的にスリープした場合でも復帰後に録音を再開できるようにする。

## やること

- 録音開始時に `powerSaveBlocker` を開始し、録音停止時に停止する。
  録音中にだけ有効にし、停止後は通常のスリープを許可する。
- `powerMonitor` の suspend と resume を監視する。
  スリープした時刻と復帰した時刻を `meta.json` に記録する。
- 復帰後に BlackHole 2ch の入力デバイスとマイクのストリームを再確認する。
  必要なら `getUserMedia` をやり直し、録音を再開する。
- スリープ中に音声が欠落した可能性がある場合は、録音終了後に警告を出す。
  音声ファイルのタイムスタンプやチャンクの連続性から、欠落区間を特定できるようにする。
- 復帰後に BlackHole が見つからない場合は、録音を停止して設定を確認するよう案内する。
- スリープ復帰後の録音を、手動テストのチェックリストに含める。

## 完了条件

- 録音中に `powerSaveBlocker` が有効になり、通常のアイドルスリープが起きない。
- 録音停止後に `powerSaveBlocker` が解放され、通常のスリープができる。
- 強制的にスリープした場合、復帰後に録音が再開し、欠落区間が `meta.json` に記録される。
- BlackHole が見つからない場合に、録音が無音のまま続かない。
- スリープ復帰の手動テスト結果が `docs/m0/0003-system-audio/README.md` に残る。

## 参照

- `docs/adr/0003-system-audio-virtual-device.md` の「結果」
- `docs/adr/0002-web-audio-recording-and-chunks.md` の「結果」
- `docs/prd/kataribe.md` の非機能要件
