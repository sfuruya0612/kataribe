import {
  buildOpenAiTranscriptionEndpoint,
  estimateOpenAiChunkCount,
} from '../shared/openai-transcription';
import { findLlmProfile } from '../shared/llm';
import type {
  AppSettings,
  OpenAiTranscriptionModel,
  TranscriptionEngine,
  WhisperModel,
} from '../shared/types';
import type { ApiKeyStore } from './api-keys';
import { t } from './i18n';
import type { ModelManager } from './models';
import type { OpenAiTranscriptionService } from './openai-transcription';
import type {
  TranscribeOptions,
  TranscriptionErrorCode,
  TranscriptionOutcome,
  TranscriptionProgress,
  TranscriptionService,
} from './transcription';

export type CloudTranscriptionConfirmation = {
  host: string;
  model: string;
  durationSeconds: number;
  chunkCount: number;
  audioVariant: 'raw' | 'enhanced';
};

export type TranscriptionPlan = {
  resolution: TranscriptionResolution;
  failure: TranscriptionOutcome | null;
  localModel: WhisperModel | null;
  localModelPath: string | null;
  openAiModel: OpenAiTranscriptionModel | null;
  openAiEndpoint: string | null;
  openAiApiKey: string | null;
};

export type TranscriptionResolution = {
  engine: TranscriptionEngine;
  modelLabel: string;
  fallbackReason: 'cloud-declined' | null;
};

export type TranscriptionRunnerOptions = {
  settings: () => AppSettings;
  apiKeyStore: Pick<ApiKeyStore, 'getKey'>;
  modelManager: Pick<ModelManager, 'installedPath'>;
  localService: Pick<TranscriptionService, 'transcribe'>;
  openAiService: Pick<OpenAiTranscriptionService, 'transcribe'>;
  confirmCloudTranscription?: (
    details: CloudTranscriptionConfirmation,
  ) => Promise<boolean>;
};

export type TranscriptionRunOptions = {
  meetingId: string;
  tempDir: string;
  audioWavPath: string;
  durationSeconds: number;
  signal: AbortSignal;
  onUpdate?: (progress: TranscriptionProgress) => void;
  onPartial?: (outcome: TranscriptionOutcome) => void | Promise<void>;
  onHardLimitExceeded?: TranscribeOptions['onHardLimitExceeded'];
  onResolved?: (resolution: TranscriptionResolution) => void;
  preferredAudio?: 'raw' | 'enhanced';
};

export type TranscriptionRunResult = {
  outcome: TranscriptionOutcome;
  resolution: TranscriptionResolution;
};

type LocalResolution = {
  kind: 'local';
  model: WhisperModel;
  modelPath: string;
  modelLabel: string;
  fallbackReason: 'cloud-declined' | null;
};

type OpenAiResolution = {
  kind: 'openai';
  model: OpenAiTranscriptionModel;
  endpoint: string;
  apiKey: string;
  modelLabel: string;
};

type ResolutionFailure = {
  kind: 'failure';
  outcome: TranscriptionOutcome;
  resolution: TranscriptionResolution;
};

type Resolution = LocalResolution | OpenAiResolution | ResolutionFailure;

function failedOutcome(
  durationSeconds: number,
  errorCode: TranscriptionErrorCode,
  error: string,
): TranscriptionOutcome {
  return {
    state: 'failed',
    segments: [],
    language: 'auto',
    lastEndSeconds: 0,
    durationSeconds,
    elapsedSeconds: 0,
    errorCode,
    error,
    resumed: false,
  };
}

function openAiModelLabel(model: OpenAiTranscriptionModel): string {
  return `openai/${model}`;
}

function endpointHost(baseUrl: string): string {
  try {
    return new URL(baseUrl).host;
  } catch {
    return '';
  }
}

/**
 * 設定から文字起こしエンジンを解決し、ローカルまたは OpenAI で文字起こしを実行する。
 */
