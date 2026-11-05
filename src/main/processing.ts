import { createHash, randomUUID } from 'node:crypto';
import {
  copyFile,
  mkdir,
  readFile,
  rename,
  rm,
  stat,
} from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  estimateTokens,
  defaultLlmProfile,
  findLlmProfile,
} from '../shared/llm';
import {
  formatSummaryMarkdown,
  formatTranscriptMarkdown,
  formatTranslationMarkdown,
  parseFrontMatter,
  type TranscriptSegment,
} from '../shared/markdown';
import type {
  AppSettings,
  EnhancementFile,
  EnhancementTranscriptionEntry,
  EnhancementSettings,
  GenerateSummaryResult,
  LlmRuntimeConfig,
  MeetingDetail,
  MeetingStatus,
  MeetingSummary,
  ProcessingState,
  SummaryPreview,
  SummaryLanguage,
  TranslationPreview,
  TranslationResult,
} from '../shared/types';
import { DEFAULT_MEETING_TITLE } from '../shared/title';
import { renameTranscriptSpeakers } from '../shared/speakers';
import type { ApiKeyStore } from './api-keys';
import { hashFile } from './asset-download';
import type { DiarizationService } from './diarization';
import { runDiarization } from './diarization-run';
import {
  buildLabelMapping,
  diarizationCachePath,
  readDiarizationCache,
  writeDiarizationCache,
  type DiarizationCache,
  type DiarizationInputKind,
} from './diarization-cache';
import type { LlmClient } from './llm';
import { buildLlmProfileStatus } from './llm-profiles';
import { t } from './i18n';
import { computeWavWaveform, MediaError, type MediaEncoder } from './media';
import { writePrivateText } from './private-file';
import {
  readMeetingMeta,
  updateMeetingMeta,
  type MeetingMeta,
  type MeetingMetaDiarization,
} from './meeting-meta';
import { TRANSLATION_FILES, type MeetingStore } from './meetings';
import {
  readEnhancementFile,
  updateMetaEnhancement,
  writeEnhancementFile,
} from './reuse-metadata';
import { generateAndSaveMeetingTitle } from './meeting-title';
import { generateSummary } from './summary';
import type { TranscriptionOutcome, TranscriptionService } from './transcription';
import type {
  TranscriptionPlan,
  TranscriptionRunner,
} from './transcription-runner';
import { translateTranscript } from './translation';
import {
  cleanupMeetingTemp,
  invalidateEnhancement,
  reconcileEnhancement,
} from './reuse-cleanup';
import type { ReuseSavedAudioService } from './reuse-saved-audio';
import type { ReuseEnhancementService } from './reuse-enhancement';
import { getReuseModelDefinition } from './reuse-models';
import { readWavInfo } from './wav';

export type ProcessingCoordinatorOptions = {
  tempRoot: string;
  meetingStore: MeetingStore;
  apiKeyStore: ApiKeyStore;
  mediaEncoder: MediaEncoder;
  transcriptionService: TranscriptionService;
  transcriptionRunner: TranscriptionRunner;
  diarizationService: DiarizationService;
  llmClient: LlmClient;
  reuseSavedAudio?: ReuseSavedAudioService;
  reuseEnhancement?: ReuseEnhancementService;
  settings: () => AppSettings;
  now?: () => Date;
  onStateChange: (state: ProcessingState) => void;
  onMeetingUpdated: (meetingId: string) => void;
  onSpeedRatioMeasured?: (
    model: AppSettings['whisperModel'],
    ratio: number,
  ) => Promise<void> | void;
  confirmContinue?: (message: string, detail: string) => Promise<boolean>;
};

type PreviewToken = {
  meetingId: string;
  contentHash: string;
  createdAt: number;
  expiresAt: number;
  profileId: string;
  provider: LlmRuntimeConfig['provider'];
  baseUrl: string;
  endpoint: string;
  model: string;
  kind: 'openai' | 'anthropic';
  language: AppSettings['summaryLanguage'];
  cleanupFillers: boolean;
};

type TranslationToken = {
  meetingId: string;
  targetLanguage: SummaryLanguage;
  sourceLanguage: string;
  contentHash: string;
  expiresAt: number;
  profileId: string;
  provider: LlmRuntimeConfig['provider'];
  baseUrl: string;
  endpoint: string;
  model: string;
  kind: 'openai' | 'anthropic';
};

type ActiveTask = {
  meetingId: string;
  controller: AbortController;
};

const IDLE_STATE: ProcessingState = {
  stage: null,
  meetingId: null,
  progress: null,
  etaSeconds: null,
  message: null,
  cancellable: false,
  error: null,
};

async function exists(path: string): Promise<boolean> {
  try {
    const info = await stat(path);
    return info.isFile() && info.size > 0;
  } catch {
    return false;
  }
}

function clearDiarization(meta: MeetingMeta): void {
  delete meta.diarization;
  delete meta.speakers;
}

async function rewriteTranslationSpeakers(
  meetingDir: string,
  previous: DiarizationCache,
  next: DiarizationCache,
): Promise<void> {
  const mapping = buildLabelMapping(previous, next);
  if (mapping.size === 0) {
    return;
  }
  for (const entry of TRANSLATION_FILES) {
    const path = join(meetingDir, entry.file);
    let markdown: string;
    try {
      markdown = await readFile(path, 'utf8');
    } catch {
      continue;
    }
    const renamed = renameTranscriptSpeakers(markdown, mapping);
    if (renamed !== markdown) {
      await writePrivateText(path, renamed);
    }
  }
}

function sourceLabel(meta: MeetingMeta): string {
  switch (meta.source.input) {
    case 'microphone':
      return 'mic';
    case 'system':
      return 'system';
    case 'both':
      return 'mic+system';
  }
}

function dateOnly(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return new Date().toISOString().slice(0, 10);
  }
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function transcriptionErrorMessage(outcome: TranscriptionOutcome): string {
  switch (outcome.errorCode) {
    case 'model-missing':
      return t(
        'whisper モデルが見つかりません。設定画面からモデルをダウンロードしてください。',
      );
    case 'binary-missing':
      return t(
        'whisper-cli が見つかりません。アプリに同梱されたバイナリを確認してください。',
      );
    case 'stalled':
      return t(
        '文字起こしの進捗が止まったため、処理を中断しました。部分的な結果を保存しています。',
      );
    case 'hard-limit':
      return t(
        '文字起こしが制限時間を超えたため、処理を中断しました。部分的な結果を保存しています。',
      );
    case 'empty-output':
      return t(
        '音声から文字起こし結果が得られませんでした。音声に発話が含まれているか確認してください。',
      );
    case 'incomplete':
      return t(
        '文字起こしが最後まで完了しませんでした。部分的な結果を保存しています。より小さいモデルで再実行してください。',
      );
    case 'cancelled':
      return t('文字起こしをキャンセルしました。部分的な結果を保存しています。');
    case 'invalid-audio':
      return t('文字起こし用の音声ファイルを読み込めませんでした。');
    case 'openai-config':
      return t('OpenAI の文字起こし設定を確認してください。{detail}', {
        detail: outcome.error ?? '',
      }).trim();
    case 'openai-rate-limit':
      return t(
        'OpenAI の文字起こし API のレート制限に達しました。時間をおいて再実行してください。',
      );
    case 'openai-server':
      return t(
        'OpenAI の文字起こし API がサーバーエラーを返しました。時間をおいて再実行してください。',
      );
    case 'openai-network':
      return t(
        'OpenAI の文字起こし API に接続できませんでした。ネットワークを確認してください。',
      );
    case 'file-too-large':
      return t('音声の分割が大きすぎます。音声を短くして再実行してください。');
    case 'openai-failed':
      return t('OpenAI の文字起こしに失敗しました。{detail}', {
        detail: outcome.error ?? '',
      }).trim();
    default:
      return t('whisper.cpp の実行に失敗しました。{detail}', {
        detail: outcome.error ?? '',
      }).trim();
  }
}

function summaryErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

export class ProcessingCoordinator {
  private readonly tempRoot: string;
  private readonly meetingStore: MeetingStore;
  private readonly apiKeyStore: ApiKeyStore;
  private readonly mediaEncoder: MediaEncoder;
  private readonly transcriptionService: TranscriptionService;
  private readonly transcriptionRunner: TranscriptionRunner;
  private readonly diarizationService: DiarizationService;
  private readonly llmClient: LlmClient;
  private readonly reuseSavedAudio?: ReuseSavedAudioService;
  private readonly reuseEnhancement?: ReuseEnhancementService;
  private readonly settings: () => AppSettings;
  private readonly now: () => Date;
  private readonly onStateChange: (state: ProcessingState) => void;
  private readonly onMeetingUpdated: (meetingId: string) => void;
  private readonly onSpeedRatioMeasured?: (
    model: AppSettings['whisperModel'],
    ratio: number,
  ) => Promise<void> | void;
  private readonly confirmContinue?: (
    message: string,
    detail: string,
  ) => Promise<boolean>;
  private readonly previewTokens = new Map<string, PreviewToken>();
  private readonly translationTokens = new Map<string, TranslationToken>();
  private queue: Promise<void> = Promise.resolve();
  private active: ActiveTask | null = null;
  private titleGenerationActive = false;
  private queued = new Set<string>();
  private readonly comparisonReruns = new Set<string>();
  private readonly comparisonRerunStatus = new Map<string, MeetingStatus>();
  private state: ProcessingState = { ...IDLE_STATE };
  private recordingActive = false;
  private shuttingDown = false;

