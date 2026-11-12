import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  LlmProfilesState,
  MeetingDetail as MeetingDetailData,
  MeetingSummary,
  ProcessingState,
  SummaryLanguage,
  SummaryPreview,
  TranscriptionEngine,
  TranslationPreview,
} from '../../shared/types';
import { enhancedMeetingAudioUrl } from '../../shared/meeting-audio-url';
import { DEFAULT_MEETING_TITLE } from '../../shared/title';
import { AudioPlayer } from './AudioPlayer';
import { EnhancementStatusSummary } from './EnhancementStatusSummary';
import { SavedAudioEnhancementControls } from './SavedAudioEnhancementControls';
import { StaleTranscriptNotice } from './StaleTranscriptNotice';
import { SummaryCleanupWarning } from './SummaryCleanupWarning';
import { SummaryRegenerationWarning } from './SummaryRegenerationWarning';
import { TitleGenerationNotice } from './TitleGenerationNotice';
import {
  TranscriptComparison,
  type TranscriptView,
} from './TranscriptComparison';
import { useI18n, type I18nValue } from './i18n';
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
  transcriptionEngine: TranscriptionEngine;
  enhanceBeforeTranscription: boolean;
  initialSeekSeconds: number | null;
  onUpdateSettings: (patch: {
    whisperModel?: 'large-v3-turbo' | 'medium' | 'small';
  }) => Promise<void>;
  onBack: () => void;
  onOpenFolder: () => void;
  onOpenSettings: () => void;
};

const TIMESTAMP_LINE = /^\[(\d{2}:\d{2}:\d{2})\]\s?(.*)$/u;

function isValidSpeakerName(value: string): boolean {
  const name = value.trim();
  return (
    name.length > 0 &&
    name.length <= 40 &&
    !name.includes(':') &&
    !name.includes('\n') &&
    !name.includes('\r') &&
    !name.includes('[') &&
    !name.includes(']')
  );
}

function selectProfileId(
  state: LlmProfilesState | null,
  current: string,
): string {
  if (!state) {
    return current;
  }
  if (current && state.profiles.some((profile) => profile.id === current)) {
    return current;
  }
  return state.defaultProfileId || state.profiles[0]?.id || '';
}

function progressLabel(processing: ProcessingState, t: I18nValue['t']): string {
  switch (processing.stage) {
    case 'encoding':
      return t('音声を変換しています');
    case 'enhancing':
      return t('音声強調をしています');
    case 'transcribing':
      return t('文字起こしをしています');
    case 'translating':
      return t('翻訳しています');
    case 'summarizing':
      return t('要約を生成しています');
    case 'title':
      return t('タイトルを生成しています');
    default:
      return '';
  }
}

