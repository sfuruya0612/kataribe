import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  MeetingDetail as MeetingDetailData,
  MeetingSummary,
  ProcessingState,
  SummaryLanguage,
  SummaryPreview,
  TranslationPreview,
} from '../../shared/types';
import { AudioPlayer } from './AudioPlayer';
import {
  errorText,
  formatDateTime,
  formatDuration,
  inputSourceLabel,
  meetingStatusClass,
  meetingStatusLabel,
} from './recording-utils';

type DetailTab = 'transcript' | 'summary';

type MeetingDetailProps = {
  meeting: MeetingSummary | null;
  processing: ProcessingState;
  defaultSummaryLanguage: SummaryLanguage;
  whisperModel: 'large-v3-turbo' | 'medium' | 'small';
  initialSeekSeconds: number | null;
  onUpdateSettings: (patch: {
    whisperModel?: 'large-v3-turbo' | 'medium' | 'small';
  }) => Promise<void>;
  onBack: () => void;
  onOpenFolder: () => void;
  onOpenSettings: () => void;
};

const TIMESTAMP_LINE = /^\[(\d{2}:\d{2}:\d{2})\]\s?(.*)$/u;

function progressLabel(processing: ProcessingState): string {
  switch (processing.stage) {
    case 'encoding':
      return '音声を変換しています';
    case 'transcribing':
      return '文字起こしをしています';
    case 'translating':
      return '翻訳しています';
    case 'summarizing':
      return '要約を生成しています';
    default:
      return '';
  }
}