  constructor(options: ProcessingCoordinatorOptions) {
    this.tempRoot = options.tempRoot;
    this.meetingStore = options.meetingStore;
    this.apiKeyStore = options.apiKeyStore;
    this.mediaEncoder = options.mediaEncoder;
    this.transcriptionService = options.transcriptionService;
    this.transcriptionRunner = options.transcriptionRunner;
    this.diarizationService = options.diarizationService;
    this.llmClient = options.llmClient;
    this.reuseSavedAudio = options.reuseSavedAudio;
    this.reuseEnhancement = options.reuseEnhancement;
    this.settings = options.settings;
    this.now = options.now ?? (() => new Date());
    this.onStateChange = options.onStateChange;
    this.onMeetingUpdated = options.onMeetingUpdated;
    this.onSpeedRatioMeasured = options.onSpeedRatioMeasured;
    this.confirmContinue = options.confirmContinue;
  }

  getState(): ProcessingState {
    return { ...this.state };
  }

  isBusy(): boolean {
    return this.state.stage !== null || this.titleGenerationActive;
  }

  pauseForRecording(): void {
    this.recordingActive = true;
    this.active?.controller.abort();
    this.transcriptionService.pause();
  }

  pauseTranscription(): void {
    this.transcriptionService.pause();
  }

  resumeTranscription(): void {
    this.transcriptionService.resume();
  }

  resumeAfterRecording(meetingId: string | null): Promise<void> {
    this.recordingActive = false;
    this.transcriptionService.resume();
    if (!meetingId) {
      return Promise.resolve();
    }
    return this.enqueue(meetingId, () => this.processMeeting(meetingId));
  }

  requestTranscription(meetingId: string): Promise<void> {
    return this.enqueue(meetingId, () => this.processMeeting(meetingId));
  }

  requestSavedAudioEnhancement(
    meetingId: string,
    model: 'nemotronlabs',
  ): Promise<void> {
    if (!this.reuseSavedAudio) {
      return Promise.reject(new Error('speech enhancement is not available'));
    }
    return this.enqueue(meetingId, () =>
      this.enhanceSavedAudioOnly(meetingId, model),
    );
  }

  async requestTranscriptionComparison(meetingId: string): Promise<void> {
    const meeting = await this.meetingStore.find(meetingId);
    if (!meeting) {
      throw new Error(t('会議が見つかりません。'));
    }
    const meta = await readMeetingMeta(join(meeting.meetingDir, 'meta.json'));
    const transcriptPath = join(meeting.meetingDir, 'transcript.md');
    try {
      await copyFile(
        transcriptPath,
        join(meeting.meetingDir, 'transcript.previous.md'),
      );
    } catch (error) {
      if (
        !(
          typeof error === 'object' &&
          error !== null &&
          (error as { code?: unknown }).code === 'ENOENT'
        )
      ) {
        throw error;
      }
    }
    this.comparisonRerunStatus.set(meetingId, meta.status);
    this.comparisonReruns.add(meetingId);
    try {
      await this.enqueue(meetingId, () => this.processMeeting(meetingId));
    } catch (error) {
      this.comparisonRerunStatus.delete(meetingId);
      this.comparisonReruns.delete(meetingId);
      throw error;
    }
  }

  cancel(): boolean {
    if (!this.active) {
      return false;
    }
    this.active.controller.abort();
    return true;
  }

  async shutdown(): Promise<void> {
    this.shuttingDown = true;
    this.active?.controller.abort();
    await Promise.race([
      this.queue.catch(() => undefined),
      new Promise<void>((resolve) => setTimeout(resolve, 5000)),
    ]);
  }

