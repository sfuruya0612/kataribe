import type { InputSource, UiLanguage } from './types';

export type MessageParams = Readonly<Record<string, string | number>>;

/**
 * UI の英語表記を、日本語の原文をキーにして保持する。
 *
 * 日本語の原文をそのままキーにすると、画面の文言を変えたときに翻訳の更新漏れを
 * 型検査で検出できる。英語表記を追加するときは、同じ原文のキーへ訳文を登録する。
 */
export const EN_MESSAGES = {
  '待機中': 'Idle',
  '準備中': 'Preparing',
  '録音中': 'Recording',
  '停止中': 'Stopping',
  '保存中': 'Saving',
  '変換待ち': 'Waiting to encode',
  'エラー': 'Error',
  '録音を開始': 'Start recording',
  '録音を停止': 'Stop recording',
  '状態: {status}': 'Status: {status}',
  '経過時間: {elapsed}': 'Elapsed: {elapsed}',
  '入力ソース: {source}': 'Input source: {source}',
  '入力ソース': 'Input source',
  'マイク': 'Microphone',
  'システム音声': 'System audio',
  'マイク + システム音声': 'Microphone + system audio',
  'メインウィンドウを開く': 'Open main window',
  'Kataribe を終了': 'Quit Kataribe',
  'Kataribe 会議録 について': 'About Kataribe',
  'Kataribe を隠す': 'Hide Kataribe',
  'ほかのアプリを隠す': 'Hide others',
  'すべてを表示': 'Show all',
  'ファイル': 'File',
  'ウインドウを閉じる': 'Close window',
  '編集': 'Edit',
  'ウインドウ': 'Window',
  '元に戻す': 'Undo',
  'やり直す': 'Redo',
  'カット': 'Cut',
  'ペースト': 'Paste',
  'ペーストとスタイルを合わせる': 'Paste and Match Style',
  'すべてを選択': 'Select All',
  'しまう': 'Minimize',
  '拡大/縮小': 'Zoom',
  'フルスクリーンを切り替える': 'Toggle Full Screen',
  'すべてを手前に移動': 'Bring All to Front',
  '設定': 'Settings',
  '一般': 'General',
  '文字起こし': 'Transcription',
  '要約': 'Summary',
  '外観': 'Appearance',
  'システム': 'System',
  'ライト': 'Light',
  'ダーク': 'Dark',
  '日本語': 'Japanese',
  'English': 'English',
  'UI の言語': 'Language',
  'アプリの表示に使う言語です。変更するとすぐに反映されます。': 'Language used in the app. Changes apply immediately.',
  '保存先': 'Save location',
  '変更': 'Change',
  '設定はローカルに保存されます': 'Settings are saved locally',
  'Kataribe 会議録': 'Kataribe',
  'ローカルビルド': 'Local build',
  'About を開く': 'Open About',
  '会議索引': 'Meeting index',
  '索引を再構築': 'Rebuild index',
  '再構築中...': 'Rebuilding...',
  'セットアップ': 'Setup',
  'セットアップ手順を開く': 'Open setup guide',
  'セットアップ手順': 'Setup guide',
  'BlackHole 2ch の配布元': 'BlackHole 2ch download',
  'キャンセル': 'Cancel',
  '保存': 'Save',
  '保存中...': 'Saving...',
  '削除': 'Delete',
  'コピー': 'Copy',
  '閉じる': 'Close',
  '変更を保存': 'Save changes',
  '中止': 'Cancel',
  'ダウンロード': 'Download',
  '開始中...': 'Starting...',
  '検証中': 'Verifying',
  'インストール済み': 'Installed',
  '未取得': 'Not downloaded',
  '状態を確認中': 'Checking status',
  '自動': 'Auto',
  '{count} 人': '{count} people',
  '1 人': '1 person',
  '{month} 月': '{month}',
  '会議一覧を読み込めませんでした: {error}': 'Could not load meetings: {error}',
  '保存先が {service} の同期対象です。音声と文字起こしが端末外に同期されます。':
    'The save location is synced by {service}. Audio and transcripts are synced off this device.',
  '選択したフォルダは {service} の同期対象です。音声と文字起こしが端末外に同期されます。':
    'The selected folder is synced by {service}. Audio and transcripts are synced off this device.',
  'アプリ情報を取得できませんでした: {error}': 'Could not load app information: {error}',
  '設定を読み込めませんでした: {error}': 'Could not load settings: {error}',
  'whisper モデルが未取得です。設定 > 文字起こし からダウンロードしてください。':
    'The whisper model is not installed. Download it from Settings > Transcription.',
  '検索できませんでした: {error}': 'Search failed: {error}',
  '設定を保存できませんでした: {error}': 'Could not save settings: {error}',
  '操作に失敗しました: {error}': 'The operation failed: {error}',
  '保存先を変更しました。': 'Changed the save location.',
  '保存先を変更できませんでした: {error}': 'Could not change the save location: {error}',
  '音声を取り込めませんでした: {error}': 'Could not import audio: {error}',
  'Pin を変更できませんでした: {error}': 'Could not change the pin: {error}',
  '「{title}」を削除します。音声、文字起こし、要約、メタデータがすべて削除され、元に戻せません。':
    'Delete "{title}"? Audio, transcripts, summaries, and metadata will be deleted permanently.',
  '会議を削除しました。': 'Deleted the meeting.',
  '会議を削除できませんでした: {error}': 'Could not delete the meeting: {error}',
  '変換中': 'Encoding',
  '文字起こし中': 'Transcribing',
  '文字起こし済み': 'Transcribed',
  '要約済み': 'Summarized',
  '処理中': 'Working',
  '処理中の会議': 'Processing',
  '停止': 'Stop',
  '1 件の会議': '1 meeting',
  '{count} 件の会議': '{count} meetings',
  '会議を検索': 'Search meetings',
  '文字起こし・要約を検索': 'Search transcripts and summaries',
  '会議の絞り込み': 'Filter meetings',
  'ライブラリ': 'Library',
  'すべての会議': 'All meetings',
  '年 / 月': 'Year / Month',
  '操作': 'Actions',
  '録音パネル': 'Recorder panel',
  '会議': 'Meetings',
  '会議一覧': 'All meetings',
  '音声を取り込む': 'Import audio',
  '再読み込み': 'Reload',
  '日付': 'Date',
  'タイトル': 'Title',
  '長さ': 'Duration',
  '状態': 'Status',
  '会議を読み込んでいます。': 'Loading meetings...',
  '録音した会議はここに表示されます': 'Your recorded meetings appear here',
  '右側の「録音を開始」から最初の会議を録音できます。':
    'Start your first recording with "Start recording" on the right.',
  'Pin を解除': 'Unpin',
  'Pin 止め': 'Pin',
  '会議を削除': 'Delete meeting',
  '検索': 'Search',
  '検索結果': 'Search results',
  '「{query}」': '"{query}"',
  '「{query}」を検索しています...': 'Searching for "{query}"...',
  '1 件': '1 result',
  '{count} 件': '{count} results',
  '1 件の録音': '1 recording',
  '{count} 件の録音': '{count} recordings',
  '（上限に達しました）': ' (limit reached)',
  '検索しています。': 'Searching.',
  '一致する会議はありませんでした': 'No matching meetings',
  '文字起こし、翻訳、要約、タイトルから検索します。2 文字以上で入力してください。':
    'Search titles, transcripts, translations, and summaries. Enter at least 2 characters.',
  '文字起こし（日本語訳）': 'Transcript (Japanese translation)',
  '文字起こし（English 訳）': 'Transcript (English translation)',
  '保存済み': 'Saved',
  '録音を保存しました': 'Recording saved',
  '一部保存': 'Partially saved',
  '変換と文字起こしを開始': 'Encoding and transcription started',
  '実サンプル': 'Actual samples',
  '期待サンプル': 'Expected samples',
  'サンプルレート': 'Sample rate',
  '期待サンプル数と実サンプル数が一致しません。一部の音声が欠落している可能性があります。':
    'The expected and actual sample counts differ. Some audio may be missing.',
  '保存に失敗したチャンクがあります。音声が欠落している可能性があります。':
    'Some chunks could not be saved. Audio may be missing.',
  'Finder で開く': 'Open in Finder',
  '会議詳細を開く': 'Open meeting',
  'mp3 への変換と文字起こしはバックグラウンドで自動的に始まります。会議詳細で進捗を確認できます。':
    'mp3 encoding and transcription start automatically in the background. Check progress in the meeting detail.',
  '復旧': 'Recovery',
  '復旧できる録音': 'Recoverable recordings',
  '前回の終了時に残ったチャンクがあります。復旧すると 1 つの WAV に結合します。':
    'Audio chunks remain from the previous session. Recovering them joins them into one WAV file.',
  '1 チャンク': '1 chunk',
  '{count} チャンク': '{count} chunks',
  '{seconds} 秒相当': '{seconds} seconds',
  '復旧しています...': 'Recovering...',
  '復旧する': 'Recover',
  '音声を再生できませんでした。': 'Could not play the audio.',
  '音声ファイルがありません。': 'No audio file.',
  '音声を読み込めませんでした。': 'Could not load the audio.',
  '一時停止': 'Pause',
  '再生': 'Play',
  '再生位置': 'Playback position',
  'レベル': 'Levels',
  '入力レベル': 'Input level',
  '100 ms 間隔': 'Every 100 ms',
  '録音停止中': 'Recording is stopped',
  'ピーク': 'Peak',
  'マイク入力がクリップしています。macOS の入力音量、マイクのゲイン、マイクとの距離を調整してください。':
    'The microphone input is clipping. Adjust the macOS input volume, the microphone gain, or the distance to the microphone.',
  'システム音声が届いていません。Multi-Output Device と macOS の出力設定を確認してください。':
    'System audio is not arriving. Check the Multi-Output Device and the macOS output settings.',
  '実フレーム': 'Actual frames',
  '期待フレーム': 'Expected frames',
  '欠落フレーム': 'Missed frames',
  'ギャップ': 'Gaps',
  'コンテキスト差': 'Context clock delta',
  '保存済みチャンク': 'Saved chunks',
  '{gaps} 回 / 最大 {max}': '{gaps} times / max {max}',
  '0 回': '0 times',
  '{seconds} 秒': '{seconds} s',
  '0.000 秒': '0.000 s',
  '録音を開始すると、AudioWorklet が数えた実フレーム数と入力レベルを表示します。':
    'When recording starts, the actual frame count measured by the AudioWorklet and the input level appear here.',
  '録音を準備しています': 'Preparing to record',
  '録音を保存しています': 'Saving the recording',
  '録音でエラーが発生しました': 'A recording error occurred',
  '録音の準備': 'Ready to record',
  'マイク権限: 許可済み': 'Microphone access: allowed',
  'マイク権限: 確認中': 'Microphone access: checking',
  'マイク権限: 拒否': 'Microphone access: denied',
  'マイク権限: 未確認': 'Microphone access: not requested',
  'マイク権限: 不明': 'Microphone access: unknown',
  '保存した音声の長さ': 'Length of the saved audio',
  '入力ソースを変更しました。この変更は次の録音から適用されます。':
    'Changed the input source. The change applies to the next recording.',
  'マイクが見つかりません': 'No microphone found',
  'マイク {index}': 'Microphone {index}',
  'システム音声（BlackHole 2ch）': 'System audio (BlackHole 2ch)',
  'BlackHole 2ch が見つかりません': 'BlackHole 2ch not found',
  'マイク権限を確認する': 'Check microphone access',
  'システム設定を開く': 'Open System Settings',
  'マイク権限が拒否されています。システム設定の「プライバシーとセキュリティ」>「マイク」で Kataribe を許可してください。':
    'Microphone access is denied. Allow Kataribe in System Settings > Privacy & Security > Microphone.',
  '入力デバイスの検出と録音にマイク権限を使います。システム音声だけの場合も、BlackHole 2ch のラベル取得に必要です。':
    'Kataribe uses microphone access to detect input devices and record audio. It also needs access to read the BlackHole 2ch label when recording system audio only.',
  'マイクが見つかりません。マイクを接続し、マイク権限を確認してください。':
    'No microphone was found. Connect a microphone and check microphone access.',
  'BlackHole 2ch が見つかりません。': 'BlackHole 2ch was not found.',
  '保存しています...': 'Saving...',
  '準備しています...': 'Preparing...',
  '保存先: {path}': 'Save location: {path}',
  '復旧対象の確認に失敗しました: {error}': 'Could not check recoverable recordings: {error}',
  'チャンクの保存に失敗しました: {error}': 'Could not save a chunk: {error}',
  '入力レベルの送信に失敗しました: {error}': 'Could not send the input level: {error}',
  'クリッピング状態の送信に失敗しました: {error}':
    'Could not send the clipping state: {error}',
  '無音状態の送信に失敗しました: {error}': 'Could not send the silence state: {error}',
  'スリープ中の無音を保存できませんでした: {error}':
    'Could not save silence during sleep: {error}',
  'BlackHole 2ch が切断されました。録音を停止してチャンクを保存します。':
    'BlackHole 2ch was disconnected. Recording will stop and saved chunks will be kept.',
  'マイクが切断されました。録音を停止してチャンクを保存します。':
    'The microphone was disconnected. Recording will stop and saved chunks will be kept.',
  'マイクが切断されました。システム音声の録音を続けます。':
    'The microphone was disconnected. System audio recording will continue.',
  'デバイスの切断を記録できませんでした: {error}':
    'Could not record the device disconnection: {error}',
  '入力デバイスの状態を確認できませんでした: {error}':
    'Could not check the input device state: {error}',
  'マイクが見つかりません。マイクを接続してから再試行してください。':
    'No microphone was found. Connect a microphone and try again.',
  'BlackHole 2ch が見つかりません。README の初期セットアップに従ってインストールしてください。':
    'BlackHole 2ch was not found. Install it following the initial setup in the README.',
  '録音が開始されていません。': 'Recording has not started.',
  '録音処理の停止に失敗しました。保存済みのチャンクで停止します: {error}':
    'Could not stop the recorder. Stopping with the chunks saved so far: {error}',
  '録音の再開に失敗しました: {error}': 'Could not resume recording: {error}',
  '入力デバイスの変更を確認できませんでした: {error}':
    'Could not check for input device changes: {error}',
  '録音状態の取得に失敗しました: {error}': 'Could not read the recording state: {error}',
  'マイク権限の確認に失敗しました: {error}': 'Could not check microphone access: {error}',
  '入力デバイスの取得に失敗しました: {error}': 'Could not list input devices: {error}',
  '状態を確認してください。': 'Check the current state.',
  '録音を開始できませんでした: {error}': 'Could not start recording: {error}',
  '録音を停止できませんでした: {error}': 'Could not stop recording: {error}',
  '入力ソースを変更できませんでした: {error}': 'Could not change the input source: {error}',
  'クリッピング設定を変更できませんでした: {error}':
    'Could not change the clipping settings: {error}',
  '無音検出の設定を変更できませんでした: {error}':
    'Could not change the silence detection settings: {error}',
  '録音の復旧に失敗しました: {error}': 'Could not recover the recording: {error}',
  '保存先を開けませんでした: {error}': 'Could not open the save location: {error}',
  'システム設定を開けませんでした: {error}': 'Could not open System Settings: {error}',
  '話者分離に失敗しました。': 'Speaker diarization failed.',
  '録音データが保存されなかったため、音声ファイルを作成できませんでした。入力デバイスと権限を確認して、もう一度録音してください。':
    'No recording data was saved, so the audio file could not be created. Check the input device and permissions, then record again.',
  'クリッピング警告': 'Clipping warning',
  '解除までの連続回数': 'Consecutive intervals before clearing',
  'システム音声の無音検出': 'System audio silence detection',
  '猶予時間（秒）': 'Grace period (seconds)',
  '選択中': 'Selected',
  'エンドポイント未設定': 'Endpoint not set',
  '新規プロファイル': 'New profile',
  'プロファイルを追加': 'Add profile',
  'モデル': 'Model',
  '要約の出力言語': 'Summary output language',
  '要約プロンプト': 'Summary prompt',
  '既定': 'Default',
  '再検出': 'Detect again',
  '現在の出力': 'Current output',
  '出力デバイス': 'Output device',
  '取得できません': 'Unavailable',
  '選択してください': 'Select an option',
  '警告までの連続回数': 'Consecutive intervals before warning',
  '監視ウィンドウ（秒）': 'Monitoring window (seconds)',
  '自動作成して出力に設定': 'Create and set as output',
  'システムプロンプト（空欄で既定）': 'System prompt (empty for default)',
  '処理中...': 'Working...',
  'API キーを削除': 'Delete API key',
  '翻訳': 'Translation',
  '録音': 'Recording',
  '録音は停止しています': 'Recording is stopped',
  'モデル一覧を取得できませんでした: {error}':
    'Could not load the model list: {error}',
  'LLM プロファイルを保存できませんでした: {error}':
    'Could not save the LLM profile: {error}',
  'LLM プロファイルを削除しました。': 'Deleted the LLM profile.',
  'LLM プロファイルを削除できませんでした: {error}':
    'Could not delete the LLM profile: {error}',
  'ダウンロードを中断しました。次回は続きから再開します。':
    'Cancelled the download. It resumes from the same point next time.',
  '索引を再構築できませんでした: {error}':
    'Could not rebuild the index: {error}',
  'このアプリについて': 'About this app',
  '入力デバイス': 'Input devices',
  '検出済み': 'Detected',
  '見つかりません': 'Not found',
  'マイクを接続してください。': 'Connect a microphone.',
  'マイク権限を確認': 'Check microphone access',
  '音声の変換をキャンセルしました。': 'Cancelled audio encoding.',
  'ユーザーの確認により処理を継続しています。':
    'Continuing after user confirmation.',
  '要約をコピーしました。': 'Copied the summary.',
  '話者名を変更しました。': 'Changed speaker names.',
  '文字起こしを保存できませんでした: {error}':
    'Could not save the transcript: {error}',
  '要約を保存しました。': 'Saved the summary.',
  '翻訳を生成しました。': 'Generated the translation.',
  '要約を生成しました。': 'Generated the summary.',
  '処理を中断しました。': 'Cancelled processing.',
  '文字起こしの本文が空です。': 'The transcript body is empty.',
  '要約を生成': 'Generate summary',
  '録音エラー': 'Recording error',
  '会議の表示': 'Meeting view',
  '文字起こしを開始': 'Start transcription',
  '（既定）': ' (default)',
  'この会議の要約言語': 'Summary language for this meeting',
  '要約はまだありません。': 'No summary yet.',
  '送信内容の確認': 'Confirm what will be sent',
  'エンドポイント': 'Endpoint',
  '概算トークン': 'Estimated tokens',
  '内容ハッシュ': 'Content hash',
  '送信中...': 'Sending...',
  '送信して要約': 'Send and generate summary',
  '翻訳の送信内容の確認': 'Confirm what will be translated',
  '送信して翻訳': 'Send and translate',
  '話者': 'Speakers',
  '話者名の変更': 'Change speaker names',
  '録音中は話者名を変更できません。':
    'Speaker names cannot be changed while recording.',
  'マイク入力のクリッピングが収まりました。':
    'The microphone input is no longer clipping.',
  'システムスリープから復帰しました。': 'Resumed from system sleep.',
  '取り込んだ会議が見つかりません。':
    'The imported meeting was not found.',
  '会議フォルダのパスが保存先の外になります。':
    'The meeting folder path would be outside the save location.',
  '文字起こしの話者名が重複しています。':
    'The transcript has duplicate speaker names.',
  '話者名に対応するクラスタが見つかりません。':
    'No cluster matches the speaker name.',
  '文字起こしに話者名が見つかりません。':
    'No speaker names were found in the transcript.',
  '要約をキャンセルしました。': 'Cancelled the summary.',
  '原文と同じ言語には翻訳できません。':
    'The transcript cannot be translated into its own language.',
  '部分的な文字起こしを翻訳します。完了済みの文字起こしで再実行することを推奨します。':
    'Translating a partial transcript. We recommend running it again with the completed transcript.',
  '別の処理が実行中です。完了してから翻訳を実行してください。':
    'Another operation is running. Wait for it to finish before translating.',
  '翻訳をキャンセルしました。': 'Cancelled the translation.',
  '処理中は文字起こしを編集できません。':
    'The transcript cannot be edited while processing.',
  '文字起こしが大きすぎます。': 'The transcript is too large.',
  '処理中は要約を編集できません。':
    'The summary cannot be edited while processing.',
  '要約が大きすぎます。': 'The summary is too large.',
  '録音中の会議は処理できません。':
    'A meeting cannot be processed while it is recording.',
  '変換できる音声ファイルがありません。':
    'No audio file can be converted.',
  '確認': 'Confirm',
  '文字数': 'Characters',
  '日本語訳': 'Japanese translation',
  '処理を中断': 'Cancel processing',
  'プロファイル': 'Profile',
  'タイトルを編集': 'Edit title',
  '日本語訳を再生成': 'Regenerate Japanese translation',
  'プロファイル未設定': 'No profile configured',
  '要約を生成しています': 'Generating the summary',
  '会議が選ばれていません': 'No meeting selected',
  '話者名が重複しています。': 'Speaker names are duplicated.',
  '文字起こしを開始しました。': 'Started transcription.',
  'このプロファイルを既定にする': 'Make this profile the default',
  '設定済み（変更する場合だけ入力）': 'Set (enter only to change)',
  '話者名に角括弧を含めることはできません。':
    'A speaker name cannot contain square brackets.',
  '話者分離に失敗しました。文字起こしは保存されています。':
    'Speaker diarization failed. The transcript was saved.',
  '入力ソースはトレイと録音パネルに同期します。録音中の変更は次の録音から適用されます。':
    'The input source is shared with the menu bar and the recorder panel. A change during recording applies to the next recording.',
  '翻訳に使う LLM プロファイル': 'LLM profile for translations',
  '処理を中断できませんでした: {error}':
    'Could not cancel processing: {error}',
  'モデルを削除できませんでした: {error}':
    'Could not delete the model: {error}',
  '要約言語を変更できませんでした: {error}':
    'Could not change the summary language: {error}',
  '文字起こしを開始できませんでした: {error}':
    'Could not start transcription: {error}',
  '生成中...': 'Generating...',
  'API キーを入力': 'Enter the API key',
  'LLM プロファイル': 'LLM profiles',
  'LLM プロファイルを追加しました。': 'Added the LLM profile.',
  'LLM プロファイルを読み込めませんでした: {error}':
    'Could not load LLM profiles: {error}',
  'Multi-Output Device を削除できませんでした: {error}':
    'Could not delete the Multi-Output Device: {error}',
  '継続': 'Continue',
  '音声ファイル': 'Audio file',
  '文字起こしの継続確認': 'Continue transcription',
  '会議が見つかりません。': 'The meeting was not found.',
  '部分要約を統合しています': 'Merging partial summaries',
  'モデルを入力してください。': 'Enter a model.',
  'システムスリープに入りました。': 'System sleep started.',
  '処理中は話者名を変更できません。':
    'Speaker names cannot be changed while processing.',
  '録音中はタイトルを変更できません。':
    'The title cannot be changed while recording.',
  '会議フォルダが保存先の外にあります。':
    'The meeting folder is outside the save location.',
  '翻訳ファイルの読み込みに失敗しました。':
    'Could not read the translation file.',
  '録音または処理中は音声を取り込めません。':
    'Audio cannot be imported while recording or processing.',
  '録音または処理中は索引を再構築できません。':
    'The index cannot be rebuilt while recording or processing.',
  '別の処理が実行中です。完了してから要約を生成してください。':
    'Another operation is running. Wait for it to finish before generating a summary.',
  '翻訳の確認トークンが無効です。もう一度プレビューを開いてください。':
    'The translation confirmation token is invalid. Open the preview again.',
  '翻訳の確認トークンの有効期限が切れました。もう一度プレビューを開いてください。':
    'The translation confirmation token expired. Open the preview again.',
  '部分的な文字起こしを送信します。完了済みの文字起こしで再実行することを推奨します。':
    'Sending a partial transcript. We recommend running it again with the completed transcript.',
  '削除する LLM プロファイルが見つかりません。':
    'The LLM profile to delete was not found.',
  '録音の復旧に失敗しました。{detail}':
    'Could not recover the recording. {detail}',
  '原文': 'Source',
  '送信先': 'Destination',
  '入力不明': 'Unknown input',
  '会議一覧へ': 'Back to meetings',
  '話者名を編集': 'Edit speaker names',
  '翻訳しています': 'Translating',
  'コピーしました。': 'Copied.',
  '文字起こしを再実行': 'Run transcription again',
  '音声を変換しています': 'Encoding audio',
  '文字起こしをしています': 'Transcribing',
  'タイトルを変更しました。': 'Changed the title.',
  '文字起こしを保存しました。': 'Saved the transcript.',
  '波形を取得できませんでした。': 'Could not load the waveform.',
  '出力デバイスを選択してください。': 'Choose an output device.',
  '話者名を空にすることはできません。': 'A speaker name cannot be empty.',
  '要約言語をアプリの既定に戻しました。': 'Restored the app default summary language.',
  '話者名に改行を含めることはできません。': 'A speaker name cannot contain a line break.',
  '話者名にコロンを含めることはできません。': 'A speaker name cannot contain a colon.',
  '部分的な翻訳です。原文と対応していない行があります。':
    'This translation is partial. Some lines do not match the source.',
  '会議一覧から録音を選ぶと、音声と処理状況を表示します。':
    'Select a recording from the meeting list to view the audio and processing status.',
  '部分的な文字起こしです。完了していない可能性があります。':
    'This transcript is partial and may not be complete.',
  'モデルが未取得の場合は、設定画面からダウンロードしてください。':
    'If the model is not installed, download it from Settings.',
  '話者名を空にせず、重複しない名前にしてください。コロン、改行、角括弧は使えません。':
    'Speaker names must be non-empty and unique. They cannot contain colons, line breaks, or square brackets.',
  '変更後、既存の会議は新しい保存先の一覧に表示されません。会議フォルダは移動しません。':
    'After the change, existing meetings no longer appear in the new save location. Meeting folders are not moved.',
  '文字起こしと既存の翻訳の話者名を置き換えます。翻訳が話者名を保持していない行は変わりません。':
    'Replaces speaker names in the transcript and existing translations. Lines whose translation does not keep the speaker name are unchanged.',
  'メニューバーまたはこの画面から録音を開始できます。録音中にウィンドウを閉じても録音は続きます。':
    'Start recording from the menu bar or this screen. Closing the window during recording does not stop the recording.',
  '文字起こしが完了したら「要約を生成」を押してください。送信前に、送る内容と送信先を確認できます。':
    'When transcription finishes, select Generate summary. You can review the content and destination before sending.',
  '音声ファイルは送信しません。送信するのは文字起こしの本文だけで、要約の生成を実行したときだけ送ります。':
    'Audio files are not sent. Only the transcript body is sent, and only when you generate a summary.',
  '会議一覧と全文検索の索引を、会議フォルダから作り直します。索引が壊れた場合や、外部で会議フォルダを編集した場合に使います。':
    'Rebuilds the meeting list and full-text search index from the meeting folders. Use this when the index is broken or you edited meeting folders outside the app.',
  '音声ファイルと会議のメタデータは送信しません。原文のタイムスタンプを保って翻訳します。翻訳の品質と料金はプロバイダとモデルに依存します。':
    'Audio files and meeting metadata are not sent. The translation preserves the source timestamps. Translation quality and cost depend on the provider and model.',
  '専門用語や固有名詞をカンマ区切りで入力します。日本語の会議で用語の表記を安定させます。用語集が多いと関係のない単語を誘導することがあります。':
    'Enter technical terms and proper nouns separated by commas. This stabilizes terminology in Japanese meetings. A long glossary can bias the model toward unrelated words.',
  '音声ファイルと会議のメタデータは送信しません。個人名や社名のマスクは行いません。概算料金はプロバイダの料金表を確認してください。送信先でのデータの扱いはプロバイダの規約に従います。':
    'Audio files and meeting metadata are not sent. Personal and company names are not masked. Check the provider price list for estimated cost. The provider terms govern how the destination handles the data.',
  ' · 残り約 {duration}': ' · about {duration} left',
  ' · 取得済み {size}': ' · {size} downloaded',
  ' · インストール済み {size}': ' · {size} installed',
  ' 保存時のホストは {host} です。': ' The saved host is {host}.',
  ' 保存先: {path}': ' Save location: {path}',
  '約 {count} tokens': 'about {count} tokens',
  '話者名は {max} 文字以内にしてください。':
    'A speaker name must be {max} characters or fewer.',
  'プロファイルが 1 つだけのため、自動的に既定として使用します。':
    'The only profile is used as the default automatically.',
  '要約と翻訳で最初に選ばれるプロファイルです。プロファイルが 1 つだけの場合は自動的に既定になります。':
    'This profile is selected first for summaries and translations. When it is the only profile, it becomes the default automatically.',
  'マイク入力のピークがしきい値を超えた状態が続くと警告します。値は 100 ms 単位の連続回数で指定します。':
    'Warns when the microphone peak stays above the threshold. The value is the number of consecutive 100 ms intervals.',
  '設定変更のため API キーの再入力が必要':
    'Re-enter the API key after these settings change',
  '保存済みの API キーは現在のプロファイル設定と一致しません。':
    'The saved API key does not match the current profile settings.',
  'システム音声を録音するには BlackHole 2ch と Multi-Output Device の設定が必要です。':
    'Recording system audio requires BlackHole 2ch and a Multi-Output Device.',
  'モデルは HTTPS でダウンロードし、SHA-256 を照合してから保存します。中断しても次回は続きから再開します。':
    'Models are downloaded over HTTPS and saved after SHA-256 verification. An interrupted download resumes next time.',
  'その ID は既に使われています。別の ID を入力してください。':
    'That ID is already used. Enter a different ID.',
  '要約に使う LLM プロファイル': 'LLM profile for summaries',
  '既定の LLM プロファイルを変更できませんでした: {error}':
    'Could not change the default LLM profile: {error}',
  'システムを選ぶと macOS のライト / ダーク設定に追従します。既定はシステムです。':
    'System follows the macOS light and dark settings. The default is System.',
  'システム音声の RMS がしきい値を下回る状態が続くと警告します。猶予時間は会議前の無音で警告しないために使います。':
    'Warns when system audio RMS stays below the threshold. The grace period prevents warnings from silence before the meeting.',
  'エンドポイント URL': 'Endpoint URL',
  'エンドポイント URL を入力してください。': 'Enter the endpoint URL.',
  'エンドポイント URL の形式が正しくありません。':
    'The endpoint URL format is invalid.',
  'エンドポイント URL に認証情報を含めないでください。':
    'Do not include credentials in the endpoint URL.',
  'エンドポイント URL にフラグメントを含めないでください。':
    'Do not include a fragment in the endpoint URL.',
  'エンドポイント URL は HTTPS を指定してください。':
    'Use HTTPS for the endpoint URL.',
  '文字起こしは端末内の whisper.cpp で行います。録音停止後、選択中のモデルで自動的に開始します。':
    'Transcription runs locally with whisper.cpp. It starts automatically with the selected model after recording stops.',
  'コピーできませんでした: {error}': 'Could not copy: {error}',
  '要約を保存できませんでした: {error}': 'Could not save the summary: {error}',
  '話者名を変更できませんでした: {error}':
    'Could not change speaker names: {error}',
  'タイトルを変更できませんでした: {error}':
    'Could not change the title: {error}',
  '会議の詳細を読み込めませんでした: {error}':
    'Could not load the meeting details: {error}',
  'ダウンロードを中断できませんでした: {error}':
    'Could not cancel the download: {error}',
  'モデルのダウンロードを開始できませんでした: {error}':
    'Could not start the model download: {error}',
  'プロファイルを編集: {id}': 'Edit profile: {id}',
  '作成済み: {name}（{channels} ch）': 'Created: {name} ({channels} ch)',
  '例: Kataribe, BlackHole, リリース, スプリント':
    'Example: Kataribe, BlackHole, release, sprint',
  '例: work-claude': 'Example: work-claude',
  '確認中...': 'Checking...',
  '読み込み中です...': 'Loading...',
  '{count} 文字': '{count} characters',
  '索引を再構築しました（{count} 件）。':
    'Rebuilt the index ({count} meetings).',
  '{id} を既定にする': 'Make {id} the default',
  '「{id}」の API キーを削除します。よろしいですか？':
    'Delete the API key for "{id}"?',
  '「{id}」を既定の LLM プロファイルにしました。':
    'Made "{id}" the default LLM profile.',
  '既定（{language}）': 'Default ({language})',
  'この会議の要約言語を{language}に変更しました。':
    'Changed this meeting summary language to {language}.',
  '{model} で再実行': 'Run again with {model}',
  '{model} を削除しました。': 'Deleted {model}.',
  '{model} で文字起こしを開始しました。': 'Started transcription with {model}.',
  '{model} のモデルファイルを削除します。よろしいですか？':
    'Delete the {model} model file?',
  '{name}（{channels} ch）': '{name} ({channels} ch)',
  'ピークしきい値（0.5〜1.0）': 'Peak threshold (0.5 to 1.0)',
  '4 セクションの見出しが欠けても、保存時に不足する見出しを補います。プロンプトを変更すると出力の品質や形式が変わる場合があります。':
    'If any of the four section headings are missing, the app adds them when saving. Changing the prompt can change output quality and format.',
  '新しく録音する会議に適用します。64 kbps は 1 時間で約 29 MB、128 kbps は約 58 MB です。既存の mp3 は変更しません。':
    'Applies to new recordings. 64 kbps is about 29 MB per hour and 128 kbps about 58 MB. Existing mp3 files are unchanged.',
  'API キー': 'API key',
  'API キー未設定': 'API key not set',
  'API キー設定済み': 'API key set',
  'API キーを削除しました。': 'Deleted the API key.',
  'API キーを再入力してください。': 'Re-enter the API key.',
  'API キーは Electron の safeStorage で暗号化し、macOS Keychain に保護された鍵で保存します。設定ファイルに平文は残しません。別の Mac にコピーした場合は再入力が必要です。':
    'The API key is encrypted with Electron safeStorage and stored with a key protected by macOS Keychain. The settings file keeps no plaintext. Copying to another Mac requires re-entering the key.',
  'API キーを削除できませんでした: {error}':
    'Could not delete the API key: {error}',
  'English 訳': 'English translation',
  'English 訳を再生成': 'Regenerate English translation',
  'HTTP は localhost、127.0.0.1、::1 のいずれかでのみ使用できます。':
    'HTTP is allowed only with localhost, 127.0.0.1, or ::1.',
  'ID（一意の名前）': 'ID (unique name)',
  'ID を入力してください。': 'Enter an ID.',
  'ID は 64 文字以内で入力してください。':
    'Enter an ID of 64 characters or fewer.',
  'ID ごとに Provider、エンドポイント URL、モデル、API キーを保存します。要約と翻訳では、既定のプロファイルまたは任意のプロファイルを選んで使用します。':
    'Each ID stores a provider, endpoint URL, model, and API key. Summaries and translations use the default profile or a profile you choose.',
  '用語集（initial prompt）': 'Glossary (initial prompt)',
  'Kataribe Multi-Output を削除': 'Delete Kataribe Multi-Output',
  'Kataribe Multi-Output を削除しました。': 'Deleted Kataribe Multi-Output.',
  'Kataribe Multi-Output を作成し、macOS の出力に設定しました。システム音声の入力に BlackHole 2ch を選んでください。':
    'Created Kataribe Multi-Output and set it as the macOS output. Choose BlackHole 2ch as the system audio input.',
  'LLM の設定を開く': 'Open LLM settings',
  'LLM プロファイルを更新しました。': 'Updated the LLM profile.',
  'LLM プロファイルがありません。下のフォームから追加してください。':
    'No LLM profiles. Add one with the form below.',
  'LLM プロファイルが設定されていません。設定画面でプロファイルを追加してください。':
    'No LLM profile is configured. Add a profile in Settings.',
  'LLM プロファイルを取得できませんでした: {error}':
    'Could not load LLM profiles: {error}',
  'LLM プロファイルを読み込んでいます...': 'Loading LLM profiles...',
  'LLM プロファイル「{id}」を削除します。保存済みの API キーも削除されます。よろしいですか？':
    'Delete the LLM profile "{id}"? The saved API key will also be deleted.',
  'macOS の出力デバイスと BlackHole 2ch を含む「Kataribe Multi-Output」を自動作成し、システム出力に設定します。作成には BlackHole 2ch が必要です。':
    'Creates a Kataribe Multi-Output device that includes the macOS output device and BlackHole 2ch, then sets it as the system output. BlackHole 2ch is required.',
  'macOS Keychain 利用可能': 'macOS Keychain available',
  'macOS Keychain を利用できません': 'macOS Keychain unavailable',
  'mp3 のビットレート': 'mp3 bitrate',
  '録音を停止すると、mp3 への変換と文字起こしが自動で始まります。':
    'Stopping the recording starts mp3 encoding and transcription automatically.',
  'Multi-Output ヘルパーが見つかりません。`npm run binaries` で再ビルドしてください。':
    'The Multi-Output helper was not found. Rebuild it with `npm run binaries`.',
  'Multi-Output Device の自動作成は macOS でのみ利用できます。':
    'Automatic Multi-Output Device creation is available only on macOS.',
  'Multi-Output Device を作成できませんでした: {error}':
    'Could not create the Multi-Output Device: {error}',
  'Multi-Output Device の状態を取得できませんでした: {error}':
    'Could not read the Multi-Output Device status: {error}',
  'RMS しきい値': 'RMS threshold',
  '要約を生成すると、要約・決定事項・ToDo・未決事項がここに表示されます。':
    'Generating a summary shows the summary, decisions, ToDo, and open questions here.',
  '空欄の場合は、要約・決定事項・ToDo・未決事項の 4 セクションを指定する既定のプロンプトを使います。':
    'Leave empty to use the default prompt that specifies the four sections: summary, decisions, ToDo, and open questions.',
  'whisper.cpp モデル': 'whisper.cpp model',
  '作成': 'Create',
  'カスタム': 'Custom',
  '保存先を変更': 'Change save location',
  '保存先フォルダを選択': 'Choose a save folder',
  '音声ファイルが空です。': 'The audio file is empty.',
  '文字起こしがありません。': 'No transcript.',
  'システム音声が戻りました。': 'System audio returned.',
  '文字起こしを再開しています。': 'Resuming transcription.',
  '出力デバイスが見つかりません。': 'The output device was not found.',
  '文字起こしする音声ファイルを選択': 'Choose an audio file to transcribe',
  '処理中はタイトルを変更できません。':
    'The title cannot be changed while processing.',
  '会議の更新後に会議が見つかりません。':
    'The meeting was not found after the update.',
  '選択した出力デバイスが見つかりません。':
    'The selected output device was not found.',
  '録音または処理中は会議を削除できません。':
    'Meetings cannot be deleted while recording or processing.',
  '録音または処理中は保存先を変更できません。':
    'The save location cannot be changed while recording or processing.',
  '文字起こしに予想以上の時間がかかっています。':
    'Transcription is taking longer than expected.',
  '既存の会議は新しい保存先の一覧に表示されません。':
    'Existing meetings do not appear in the new save location list.',
  '文字起こし用の音声ファイルを読み込めませんでした。':
    'Could not read the audio file for transcription.',
  '予想より時間がかかっています。処理は続行しています。':
    'This is taking longer than expected. Processing continues.',
  '文字起こしがありません。先に文字起こしを完了してください。':
    'No transcript. Finish transcription first.',
  '話者数が一致しません。最新の文字起こしを読み直してください。':
    'The speaker count does not match. Reload the latest transcript.',
  '文字起こしをキャンセルしました。部分的な結果を保存しています。':
    'Transcription was cancelled. The partial result was saved.',
  '文字起こしが変更されました。もう一度プレビューを開いてください。':
    'The transcript changed. Open the preview again.',
  '要約の確認トークンが無効です。もう一度プレビューを開いてください。':
    'The summary confirmation token is invalid. Open the preview again.',
  '前回の音声変換が中断されました。会議詳細から文字起こしを再実行してください。':
    'The previous audio encoding was interrupted. Run transcription again from the meeting details.',
  '要約の確認トークンの有効期限が切れました。もう一度プレビューを開いてください。':
    'The summary confirmation token expired. Open the preview again.',
  '文字起こしの進捗が止まったため、処理を中断しました。部分的な結果を保存しています。':
    'Transcription progress stopped, so processing was interrupted. The partial result was saved.',
  '文字起こしが制限時間を超えたため、処理を中断しました。部分的な結果を保存しています。':
    'Transcription exceeded the time limit, so processing was interrupted. The partial result was saved.',
  '音声から文字起こし結果が得られませんでした。音声に発話が含まれているか確認してください。':
    'No transcription was produced from the audio. Check that the audio contains speech.',
  '前回の文字起こしが中断されました。会議詳細から再実行してください。部分的な結果は保存されています。':
    'The previous transcription was interrupted. Run it again from the meeting details. The partial result was saved.',
  '文字起こしが最後まで完了しませんでした。部分的な結果を保存しています。より小さいモデルで再実行してください。':
    'Transcription did not finish. The partial result was saved. Run it again with a smaller model.',
  '経過 {elapsed} 分、予想 {predicted} 分を超えました。処理を続けますか？':
    '{elapsed} minutes have passed, exceeding the predicted {predicted} minutes. Continue processing?',
  'マイク入力がクリップしています（ピーク {peak}%）。macOS の入力音量、マイクのゲイン、マイクとの距離を調整してください。':
    'The microphone input is clipping (peak {peak}%). Adjust the macOS input volume, the microphone gain, or the distance to the microphone.',
  '録音データが 1 つも保存されなかったため、音声ファイルを作成できませんでした。入力デバイスと権限を確認して、もう一度録音してください。':
    'No recording data was saved, so the audio file could not be created. Check the input device and permissions, then record again.',
  '文字起こし用の 16 kHz WAV を生成しています':
    'Creating the 16 kHz WAV for transcription',
  '既存の Aggregate Device を出力デバイスにできません。通常の出力デバイスを選択してください。':
    'An existing Aggregate Device cannot be the output device. Choose a normal output device.',
  '会議フォルダは移動しません。元のフォルダは Finder から引き続き参照できます。保存先を変更しますか？':
    'Meeting folders are not moved. You can still access the original folders in Finder. Change the save location?',
  '編集する LLM プロファイルが見つかりません。':
    'The LLM profile to edit was not found.',
  '既定に設定する LLM プロファイルが見つかりません。':
    'The LLM profile to set as default was not found.',
  '録音または処理中は Multi-Output Device を作成できません。':
    'The Multi-Output Device cannot be created while recording or processing.',
  '音声の変換に失敗しました。{detail}': 'Audio encoding failed. {detail}',
  '無音区間の保存に失敗しました。{detail}':
    'Could not save the silence interval. {detail}',
  '録音データの保存に失敗しました。{detail}':
    'Could not save the recording data. {detail}',
  '録音した音声の結合に失敗しました。{detail}':
    'Could not join the recorded audio. {detail}',
  '翻訳しています（{index}/{total}）': 'Translating ({index}/{total})',
  '要約を生成しています（{index}/{total}）':
    'Generating the summary ({index}/{total})',
  '{label} が見つかりません。resources/{directory}/{binary} に実行ファイルを置くか、PATH の通った {binary} をインストールしてください。':
    '{label} was not found. Place the executable at resources/{directory}/{binary} or install {binary} on PATH.',
  '{output} と {blackhole} を含む「Kataribe Multi-Output」を作成し、既定の出力に設定します。音量キーが効かなくなる場合があります。':
    'Creates Kataribe Multi-Output with {output} and {blackhole}, then sets it as the default output. The volume keys may stop working.',
  'システムスリープから復帰しました。{seconds} 秒の無音を補います。':
    'Resumed from system sleep. Filling {seconds} seconds of silence.',
  '話者を分離しています{suffix}': 'Separating speakers{suffix}',
  '話者分離モデルを準備しています{suffix}':
    'Preparing the speaker diarization model{suffix}',
  'API キーが設定されていません。': 'The API key is not set.',
  'API キーを復号できませんでした。設定画面で再入力してください。{detail}':
    'Could not decrypt the API key. Re-enter it in Settings. {detail}',
  'BlackHole 2ch を通常の出力デバイスとして選択できません。':
    'BlackHole 2ch cannot be selected as a normal output device.',
  'BlackHole 2ch が見つかりません。先に BlackHole 2ch をインストールしてください。':
    'BlackHole 2ch was not found. Install BlackHole 2ch first.',
  'BlackHole 2ch は GPLv3 のソフトウェアです。Kataribe は BlackHole 2ch を同梱せず、再配布しません。配布元: https://existential.audio/blackhole/':
    'BlackHole 2ch is GPLv3 software. Kataribe does not bundle or redistribute BlackHole 2ch. Source: https://existential.audio/blackhole/',
  'ID は 1〜64 文字で入力してください。':
    'Enter an ID between 1 and 64 characters.',
  'Kataribe Multi-Output を削除しますか？':
    'Delete Kataribe Multi-Output?',
  'Kataribe Multi-Output 自身を出力デバイスにできません。':
    'Kataribe Multi-Output cannot be its own output device.',
  'Kataribe: {status}': 'Kataribe: {status}',
  'LLM プロファイルが見つかりません。': 'The LLM profile was not found.',
  'LLM プロファイルの形式が正しくありません。':
    'The LLM profile format is invalid.',
  'LLM の API キーが設定されていません。設定画面で保存してください。':
    'The LLM API key is not set. Save it in Settings.',
  'LLM のエンドポイント URL が正しくありません。設定を確認してください。':
    'The LLM endpoint URL is invalid. Check the settings.',
  'macOS の音声出力を変更します。': 'This changes the macOS audio output.',
  'macOS の出力が Kataribe Multi-Output の場合は、削除後に別の出力デバイスを選び直してください。':
    'If the macOS output is Kataribe Multi-Output, choose another output device after deleting it.',
  'mp3 に変換しています': 'Encoding to mp3',
  'mp3 または wav を選択してください。': 'Choose an mp3 or wav file.',
  'Multi-Output Device を削除': 'Delete Multi-Output Device',
  'Multi-Output Device を自動作成': 'Create Multi-Output Device automatically',
  'Multi-Output Device の作成がタイムアウトしました。':
    'Creating the Multi-Output Device timed out.',
  'Multi-Output Device の操作に失敗しました。{detail}':
    'The Multi-Output Device operation failed. {detail}',
  'Provider が正しくありません。': 'The provider is invalid.',
  'summary.md の読み込みに失敗しました。': 'Could not read summary.md.',
  'whisper モデルが見つかりません。設定画面からモデルをダウンロードしてください。':
    'The whisper model was not found. Download a model from Settings.',
  'whisper モデル（{model}）がダウンロードされていません。設定画面から取得してください。':
    'The whisper model ({model}) is not downloaded. Download it from Settings.',
  'whisper-cli が見つかりません。アプリに同梱されたバイナリを確認してください。':
    'whisper-cli was not found. Check the binary bundled with the app.',
  'whisper.cpp の実行に失敗しました。{detail}': 'whisper.cpp failed. {detail}',
  '話者分離': 'Speaker diarization',
  '話者分離を使う': 'Use speaker diarization',
  '発話区間から 2〜10 人の話者を推定し、文字起こしの行頭に話者ラベルを付けます。声質が近い場合や重なり発話では誤ることがあります。':
    'Estimate 2 to 10 speakers from speech segments and add speaker labels to each transcript line. Similar voices or overlapping speech can cause mistakes.',
  '話者数': 'Number of speakers',
  '自動を選ぶと 2〜10 人の範囲で推定します。人数を指定すると、その人数に分けます。':
    'Auto estimates between 2 and 10 speakers. A fixed number splits the audio into that many speakers.',
  '話者分離モデル': 'Speaker diarization model',
  '初回は約 46 MB をダウンロードします。SHA-256 を照合してから使います。':
    'The first use downloads about 46 MB. Kataribe verifies the SHA-256 before using it.',
  '未取得 ({downloaded} / {total})': 'Not downloaded ({downloaded} / {total})',
  '話者分離モデルの状態を取得できませんでした: {error}':
    'Could not read the speaker diarization model status: {error}',
  '話者分離モデルのダウンロードを開始できませんでした: {error}':
    'Could not start the speaker diarization model download: {error}',
  '話者分離モデルのダウンロードを中断できませんでした: {error}':
    'Could not cancel the speaker diarization model download: {error}',
  'マイクの使用が許可されていません。システム設定の「プライバシーとセキュリティ」>「マイク」で Kataribe を許可してください。':
    'Microphone access is not allowed. Allow Kataribe in System Settings > Privacy & Security > Microphone.',
  '選択した入力デバイスが見つかりません。デバイスを接続してから再試行してください。':
    'The selected input device was not found. Connect the device and try again.',
  '入力デバイスを開けませんでした。他のアプリが使用していないか確認してください。':
    'Could not open the input device. Check whether another app is using it.',
  '選択した入力デバイスの設定に対応できません。別のデバイスを選んでください。':
    'The selected input device does not support the requested settings. Choose another device.',
  'ToDo': 'ToDo',
  'ToDo 一覧': 'ToDo list',
  'ToDo の絞り込み': 'Filter ToDo items',
  '未完了': 'Open',
  '完了': 'Done',
  'すべて': 'All',
  'ToDo を読み込んでいます。': 'Loading ToDo items.',
  'ToDo を読み込めませんでした: {error}': 'Could not load ToDo items: {error}',
  'ToDo はまだありません。': 'No ToDo items yet.',
  '会議の要約に ToDo を追加すると、ここに表示されます。':
    'ToDo items in meeting summaries appear here.',
  '該当する ToDo はありません。': 'No ToDo items match this filter.',
  'ToDo の完了状態を変更できませんでした: {error}':
    'Could not change the ToDo completion state: {error}',
  '要約の ToDo が変更されました。一覧を再読み込みしてください。':
    'The ToDo item changed in the summary. Reload the list.',
  '要約がありません。': 'No summary.',
  '処理中は ToDo の完了状態を変更できません。':
    'The ToDo completion state cannot be changed while processing.',
  '既存の要約を上書きします': 'This replaces the existing summary',
  'ToDo の完了状態は引き継ぎません。':
    'ToDo completion states are not carried over.',
  '直前の要約は summary.previous.md に退避します。':
    'The previous summary is saved to summary.previous.md.',
  '{text} を完了にする': 'Mark {text} as done',
  '{text} を未完了に戻す': 'Mark {text} as not done',
  '{title} の会議詳細を開く': 'Open meeting details for {title}',
} as const;