export function MeetingDetail({
  meeting,
  processing,
  defaultSummaryLanguage,
  whisperModel,
  transcriptionEngine,
  enhanceBeforeTranscription,
  initialSeekSeconds,
  onUpdateSettings,
  onBack,
  onOpenFolder,
  onOpenSettings,
}: MeetingDetailProps) {
  const { locale, t } = useI18n();
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
  const [llmProfiles, setLlmProfiles] = useState<LlmProfilesState | null>(null);
  const [summaryProfileId, setSummaryProfileId] = useState('');
  const [translationProfileId, setTranslationProfileId] = useState('');
  const [translationPreview, setTranslationPreview] =
    useState<TranslationPreview | null>(null);
  const [translationBusy, setTranslationBusy] = useState(false);
  const [transcriptLanguage, setTranscriptLanguage] = useState<
    'source' | SummaryLanguage
  >('source');
  const [transcriptView, setTranscriptView] =
    useState<TranscriptView>('current');
  const [titleEditing, setTitleEditing] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const [titleSaving, setTitleSaving] = useState(false);
  const [titleGenerating, setTitleGenerating] = useState(false);
  const [speakerEditing, setSpeakerEditing] = useState(false);
  const [speakerDraft, setSpeakerDraft] = useState<string[]>([]);
  const [speakerSaving, setSpeakerSaving] = useState(false);
  const [speakerError, setSpeakerError] = useState<string | null>(null);
  const previewRef = useRef<SummaryPreview | null>(null);
  const translationPreviewRef = useRef<TranslationPreview | null>(null);
  const savedAudioWasRunning = useRef(false);

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
      setError(
        t('会議の詳細を読み込めませんでした: {error}', { error: errorText(reason) }),
      );
    } finally {
      setLoading(false);
    }
  }, [meetingId, t]);

  const refreshLlmProfiles = useCallback(async () => {
    try {
      const state = await window.kataribe.getLlmProfiles();
      setLlmProfiles(state);
      setSummaryProfileId((current) => selectProfileId(state, current));
      setTranslationProfileId((current) => selectProfileId(state, current));
      return state;
    } catch (reason: unknown) {
      setError(
        t('LLM プロファイルを取得できませんでした: {error}', {
          error: errorText(reason),
        }),
      );
      return null;
    }
  }, [t]);

  useEffect(() => {
    void refreshLlmProfiles();
  }, [refreshLlmProfiles]);

  useEffect(() => {
    setDetail(null);
    setTab('transcript');
    setEditing(false);
    setSummaryEditing(false);
    setPreview(null);
    setTranslationPreview(null);
    setTranscriptLanguage('source');
    setTranscriptView('current');
    setTitleEditing(false);
    setSpeakerEditing(false);
    setSpeakerError(null);
    setError(null);
    setNotice(null);
    setPeaks([]);
    setWaveformError(null);
  }, [meetingId]);

  useEffect(() => {
    void load();
  }, [
    load,
    meeting?.status,
    meeting?.hasTranscript,
    meeting?.hasSummary,
    meeting?.audioUrl,
  ]);

  useEffect(() => {
    const running =
      meetingId !== null &&
      processing.meetingId === meetingId &&
      processing.stage === 'enhancing';
    if (
      savedAudioWasRunning.current &&
      !running &&
      meetingId !== null &&
      processing.meetingId === meetingId
    ) {
      if (processing.error) {
        setError(processing.error);
      } else {
        setNotice(t('保存音声の強調が完了しました。'));
      }
    }
    savedAudioWasRunning.current = running;
  }, [meetingId, processing.error, processing.meetingId, processing.stage, t]);

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
        <h1 className="page-title">{t('会議が選ばれていません')}</h1>
        <p className="muted">
          {t('会議一覧から録音を選ぶと、音声と処理状況を表示します。')}
        </p>
        <button type="button" className="button button-secondary" onClick={onBack}>
          {t('会議一覧へ')}
        </button>
      </div>
    );
  }

  const current = detail?.meeting ?? meeting;
  const enhancedOutput =
    detail?.enhancement?.saved_audio.nemotronlabs?.output ?? null;
  const enhancedSrc = current.enhancedModels.includes('nemotronlabs')
    ? enhancedMeetingAudioUrl(
        current.id,
        'nemotronlabs',
        enhancedOutput?.sha256 ?? null,
      )
    : null;
  const recordingError = detail?.recordingError ?? null;
  const transcript = detail?.transcript ?? null;
  const summary = detail?.summary ?? null;
  const translations = detail?.translations ?? {};
  const rawComparison = detail?.transcriptComparisons.raw ?? null;
  const enhancedComparison =
    detail?.transcriptComparisons.models.nemotronlabs ?? null;
  const comparisonDocument =
    transcriptView === 'raw'
      ? rawComparison
      : transcriptView === 'enhanced'
        ? enhancedComparison
        : null;
  const comparisonReadOnly = comparisonDocument !== null;
  const displayedTranscript = comparisonDocument ?? transcript;
  const displayedTranslation =
    comparisonReadOnly || transcriptLanguage === 'source'
      ? null
      : translations[transcriptLanguage] ?? null;
  const transcriptForRender =
    (comparisonReadOnly ? comparisonDocument : displayedTranslation ?? transcript) ??
    { body: '' };
  const staleSummary =
    summary?.generatedAt !== null &&
    summary?.generatedAt !== undefined &&
    transcript?.updatedAt !== null &&
    transcript?.updatedAt !== undefined &&
    summary.generatedAt < transcript.updatedAt;
  const staleTranslation = Object.values(translations).some(
    (translation) =>
      translation?.generatedAt !== null &&
      translation?.generatedAt !== undefined &&
      transcript?.updatedAt !== null &&
      transcript?.updatedAt !== undefined &&
      translation.generatedAt < transcript.updatedAt,
  );
  const activeHere = processing.meetingId === meeting.id && processing.stage !== null;
  const canGenerateTitle =
    current.title === DEFAULT_MEETING_TITLE &&
    current.hasTranscript &&
    current.status !== 'recording';
  const titleGeneration =
    current.title === DEFAULT_MEETING_TITLE
      ? detail?.titleGeneration ?? null
      : null;
  const titleGenerationFailed = titleGeneration?.state === 'failed';
  const processingError =
    processing.meetingId === meeting.id ? processing.error : null;
  const progressPercent =
    processing.progress !== null ? Math.round(processing.progress * 100) : null;
  const sourceLanguage = transcript?.language ?? 'auto';
  const translationCandidates: SummaryLanguage[] = [
    ...(sourceLanguage.startsWith('ja') ? [] : (['ja'] as SummaryLanguage[])),
    ...(sourceLanguage.startsWith('en') ? [] : (['en'] as SummaryLanguage[])),
  ];
  const defaultSummaryLanguageLabel =
    defaultSummaryLanguage === 'ja' ? t('日本語') : t('English');

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
      setNotice(t('コピーしました。'));
    } catch (reason: unknown) {
      setError(t('コピーできませんでした: {error}', { error: errorText(reason) }));
    }
  };

  const copySummary = async () => {
    if (!summary?.markdown) {
      return;
    }
    try {
      await window.kataribe.copyText(summary.markdown);
      setNotice(t('要約をコピーしました。'));
    } catch (reason: unknown) {
      setError(t('コピーできませんでした: {error}', { error: errorText(reason) }));
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
      setNotice(t('タイトルを変更しました。'));
      await load();
    } catch (reason: unknown) {
      setError(
        t('タイトルを変更できませんでした: {error}', { error: errorText(reason) }),
      );
    } finally {
      setTitleSaving(false);
    }
  };

  const generateTitle = async () => {
    setTitleGenerating(true);
    setError(null);
    try {
      await window.kataribe.generateMeetingTitle(
        meeting.id,
        summaryProfileId || undefined,
      );
      setNotice(t('タイトルを生成しました。'));
      await load();
    } catch (reason: unknown) {
      await load();
      setError(
        t('タイトルを生成できませんでした: {error}', {
          error: errorText(reason),
        }),
      );
    } finally {
      setTitleGenerating(false);
    }
  };

  const smallerModel =
    transcriptionEngine === 'openai'
      ? null
      : whisperModel === 'large-v3-turbo'
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
      setNotice(t('{model} で文字起こしを開始しました。', { model: smallerModel }));
      setError(null);
      await load();
    } catch (reason: unknown) {
      setError(
        t('文字起こしを開始できませんでした: {error}', { error: errorText(reason) }),
      );
    }
  };

  const saveSummaryLanguage = async (value: string) => {
    try {
      const language =
        value === 'ja' || value === 'en' ? value : null;
      await window.kataribe.setMeetingSummaryLanguage(meeting.id, language);
      const languageLabel =
        language === null
          ? null
          : language === 'ja'
            ? t('日本語')
            : t('English');
      setNotice(
        languageLabel !== null
          ? t('この会議の要約言語を{language}に変更しました。', {
              language: languageLabel,
            })
          : t('要約言語をアプリの既定に戻しました。'),
      );
      await load();
    } catch (reason: unknown) {
      setError(
        t('要約言語を変更できませんでした: {error}', { error: errorText(reason) }),
      );
    }
  };

  const startEditing = () => {
    if (!transcript) {
      return;
    }
    setDraft(transcript.markdown);
    setEditing(true);
  };

  const startSpeakerEditing = () => {
    setSpeakerDraft([...(detail?.speakers ?? [])]);
    setSpeakerError(null);
    setSpeakerEditing(true);
  };

  const speakerNamesValid =
    speakerDraft.length > 0 &&
    speakerDraft.length === (detail?.speakers.length ?? 0) &&
    speakerDraft.every(isValidSpeakerName) &&
    new Set(speakerDraft.map((name) => name.trim())).size ===
      speakerDraft.length;

  const saveSpeakers = async () => {
    if (!speakerNamesValid) {
      return;
    }
    setSpeakerSaving(true);
    try {
      const value = await window.kataribe.renameMeetingSpeakers(
        meeting.id,
        speakerDraft.map((name) => name.trim()),
      );
      setDetail(value);
      setSpeakerEditing(false);
      setNotice(t('話者名を変更しました。'));
    } catch (reason: unknown) {
      setSpeakerError(
        t('話者名を変更できませんでした: {error}', { error: errorText(reason) }),
      );
    } finally {
      setSpeakerSaving(false);
    }
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
      setNotice(t('文字起こしを保存しました。'));
    } catch (reason: unknown) {
      setError(
        t('文字起こしを保存できませんでした: {error}', { error: errorText(reason) }),
      );
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
      setNotice(t('要約を保存しました。'));
    } catch (reason: unknown) {
      setError(t('要約を保存できませんでした: {error}', { error: errorText(reason) }));
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
      const state = await refreshLlmProfiles();
      const profileId = selectProfileId(state, translationProfileId);
      if (!profileId) {
        throw new Error(
          t(
            'LLM プロファイルが設定されていません。設定画面でプロファイルを追加してください。',
          ),
        );
      }
      setTranslationProfileId(profileId);
      const value = await window.kataribe.previewTranslation(
        meeting.id,
        targetLanguage,
        profileId,
      );
      setTranslationPreview(value);
    } catch (reason: unknown) {
      setError(errorText(reason));
    } finally {
      setTranslationBusy(false);
    }
  };

  const changeTranslationProfile = async (profileId: string) => {
    setTranslationProfileId(profileId);
    const current = translationPreviewRef.current;
    if (!current) {
      return;
    }
    setTranslationBusy(true);
    setError(null);
    try {
      const value = await window.kataribe.previewTranslation(
        meeting.id,
        current.targetLanguage,
        profileId,
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
      setNotice(t('翻訳を生成しました。'));
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
      const state = await refreshLlmProfiles();
      const profileId = selectProfileId(state, summaryProfileId);
      if (!profileId) {
        throw new Error(
          t(
            'LLM プロファイルが設定されていません。設定画面でプロファイルを追加してください。',
          ),
        );
      }
      setSummaryProfileId(profileId);
      const value = await window.kataribe.previewSummary(meeting.id, profileId);
      setPreview(value);
    } catch (reason: unknown) {
      setError(errorText(reason));
    } finally {
      setPreviewBusy(false);
    }
  };

  const changeSummaryProfile = async (profileId: string) => {
    setSummaryProfileId(profileId);
    const current = previewRef.current;
    if (!current) {
      return;
    }
    setPreviewBusy(true);
    setError(null);
    try {
      const value = await window.kataribe.previewSummary(meeting.id, profileId);
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
      const result = await window.kataribe.generateSummary(meeting.id, currentPreview.token);
      setPreview(null);
      setTab('summary');
      if (result.cleanup.state === 'failed') {
        setNotice(
          t(
            '相槌と擬音を除去できなかったため、元の文字起こしで要約しました。',
          ),
        );
      } else if (result.cleanup.state === 'partial') {
        setNotice(
          t(
            '一部の区間で相槌と擬音を除去できなかったため、元の文字起こしを混ぜて要約しました。',
          ),
        );
      } else {
        setNotice(t('要約を生成しました。'));
      }
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
      setNotice(t('文字起こしを開始しました。'));
      setError(null);
      await load();
    } catch (reason: unknown) {
      setError(
        t('文字起こしを開始できませんでした: {error}', { error: errorText(reason) }),
      );
    }
  };

  const runTranscriptionComparison = async () => {
    if (
      !window.confirm(
        t(
          '既存の transcript.md を transcript.previous.md にコピーして上書きします。よろしいですか？',
        ),
      )
    ) {
      return;
    }
    try {
      await window.kataribe.retryTranscriptionComparison(current.id);
      setTranscriptView('current');
      setNotice(null);
      setError(null);
    } catch (reason: unknown) {
      setError(
        t('文字起こし前の強調を開始できませんでした: {error}', {
          error: errorText(reason),
        }),
      );
    }
  };

  const savedAudioBusy = activeHere && processing.stage === 'enhancing';

  const runSavedAudioEnhancement = async () => {
    if (
      current.enhancedModels.includes('nemotronlabs') &&
      !window.confirm(
        t('同じモデルの強調音声を置き換えます。よろしいですか？'),
      )
    ) {
      return;
    }
    try {
      setNotice(null);
      setError(null);
      await window.kataribe.enhanceReuseSavedAudio(current.id, 'nemotronlabs');
    } catch (reason: unknown) {
      setError(
        t('音声強調を開始できませんでした: {error}', {
          error: errorText(reason),
        }),
      );
    }
  };

  const cancelSavedAudioEnhancement = async () => {
    try {
      await window.kataribe.cancelProcessing();
    } catch (reason: unknown) {
      setError(
        t('処理を中断できませんでした: {error}', {
          error: errorText(reason),
        }),
      );
    }
  };

  const cancelProcessing = async () => {
    try {
      await window.kataribe.cancelProcessing();
      setNotice(t('処理を中断しました。'));
    } catch (reason: unknown) {
      setError(t('処理を中断できませんでした: {error}', { error: errorText(reason) }));
    }
  };

  const renderTranscript = (value: { body: string }) => {
    const lines = value.body.trim().split('\n');
    if (lines.length === 0 || (lines.length === 1 && lines[0] === '')) {
      return <p className="muted">{t('文字起こしの本文が空です。')}</p>;
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
          {t('会議一覧へ')}
        </button>
        <span className="detail-toolbar-spacer" />
        {activeHere ? (
          <button type="button" className="button button-secondary" onClick={() => void cancelProcessing()}>
            {t('処理を中断')}
          </button>
        ) : null}
        <button
          type="button"
          className="button button-secondary"
          disabled={!transcript && !summary}
          onClick={() => void copyCurrent()}
        >
          {t('コピー')}
        </button>
        <button
          type="button"
          className="button button-primary"
          disabled={
            !transcript ||
            summaryBusy ||
            processing.stage !== null ||
            titleGenerating
          }
          onClick={() => void openSummaryPreview()}
        >
          {previewBusy
            ? t('確認中...')
            : summaryBusy
              ? t('生成中...')
              : t('要約を生成')}
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
                {t('保存')}
              </button>
              <button
                type="button"
                className="link-button"
                disabled={titleSaving}
                onClick={() => setTitleEditing(false)}
              >
                {t('キャンセル')}
              </button>
            </>
          ) : (
            <>
              <h1 className="detail-title">{current.title}</h1>
              {canGenerateTitle && !titleGenerationFailed ? (
                <button
                  type="button"
                  className="link-button"
                  disabled={titleGenerating || processing.stage !== null}
                  onClick={() => void generateTitle()}
                >
                  {titleGenerating
                    ? t('生成中...')
                    : t('タイトルを自動生成')}
                </button>
              ) : null}
              <button
                type="button"
                className="link-button"
                disabled={processing.stage !== null || titleGenerating}
                onClick={startTitleEditing}
              >
                {t('タイトルを編集')}
              </button>
            </>
          )}
          <span className={`status-chip ${meetingStatusClass(current.status)}`}>
            {meetingStatusLabel(current.status, locale)}
          </span>
          <EnhancementStatusSummary
            key={current.id}
            enhancement={detail?.enhancement ?? null}
            warning={detail?.enhancementWarning ?? null}
          />
        </div>
        <p className="detail-meta">
          {formatDateTime(current.startedAt, locale)} ·{' '}
          {formatDuration(current.duration)} ·{' '}
          {current.inputSource
            ? inputSourceLabel(current.inputSource, locale)
            : t('入力不明')}{' '}
          · {current.sampleRate.toLocaleString(locale)} Hz
        </p>
        {recordingError ? (
          <div className="alert alert-error recording-error" role="alert">
            <strong>{t('録音エラー')}</strong>
            <p>{recordingError.message}</p>
            {recordingError.at ? (
              <span className="recording-error-time">
                {formatDateTime(recordingError.at, locale)}
              </span>
            ) : null}
          </div>
        ) : null}
        {detail?.diarizationError ? (
          <p className="alert alert-warning" role="status">
            {t('話者分離に失敗しました。文字起こしは保存されています。')}
            {detail.diarizationError}
          </p>
        ) : null}
        <TitleGenerationNotice
          titleGeneration={titleGeneration}
          canRetry={canGenerateTitle}
          busy={titleGenerating}
          onRetry={() => void generateTitle()}
        />
        <div className="detail-player-row">
          <AudioPlayer
            key={current.id}
            src={current.audioUrl}
            enhancedSrc={enhancedSrc}
            peaks={peaks}
            duration={current.duration}
            initialTime={initialSeekSeconds}
          />
          <button type="button" className="button button-secondary" onClick={onOpenFolder}>
            {t('Finder で開く')}
          </button>
          {!transcript && !activeHere ? (
            <button
              type="button"
              className="button button-secondary"
              onClick={() => void retryTranscription()}
            >
              {t('文字起こしを再実行')}
            </button>
          ) : null}
          {enhanceBeforeTranscription && transcript ? (
            <button
              type="button"
              className="button button-secondary"
              disabled={activeHere}
              onClick={() => void runTranscriptionComparison()}
            >
              {t('文字起こし前の強調を再実行')}
            </button>
          ) : null}
        </div>
        <SavedAudioEnhancementControls
          enabled={current.audioUrl !== null && !activeHere}
          busy={savedAudioBusy}
          progress={processing.progress}
          error={savedAudioBusy ? null : processingError}
          notice={null}
          inputDiffers={current.audioUrl !== null}
          onRun={() => void runSavedAudioEnhancement()}
          onCancel={() => void cancelSavedAudioEnhancement()}
        />
        {waveformError ? (
          <p className="muted">{t('波形を取得できませんでした。')}</p>
        ) : null}
        {activeHere ? (
          <div className="progress-card" role="status">
            <div className="progress-row">
              <strong>{progressLabel(processing, t)}</strong>
              <span className="mono">
                {progressPercent !== null ? `${progressPercent}%` : t('準備中')}
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
                ? t(' · 残り約 {duration}', {
                    duration: formatDuration(processing.etaSeconds),
                  })
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
        <StaleTranscriptNotice
          summaryStale={Boolean(staleSummary)}
          translationStale={staleTranslation}
        />
        <section className="transcript-pane" aria-labelledby="transcript-title">
          <div className="transcript-bar">
            <div className="seg" role="tablist" aria-label={t('会議の表示')}>
              <button
                type="button"
                role="tab"
                aria-selected={tab === 'transcript'}
                aria-pressed={tab === 'transcript'}
                onClick={() => setTab('transcript')}
              >
                {t('文字起こし')}
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={tab === 'summary'}
                aria-pressed={tab === 'summary'}
                onClick={() => setTab('summary')}
              >
                {t('要約')}
              </button>
            </div>
            <span className="detail-toolbar-spacer" />
            {tab === 'transcript' &&
            !comparisonReadOnly &&
            Object.keys(translations).length > 0 ? (
              <select
                className="setting-input transcript-language-select"
                value={transcriptLanguage}
                onChange={(event) =>
                  setTranscriptLanguage(
                    event.target.value as 'source' | SummaryLanguage,
                  )
                }
              >
                <option value="source">{t('原文')}</option>
                {translations.ja ? <option value="ja">{t('日本語訳')}</option> : null}
                {translations.en ? (
                  <option value="en">{t('English 訳')}</option>
                ) : null}
              </select>
            ) : null}
            {tab === 'transcript' && !comparisonReadOnly && transcript
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
                        ? t('日本語訳を再生成')
                        : t('English 訳を再生成')
                      : target === 'ja'
                        ? t('日本語訳')
                        : t('English 訳')}
                  </button>
                ))
              : null}
            {tab === 'transcript' &&
            !editing &&
            !comparisonReadOnly &&
            transcript !== null &&
            (detail?.speakers.length ?? 0) >= 2 ? (
              <button
                type="button"
                className="link-button"
                disabled={processing.stage !== null}
                onClick={startSpeakerEditing}
              >
                {t('話者名を編集')}
              </button>
            ) : null}
            {tab === 'transcript' ? (
              editing ? (
                <>
                  <button
                    type="button"
                    className="link-button"
                    disabled={saving}
                    onClick={() => void saveTranscript()}
                  >
                    {t('保存')}
                  </button>
                  <button
                    type="button"
                    className="link-button"
                    disabled={saving}
                    onClick={() => setEditing(false)}
                  >
                    {t('キャンセル')}
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="link-button"
                  disabled={
                    !transcript ||
                    Boolean(displayedTranslation) ||
                    comparisonReadOnly ||
                    processing.stage !== null
                  }
                  onClick={startEditing}
                >
                  {t('編集')}
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
                  {t('保存')}
                </button>
                <button
                  type="button"
                  className="link-button"
                  disabled={summarySaving}
                  onClick={() => setSummaryEditing(false)}
                >
                  {t('キャンセル')}
                </button>
              </>
            ) : (
              <button
                type="button"
                className="link-button"
                disabled={
                  !summary || processing.stage !== null || titleGenerating
                }
                onClick={startSummaryEditing}
              >
                {t('編集')}
              </button>
            )}
          </div>

          {tab === 'transcript' ? (
            <TranscriptComparison
              value={transcriptView}
              hasRaw={rawComparison !== null}
              hasEnhanced={enhancedComparison !== null}
              onChange={setTranscriptView}
            />
          ) : null}

          {loading ? (
            <div className="transcript-empty">
              <p className="muted">{t('読み込み中です...')}</p>
            </div>
          ) : tab === 'transcript' ? (
            editing && !comparisonReadOnly ? (
              <textarea
                className="transcript-editor"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                spellCheck={false}
              />
            ) : displayedTranscript ? (
              <div className="transcript-scroll">
                {(displayedTranslation?.partial ?? displayedTranscript.partial) ? (
                  <p className="alert alert-warning">
                    {displayedTranslation
                      ? t('部分的な翻訳です。原文と対応していない行があります。')
                      : t('部分的な文字起こしです。完了していない可能性があります。')}
                  </p>
                ) : null}
                {displayedTranslation ? (
                  <p className="transcript-translation-note">
                    {displayedTranslation.language === 'ja'
                      ? t('日本語訳')
                      : t('English 訳')}
                    {displayedTranslation.provider
                      ? ` · ${displayedTranslation.provider}`
                      : ''}
                  </p>
                ) : null}
                {renderTranscript(transcriptForRender)}
              </div>
            ) : (
              <div className="transcript-empty">
                <h2>{t('文字起こし')}</h2>
                <p>
                  {t(
                    '録音を停止すると、mp3 への変換と文字起こしが自動で始まります。',
                  )}
                  {t('モデルが未取得の場合は、設定画面からダウンロードしてください。')}
                </p>
                {!activeHere ? (
                  <div className="setting-actions">
                    <button
                      type="button"
                      className="button button-secondary"
                      onClick={() => void retryTranscription()}
                    >
                      {t('文字起こしを開始')}
                    </button>
                    {smallerModel ? (
                      <button
                        type="button"
                        className="button button-secondary"
                        onClick={() => void retryWithSmallerModel()}
                      >
                        {t('{model} で再実行', { model: smallerModel })}
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
                <h2>{t('要約')}</h2>
                <p>
                  {t(
                    '文字起こしが完了したら「要約を生成」を押してください。送信前に、送る内容と送信先を確認できます。',
                  )}
                </p>
              </div>
            )
          ) : null}
        </section>

        <aside className="summary-pane" aria-labelledby="summary-title">
          <div className="summary-head">
            <h2 id="summary-title">{t('要約')}</h2>
            <select
              className="setting-input summary-profile-select"
              aria-label={t('要約に使う LLM プロファイル')}
              value={summaryProfileId}
              disabled={
                processing.stage !== null || summaryBusy || titleGenerating
              }
              onChange={(event) => {
                if (previewRef.current) {
                  void changeSummaryProfile(event.target.value);
                } else {
                  setSummaryProfileId(event.target.value);
                }
              }}
            >
              {llmProfiles?.profiles.length ? (
                llmProfiles.profiles.map((profile) => (
                  <option value={profile.id} key={profile.id}>
                    {profile.id}
                    {profile.isDefault ? t('（既定）') : ''}
                  </option>
                ))
              ) : (
                <option value="">{t('プロファイル未設定')}</option>
              )}
            </select>
            <select
              className="setting-input summary-language-select"
              aria-label={t('この会議の要約言語')}
              value={current.summaryLanguage ?? ''}
              onChange={(event) => void saveSummaryLanguage(event.target.value)}
            >
              <option value="">
                {t('既定（{language}）', {
                  language: defaultSummaryLanguageLabel,
                })}
              </option>
              <option value="ja">{t('日本語')}</option>
              <option value="en">{t('English')}</option>
            </select>
            <button
              type="button"
              className="link-button"
              disabled={!summary}
              onClick={() => void copySummary()}
            >
              {t('コピー')}
            </button>
          </div>
          {summary ? (
            <div className="summary-preview">
              <p className="muted">
                {summary.provider ?? 'LLM'}
                {summary.model ? ` · ${summary.model}` : ''}
                {summary.generatedAt
                  ? ` · ${formatDateTime(summary.generatedAt, locale)}`
                  : ''}
              </p>
              <pre className="markdown-view">{summary.body}</pre>
            </div>
          ) : (
            <div className="summary-empty">
              <p>{t('要約はまだありません。')}</p>
              <p className="muted">
                {t(
                  '要約を生成すると、要約・決定事項・ToDo・未決事項がここに表示されます。',
                )}
              </p>
              <button type="button" className="link-button" onClick={onOpenSettings}>
                {t('LLM の設定を開く')}
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
                <p className="section-label">{t('確認')}</p>
                <h2 id="confirm-title">{t('送信内容の確認')}</h2>
              </div>
              <button
                type="button"
                className="icon-button"
                aria-label={t('閉じる')}
                disabled={summaryBusy}
                onClick={() => setPreview(null)}
              >
                ×
              </button>
            </div>
            <dl className="confirm-meta">
              <div>
                <dt>{t('プロファイル')}</dt>
                <dd>
                  <select
                    className="setting-input"
                    aria-label={t('要約に使う LLM プロファイル')}
                    value={preview.profileId}
                    disabled={summaryBusy || previewBusy}
                    onChange={(event) => void changeSummaryProfile(event.target.value)}
                  >
                    {llmProfiles?.profiles.some(
                      (profile) => profile.id === preview.profileId,
                    ) ? null : (
                      <option value={preview.profileId}>{preview.profileId}</option>
                    )}
                    {llmProfiles?.profiles.map((profile) => (
                      <option value={profile.id} key={profile.id}>
                        {profile.id}
                        {profile.isDefault ? t('（既定）') : ''}
                      </option>
                    ))}
                  </select>
                </dd>
              </div>
              <div>
                <dt>{t('送信先')}</dt>
                <dd className="mono">{preview.providerLabel} · {preview.model}</dd>
              </div>
              <div>
                <dt>{t('エンドポイント')}</dt>
                <dd className="mono confirm-endpoint">{preview.endpoint}</dd>
              </div>
              <div>
                <dt>{t('文字数')}</dt>
                <dd>
                  {t('{count} 文字', {
                    count: preview.charCount.toLocaleString(locale),
                  })}
                </dd>
              </div>
              <div>
                <dt>{t('概算トークン')}</dt>
                <dd>
                  {t('約 {count} tokens', {
                    count: preview.estimatedTokens.toLocaleString(locale),
                  })}
                </dd>
              </div>
              <div>
                <dt>{t('相槌と擬音の除去')}</dt>
                <dd>
                  {preview.cleanupEnabled
                    ? t('あり（約 {count} tokens を追加）', {
                        count:
                          preview.cleanupEstimatedTokens.toLocaleString(locale),
                      })
                    : t('なし')}
                </dd>
              </div>
              <div>
                <dt>{t('内容ハッシュ')}</dt>
                <dd className="mono">{preview.contentHash.slice(0, 16)}...</dd>
              </div>
            </dl>
            {preview.warning ? (
              <p className="alert alert-warning">{preview.warning}</p>
            ) : null}
            <SummaryCleanupWarning enabled={preview.cleanupEnabled} />
            <SummaryRegenerationWarning summary={summary} />
            <p className="muted">
              {t(
                '音声ファイルと会議のメタデータは送信しません。個人名や社名のマスクは行いません。概算料金はプロバイダの料金表を確認してください。送信先でのデータの扱いはプロバイダの規約に従います。',
              )}
            </p>
            <pre className="confirm-content">{preview.text}</pre>
            <div className="confirm-actions">
              <button
                type="button"
                className="button button-secondary"
                disabled={summaryBusy}
                onClick={() => setPreview(null)}
              >
                {t('キャンセル')}
              </button>
              <button
                type="button"
                className="button button-primary"
                disabled={summaryBusy}
                onClick={() => void generateSummary()}
              >
                {summaryBusy ? t('送信中...') : t('送信して要約')}
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
                <p className="section-label">{t('翻訳')}</p>
                <h2 id="translation-confirm-title">{t('翻訳の送信内容の確認')}</h2>
              </div>
              <button
                type="button"
                className="icon-button"
                aria-label={t('閉じる')}
                disabled={translationBusy}
                onClick={() => setTranslationPreview(null)}
              >
                ×
              </button>
            </div>
            <dl className="confirm-meta">
              <div>
                <dt>{t('プロファイル')}</dt>
                <dd>
                  <select
                    className="setting-input"
                    aria-label={t('翻訳に使う LLM プロファイル')}
                    value={translationPreview.profileId}
                    disabled={translationBusy}
                    onChange={(event) =>
                      void changeTranslationProfile(event.target.value)
                    }
                  >
                    {llmProfiles?.profiles.some(
                      (profile) => profile.id === translationPreview.profileId,
                    ) ? null : (
                      <option value={translationPreview.profileId}>
                        {translationPreview.profileId}
                      </option>
                    )}
                    {llmProfiles?.profiles.map((profile) => (
                      <option value={profile.id} key={profile.id}>
                        {profile.id}
                        {profile.isDefault ? t('（既定）') : ''}
                      </option>
                    ))}
                  </select>
                </dd>
              </div>
              <div>
                <dt>{t('翻訳')}</dt>
                <dd>
                  {translationPreview.sourceLanguage} →{' '}
                  {translationPreview.targetLanguage === 'ja'
                    ? t('日本語')
                    : t('English')}
                </dd>
              </div>
              <div>
                <dt>{t('送信先')}</dt>
                <dd className="mono">
                  {translationPreview.providerLabel} · {translationPreview.model}
                </dd>
              </div>
              <div>
                <dt>{t('エンドポイント')}</dt>
                <dd className="mono confirm-endpoint">
                  {translationPreview.endpoint}
                </dd>
              </div>
              <div>
                <dt>{t('文字数')}</dt>
                <dd>
                  {t('{count} 文字', {
                    count: translationPreview.charCount.toLocaleString(locale),
                  })}
                </dd>
              </div>
              <div>
                <dt>{t('概算トークン')}</dt>
                <dd>
                  {t('約 {count} tokens', {
                    count:
                      translationPreview.estimatedTokens.toLocaleString(locale),
                  })}
                </dd>
              </div>
            </dl>
            {translationPreview.warning ? (
              <p className="alert alert-warning">{translationPreview.warning}</p>
            ) : null}
            <p className="muted">
              {t(
                '音声ファイルと会議のメタデータは送信しません。原文のタイムスタンプを保って翻訳します。翻訳の品質と料金はプロバイダとモデルに依存します。',
              )}
            </p>
            <pre className="confirm-content">{translationPreview.text}</pre>
            <div className="confirm-actions">
              <button
                type="button"
                className="button button-secondary"
                disabled={translationBusy}
                onClick={() => setTranslationPreview(null)}
              >
                {t('キャンセル')}
              </button>
              <button
                type="button"
                className="button button-primary"
                disabled={translationBusy}
                onClick={() => void generateTranslation()}
              >
                {translationBusy ? t('送信中...') : t('送信して翻訳')}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {speakerEditing ? (
        <div
          className="modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="speaker-rename-title"
        >
          <div className="confirm-dialog">
            <div className="confirm-head">
              <div>
                <p className="section-label">{t('話者')}</p>
                <h2 id="speaker-rename-title">{t('話者名の変更')}</h2>
              </div>
              <button
                type="button"
                className="icon-button"
                aria-label={t('閉じる')}
                disabled={speakerSaving}
                onClick={() => setSpeakerEditing(false)}
              >
                ×
              </button>
            </div>
            <p className="muted">
              {t(
                '文字起こしと既存の翻訳の話者名を置き換えます。翻訳が話者名を保持していない行は変わりません。',
              )}
            </p>
            <div className="speaker-rename-list">
              {(detail?.speakers ?? []).map((name, index) => (
                <label className="field" key={`${name}-${index}`}>
                  <span>{name}</span>
                  <input
                    className="setting-input"
                    value={speakerDraft[index] ?? ''}
                    maxLength={40}
                    onChange={(event) => {
                      const value = event.target.value;
                      setSpeakerDraft((current) =>
                        current.map((item, itemIndex) =>
                          itemIndex === index ? value : item,
                        ),
                      );
                    }}
                  />
                </label>
              ))}
            </div>
            {!speakerNamesValid ? (
              <p className="alert alert-warning">
                {t(
                  '話者名を空にせず、重複しない名前にしてください。コロン、改行、角括弧は使えません。',
                )}
              </p>
            ) : null}
            {speakerError ? (
              <p className="alert alert-error">{speakerError}</p>
            ) : null}
            <div className="confirm-actions">
              <button
                type="button"
                className="button button-secondary"
                disabled={speakerSaving}
                onClick={() => setSpeakerEditing(false)}
              >
                {t('キャンセル')}
              </button>
              <button
                type="button"
                className="button button-primary"
                disabled={speakerSaving || !speakerNamesValid}
                onClick={() => void saveSpeakers()}
              >
                {speakerSaving ? t('保存中...') : t('保存')}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </article>
  );
}