export class TranscriptionRunner {
  private readonly settings: () => AppSettings;
  private readonly apiKeyStore: Pick<ApiKeyStore, 'getKey'>;
  private readonly modelManager: Pick<ModelManager, 'installedPath'>;
  private readonly localService: Pick<TranscriptionService, 'transcribe'>;
  private readonly openAiService: Pick<OpenAiTranscriptionService, 'transcribe'>;
  private readonly confirmCloudTranscription?: TranscriptionRunnerOptions['confirmCloudTranscription'];

  constructor(options: TranscriptionRunnerOptions) {
    this.settings = options.settings;
    this.apiKeyStore = options.apiKeyStore;
    this.modelManager = options.modelManager;
    this.localService = options.localService;
    this.openAiService = options.openAiService;
    this.confirmCloudTranscription = options.confirmCloudTranscription;
  }

  async plan(options: {
    durationSeconds: number;
    preferredAudio?: 'raw' | 'enhanced';
  }): Promise<TranscriptionPlan> {
    const resolution = await this.resolve(options);
    if (resolution.kind === 'failure') {
      return {
        resolution: resolution.resolution,
        failure: resolution.outcome,
        localModel: null,
        localModelPath: null,
        openAiModel: null,
        openAiEndpoint: null,
        openAiApiKey: null,
      };
    }
    return {
      resolution: {
        engine: resolution.kind === 'openai' ? 'openai' : 'whisper-cpp',
        modelLabel: resolution.modelLabel,
        fallbackReason:
          resolution.kind === 'local' ? resolution.fallbackReason : null,
      },
      failure: null,
      localModel: resolution.kind === 'local' ? resolution.model : null,
      localModelPath: resolution.kind === 'local' ? resolution.modelPath : null,
      openAiModel: resolution.kind === 'openai' ? resolution.model : null,
      openAiEndpoint:
        resolution.kind === 'openai' ? resolution.endpoint : null,
      openAiApiKey: resolution.kind === 'openai' ? resolution.apiKey : null,
    };
  }

  async run(
    options: TranscriptionRunOptions,
    existingPlan?: TranscriptionPlan,
  ): Promise<TranscriptionRunResult> {
    const plan =
      existingPlan ??
      (await this.plan({
        durationSeconds: options.durationSeconds,
        preferredAudio: options.preferredAudio,
      }));
    options.onResolved?.(plan.resolution);
    if (plan.failure) {
      return { outcome: plan.failure, resolution: plan.resolution };
    }

    if (plan.openAiModel && plan.openAiEndpoint && plan.openAiApiKey) {
      const outcome = await this.openAiService.transcribe({
        audioWavPath: options.audioWavPath,
        tempDir: options.tempDir,
        durationSeconds: options.durationSeconds,
        model: plan.openAiModel,
        endpoint: plan.openAiEndpoint,
        apiKey: plan.openAiApiKey,
        initialPrompt: this.settings().whisperInitialPrompt,
        signal: options.signal,
        onUpdate: options.onUpdate,
        onPartial: options.onPartial,
      });
      return { outcome, resolution: plan.resolution };
    }

    if (!plan.localModel || !plan.localModelPath) {
      throw new Error('transcription plan has no engine');
    }
    const settings = this.settings();
    const outcome = await this.localService.transcribe({
      meetingId: options.meetingId,
      tempDir: options.tempDir,
      audioWavPath: options.audioWavPath,
      model: plan.localModel,
      modelPath: plan.localModelPath,
      durationSeconds: options.durationSeconds,
      predictedSpeedRatio:
        settings.whisperSpeedRatios[plan.localModel] ?? 0.2,
      initialPrompt: settings.whisperInitialPrompt,
      signal: options.signal,
      onUpdate: options.onUpdate,
      onPartial: options.onPartial,
      onHardLimitExceeded: options.onHardLimitExceeded,
    });
    return { outcome, resolution: plan.resolution };
  }