export type MessageKey = keyof typeof EN_MESSAGES;

export const INPUT_SOURCES: readonly InputSource[] = [
  'microphone',
  'system',
  'both',
];

export const INPUT_SOURCE_MESSAGE_KEYS: Record<InputSource, MessageKey> = {
  microphone: 'マイク',
  system: 'システム音声',
  both: 'マイク + システム音声',
};

const PLACEHOLDER = /\{([A-Za-z0-9_]+)\}/g;

export function isUiLanguage(value: unknown): value is UiLanguage {
  return value === 'ja' || value === 'en';
}

/**
 * メッセージのプレースホルダーを値で置き換える。
 *
 * 値が渡されていないプレースホルダーは、翻訳の不足を隠さずにそのまま残す。
 */
export function interpolate(
  template: string,
  params?: MessageParams,
): string {
  return template.replace(PLACEHOLDER, (placeholder, name: string) => {
    const value = params?.[name];
    return value === undefined ? placeholder : String(value);
  });
}

/**
 * 指定した UI 言語でメッセージを返す。
 */
export function translate(
  locale: UiLanguage,
  key: MessageKey,
  params?: MessageParams,
): string {
  const template = locale === 'en' ? EN_MESSAGES[key] : key;
  return interpolate(template, params);
}

/**
 * 保存先が同期サービスの対象であることを伝える警告を組み立てる。
 */
export function formatSaveLocationSyncWarning(
  service: string,
  locale: UiLanguage,
): string {
  return translate(
    locale,
    '保存先が {service} の同期対象です。音声と文字起こしが端末外に同期されます。',
    { service },
  );
}

/**
 * 選択したフォルダが同期サービスの対象であることを伝える警告を組み立てる。
 */
export function formatSelectedFolderSyncWarning(
  service: string,
  locale: UiLanguage,
): string {
  return translate(
    locale,
    '選択したフォルダは {service} の同期対象です。音声と文字起こしが端末外に同期されます。',
    { service },
  );
}

/**
 * 単数と複数で表記が変わる件数を、指定した UI 言語で返す。
 */
export function translateCount(
  locale: UiLanguage,
  count: number,
  singularKey: MessageKey,
  pluralKey: MessageKey,
  params?: MessageParams,
): string {
  const key = count === 1 ? singularKey : pluralKey;
  return translate(locale, key, { ...params, count });
}

/**
 * メッセージのプレースホルダー名を出現順に返す。
 */
export function placeholders(template: string): string[] {
  return [...template.matchAll(PLACEHOLDER)].map((match) => match[1]);
}