export function MeetingDetail({
  meeting,
  processing,
  defaultSummaryLanguage,
  whisperModel,
  initialSeekSeconds,
  onUpdateSettings,
  onBack,
  onOpenFolder,
  onOpenSettings,
}: MeetingDetailProps) {
  const [detail, setDetail] = useState<MeetingDetailData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [tab, setTab] = useState<DetailTab>('transcript');
  const [peaks, setPeaks] = useState<number[]>([]);
  const [waveformError, setWaveformError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [summaryEditing, setSummaryEditing] = useState(false);
  const [summaryDraft, setSummaryDraft] = useState('');
  const [summarySaving, setSummarySaving] = useState(false);
  const [preview, setPreview] = useState<SummaryPreview | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [summaryBusy, setSummaryBusy] = useState(false);
  const [translationPreview, setTranslationPreview] =
    useState<TranslationPreview | null>(null);
  const [translationBusy, setTranslationBusy] = useState(false);
  const [transcriptLanguage, setTranscriptLanguage] = useState<
    'source' | SummaryLanguage
  >('source');
  const [titleEditing, setTitleEditing] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const [titleSaving, setTitleSaving] = useState(false);
  const previewRef = useRef<SummaryPreview | null>(null);
  const translationPreviewRef = useRef<TranslationPreview | null>(null);

  previewRef.current = preview;
  translationPreviewRef.current = translationPreview;

  const meetingId = meeting?.id ?? null;

  const load = useCallback(async () => {
    if (!meetingId) {
      setDetail(null);
      return;
    }
    setLoading(true);
    try {
      const value = await window.kataribe.getMeetingDetail(meetingId);
      setDetail(value);
      setError(null);
    } catch (reason: unknown) {
      setError(`会議の詳細を読み込めませんでした: ${errorText(reason)}`);
    } finally {
      setLoading(false);
    }
  }, [meetingId]);

  useEffect(() => {
    setTab('transcript');
    setEditing(false);
    setSummaryEditing(false);
    setPreview(null);
    setTranslationPreview(null);
    setTranscriptLanguage('source');
    setTitleEditing(false);
    setError(null);
    setNotice(null);
    setPeaks([]);
    setWaveformError(null);
  }, [meetingId]);

  useEffect(() => {
    void load();
  }, [load, meeting?.status, meeting?.hasTranscript, meeting?.hasSummary]);

  useEffect(() => {
    if (!meetingId) {
      return;
    }
    const unsubscribe = window.kataribe.onMeetingUpdated((payload) => {
      if (payload.meetingId === meetingId) {
        void load();
      }
    });
    return unsubscribe;
  }, [load, meetingId]);

  useEffect(() => {
    if (!meeting?.audioUrl) {
      return;
    }
    let cancelled = false;
    void window.kataribe
      .getMeetingWaveform(meeting.id)
      .then((waveform) => {
        if (!cancelled) {
          setPeaks(waveform.peaks);
        }
      })
      .catch((reason: unknown) => {
        if (!cancelled) {
          setWaveformError(String(reason));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [meeting?.id, meeting?.audioUrl]);

  useEffect(() => {
    if (!notice) {
      return;
    }
    const timer = window.setTimeout(() => setNotice(null), 4000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  if (!meeting) {
    return (
      <div className="detail-empty">
        <h1 className="page-title">会議が選ばれていません</h1>
        <p className="muted">会議一覧から録音を選ぶと、音声と処理状況を表示します。</p>
        <button type="button" className="button button-secondary" onClick={onBack}>
          会議一覧へ
        </button>
      </div>
    );
  }

  const current = detail?.meeting ?? meeting;
  const transcript = detail?.transcript ?? null;
  const summary = detail?.summary ?? null;
  const translations = detail?.translations ?? {};
  const displayedTranslation =
    transcriptLanguage === 'source' ? null : translations[transcriptLanguage] ?? null;
  const activeHere = processing.meetingId === meeting.id && processing.stage !== null;
  const processingError =
    processing.meetingId === meeting.id ? processing.error : null;
  const progressPercent =
    processing.progress !== null ? Math.round(processing.progress * 100) : null;
  const sourceLanguage = transcript?.language ?? 'auto';
  const translationCandidates: SummaryLanguage[] = [
    ...(sourceLanguage.startsWith('ja') ? [] : (['ja'] as SummaryLanguage[])),
    ...(sourceLanguage.startsWith('en') ? [] : (['en'] as SummaryLanguage[])),
  ];

  const copyCurrent = async () => {
    const text =
      tab === 'transcript'
        ? displayedTranslation?.markdown ?? transcript?.markdown ?? ''
        : summary?.markdown ?? '';
    if (!text) {
      return;
    }
    try {
      await window.kataribe.copyText(text);
      setNotice('コピーしました。');
    } catch (reason: unknown) {
      setError(`コピーできませんでした: ${errorText(reason)}`);
    }
  };

  const copySummary = async () => {
    if (!summary?.markdown) {
      return;
    }
    try {
      await window.kataribe.copyText(summary.markdown);
      setNotice('要約をコピーしました。');
    } catch (reason: unknown) {
      setError(`コピーできませんでした: ${errorText(reason)}`);
    }
  };

  const startTitleEditing = () => {
    setTitleDraft(current.title);
    setTitleEditing(true);
  };

  const saveTitle = async () => {
    setTitleSaving(true);
    try {
      await window.kataribe.updateMeetingTitle(meeting.id, titleDraft);
      setTitleEditing(false);
      setNotice('タイトルを変更しました。');
      await load();
    } catch (reason: unknown) {
      setError(`タイトルを変更できませんでした: ${errorText(reason)}`);
    } finally {
      setTitleSaving(false);
    }
  };

  const smallerModel =
    whisperModel === 'large-v3-turbo'
      ? 'medium'
      : whisperModel === 'medium'
        ? 'small'
        : null;

  const retryWithSmallerModel = async () => {
    if (!smallerModel) {
      return;
    }
    try {
      await onUpdateSettings({ whisperModel: smallerModel });
      await window.kataribe.retryTranscription(meeting.id);
      setNotice(`${smallerModel} で文字起こしを開始しました。`);
      setError(null);
      await load();
    } catch (reason: unknown) {
      setError(`文字起こしを開始できませんでした: ${errorText(reason)}`);
    }
  };

  const saveSummaryLanguage = async (value: string) => {
    try {
      const language =
        value === 'ja' || value === 'en' ? value : null;
      await window.kataribe.setMeetingSummaryLanguage(meeting.id, language);
      setNotice(
        language
          ? `この会議の要約言語を${language === 'ja' ? '日本語' : 'English'}に変更しました。`
          : '要約言語をアプリの既定に戻しました。',
      );
      await load();
    } catch (reason: unknown) {
      setError(`要約言語を変更できませんでした: ${errorText(reason)}`);
    }
  };

  const startEditing = () => {
    if (!transcript) {
      return;
    }
    setDraft(transcript.markdown);
    setEditing(true);
  };

  const saveTranscript = async () => {
    if (!transcript) {
      return;
    }
    setSaving(true);
    try {
      const value = await window.kataribe.saveTranscript(meeting.id, draft);
      setDetail(value);
      setEditing(false);
      setNotice('文字起こしを保存しました。');
    } catch (reason: unknown) {
      setError(`文字起こしを保存できませんでした: ${errorText(reason)}`);
    } finally {
      setSaving(false);
    }
  };

  const startSummaryEditing = () => {
    if (!summary) {
      return;
    }
    setSummaryDraft(summary.markdown);
    setSummaryEditing(true);
  };

  const saveSummaryDocument = async () => {
    if (!summary) {
      return;
    }
    setSummarySaving(true);
    try {
      const value = await window.kataribe.saveSummary(meeting.id, summaryDraft);
      setDetail(value);
      setSummaryEditing(false);
      setNotice('要約を保存しました。');
    } catch (reason: unknown) {
      setError(`要約を保存できませんでした: ${errorText(reason)}`);
    } finally {
      setSummarySaving(false);
    }
  };

  const openTranslationPreview = async (targetLanguage: SummaryLanguage) => {
    if (!transcript || processing.stage !== null) {
      return;
    }
    setTranslationBusy(true);
    setError(null);
    try {
      const value = await window.kataribe.previewTranslation(
        meeting.id,
        targetLanguage,
      );
      setTranslationPreview(value);
    } catch (reason: unknown) {
      setError(errorText(reason));
      } finally {
      setTranslationBusy(false);
    }
  };

  const generateTranslation = async () => {
    const currentPreview = translationPreviewRef.current;
    if (!currentPreview) {
      return;
    }
    setTranslationBusy(true);
    setError(null);
    try {
      await window.kataribe.generateTranslation(
        meeting.id,
        currentPreview.token,
      );
      setTranslationPreview(null);
      setTranscriptLanguage(currentPreview.targetLanguage);
      setNotice('翻訳を生成しました。');
      await load();
    } catch (reason: unknown) {
      setError(errorText(reason));
    } finally {
      setTranslationBusy(false);
    }
  };

  const openSummaryPreview = async () => {
    if (!transcript || processing.stage !== null) {
      return;
    }
    setPreviewBusy(true);
    setError(null);
    try {
      const value = await window.kataribe.previewSummary(meeting.id);
      setPreview(value);
    } catch (reason: unknown) {
      setError(errorText(reason));
    } finally {
      setPreviewBusy(false);
    }
  };

  const generateSummary = async () => {
    const currentPreview = previewRef.current;
    if (!currentPreview) {
      return;
    }
    setSummaryBusy(true);
    setError(null);
    try {
      await window.kataribe.generateSummary(meeting.id, currentPreview.token);
      setPreview(null);
      setTab('summary');
      setNotice('要約を生成しました。');
      await load();
    } catch (reason: unknown) {
      setError(errorText(reason));
    } finally {
      setSummaryBusy(false);
    }
  };

  const retryTranscription = async () => {
    try {
      await window.kataribe.retryTranscription(meeting.id);
      setNotice('文字起こしを開始しました。');
      setError(null);
      await load();
    } catch (reason: unknown) {
      setError(`文字起こしを開始できませんでした: ${errorText(reason)}`);
    }
  };

  const cancelProcessing = async () => {
    try {
      await window.kataribe.cancelProcessing();
      setNotice('処理を中断しました。');
    } catch (reason: unknown) {
      setError(`処理を中断できませんでした: ${errorText(reason)}`);
    }
  };

  const renderTranscript = (value: { body: string }) => {
    const lines = value.body.trim().split('\n');
    if (lines.length === 0 || (lines.length === 1 && lines[0] === '')) {
      return <p className="muted">文字起こしの本文が空です。</p>;
    }
    return (
      <div className="transcript-lines">
        {lines.map((line, index) => {
          const match = line.match(TIMESTAMP_LINE);
          return match ? (
            <div className="transcript-line" key={`${match[1]}-${index}`}>
              <span className="transcript-time mono">{match[1]}</span>
              <span className="transcript-text">{match[2]}</span>
            </div>
          ) : (
            <p className="transcript-plain" key={`line-${index}`}>
              {line}
            </p>
          );
        })}
      </div>
    );
  };

  return (
    <article className="detail-panel">
      <div className="detail-toolbar">
        <button type="button" className="detail-back" onClick={onBack}>
          会議一覧へ
        </button>
        <span className="detail-toolbar-spacer" />
        {activeHere ? (
          <button type="button" className="button button-secondary" onClick={() => void cancelProcessing()}>
            処理を中断
          </button>
        ) : null}
        <button
          type="button"
          className="button button-secondary"
          disabled={!transcript && !summary}
          onClick={() => void copyCurrent()}
        >
          コピー
        </button>
        <button
          type="button"
          className="button button-primary"
          disabled={!transcript || summaryBusy || processing.stage !== null}
          onClick={() => void openSummaryPreview()}
        >
          {previewBusy ? '確認中...' : summaryBusy ? '生成中...' : '要約を生成'}
        </button>
      </div>

      <div className="detail-head">
        <div className="detail-title-row">
          {titleEditing ? (
            <>
              <input
                className="setting-input detail-title-input"
                value={titleDraft}
                maxLength={120}
                autoFocus
                onChange={(event) => setTitleDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    void saveTitle();
                  }
                  if (event.key === 'Escape') {
                    setTitleEditing(false);
                  }
                }}
              />
              <button
                type="button"
                className="link-button"
                disabled={titleSaving}
                onClick={() => void saveTitle()}
              >
                保存
              </button>
              <button
                type="button"
                className="link-button"
                disabled={titleSaving}
                onClick={() => setTitleEditing(false)}
              >
                キャンセル
              </button>
            </>
          ) : (
            <>
              <h1 className="detail-title">{current.title}</h1>
              <button
                type="button"
                className="link-button"
                disabled={processing.stage !== null}
                onClick={startTitleEditing}
              >
                タイトルを編集
              </button>
            </>
          )}
          <span className={`status-chip ${meetingStatusClass(current.status)}`}>
            {meetingStatusLabel(current.status)}
          </span>
        </div>
        <p className="detail-meta">
          {formatDateTime(current.startedAt)} · {formatDuration(current.duration)} ·{' '}
          {current.inputSource ? inputSourceLabel(current.inputSource) : '入力不明'} ·{' '}
          {current.sampleRate.toLocaleString('ja-JP')} Hz
        </p>
        <div className="detail-player-row">
          <AudioPlayer
            src={current.audioUrl}
            peaks={peaks}
            duration={current.duration}
            initialTime={initialSeekSeconds}
          />
          <button type="button" className="button button-secondary" onClick={onOpenFolder}>
            Finder で開く
          </button>
          {!transcript && !activeHere ? (
            <button
              type="button"
              className="button button-secondary"
              onClick={() => void retryTranscription()}
            >
              文字起こしを再実行
            </button>
          ) : null}
        </div>
        {waveformError ? <p className="muted">波形を取得できませんでした。</p> : null}
        {activeHere ? (
          <div className="progress-card" role="status">
            <div className="progress-row">
              <strong>{progressLabel(processing)}</strong>
              <span className="mono">
                {progressPercent !== null ? `${progressPercent}%` : '準備中'}
              </span>
            </div>
            <div className="progress-track">
              <span
                className="progress-bar"
                style={{ width: `${progressPercent ?? 4}%` }}
              />
            </div>
            <p className="muted">
              {processing.message ?? ''}
              {processing.etaSeconds !== null
                ? ` · 残り約 ${formatDuration(processing.etaSeconds)}`
                : ''}
            </p>
          </div>
        ) : null}
        {processingError && !activeHere ? (
          <p className="alert alert-error">{processingError}</p>
        ) : null}
        {error ? <p className="alert alert-error">{error}</p> : null}
        {notice ? <p className="notice-text">{notice}</p> : null}
      </div>

      <div className="detail-body">
        <section className="transcript-pane" aria-labelledby="transcript-title">
          <div className="transcript-bar">
            <div className="seg" role="tablist" aria-label="会議の表示">
              <button
                type="button"
                role="tab"
                aria-selected={tab === 'transcript'}
                aria-pressed={tab === 'transcript'}
                onClick={() => setTab('transcript')}
              >
                文字起こし
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={tab === 'summary'}
                aria-pressed={tab === 'summary'}
                onClick={() => setTab('summary')}
              >
                要約
              </button>
            </div>
            <span className="detail-toolbar-spacer" />
            {tab === 'transcript' && Object.keys(translations).length > 0 ? (
              <select
                className="setting-input transcript-language-select"
                value={transcriptLanguage}
                onChange={(event) =>
                  setTranscriptLanguage(
                    event.target.value as 'source' | SummaryLanguage,
                  )
                }
              >
                <option value="source">原文</option>
                {translations.ja ? <option value="ja">日本語訳</option> : null}
                {translations.en ? <option value="en">English 訳</option> : null}
              </select>
            ) : null}
            {tab === 'transcript' && transcript
              ? translationCandidates.map((target) => (
                  <button
                    type="button"
                    className="link-button"
                    key={target}
                    disabled={processing.stage !== null || translationBusy}
                    onClick={() => void openTranslationPreview(target)}
                  >
                    {translations[target]
                      ? target === 'ja'
                        ? '日本語訳を再生成'
                        : 'English 訳を再生成'
                      : target === 'ja'
                        ? '日本語訳'
                        : 'English 訳'}
                  </button>
                ))
              : null}
            {tab === 'transcript' ? (
              editing ? (
                <>
                  <button
                    type="button"
                    className="link-button"
                    disabled={saving}
                    onClick={() => void saveTranscript()}
                  >
                    保存
                  </button>
                  <button
                    type="button"
                    className="link-button"
                    disabled={saving}
                    onClick={() => setEditing(false)}
                  >
                    キャンセル
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="link-button"
                  disabled={!transcript || Boolean(displayedTranslation) || processing.stage !== null}
                  onClick={startEditing}
                >
                  編集
                </button>
              )
            ) : summaryEditing ? (
              <>
                <button
                  type="button"
                  className="link-button"
                  disabled={summarySaving}
                  onClick={() => void saveSummaryDocument()}
                >
                  保存
                </button>
                <button
                  type="button"
                  className="link-button"
                  disabled={summarySaving}
                  onClick={() => setSummaryEditing(false)}
                >
                  キャンセル
                </button>
              </>
            ) : (
              <button
                type="button"
                className="link-button"
                disabled={!summary || processing.stage !== null}
                onClick={startSummaryEditing}
              >
                編集
              </button>
            )}
          </div>

          {loading ? (
            <div className="transcript-empty">
              <p className="muted">読み込み中です...</p>
            </div>
          ) : tab === 'transcript' ? (
            editing ? (
              <textarea
                className="transcript-editor"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                spellCheck={false}
              />
            ) : transcript ? (
              <div className="transcript-scroll">
                {(displayedTranslation?.partial ?? transcript.partial) ? (
                  <p className="alert alert-warning">
                    {displayedTranslation
                      ? '部分的な翻訳です。原文と対応していない行があります。'
                      : '部分的な文字起こしです。完了していない可能性があります。'}
                  </p>
                ) : null}
                {displayedTranslation ? (
                  <p className="transcript-translation-note">
                    {displayedTranslation.language === 'ja'
                      ? '日本語訳'
                      : 'English translation'}
                    {displayedTranslation.provider
                      ? ` · ${displayedTranslation.provider}`
                      : ''}
                  </p>
                ) : null}
                {renderTranscript(displayedTranslation ?? transcript)}
              </div>
            ) : (
              <div className="transcript-empty">
                <h2>文字起こし</h2>
                <p>
                  録音を停止すると、mp3 への変換と文字起こしが自動で始まります。
                  モデルが未取得の場合は、設定画面からダウンロードしてください。
                </p>
                {!activeHere ? (
                  <div className="setting-actions">
                    <button
                      type="button"
                      className="button button-secondary"
                      onClick={() => void retryTranscription()}
                    >
                      文字起こしを開始
                    </button>
                    {smallerModel ? (
                      <button
                        type="button"
                        className="button button-secondary"
                        onClick={() => void retryWithSmallerModel()}
                      >
                        {smallerModel} で再実行
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </div>
            )
          ) : tab === 'summary' ? (
            summaryEditing ? (
              <textarea
                className="transcript-editor"
                value={summaryDraft}
                onChange={(event) => setSummaryDraft(event.target.value)}
                spellCheck={false}
              />
            ) : summary ? (
              <div className="transcript-scroll">
                <pre className="markdown-view">{summary.body}</pre>
              </div>
            ) : (
              <div className="transcript-empty">
                <h2>要約</h2>
                <p>
                  文字起こしが完了したら「要約を生成」を押してください。送信前に、送る内容と送信先を確認できます。
                </p>
              </div>
            )
          ) : null}
        </section>

        <aside className="summary-pane" aria-labelledby="summary-title">
          <div className="summary-head">
            <h2 id="summary-title">要約</h2>
            <select
              className="setting-input summary-language-select"
              aria-label="この会議の要約言語"
              value={current.summaryLanguage ?? ''}
              onChange={(event) => void saveSummaryLanguage(event.target.value)}
            >
              <option value="">既定（{defaultSummaryLanguage === 'ja' ? '日本語' : 'English'}）</option>
              <option value="ja">日本語</option>
              <option value="en">English</option>
            </select>
            <button
              type="button"
              className="link-button"
              disabled={!summary}
              onClick={() => void copySummary()}
            >
              コピー
            </button>
          </div>
          {summary ? (
            <div className="summary-preview">
              <p className="muted">
                {summary.provider ?? 'LLM'}
                {summary.model ? ` · ${summary.model}` : ''}
                {summary.generatedAt
                  ? ` · ${formatDateTime(summary.generatedAt)}`
                  : ''}
              </p>
              <pre className="markdown-view">{summary.body}</pre>
            </div>
          ) : (
            <div className="summary-empty">
              <p>要約はまだありません。</p>
              <p className="muted">
                要約を生成すると、要約・決定事項・ToDo・未決事項がここに表示されます。
              </p>
              <button type="button" className="link-button" onClick={onOpenSettings}>
                LLM の設定を開く
              </button>
            </div>
          )}
        </aside>
      </div>

      {preview ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
          <div className="confirm-dialog">
            <div className="confirm-head">
              <div>
                <p className="section-label">Confirm</p>
                <h2 id="confirm-title">送信内容の確認</h2>
              </div>
              <button
                type="button"
                className="icon-button"
                aria-label="閉じる"
                disabled={summaryBusy}
                onClick={() => setPreview(null)}
              >
                ×
              </button>
            </div>
            <dl className="confirm-meta">
              <div>
                <dt>送信先</dt>
                <dd className="mono">{preview.providerLabel} · {preview.model}</dd>
              </div>
              <div>
                <dt>エンドポイント</dt>
                <dd className="mono confirm-endpoint">{preview.endpoint}</dd>
              </div>
              <div>
                <dt>文字数</dt>
                <dd>{preview.charCount.toLocaleString('ja-JP')} 文字</dd>
              </div>
              <div>
                <dt>概算トークン</dt>
                <dd>約 {preview.estimatedTokens.toLocaleString('ja-JP')} tokens</dd>
              </div>
              <div>
                <dt>内容ハッシュ</dt>
                <dd className="mono">{preview.contentHash.slice(0, 16)}...</dd>
              </div>
            </dl>
            {preview.warning ? (
              <p className="alert alert-warning">{preview.warning}</p>
            ) : null}
            <p className="muted">
              音声ファイルと会議のメタデータは送信しません。個人名や社名のマスクは行いません。
              概算料金はプロバイダの料金表を確認してください。送信先でのデータの扱いはプロバイダの規約に従います。
            </p>
            <pre className="confirm-content">{preview.text}</pre>
            <div className="confirm-actions">
              <button
                type="button"
                className="button button-secondary"
                disabled={summaryBusy}
                onClick={() => setPreview(null)}
              >
                キャンセル
              </button>
              <button
                type="button"
                className="button button-primary"
                disabled={summaryBusy}
                onClick={() => void generateSummary()}
              >
                {summaryBusy ? '送信中...' : '送信して要約'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {translationPreview ? (
        <div
          className="modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="translation-confirm-title"
        >
          <div className="confirm-dialog">
            <div className="confirm-head">
              <div>
                <p className="section-label">Translate</p>
                <h2 id="translation-confirm-title">翻訳の送信内容の確認</h2>
              </div>
              <button
                type="button"
                className="icon-button"
                aria-label="閉じる"
                disabled={translationBusy}
                onClick={() => setTranslationPreview(null)}
              >
                ×
              </button>
            </div>
            <dl className="confirm-meta">
              <div>
                <dt>翻訳</dt>
                <dd>
                  {translationPreview.sourceLanguage} →{' '}
                  {translationPreview.targetLanguage === 'ja'
                    ? '日本語'
                    : 'English'}
                </dd>
              </div>
              <div>
                <dt>送信先</dt>
                <dd className="mono">
                  {translationPreview.providerLabel} · {translationPreview.model}
                </dd>
              </div>
              <div>
                <dt>エンドポイント</dt>
                <dd className="mono confirm-endpoint">
                  {translationPreview.endpoint}
                </dd>
              </div>
              <div>
                <dt>文字数</dt>
                <dd>
                  {translationPreview.charCount.toLocaleString('ja-JP')} 文字
                </dd>
              </div>
              <div>
                <dt>概算トークン</dt>
                <dd>
                  約 {translationPreview.estimatedTokens.toLocaleString('ja-JP')}{' '}
                  tokens
                </dd>
              </div>
            </dl>
            {translationPreview.warning ? (
              <p className="alert alert-warning">{translationPreview.warning}</p>
            ) : null}
            <p className="muted">
              音声ファイルと会議のメタデータは送信しません。原文のタイムスタンプを保って翻訳します。
              翻訳の品質と料金はプロバイダとモデルに依存します。
            </p>
            <pre className="confirm-content">{translationPreview.text}</pre>
            <div className="confirm-actions">
              <button
                type="button"
                className="button button-secondary"
                disabled={translationBusy}
                onClick={() => setTranslationPreview(null)}
              >
                キャンセル
              </button>
              <button
                type="button"
                className="button button-primary"
                disabled={translationBusy}
                onClick={() => void generateTranslation()}
              >
                {translationBusy ? '送信中...' : '送信して翻訳'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </article>
  );
}