  async markInterruptedMeetings(): Promise<void> {
    const meetings = await this.meetingStore.list();
    for (const meeting of meetings) {
      if (
        meeting.status !== 'encoding' &&
        meeting.status !== 'enhancing' &&
        meeting.status !== 'transcribing'
      ) {
        continue;
      }
      const metaPath = join(meeting.meetingDir, 'meta.json');
      try {
        let completed = false;
        await updateMeetingMeta(metaPath, async (meta) => {
          if (meta.status === 'enhancing') {
            meta.status = 'error';
            meta.error = t(
              '前回の音声強調が中断されました。会議詳細から再実行してください。',
            );
            const read = await readEnhancementFile(meeting.meetingDir);
            if (read.state === 'ok') {
              const finishedAt = new Date().toISOString();
              for (const entry of Object.values(read.file.saved_audio)) {
                if (entry?.state === 'pending' || entry?.state === 'running') {
                  entry.state = 'interrupted';
                  entry.finished_at = finishedAt;
                  entry.error = 'interrupted';
                }
              }
              for (const entry of Object.values(read.file.transcription.models)) {
                if (entry?.state === 'pending' || entry?.state === 'running') {
                  entry.state = 'interrupted';
                  entry.finished_at = finishedAt;
                  entry.error = 'interrupted';
                }
              }
              if (
                read.file.transcription.raw.state === 'pending' ||
                read.file.transcription.raw.state === 'running'
              ) {
                read.file.transcription.raw.state = 'interrupted';
                read.file.transcription.raw.finished_at = finishedAt;
                read.file.transcription.raw.error = 'interrupted';
              }
              try {
                await writeEnhancementFile(meeting.meetingDir, read.file);
              } catch (error) {
                console.error(
                  `failed to update enhancement.json after interruption: ${error instanceof Error ? error.message : String(error)}`,
                );
              }
              updateMetaEnhancement(meta, read.file);
            }
            return;
          }
          if (meta.status === 'transcribing') {
            const lastEnd = meta.transcription?.last_segment_end ?? 0;
            if (lastEnd >= Math.max(0, meta.duration - 15)) {
              meta.status = 'transcribed';
              meta.transcription = {
                ...(meta.transcription ?? {}),
                state: 'completed',
                partial: false,
              };
              delete meta.error;
              completed = true;
              return;
            }
            meta.status = 'error';
            meta.error = t(
              '前回の文字起こしが中断されました。会議詳細から再実行してください。部分的な結果は保存されています。',
            );
            meta.transcription = {
              ...(meta.transcription ?? {}),
              state: 'interrupted',
              partial: true,
              error: 'interrupted',
            };
            return;
          }
          meta.status = 'error';
          meta.error = t(
            '前回の音声変換が中断されました。会議詳細から文字起こしを再実行してください。',
          );
          if (meta.encoding?.state === 'running') {
            meta.encoding = {
              ...meta.encoding,
              state: 'failed',
              error: 'interrupted',
            };
          }
        });
        if (completed) {
          await rm(join(this.tempRoot, meeting.id), {
            recursive: true,
            force: true,
          }).catch(() => undefined);
        }
      } catch (error) {
        console.error(
          `failed to mark interrupted meeting: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  async runtimeConfig(profileId?: string): Promise<LlmRuntimeConfig | null> {
    const settings = this.settings();
    const profile = profileId
      ? findLlmProfile(settings, profileId)
      : defaultLlmProfile(settings);
    if (!profile) {
      return null;
    }
    return buildLlmProfileStatus(
      profile,
      profile.id === settings.llmDefaultProfileId,
      this.apiKeyStore,
      settings.uiLanguage,
    );
  }

  private async resolveTitleRuntime(profileId?: string): Promise<{
    config: LlmRuntimeConfig;
    apiKey: string;
  }> {
    const config = await this.runtimeConfig(profileId);
    if (!config) {
      throw new Error(
        t(
          'LLM プロファイルが設定されていません。設定画面でプロファイルを追加してください。',
        ),
      );
    }
    if (!config.endpoint) {
      throw new Error(
        t('LLM のエンドポイント URL が正しくありません。設定を確認してください。'),
      );
    }
    if (!config.apiKeyConfigured) {
      throw new Error(
        t('LLM の API キーが設定されていません。設定画面で保存してください。'),
      );
    }
    let apiKey: string;
    try {
      apiKey =
        (await this.apiKeyStore.getKey(
          config.id,
          config.baseUrl,
          config.provider,
        )) ?? '';
    } catch (error) {
      throw new Error(
        t('API キーを復号できませんでした。設定画面で再入力してください。{detail}', {
          detail: error instanceof Error ? ` (${error.message})` : '',
        }),
      );
    }
    if (!apiKey) {
      throw new Error(t('API キーが設定されていません。'));
    }
    return { config, apiKey };
  }

  async createSummaryPreview(
    meetingId: string,
    profileId?: string,
  ): Promise<SummaryPreview> {
    const detail = await this.meetingStore.detail(meetingId);
    if (!detail?.transcript?.body.trim()) {
      throw new Error(
        t('文字起こしがありません。先に文字起こしを完了してください。'),
      );
    }
    const config = await this.runtimeConfig(profileId);
    if (!config) {
      throw new Error(
        t(
          'LLM プロファイルが設定されていません。設定画面でプロファイルを追加してください。',
        ),
      );
    }
    if (!config.endpoint) {
      throw new Error(
        t('LLM のエンドポイント URL が正しくありません。設定を確認してください。'),
      );
    }
    if (!config.apiKeyConfigured) {
      throw new Error(
        t('LLM の API キーが設定されていません。設定画面で保存してください。'),
      );
    }
    const transcript = detail.transcript.body.trim();
    const hash = createHash('sha256').update(transcript, 'utf8').digest('hex');
    const token = randomUUID();
    const now = this.now().getTime();
    const language =
      detail.meeting.summaryLanguage ?? this.settings().summaryLanguage;
    const cleanupFillers = this.settings().removeFillersBeforeSummary;
    this.previewTokens.set(token, {
      meetingId,
      contentHash: hash,
      createdAt: now,
      expiresAt: now + 5 * 60_000,
      profileId: config.id,
      provider: config.provider,
      baseUrl: config.baseUrl,
      endpoint: config.endpoint,
      model: config.model,
      kind: config.kind,
      language,
      cleanupFillers,
    });
    return {
      token,
      meetingId,
      profileId: config.id,
      provider: config.provider,
      providerLabel: config.providerLabel,
      model: config.model,
      endpoint: config.endpoint,
      language,
      charCount: transcript.length,
      estimatedTokens: estimateTokens(transcript),
      cleanupEnabled: cleanupFillers,
      cleanupEstimatedTokens: cleanupFillers ? estimateTokens(transcript) : 0,
      contentHash: hash,
      text: transcript,
      partial: detail.transcript.partial,
      warning: detail.transcript.partial
        ? t(
            '部分的な文字起こしを送信します。完了済みの文字起こしで再実行することを推奨します。',
          )
        : null,
    };
  }

  async generateSummary(meetingId: string, token: string): Promise<GenerateSummaryResult> {
    const preview = this.previewTokens.get(token);
    if (!preview || preview.meetingId !== meetingId) {
      throw new Error(
        t('要約の確認トークンが無効です。もう一度プレビューを開いてください。'),
      );
    }
    if (
      this.active ||
      this.state.stage !== null ||
      this.titleGenerationActive
    ) {
      throw new Error(
        t('別の処理が実行中です。完了してから要約を生成してください。'),
      );
    }
    if (this.now().getTime() > preview.expiresAt) {
      this.previewTokens.delete(token);
      throw new Error(
        t(
          '要約の確認トークンの有効期限が切れました。もう一度プレビューを開いてください。',
        ),
      );
    }
    const detail = await this.meetingStore.detail(meetingId);
    if (!detail?.transcript?.body.trim()) {
      throw new Error(t('文字起こしがありません。'));
    }
    const body = detail.transcript.body.trim();
    if (createHash('sha256').update(body, 'utf8').digest('hex') !== preview.contentHash) {
      this.previewTokens.delete(token);
      throw new Error(
        t('文字起こしが変更されました。もう一度プレビューを開いてください。'),
      );
    }

    const config = {
      profileId: preview.profileId,
      provider: preview.provider,
      baseUrl: preview.baseUrl,
      endpoint: preview.endpoint,
      model: preview.model,
      kind: preview.kind,
      language: preview.language,
    };
    let apiKey: string;
    try {
      apiKey =
        (await this.apiKeyStore.getKey(
          config.profileId,
          config.baseUrl,
          config.provider,
        )) ?? '';
    } catch (error) {
      throw new Error(
        t('API キーを復号できませんでした。設定画面で再入力してください。{detail}', {
          detail:
            error instanceof Error ? ` (${error.message})` : '',
        }),
      );
    }
    if (!apiKey) {
      throw new Error(t('API キーが設定されていません。'));
    }
    if (
      this.active ||
      this.state.stage !== null ||
      this.titleGenerationActive
    ) {
      throw new Error(
        t('別の処理が実行中です。完了してから要約を生成してください。'),
      );
    }
    this.previewTokens.delete(token);

    const controller = new AbortController();
    this.active = { meetingId, controller };
    this.setState({
      stage: 'summarizing',
      meetingId,
      progress: 0,
      etaSeconds: null,
      message: t('要約を生成しています'),
      cancellable: true,
      error: null,
    });
    let metaPath = join(detail.meeting.meetingDir, 'meta.json');
    try {
      const startedAt = this.now().toISOString();
      await updateMeetingMeta(metaPath, (meta) => {
        meta.summary = {
          state: 'running',
          provider: config.provider,
          model: config.model,
          language: config.language,
          generated_at: startedAt,
        };
        meta.status = 'transcribed';
        delete meta.error;
      });

      const generated = await generateSummary({
        client: this.llmClient,
        transcriptBody: body,
        language: config.language,
        kind: config.kind,
        endpoint: config.endpoint,
        apiKey,
        model: config.model,
        signal: controller.signal,
        systemPromptOverride: this.settings().summaryPromptTemplate,
        cleanupFillers: preview.cleanupFillers,
        onProgress: (message, progress) => {
          this.setState({
            ...this.state,
            progress,
            message,
            etaSeconds: null,
          });
        },
      });

      const summaryPath = join(detail.meeting.meetingDir, 'summary.md');
      let extraFields = {};
      if (await exists(summaryPath)) {
        const existing = parseFrontMatter(await readFile(summaryPath, 'utf8'));
        extraFields = existing.frontMatter;
        const previousPath = join(detail.meeting.meetingDir, 'summary.previous.md');
        await writePrivateText(previousPath, await readFile(summaryPath, 'utf8'));
      }
      const summaryMarkdown = formatSummaryMarkdown({
        title: detail.meeting.title,
        date: dateOnly(detail.meeting.startedAt),
        provider: config.provider,
        model: config.model,
        generatedAt: this.now().toISOString(),
        language: config.language,
        body: generated.body,
        extraFields,
      });
      await writePrivateText(summaryPath, summaryMarkdown);
      await updateMeetingMeta(metaPath, (meta) => {
        meta.status = 'summarized';
        delete meta.error;
        meta.summary = {
          state: 'completed',
          provider: config.provider,
          model: config.model,
          language: config.language,
          generated_at: this.now().toISOString(),
          cleanup: {
            state: generated.cleanup.state,
            chunks: generated.cleanup.chunks,
            fallback_chunks: generated.cleanup.fallbackChunks,
            removed_chars: generated.cleanup.removedChars,
            ...(generated.cleanup.error
              ? { error: generated.cleanup.error }
              : {}),
          },
          usage: {
            input_tokens: generated.usage.inputTokens,
            output_tokens: generated.usage.outputTokens,
          },
        };
      });

      let meeting = (await this.meetingStore.find(meetingId)) ?? detail.meeting;
      if (meeting.title === DEFAULT_MEETING_TITLE) {
        this.setState({
          ...this.state,
          stage: 'title',
          progress: null,
          etaSeconds: null,
          message: t('タイトルを生成しています'),
        });
        try {
          meeting = await generateAndSaveMeetingTitle({
            meetingStore: this.meetingStore,
            client: this.llmClient,
            meeting,
            transcriptBody: generated.usedTranscriptBody,
            language: config.language,
            kind: config.kind,
            endpoint: config.endpoint,
            apiKey,
            model: config.model,
            provider: config.provider,
            signal: controller.signal,
            now: this.now,
            usage: generated.usage,
          });
        } catch (error) {
          if (controller.signal.aborted) {
            throw error;
          }
          console.error(
            `failed to generate meeting title: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
      if (meeting.meetingDir !== detail.meeting.meetingDir) {
        metaPath = join(meeting.meetingDir, 'meta.json');
      }
      const summary = await this.meetingStore.readSummary(meeting);
      if (!summary) {
        throw new Error(t('summary.md の読み込みに失敗しました。'));
      }
      this.onMeetingUpdated(meetingId);
      this.setState({ ...IDLE_STATE });
      return {
        meeting,
        summary,
        usage: generated.usage,
        cleanup: generated.cleanup,
      };
    } catch (error) {
      if (controller.signal.aborted) {
        await updateMeetingMeta(metaPath, (meta) => {
          meta.status = 'transcribed';
          meta.summary = {
            ...(meta.summary ?? {}),
            state: 'failed',
            error: 'cancelled',
          };
        }).catch(() => undefined);
        this.setState({ ...IDLE_STATE, error: t('要約をキャンセルしました。') });
        throw new Error(t('要約をキャンセルしました。'));
      }
      const message = summaryErrorMessage(error);
      await updateMeetingMeta(metaPath, (meta) => {
        meta.status = 'error';
        meta.error = message;
        meta.summary = {
          ...(meta.summary ?? {}),
          state: 'failed',
          error: message,
        };
      }).catch(() => undefined);
      this.onMeetingUpdated(meetingId);
      this.setState({ ...IDLE_STATE, error: message });
      throw error;
    } finally {
      this.active = null;
    }
  }

  async generateTitle(
    meetingId: string,
    profileId?: string,
  ): Promise<MeetingSummary> {
    if (this.active || this.state.stage !== null) {
      throw new Error(
        t('別の処理が実行中です。完了してからタイトルを生成してください。'),
      );
    }
    if (this.titleGenerationActive) {
      throw new Error(
        t('タイトルを生成しています。完了してから再実行してください。'),
      );
    }
    this.titleGenerationActive = true;
    try {
      const detail = await this.meetingStore.detail(meetingId);
      if (!detail) {
        throw new Error(t('会議が見つかりません。'));
      }
      if (detail.meeting.title !== DEFAULT_MEETING_TITLE) {
        throw new Error(t('タイトルが既に入力されています。'));
      }
      if (!detail.transcript?.body.trim()) {
        throw new Error(
          t('文字起こしがありません。先に文字起こしを完了してください。'),
        );
      }
      const { config, apiKey } = await this.resolveTitleRuntime(profileId);
      return await generateAndSaveMeetingTitle({
        meetingStore: this.meetingStore,
        client: this.llmClient,
        meeting: detail.meeting,
        transcriptBody: detail.transcript.body,
        language:
          detail.meeting.summaryLanguage ?? this.settings().summaryLanguage,
        kind: config.kind,
        endpoint: config.endpoint,
        apiKey,
        model: config.model,
        provider: config.provider,
        now: this.now,
      });
    } finally {
      this.titleGenerationActive = false;
      this.onMeetingUpdated(meetingId);
    }
  }

  async createTranslationPreview(
    meetingId: string,
    targetLanguage: SummaryLanguage,
    profileId?: string,
  ): Promise<TranslationPreview> {
    const detail = await this.meetingStore.detail(meetingId);
    if (!detail?.transcript?.body.trim()) {
      throw new Error(
        t('文字起こしがありません。先に文字起こしを完了してください。'),
      );
    }
    if (targetLanguage !== 'ja' && targetLanguage !== 'en') {
      throw new Error('translation target is invalid');
    }
    const sourceLanguage = detail.transcript.language ?? 'auto';
    if (
      (targetLanguage === 'ja' && sourceLanguage.startsWith('ja')) ||
      (targetLanguage === 'en' && sourceLanguage.startsWith('en'))
    ) {
      throw new Error(t('原文と同じ言語には翻訳できません。'));
    }
    const config = await this.runtimeConfig(profileId);
    if (!config) {
      throw new Error(
        t(
          'LLM プロファイルが設定されていません。設定画面でプロファイルを追加してください。',
        ),
      );
    }
    if (!config.endpoint) {
      throw new Error(
        t('LLM のエンドポイント URL が正しくありません。設定を確認してください。'),
      );
    }
    if (!config.apiKeyConfigured) {
      throw new Error(
        t('LLM の API キーが設定されていません。設定画面で保存してください。'),
      );
    }
    const transcript = detail.transcript.body.trim();
    const hash = createHash('sha256').update(transcript, 'utf8').digest('hex');
    const token = randomUUID();
    const now = this.now().getTime();
    this.translationTokens.set(token, {
      meetingId,
      profileId: config.id,
      targetLanguage,
      sourceLanguage,
      contentHash: hash,
      expiresAt: now + 5 * 60_000,
      provider: config.provider,
      baseUrl: config.baseUrl,
      endpoint: config.endpoint,
      model: config.model,
      kind: config.kind,
    });
    return {
      token,
      meetingId,
      profileId: config.id,
      targetLanguage,
      sourceLanguage,
      provider: config.provider,
      providerLabel: config.providerLabel,
      model: config.model,
      endpoint: config.endpoint,
      charCount: transcript.length,
      estimatedTokens: estimateTokens(transcript),
      contentHash: hash,
      text: transcript,
      partial: detail.transcript.partial,
      warning: detail.transcript.partial
        ? t(
            '部分的な文字起こしを翻訳します。完了済みの文字起こしで再実行することを推奨します。',
          )
        : null,
    };
  }

  async generateTranslation(
    meetingId: string,
    token: string,
  ): Promise<TranslationResult> {
    const preview = this.translationTokens.get(token);
    if (!preview || preview.meetingId !== meetingId) {
      throw new Error(
        t('翻訳の確認トークンが無効です。もう一度プレビューを開いてください。'),
      );
    }
    if (
      this.active ||
      this.state.stage !== null ||
      this.titleGenerationActive
    ) {
      throw new Error(
        t('別の処理が実行中です。完了してから翻訳を実行してください。'),
      );
    }
    if (this.now().getTime() > preview.expiresAt) {
      this.translationTokens.delete(token);
      throw new Error(
        t(
          '翻訳の確認トークンの有効期限が切れました。もう一度プレビューを開いてください。',
        ),
      );
    }
    const detail = await this.meetingStore.detail(meetingId);
    if (!detail?.transcript?.body.trim()) {
      throw new Error(t('文字起こしがありません。'));
    }
    const body = detail.transcript.body.trim();
    if (
      createHash('sha256').update(body, 'utf8').digest('hex') !==
      preview.contentHash
    ) {
      this.translationTokens.delete(token);
      throw new Error(
        t('文字起こしが変更されました。もう一度プレビューを開いてください。'),
      );
    }
    this.translationTokens.delete(token);

    let apiKey: string;
    try {
      apiKey =
        (await this.apiKeyStore.getKey(
          preview.profileId,
          preview.baseUrl,
          preview.provider,
        )) ?? '';
    } catch (error) {
      throw new Error(
        t('API キーを復号できませんでした。設定画面で再入力してください。{detail}', {
          detail:
            error instanceof Error ? ` (${error.message})` : '',
        }),
      );
    }
    if (!apiKey) {
      throw new Error(t('API キーが設定されていません。'));
    }

    const controller = new AbortController();
    this.active = { meetingId, controller };
    this.setState({
      stage: 'translating',
      meetingId,
      progress: 0,
      etaSeconds: null,
      message: t('翻訳しています'),
      cancellable: true,
      error: null,
    });
    const metaPath = join(detail.meeting.meetingDir, 'meta.json');
    const translationPath = join(
      detail.meeting.meetingDir,
      `transcript.${preview.targetLanguage}.md`,
    );
    try {
      await updateMeetingMeta(metaPath, (meta) => {
        meta.translations = {
          ...(meta.translations ?? {}),
          [preview.targetLanguage]: {
            state: 'running',
            provider: preview.provider,
            model: preview.model,
            language: preview.targetLanguage,
            source_language: preview.sourceLanguage,
            generated_at: this.now().toISOString(),
          },
        };
      });

      const generated = await translateTranscript({
        client: this.llmClient,
        transcriptBody: body,
        sourceLanguage: preview.sourceLanguage,
        targetLanguage: preview.targetLanguage,
        kind: preview.kind,
        endpoint: preview.endpoint,
        apiKey,
        model: preview.model,
        signal: controller.signal,
        onProgress: (message, progress) => {
          this.setState({
            ...this.state,
            progress,
            message,
            etaSeconds: null,
          });
        },
      });

      const currentMeta = await readMeetingMeta(metaPath);
      const markdown = formatTranslationMarkdown({
        title: detail.meeting.title,
        startedAt: detail.meeting.startedAt,
        durationSeconds: detail.meeting.duration,
        source: sourceLabel(currentMeta),
        model: detail.transcript.model ?? this.settings().whisperModel,
        sourceLanguage: preview.sourceLanguage,
        targetLanguage: preview.targetLanguage,
        provider: preview.provider,
        generatedAt: this.now().toISOString(),
        segments: generated.segments,
        partial: generated.partial,
      });

      if (await exists(translationPath)) {
        await writePrivateText(
          `${translationPath.replace(/\.md$/u, '.previous.md')}`,
          await readFile(translationPath, 'utf8'),
        );
      }
      await writePrivateText(translationPath, markdown);
      await updateMeetingMeta(metaPath, (meta) => {
        meta.translations = {
          ...(meta.translations ?? {}),
          [preview.targetLanguage]: {
            state: 'completed',
            provider: preview.provider,
            model: preview.model,
            language: preview.targetLanguage,
            source_language: preview.sourceLanguage,
            generated_at: this.now().toISOString(),
            partial: generated.partial,
          },
        };
      });

      const meeting =
        (await this.meetingStore.find(meetingId)) ?? detail.meeting;
      const translation = await this.meetingStore.readTranslation(
        meeting,
        preview.targetLanguage,
      );
      if (!translation) {
        throw new Error(t('翻訳ファイルの読み込みに失敗しました。'));
      }
      this.onMeetingUpdated(meetingId);
      this.setState({ ...IDLE_STATE });
      return {
        meeting,
        translation,
        usage: generated.usage,
      };
    } catch (error) {
      const message =
        controller.signal.aborted
          ? t('翻訳をキャンセルしました。')
          : error instanceof Error
            ? error.message
            : String(error);
      await updateMeetingMeta(metaPath, (meta) => {
        meta.translations = {
          ...(meta.translations ?? {}),
          [preview.targetLanguage]: {
            ...(meta.translations?.[preview.targetLanguage] ?? {}),
            state: 'failed',
            provider: preview.provider,
            model: preview.model,
            language: preview.targetLanguage,
            source_language: preview.sourceLanguage,
            error: message,
          },
        };
      }).catch(() => undefined);
      this.onMeetingUpdated(meetingId);
      this.setState({ ...IDLE_STATE, error: message });
      throw error;
    } finally {
      this.active = null;
    }
  }

  async saveTranscript(meetingId: string, markdown: string): Promise<MeetingDetail> {
    if (
      this.active ||
      this.state.stage !== null ||
      this.titleGenerationActive
    ) {
      throw new Error(t('処理中は文字起こしを編集できません。'));
    }
    if (markdown.length > 5 * 1024 * 1024) {
      throw new Error(t('文字起こしが大きすぎます。'));
    }
    const meeting = await this.meetingStore.find(meetingId);
    if (!meeting) {
      throw new Error(t('会議が見つかりません。'));
    }
    await writePrivateText(join(meeting.meetingDir, 'transcript.md'), markdown);
    this.onMeetingUpdated(meetingId);
    const detail = await this.meetingStore.detail(meetingId);
    if (!detail) {
      throw new Error(t('会議が見つかりません。'));
    }
    return detail;
  }

  async saveSummary(meetingId: string, markdown: string): Promise<MeetingDetail> {
    if (
      this.active ||
      this.state.stage !== null ||
      this.titleGenerationActive
    ) {
      throw new Error(t('処理中は要約を編集できません。'));
    }
    if (markdown.length > 5 * 1024 * 1024) {
      throw new Error(t('要約が大きすぎます。'));
    }
    const meeting = await this.meetingStore.find(meetingId);
    if (!meeting) {
      throw new Error(t('会議が見つかりません。'));
    }
    await writePrivateText(join(meeting.meetingDir, 'summary.md'), markdown);
    this.onMeetingUpdated(meetingId);
    const detail = await this.meetingStore.detail(meetingId);
    if (!detail) {
      throw new Error(t('会議が見つかりません。'));
    }
    return detail;
  }

  private enqueue(meetingId: string, operation: () => Promise<void>): Promise<void> {
    if (this.shuttingDown) {
      return Promise.reject(new Error('application is shutting down'));
    }
    if (this.queued.has(meetingId)) {
      return Promise.reject(new Error('meeting is already queued'));
    }
    this.queued.add(meetingId);
    const task = this.queue.then(
      () => this.runQueued(meetingId, operation),
      () => this.runQueued(meetingId, operation),
    );
    this.queue = task
      .catch(() => undefined)
      .finally(() => {
        this.queued.delete(meetingId);
      });
    return task;
  }

  private async runQueued(
    meetingId: string,
    operation: () => Promise<void>,
  ): Promise<void> {
    while (
      (this.recordingActive || this.titleGenerationActive) &&
      !this.shuttingDown
    ) {
      await new Promise<void>((resolve) => setTimeout(resolve, 500));
    }
    if (this.shuttingDown) {
      return;
    }
    try {
      await operation();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`processing failed: ${message}`);
      this.setState({ ...IDLE_STATE, error: message });
    } finally {
      this.active = null;
    }
  }

  private async processMeeting(meetingId: string): Promise<void> {
    const meeting = await this.meetingStore.find(meetingId);
    if (!meeting) {
      throw new Error(t('会議が見つかりません。'));
    }
    const metaPath = join(meeting.meetingDir, 'meta.json');
    let meta = await readMeetingMeta(metaPath);
    if (meta.status === 'recording') {
      throw new Error(t('録音中の会議は処理できません。'));
    }
    const controller = new AbortController();
    this.active = { meetingId, controller };
    const tempDir = join(this.tempRoot, meetingId);
    await mkdir(tempDir, { recursive: true, mode: 0o700 });

    const sourceWav = join(meeting.meetingDir, 'audio.wav');
    const mp3Path = join(meeting.meetingDir, 'audio.mp3');
    const transcriptionWav = join(tempDir, 'audio.16k.wav');
    const hasSourceWav = await exists(sourceWav);
    const hasMp3 = await exists(mp3Path);
    if (!hasSourceWav && !hasMp3) {
      throw new Error(t('変換できる音声ファイルがありません。'));
    }
    let duration = meta.duration;
    if (hasSourceWav) {
      try {
        duration = (await readWavInfo(sourceWav)).duration;
      } catch (error) {
        console.error(`failed to read source wav: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    const comparisonRerun = this.comparisonReruns.delete(meetingId);
    const rerunStatus = this.comparisonRerunStatus.get(meetingId) ?? null;
    this.comparisonRerunStatus.delete(meetingId);
    const comparisonRequested = this.settings().enhanceBeforeTranscription;
    const plan =
      typeof this.transcriptionRunner.plan === 'function'
        ? await this.transcriptionRunner.plan({
            durationSeconds: duration,
            preferredAudio: comparisonRequested ? 'enhanced' : 'raw',
          })
        : null;
    if (plan?.failure) {
      const message =
        plan.failure.error ?? t('文字起こしの準備に失敗しました。');
      await updateMeetingMeta(metaPath, (value) => {
        value.status = rerunStatus ?? 'error';
        value.error = message;
      }).catch(() => undefined);
      this.onMeetingUpdated(meetingId);
      this.setState({ ...IDLE_STATE, error: message });
      return;
    }
    const resolvedEngine =
      plan?.resolution.engine ?? this.settings().transcriptionEngine;
    const resolvedModel =
      plan?.resolution.modelLabel ??
      (this.settings().transcriptionEngine === 'openai'
        ? `openai/${this.settings().openaiTranscriptionModel}`
        : this.settings().whisperModel);
    const comparisonEnabled =
      plan !== null &&
      comparisonRequested &&
      plan.resolution.engine === 'whisper-cpp';
    if (comparisonRerun && !comparisonEnabled) {
      throw new Error(t('文字起こし前の強調が OFF のため再実行できません。'));
    }
    const audioHash = hasMp3
      ? await hashFile(mp3Path).catch(() => undefined)
      : undefined;
    await reconcileEnhancement(meeting.meetingDir, {
      audioSha256: audioHash ?? '0'.repeat(64),
      modelSha256: {
        nemotronlabs: getReuseModelDefinition('nemotronlabs').sha256,
      },
      comparisonEnabled,
      transcriptionEngine: resolvedEngine,
    }).catch((error: unknown) => {
      console.error(
        `failed to reconcile speech enhancement: ${error instanceof Error ? error.message : String(error)}`,
      );
    });

    try {
      const startedAt = this.now().toISOString();
      await updateMeetingMeta(metaPath, (value) => {
        value.status = 'encoding';
        value.encoding = {
          state: 'running',
          started_at: startedAt,
          mp3_bitrate_kbps: this.settings().mp3BitrateKbps,
        };
        delete value.error;
      });
      this.onMeetingUpdated(meetingId);

      if (!hasMp3) {
        this.setState({
          stage: 'encoding',
          meetingId,
          progress: 0,
          etaSeconds: null,
          message: t('mp3 に変換しています'),
          cancellable: true,
          error: null,
        });
        await this.mediaEncoder.encodeMp3({
          inputPath: sourceWav,
          outputPath: mp3Path,
          durationSeconds: duration,
          bitrateKbps: this.settings().mp3BitrateKbps,
          signal: controller.signal,
          onProgress: ({ ratio, etaSeconds }) => {
            this.setState({
              ...this.state,
              progress: ratio,
              etaSeconds,
            });
          },
        });
      }

      if (this.settings().enhanceSavedAudio && this.reuseSavedAudio) {
        await updateMeetingMeta(metaPath, (value) => {
          value.status = 'enhancing';
          delete value.error;
        });
        this.setState({
          stage: 'enhancing',
          meetingId,
          progress: 0,
          etaSeconds: null,
          message: t('保存音声を強調しています'),
          cancellable: true,
          error: null,
        });
        try {
          await this.reuseSavedAudio.enhance({
            meetingId,
            meetingDir: meeting.meetingDir,
            audioPath: mp3Path,
            sourceWavPath: hasSourceWav ? sourceWav : null,
            model: 'nemotronlabs',
            bitrateKbps: this.settings().mp3BitrateKbps,
            signal: controller.signal,
            onProgress: (progress) => {
              this.setState({
                ...this.state,
                progress,
              });
            },
          });
        } catch (error) {
          if (controller.signal.aborted) {
            throw error;
          }
          console.error(
            `saved audio enhancement failed: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
        this.onMeetingUpdated(meetingId);
      }

      if (comparisonEnabled && plan) {
        await rm(transcriptionWav, { force: true }).catch(() => undefined);
      }
      if (!(await exists(transcriptionWav))) {
        this.setState({
          ...this.state,
          stage: 'encoding',
          progress: 0,
          message: t('文字起こし用の 16 kHz WAV を生成しています'),
          etaSeconds: null,
        });
        await this.mediaEncoder.createTranscriptionWav({
          inputPath:
            comparisonEnabled || !hasSourceWav ? mp3Path : sourceWav,
          outputPath: transcriptionWav,
          durationSeconds: duration,
          bitrateKbps: this.settings().mp3BitrateKbps,
          signal: controller.signal,
          onProgress: ({ ratio, etaSeconds }) => {
            this.setState({
              ...this.state,
              progress: ratio,
              etaSeconds,
            });
          },
        });
      }

      let waveform: number[] | undefined;
      if (!hasSourceWav || duration <= 0) {
        try {
          duration = (await readWavInfo(transcriptionWav)).duration;
        } catch (error) {
          console.error(
            `failed to read transcription wav duration: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
      if (hasSourceWav) {
        try {
          waveform = (await computeWavWaveform(sourceWav)).peaks;
        } catch (error) {
          console.error(
            `failed to compute waveform: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }

      const enhancedForOpenAi =
        plan?.resolution.engine === 'openai' && comparisonRequested
          ? await this.enhanceTranscriptionWav(
              meetingId,
              tempDir,
              transcriptionWav,
              controller,
            )
          : { outputPath: null, error: null };
      const selectedWav = enhancedForOpenAi.outputPath ?? transcriptionWav;
      if (plan?.resolution.engine === 'openai' && comparisonRequested) {
        await invalidateEnhancement(
          meeting.meetingDir,
          'comparison',
          'OpenAI transcription does not produce a comparison',
        ).catch(() => undefined);
      }
      meta = await updateMeetingMeta(metaPath, (value) => {
        value.status = 'transcribing';
        value.audio_path = 'audio.mp3';
        value.duration = duration;
        value.encoding = {
          ...(value.encoding ?? {
            started_at: startedAt,
            mp3_bitrate_kbps: this.settings().mp3BitrateKbps,
          }),
          state: 'completed',
          finished_at: this.now().toISOString(),
        };
        if (waveform && waveform.length > 0) {
          value.waveform = waveform;
        }
        value.transcription = {
          ...(value.transcription ?? {}),
          state: 'running',
          started_at: this.now().toISOString(),
          engine: resolvedEngine,
          model: resolvedModel,
          partial: false,
          resume_count: 0,
        };
        delete value.error;
      });
      if (hasSourceWav) {
        await rm(sourceWav, { force: true }).catch((error: unknown) => {
          console.error(
            `failed to remove intermediate wav: ${error instanceof Error ? error.message : String(error)}`,
          );
        });
      }
      this.onMeetingUpdated(meetingId);
      if (comparisonEnabled && plan) {
        await this.transcribeComparison(
          meetingId,
          meeting,
          metaPath,
          meta,
          transcriptionWav,
          plan,
          controller,
          comparisonRerun,
          rerunStatus,
        );
      } else {
        await this.transcribe(
          meetingId,
          meeting,
          metaPath,
          meta,
          selectedWav,
          controller,
          plan ?? undefined,
        );
      }
    } catch (error) {
      const message =
        error instanceof MediaError && error.code === 'cancelled'
          ? t('音声の変換をキャンセルしました。')
          : error instanceof MediaError
            ? t('音声の変換に失敗しました。{detail}', { detail: error.message })
            : error instanceof Error
              ? error.message
              : String(error);
      await updateMeetingMeta(metaPath, (value) => {
        value.status = comparisonRerun ? (rerunStatus ?? 'error') : 'error';
        value.error = message;
        if (value.encoding?.state === 'running') {
          value.encoding = {
            ...value.encoding,
            state: 'failed',
            finished_at: this.now().toISOString(),
            error: message,
          };
        }
      }).catch(() => undefined);
      this.onMeetingUpdated(meetingId);
      this.setState({ ...IDLE_STATE, error: message });
      if (error instanceof MediaError && error.code === 'cancelled') {
        return;
      }
      throw error;
    } finally {
      this.active = null;
      await cleanupMeetingTemp(
        this.tempRoot,
        meetingId,
        meeting.meetingDir,
      ).catch((error: unknown) => {
        console.error(
          `failed to clean meeting temp files: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
    }
  }

  private async enhanceSavedAudioOnly(
    meetingId: string,
    model: 'nemotronlabs',
  ): Promise<void> {
    if (!this.reuseSavedAudio) {
      throw new Error('speech enhancement is not available');
    }
    const meeting = await this.meetingStore.find(meetingId);
    if (!meeting) {
      throw new Error(t('会議が見つかりません。'));
    }
    const metaPath = join(meeting.meetingDir, 'meta.json');
    const meta = await readMeetingMeta(metaPath);
    const audioPath = join(meeting.meetingDir, 'audio.mp3');
    if (!(await exists(audioPath))) {
      throw new Error(t('変換できる音声ファイルがありません。'));
    }
    await reconcileEnhancement(meeting.meetingDir, {
      audioSha256: await hashFile(audioPath),
      modelSha256: {
        nemotronlabs: getReuseModelDefinition('nemotronlabs').sha256,
      },
      comparisonEnabled:
        this.settings().enhanceBeforeTranscription &&
        this.settings().transcriptionEngine === 'whisper-cpp',
      transcriptionEngine: this.settings().transcriptionEngine,
    }).catch((error: unknown) => {
      console.error(
        `failed to reconcile speech enhancement: ${error instanceof Error ? error.message : String(error)}`,
      );
    });
    const previousStatus = meta.status;
    const controller = new AbortController();
    this.active = { meetingId, controller };
    this.setState({
      stage: 'enhancing',
      meetingId,
      progress: 0,
      etaSeconds: null,
      message: t('保存音声を強調しています'),
      cancellable: true,
      error: null,
    });
    await updateMeetingMeta(metaPath, (value) => {
      value.status = 'enhancing';
      delete value.error;
    });
    try {
      await this.reuseSavedAudio.enhance({
        meetingId,
        meetingDir: meeting.meetingDir,
        audioPath,
        sourceWavPath: null,
        model,
        bitrateKbps: this.settings().mp3BitrateKbps,
        signal: controller.signal,
        onProgress: (progress) => {
          this.setState({ ...this.state, progress });
        },
      });
      await updateMeetingMeta(metaPath, (value) => {
        if (value.status === 'enhancing') {
          value.status =
            previousStatus === 'enhancing' ? 'transcribed' : previousStatus;
        }
      }).catch(() => undefined);
      this.onMeetingUpdated(meetingId);
    } catch (error) {
      await updateMeetingMeta(metaPath, (value) => {
        if (value.status === 'enhancing') {
          value.status =
            previousStatus === 'enhancing' ? 'transcribed' : previousStatus;
        }
      }).catch(() => undefined);
      this.onMeetingUpdated(meetingId);
      throw error;
    } finally {
      this.active = null;
      this.setState({ ...IDLE_STATE });
    }
  }

  private async enhanceTranscriptionWav(
    _meetingId: string,
    tempDir: string,
    transcriptionWav: string,
    controller: AbortController,
  ): Promise<{ outputPath: string | null; error: string | null }> {
    if (!this.reuseEnhancement) {
      return { outputPath: null, error: null };
    }
    const outputPath = join(tempDir, 'audio.16k.enhanced.wav');
    this.setState({
      stage: 'enhancing',
      meetingId: _meetingId,
      progress: 0,
      etaSeconds: null,
      message: t('文字起こし前の音声を強調しています'),
      cancellable: true,
      error: null,
    });
    try {
      await this.reuseEnhancement.enhance({
        inputPath: transcriptionWav,
        outputPath,
        model: 'nemotronlabs',
        signal: controller.signal,
        onProgress: (progress) => {
          this.setState({ ...this.state, progress });
        },
      });
      return { outputPath, error: null };
    } catch (error) {
      if (controller.signal.aborted) {
        throw error;
      }
      const message = error instanceof Error ? error.message : String(error);
      console.error(`pre-transcription enhancement failed: ${message}`);
      await rm(outputPath, { force: true }).catch(() => undefined);
      return { outputPath: null, error: message };
    }
  }

  private async runComparisonSnapshot(options: {
    meetingId: string;
    tempDir: string;
    audioWavPath: string;
    durationSeconds: number;
    plan: TranscriptionPlan;
    controller: AbortController;
    label: string;
    progressStart: number;
    progressSpan: number;
  }): Promise<TranscriptionOutcome> {
    const run = await this.transcriptionRunner.run(
      {
        meetingId: options.meetingId,
        tempDir: options.tempDir,
        audioWavPath: options.audioWavPath,
        durationSeconds: options.durationSeconds,
        signal: options.controller.signal,
        preferredAudio: 'raw',
        onUpdate: (progress) => {
          this.setState({
            ...this.state,
            stage: 'transcribing',
            progress: options.progressStart + progress.ratio * options.progressSpan,
            etaSeconds: progress.etaSeconds,
            message: progress.message ?? options.label,
          });
        },
      },
      options.plan,
    );
    return run.outcome;
  }

  private async transcribeComparison(
    meetingId: string,
    meeting: NonNullable<Awaited<ReturnType<MeetingStore['find']>>>,
    metaPath: string,
    meta: MeetingMeta,
    transcriptionWav: string,
    plan: TranscriptionPlan,
    controller: AbortController,
    rerun: boolean,
    rerunStatus: MeetingStatus | null,
  ): Promise<void> {
    const tempDir = dirname(transcriptionWav);
    const startedAt = this.now().toISOString();
    const audioHash = await hashFile(join(meeting.meetingDir, 'audio.mp3')).catch(
      () => undefined,
    );
    const sourceInputSha = await hashFile(transcriptionWav).catch(() => '');
    if (rerun) {
      const existing = await readEnhancementFile(meeting.meetingDir);
      if (
        existing.state === 'ok' &&
        existing.file.transcription.source_input_sha256 !== null &&
        existing.file.transcription.source_input_sha256 !== sourceInputSha
      ) {
        await invalidateEnhancement(
          meeting.meetingDir,
          'comparison',
          'the comparison input changed',
        ).catch(() => undefined);
      }
    }
    if (!rerun) {
      await invalidateEnhancement(
        meeting.meetingDir,
        'comparison',
        'a new comparison session started',
      ).catch(() => undefined);
    }

    const raw = await this.runComparisonSnapshot({
      meetingId,
      tempDir,
      audioWavPath: transcriptionWav,
      durationSeconds: meta.duration,
      plan,
      controller,
      label: t('生の音声で文字起こししています'),
      progressStart: 0,
      progressSpan: 0.4,
    });
    const enhancedWav = join(tempDir, 'audio.16k.enhanced.wav');
    let enhanced: TranscriptionOutcome | null = null;
    const enhancement = await this.enhanceTranscriptionWav(
      meetingId,
      tempDir,
      transcriptionWav,
      controller,
    );
    if (enhancement.outputPath) {
      enhanced = await this.runComparisonSnapshot({
        meetingId,
        tempDir,
        audioWavPath: enhancement.outputPath,
        durationSeconds: meta.duration,
        plan,
        controller,
        label: t('強調した音声で文字起こししています'),
        progressStart: 0.6,
        progressSpan: 0.4,
      });
    }

    const rawCompleted = raw.state === 'completed';
    const enhancedCompleted = enhanced?.state === 'completed';
    const bothCompleted = rawCompleted && enhancedCompleted;
    const primary: {
      outcome: TranscriptionOutcome;
      wavPath: string;
      enhanced: boolean;
    } | null =
      enhancedCompleted && enhanced
        ? { outcome: enhanced, wavPath: enhancedWav, enhanced: true }
        : rawCompleted
          ? { outcome: raw, wavPath: transcriptionWav, enhanced: false }
          : null;
    const partial =
      enhanced && enhanced.segments.length > 0 ? enhanced : raw;
    const primarySegments = primary
      ? primary.outcome.segments
      : partial.segments;
    if (rerun && (!bothCompleted || primary === null)) {
      const message = transcriptionErrorMessage(partial);
      await updateMeetingMeta(metaPath, (value) => {
        value.status = rerunStatus ?? 'error';
        value.error = message;
      }).catch(() => undefined);
      await rm(enhancedWav, { force: true }).catch(() => undefined);
      this.onMeetingUpdated(meetingId);
      this.setState({ ...IDLE_STATE, error: message });
      return;
    }

    const diarization = primary
      ? await this.diarizeOutcome({
          meeting,
          wavPath: primary.wavPath,
          segments: primarySegments,
          controller,
          audioSha256: audioHash,
          inputKind: primary.enhanced ? 'enhanced:nemotronlabs' : 'raw',
          enhancementModelSha256: primary.enhanced
            ? getReuseModelDefinition('nemotronlabs').sha256
            : null,
          enhancementSettings: primary.enhanced
            ? { chunk_seconds: 5, hop_seconds: 2.5, crossfade_seconds: 0.5 }
            : null,
        })
      : null;
    const finalSegments = diarization?.segments ?? primarySegments;
    const finishedAt = this.now().toISOString();
    const rawMarkdown = rawCompleted
      ? formatTranscriptMarkdown({
          title: meeting.title,
          startedAt: meta.started_at,
          durationSeconds: raw.durationSeconds,
          source: sourceLabel(meta),
          model: plan.resolution.modelLabel,
          language: raw.language,
          segments: raw.segments,
        })
      : null;
    const enhancedMarkdown = enhancedCompleted && enhanced
      ? formatTranscriptMarkdown({
          title: meeting.title,
          startedAt: meta.started_at,
          durationSeconds: enhanced.durationSeconds,
          source: sourceLabel(meta),
          model: plan.resolution.modelLabel,
          language: enhanced.language,
          segments: enhanced.segments,
        })
      : null;
    const primaryMarkdown = primary
      ? formatTranscriptMarkdown({
          title: meeting.title,
          startedAt: meta.started_at,
          durationSeconds: primary.outcome.durationSeconds,
          source: sourceLabel(meta),
          model: plan.resolution.modelLabel,
          language: primary.outcome.language,
          segments: finalSegments,
        })
      : !rerun && finalSegments.length > 0
        ? formatTranscriptMarkdown({
            title: meeting.title,
            startedAt: meta.started_at,
            durationSeconds: partial.durationSeconds,
            source: sourceLabel(meta),
            model: plan.resolution.modelLabel,
            language: partial.language,
            segments: finalSegments,
            partial: true,
          })
        : null;

    const target = (name: string) =>
      rerun ? join(tempDir, name) : join(meeting.meetingDir, name);
    if (rawMarkdown) {
      await writePrivateText(target('transcript.raw.md'), rawMarkdown);
    }
    if (enhancedMarkdown) {
      await writePrivateText(target('transcript.nemotronlabs.md'), enhancedMarkdown);
    }
    if (primaryMarkdown) {
      await writePrivateText(target('transcript.md'), primaryMarkdown);
    }
    if (rerun && bothCompleted) {
      await rename(
        join(tempDir, 'transcript.raw.md'),
        join(meeting.meetingDir, 'transcript.raw.md'),
      );
      await rename(
        join(tempDir, 'transcript.nemotronlabs.md'),
        join(meeting.meetingDir, 'transcript.nemotronlabs.md'),
      );
      await rename(
        join(tempDir, 'transcript.md'),
        join(meeting.meetingDir, 'transcript.md'),
      );
    }

    if (diarization?.cache) {
      try {
        await writeDiarizationCache(diarization.cachePath, diarization.cache);
      } catch (error) {
        console.error(
          `failed to save speaker diarization cache: ${error instanceof Error ? error.message : String(error)}`,
        );
        await rm(diarization.cachePath, { force: true }).catch(() => undefined);
      }
    }
    const speakerNames = [
      ...new Set(
        finalSegments
          .map((segment) => segment.speaker)
          .filter(
            (speaker): speaker is string =>
              typeof speaker === 'string' && speaker.length > 0,
          ),
      ),
    ];
    const primaryState = primary?.outcome.state ?? partial.state;
    const message = primary ? null : transcriptionErrorMessage(partial);
    await updateMeetingMeta(metaPath, (value) => {
      value.status = primary ? 'transcribed' : 'error';
      value.transcription = {
        state: primaryState,
        started_at: value.transcription?.started_at ?? startedAt,
        finished_at: finishedAt,
        engine: 'whisper-cpp',
        model: plan.resolution.modelLabel,
        language: primary?.outcome.language ?? partial.language,
        last_segment_end:
          primary?.outcome.lastEndSeconds ?? partial.lastEndSeconds,
        resume_count: 0,
        partial: primary === null,
        error: message ?? undefined,
      };
      if (diarization?.meta) {
        value.diarization = diarization.meta;
      } else {
        clearDiarization(value);
      }
      if (speakerNames.length > 0) {
        value.speakers = speakerNames;
      } else {
        delete value.speakers;
      }
      if (message) {
        value.error = message;
      } else {
        delete value.error;
      }
    });

    const source = {
      path: 'audio.mp3',
      sha256: audioHash ?? '0'.repeat(64),
      sample_rate: 44_100,
      channels: 1,
    };
    const read = await readEnhancementFile(meeting.meetingDir);
    const file: EnhancementFile =
      read.state === 'ok'
        ? read.file
        : {
            schema_version: 1,
            source,
            saved_audio: {},
            transcription: {
              source_input_sha256: sourceInputSha,
              raw: {
                state: 'pending',
                path: null,
                input_sha256: sourceInputSha,
                output_sha256: null,
                model: plan.resolution.modelLabel,
                model_sha256: null,
                settings: {
                  engine: 'whisper-cpp',
                  whisper_model: plan.resolution.modelLabel,
                  chunk_seconds: null,
                  hop_seconds: null,
                  crossfade_seconds: null,
                },
                chars: null,
                started_at: startedAt,
                finished_at: finishedAt,
                elapsed_seconds: null,
                error: null,
              },
              models: {},
              primary: { source: 'raw', path: null },
            },
          };
    file.source = source;
    file.transcription.source_input_sha256 = sourceInputSha;
    const entry = (
      outcome: TranscriptionOutcome | null,
      markdown: string | null,
      path: string | null,
      enhanced: boolean,
    ): EnhancementTranscriptionEntry => ({
      state:
        outcome?.state === 'completed'
          ? 'succeeded'
          : outcome?.state === 'partial'
            ? 'running'
            : outcome?.state === 'cancelled'
              ? 'cancelled'
              : outcome?.state === 'failed'
                ? 'failed'
                : 'pending',
      path: markdown ? path : null,
      input_sha256: sourceInputSha,
      output_sha256: markdown
        ? createHash('sha256').update(markdown).digest('hex')
        : null,
      model: plan.resolution.modelLabel,
      model_sha256: enhanced
        ? getReuseModelDefinition('nemotronlabs').sha256
        : null,
      settings: {
        engine: 'whisper-cpp' as const,
        whisper_model: plan.resolution.modelLabel,
        chunk_seconds: enhanced ? 5 : null,
        hop_seconds: enhanced ? 2.5 : null,
        crossfade_seconds: enhanced ? 0.5 : null,
      },
      chars: markdown ? parseFrontMatter(markdown).body.length : null,
      started_at: startedAt,
      finished_at: finishedAt,
      elapsed_seconds: outcome?.elapsedSeconds ?? null,
      error: outcome?.error ?? null,
    });
    file.transcription.raw = entry(raw, rawMarkdown, 'transcript.raw.md', false);
    if (enhanced) {
      file.transcription.models.nemotronlabs = entry(
        enhanced,
        enhancedMarkdown,
        'transcript.nemotronlabs.md',
        true,
      );
    } else if (enhancement.error) {
      file.transcription.models.nemotronlabs = {
        state: 'failed',
        path: null,
        input_sha256: sourceInputSha,
        output_sha256: null,
        model: plan.resolution.modelLabel,
        model_sha256: getReuseModelDefinition('nemotronlabs').sha256,
        settings: {
          engine: 'whisper-cpp' as const,
          whisper_model: plan.resolution.modelLabel,
          chunk_seconds: 5,
          hop_seconds: 2.5,
          crossfade_seconds: 0.5,
        },
        chars: null,
        started_at: startedAt,
        finished_at: finishedAt,
        elapsed_seconds: null,
        error: enhancement.error,
      };
    } else {
      delete file.transcription.models.nemotronlabs;
    }
    file.transcription.primary = {
      source: primary?.enhanced ? 'nemotronlabs' : 'raw',
      path: primaryMarkdown ? 'transcript.md' : null,
    };
    await writeEnhancementFile(meeting.meetingDir, file);
    await updateMeetingMeta(metaPath, (value) => {
      updateMetaEnhancement(value, file);
    }).catch(() => undefined);
    await rm(enhancedWav, { force: true }).catch(() => undefined);
    this.onMeetingUpdated(meetingId);
    this.setState({ ...IDLE_STATE, error: primary ? null : message });
  }

  private async diarizeOutcome(options: {
    meeting: NonNullable<Awaited<ReturnType<MeetingStore['find']>>>;
    wavPath: string;
    segments: TranscriptSegment[];
    controller: AbortController;
    audioSha256?: string;
    inputKind?: DiarizationInputKind;
    enhancementModelSha256?: string | null;
    enhancementSettings?: EnhancementSettings | null;
  }): Promise<{
    segments: TranscriptSegment[];
    meta: MeetingMetaDiarization | undefined;
    cache: DiarizationCache | null;
    cachePath: string;
  }> {
    const cachePath = diarizationCachePath(options.meeting.meetingDir);
    const currentSettings = this.settings();
    if (!currentSettings.speakerDiarization) {
      return {
        segments: options.segments,
        meta: undefined,
        cache: null,
        cachePath,
      };
    }
    const audioPath = join(options.meeting.meetingDir, 'audio.mp3');
    let audioSha256 = options.audioSha256;
    if (!audioSha256) {
      try {
        audioSha256 = await hashFile(audioPath);
      } catch (error) {
        console.error(
          `failed to hash meeting audio: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    const previousCache = await readDiarizationCache(cachePath);
    const diarization = await runDiarization({
      service: this.diarizationService,
      wavPath: options.wavPath,
      segments: options.segments,
      numSpeakers: currentSettings.speakerCount,
      signal: options.controller.signal,
      cache: previousCache,
      audioSha256,
      inputKind: options.inputKind,
      enhancementModelSha256: options.enhancementModelSha256,
      enhancementSettings: options.enhancementSettings,
      onProgress: (progress) => {
        const percent =
          progress.progress === null
            ? ''
            : ` (${Math.round(progress.progress * 100)}%)`;
        this.setState({
          ...this.state,
          progress: 1,
          etaSeconds: null,
          message:
            progress.phase === 'models'
              ? t('話者分離モデルを準備しています{suffix}', {
                  suffix: percent,
                })
              : t('話者を分離しています{suffix}', { suffix: percent }),
        });
      },
    });
    if (diarization.cacheHit && previousCache && diarization.cache) {
      try {
        await rewriteTranslationSpeakers(
          options.meeting.meetingDir,
          previousCache,
          diarization.cache,
        );
      } catch (error) {
        console.error(
          `failed to update translation speaker labels: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    return {
      segments: diarization.segments,
      meta: diarization.meta,
      cache: diarization.cache,
      cachePath,
    };
  }

  private async transcribe(
    meetingId: string,
    meeting: NonNullable<Awaited<ReturnType<MeetingStore['find']>>>,
    metaPath: string,
    meta: MeetingMeta,
    transcriptionWav: string,
    controller: AbortController,
    plan?: TranscriptionPlan,
  ): Promise<void> {
    const settings = this.settings();
    let transcriptionEngine = settings.transcriptionEngine;
    let transcriptionModel =
      transcriptionEngine === 'openai'
        ? `openai/${settings.openaiTranscriptionModel}`
        : settings.whisperModel;

    this.setState({
      stage: 'transcribing',
      meetingId,
      progress: 0,
      etaSeconds: null,
      message: t('文字起こしをしています'),
      cancellable: true,
      error: null,
    });

    let lastPartialAt = 0;
    let lastLanguage = meta.transcription?.language ?? 'auto';
    let lastSegments: TranscriptSegment[] = [];
    let partialQueue: Promise<void> = Promise.resolve();
    const persistPartial = async (
      segments: TranscriptSegment[],
      language: string,
      partial: boolean,
      outcome?: TranscriptionOutcome,
    ) => {
      if (segments.length === 0) {
        return;
      }
      const now = this.now().getTime();
      if (!outcome && now - lastPartialAt < 5000) {
        return;
      }
      lastPartialAt = now;
      const markdown = formatTranscriptMarkdown({
        title: meeting.title,
        startedAt: meta.started_at,
        durationSeconds: meta.duration,
        source: sourceLabel(meta),
        model: transcriptionModel,
        language,
        segments,
        partial,
      });
      await writePrivateText(join(meeting.meetingDir, 'transcript.md'), markdown);
      await updateMeetingMeta(metaPath, (value) => {
        clearDiarization(value);
        value.transcription = {
          ...(value.transcription ?? {}),
          state: partial ? 'partial' : 'running',
          engine: transcriptionEngine,
          model: transcriptionModel,
          language,
          partial,
          last_segment_end: segments.reduce(
            (maximum, segment) =>
              Math.max(maximum, segment.endSeconds ?? segment.startSeconds),
            0,
          ),
        };
      });
      this.onMeetingUpdated(meetingId);
    };
    const queuePartial = (
      segments: TranscriptSegment[],
      language: string,
      partial: boolean,
      outcome?: TranscriptionOutcome,
    ): Promise<void> => {
      partialQueue = partialQueue
        .then(() => persistPartial(segments, language, partial, outcome))
        .catch((error: unknown) => {
          console.error(
            `failed to persist partial transcript: ${error instanceof Error ? error.message : String(error)}`,
          );
        });
      return partialQueue;
    };

    let outcome: TranscriptionOutcome | null = null;
    try {
      const run = await this.transcriptionRunner.run(
        {
          meetingId,
          tempDir: dirname(transcriptionWav),
          audioWavPath: transcriptionWav,
          durationSeconds: meta.duration,
          signal: controller.signal,
          preferredAudio: this.settings().enhanceBeforeTranscription
            ? 'enhanced'
            : 'raw',
        onHardLimitExceeded: async (elapsedSeconds, predictedSeconds) => {
          if (!this.confirmContinue) {
            return true;
          }
          return this.confirmContinue(
            t('文字起こしに予想以上の時間がかかっています。'),
            t('経過 {elapsed} 分、予想 {predicted} 分を超えました。処理を続けますか？', {
              elapsed: Math.round(elapsedSeconds / 60),
              predicted: Math.round(predictedSeconds / 60),
            }),
          );
        },
        onUpdate: (progress) => {
          lastLanguage = progress.language || lastLanguage;
          lastSegments = progress.segments;
          this.setState({
            ...this.state,
            progress: progress.ratio,
            etaSeconds: progress.etaSeconds,
            message: progress.message ?? t('文字起こしをしています'),
          });
          void queuePartial(progress.segments, progress.language, true);
        },
        onPartial: async (partial) => {
          await queuePartial(
            partial.segments,
            partial.language,
            true,
            partial,
          );
        },
        onResolved: (resolution) => {
          transcriptionEngine = resolution.engine;
          transcriptionModel = resolution.modelLabel;
          partialQueue = partialQueue
            .then(async () => {
              await updateMeetingMeta(metaPath, (value) => {
                value.transcription = {
                  ...(value.transcription ?? {}),
                  state: value.transcription?.state ?? 'running',
                  engine: resolution.engine,
                  model: resolution.modelLabel,
                };
              });
            })
            .catch((error: unknown) => {
              console.error(
                `failed to save the transcription engine: ${error instanceof Error ? error.message : String(error)}`,
              );
            });
          if (resolution.fallbackReason === 'cloud-declined') {
            this.setState({
              ...this.state,
              message: t(
                'OpenAI への送信を取りやめ、ローカルの whisper で文字起こしをしています。',
              ),
            });
          }
        },
      },
      plan,
      );
      outcome = run.outcome;
      transcriptionEngine = run.resolution.engine;
      transcriptionModel = run.resolution.modelLabel;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await updateMeetingMeta(metaPath, (value) => {
        value.status = 'error';
        value.error = message;
        clearDiarization(value);
        value.transcription = {
          ...(value.transcription ?? {}),
          state: 'failed',
          error: message,
        };
      });
      this.onMeetingUpdated(meetingId);
      this.setState({ ...IDLE_STATE, error: message });
      return;
    }

    const finishedAt = this.now().toISOString();
    if (outcome.state === 'completed') {
      await partialQueue;
      if (
        transcriptionEngine === 'whisper-cpp' &&
        outcome.durationSeconds > 0 &&
        outcome.elapsedSeconds > 0
      ) {
        const ratio = outcome.elapsedSeconds / outcome.durationSeconds;
        if (Number.isFinite(ratio) && ratio >= 0.01 && ratio <= 10) {
          try {
            await this.onSpeedRatioMeasured?.(
              this.settings().whisperModel,
              Math.round(ratio * 1000) / 1000,
            );
          } catch (error) {
            console.error(
              `failed to save transcription speed ratio: ${error instanceof Error ? error.message : String(error)}`,
            );
          }
        }
      }
      const diarization = await this.diarizeOutcome({
        meeting,
        wavPath: transcriptionWav,
        segments: outcome.segments,
        controller,
      });
      const finalSegments = diarization.segments;
      const diarizationMeta = diarization.meta;
      const diarizationCache = diarization.cache;
      const cachePath = diarization.cachePath;
      const speakerNames = [
        ...new Set(
          finalSegments
            .map((segment) => segment.speaker)
            .filter(
              (speaker): speaker is string =>
                typeof speaker === 'string' && speaker.length > 0,
            ),
        ),
      ];
      const markdown = formatTranscriptMarkdown({
        title: meeting.title,
        startedAt: meta.started_at,
        durationSeconds: outcome.durationSeconds,
        source: sourceLabel(meta),
        model: transcriptionModel,
        language: outcome.language,
        segments: finalSegments,
      });
      await writePrivateText(join(meeting.meetingDir, 'transcript.md'), markdown);
      if (diarizationCache) {
        try {
          await writeDiarizationCache(cachePath, diarizationCache);
        } catch (error) {
          console.error(
            `failed to save speaker diarization cache: ${error instanceof Error ? error.message : String(error)}`,
          );
          await rm(cachePath, { force: true }).catch(() => undefined);
        }
      }
      await updateMeetingMeta(metaPath, (value) => {
        value.status = 'transcribed';
        value.transcription = {
          state: 'completed',
          started_at: value.transcription?.started_at ?? finishedAt,
          finished_at: finishedAt,
          engine: transcriptionEngine,
          model: transcriptionModel,
          language: outcome.language,
          last_segment_end: outcome.lastEndSeconds,
          resume_count: outcome.resumed ? 1 : 0,
          partial: false,
        };
        if (diarizationMeta) {
          value.diarization = diarizationMeta;
        } else {
          delete value.diarization;
        }
        if (speakerNames.length > 0) {
          value.speakers = speakerNames;
        } else {
          delete value.speakers;
        }
        delete value.error;
      });
      await rm(dirname(transcriptionWav), { recursive: true, force: true }).catch(
        () => undefined,
      );
      this.onMeetingUpdated(meetingId);
      this.setState({ ...IDLE_STATE });
      return;
    }

    const message = transcriptionErrorMessage(outcome);
    const state =
      outcome.state === 'cancelled'
        ? 'cancelled'
        : outcome.state === 'failed'
          ? 'failed'
          : 'partial';
    await partialQueue;
    const finalSegments =
      outcome.segments.length > 0 ? outcome.segments : lastSegments;
    if (finalSegments.length > 0) {
      await queuePartial(
        finalSegments,
        outcome.language || lastLanguage,
        true,
        outcome,
      );
    }
    await updateMeetingMeta(metaPath, (value) => {
      value.status = 'error';
      value.error = message;
      clearDiarization(value);
      value.transcription = {
        ...(value.transcription ?? {}),
        state,
        finished_at: finishedAt,
        engine: transcriptionEngine,
        model: transcriptionModel,
        language: outcome.language || lastLanguage,
        partial: finalSegments.length > 0,
        error: outcome.error ?? message,
      };
    });
    this.onMeetingUpdated(meetingId);
    this.setState({ ...IDLE_STATE, error: message });
  }

  private setState(state: ProcessingState): void {
    this.state = {
      ...state,
      progress:
        state.progress === null || !Number.isFinite(state.progress)
          ? null
          : Math.max(0, Math.min(1, state.progress)),
      etaSeconds:
        state.etaSeconds === null || !Number.isFinite(state.etaSeconds)
          ? null
          : Math.max(0, Math.round(state.etaSeconds)),
    };
    this.onStateChange({ ...this.state });
  }
}