  private async resolve(options: {
    durationSeconds: number;
    preferredAudio?: 'raw' | 'enhanced';
  }): Promise<Resolution> {
    const settings = this.settings();
    if (settings.transcriptionEngine === 'openai') {
      return this.resolveOpenAi(settings, options);
    }
    return this.resolveLocal(settings, options.durationSeconds, null);
  }

  private async resolveOpenAi(
    settings: AppSettings,
    options: {
      durationSeconds: number;
      preferredAudio?: 'raw' | 'enhanced';
    },
  ): Promise<Resolution> {
    const profile = findLlmProfile(settings, settings.openaiTranscriptionProfileId);
    if (!profile || profile.provider !== 'chatgpt') {
      return this.failure(
        'openai-config',
        t(
          'OpenAI 文字起こし用の ChatGPT プロファイルが設定されていません。設定画面で ChatGPT のプロファイルを選んでください。',
        ),
        options.durationSeconds,
        'openai',
        openAiModelLabel(settings.openaiTranscriptionModel),
      );
    }
    let apiKey = '';
    try {
      apiKey =
        (await this.apiKeyStore.getKey(
          profile.id,
          profile.baseUrl,
          profile.provider,
        )) ?? '';
    } catch (error) {
      return this.failure(
        'openai-config',
        t('OpenAI の API キーを復号できませんでした。設定画面で再入力してください。{detail}', {
          detail: error instanceof Error ? ` (${error.message})` : '',
        }),
        options.durationSeconds,
        'openai',
        openAiModelLabel(settings.openaiTranscriptionModel),
      );
    }
    if (!apiKey) {
      return this.failure(
        'openai-config',
        t(
          'OpenAI の API キーが設定されていません。設定画面の ChatGPT プロファイルに API キーを保存してください。',
        ),
        options.durationSeconds,
        'openai',
        openAiModelLabel(settings.openaiTranscriptionModel),
      );
    }
    if (!this.confirmCloudTranscription) {
      return this.failure(
        'openai-config',
        t('音声を送信する確認を表示できないため、OpenAI 文字起こしを中止しました。'),
        options.durationSeconds,
        'openai',
        openAiModelLabel(settings.openaiTranscriptionModel),
      );
    }
    const confirmed = await this.confirmCloudTranscription({
      host: endpointHost(profile.baseUrl),
      model: settings.openaiTranscriptionModel,
      durationSeconds: options.durationSeconds,
      chunkCount: estimateOpenAiChunkCount(options.durationSeconds),
      audioVariant: options.preferredAudio ?? 'raw',
    });
    if (!confirmed) {
      return this.resolveLocal(settings, options.durationSeconds, 'cloud-declined');
    }
    return {
      kind: 'openai',
      model: settings.openaiTranscriptionModel,
      endpoint: buildOpenAiTranscriptionEndpoint(profile.baseUrl),
      apiKey,
      modelLabel: openAiModelLabel(settings.openaiTranscriptionModel),
    };
  }

  private async resolveLocal(
    settings: AppSettings,
    durationSeconds: number,
    fallbackReason: 'cloud-declined' | null,
  ): Promise<Resolution> {
    const model = settings.whisperModel;
    const modelPath = await this.modelManager.installedPath(model);
    if (!modelPath) {
      return this.failure(
        'model-missing',
        t(
          'whisper モデル（{model}）がダウンロードされていません。設定画面から取得してください。',
          { model },
        ),
        durationSeconds,
        'whisper-cpp',
        model,
      );
    }
    return {
      kind: 'local',
      model,
      modelPath,
      modelLabel: model,
      fallbackReason,
    };
  }

  private failure(
    errorCode: TranscriptionErrorCode,
    message: string,
    durationSeconds: number,
    engine: TranscriptionEngine,
    modelLabel: string,
  ): ResolutionFailure {
    return {
      kind: 'failure',
      outcome: failedOutcome(durationSeconds, errorCode, message),
      resolution: { engine, modelLabel, fallbackReason: null },
    };
  }
}
