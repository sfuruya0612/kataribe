import {
  DEFAULT_CLIPPING_CONFIG,
  normalizeClippingConfig,
  type ClippingConfig,
} from './clipping';
import {
  getLlmProviderPreset,
  isLlmProvider,
  normalizeLlmModel,
  normalizeLlmProfile,
  normalizeLlmProfileId,
  normalizeLlmBaseUrl,
} from './llm';
import {
  DEFAULT_SILENCE_CONFIG,
  normalizeSilenceConfig,
  type SilenceConfig,
} from './silence';
import {
  DEFAULT_OPENAI_TRANSCRIPTION_MODEL,
  normalizeOpenAiTranscriptionModel,
} from './openai-transcription';
import type {
  AppSettings,
  InputSource,
  LlmProfile,
  LlmProvider,
  OpenAiTranscriptionModel,
  SpeakerCount,
  SummaryLanguage,
  ThemeMode,
  TranscriptionEngine,
  UiLanguage,
  WhisperModel,
} from './types';

const INPUT_SOURCES: InputSource[] = ['microphone', 'system', 'both'];
const THEME_MODES: ThemeMode[] = ['system', 'light', 'dark'];
const WHISPER_MODELS: WhisperModel[] = ['large-v3-turbo', 'medium', 'small'];
const TRANSCRIPTION_ENGINES: TranscriptionEngine[] = ['whisper-cpp', 'openai'];
const SUMMARY_LANGUAGES: SummaryLanguage[] = ['ja', 'en'];
const UI_LANGUAGES: UiLanguage[] = ['ja', 'en'];
const SPEAKER_COUNTS: SpeakerCount[] = ['auto', 2, 3, 4, 5, 6, 7, 8, 9, 10];

const DEFAULT_LLM_PROVIDER: LlmProvider = 'claude';
const DEFAULT_LLM_PRESET = getLlmProviderPreset(DEFAULT_LLM_PROVIDER);

export const DEFAULT_LLM_PROFILE: LlmProfile = {
  id: DEFAULT_LLM_PROVIDER,
  provider: DEFAULT_LLM_PROVIDER,
  baseUrl: DEFAULT_LLM_PRESET.defaultBaseUrl,
  model: DEFAULT_LLM_PRESET.defaultModel,
};

export const DEFAULT_APP_SETTINGS: AppSettings = {
  inputSource: 'both',
  saveRoot: '',
  theme: 'system',
  uiLanguage: 'ja',
  whisperModel: 'large-v3-turbo',
  transcriptionEngine: 'whisper-cpp',
  openaiTranscriptionProfileId: '',
  openaiTranscriptionModel: DEFAULT_OPENAI_TRANSCRIPTION_MODEL,
  speakerDiarization: true,
  speakerCount: 'auto',
  whisperInitialPrompt: '',
  whisperSpeedRatios: {},
  mp3BitrateKbps: 64,
  llmProfiles: [{ ...DEFAULT_LLM_PROFILE }],
  llmDefaultProfileId: DEFAULT_LLM_PROFILE.id,
  summaryLanguage: 'ja',
  summaryPromptTemplate: '',
  removeFillersBeforeSummary: true,
  clippingConfig: { ...DEFAULT_CLIPPING_CONFIG },
  silenceConfig: { ...DEFAULT_SILENCE_CONFIG },
};

export type LegacyAppSettingsInput = Partial<AppSettings> & {
  llmProvider?: unknown;
  llmModel?: unknown;
  llmBaseUrl?: unknown;
};

function legacyLlmProfile(input: LegacyAppSettingsInput): LlmProfile {
  const provider = isLlmProvider(input.llmProvider)
    ? input.llmProvider
    : DEFAULT_LLM_PROVIDER;
  return {
    id: provider,
    provider,
    baseUrl: normalizeLlmBaseUrl(provider, input.llmBaseUrl),
    model: normalizeLlmModel(provider, input.llmModel),
  };
}

function normalizeLlmProfiles(input: LegacyAppSettingsInput): LlmProfile[] {
  // 旧設定の llmProvider / llmBaseUrl / llmModel は 1 つのプロファイルとして引き継ぐ。
  if (Array.isArray(input.llmProfiles)) {
    const profiles: LlmProfile[] = [];
    const seen = new Set<string>();
    for (const value of input.llmProfiles) {
      const profile = normalizeLlmProfile(value);
      if (!profile || seen.has(profile.id)) {
        continue;
      }
      seen.add(profile.id);
      profiles.push(profile);
    }
    return profiles;
  }
  return [legacyLlmProfile(input)];
}

export function normalizeAppSettings(
  input: LegacyAppSettingsInput | null | undefined,
): AppSettings {
  const inputSource = INPUT_SOURCES.includes(input?.inputSource as InputSource)
    ? (input?.inputSource as InputSource)
    : DEFAULT_APP_SETTINGS.inputSource;
  const theme = THEME_MODES.includes(input?.theme as ThemeMode)
    ? (input?.theme as ThemeMode)
    : DEFAULT_APP_SETTINGS.theme;
  const uiLanguage = UI_LANGUAGES.includes(input?.uiLanguage as UiLanguage)
    ? (input?.uiLanguage as UiLanguage)
    : DEFAULT_APP_SETTINGS.uiLanguage;
  const whisperModel = WHISPER_MODELS.includes(input?.whisperModel as WhisperModel)
    ? (input?.whisperModel as WhisperModel)
    : DEFAULT_APP_SETTINGS.whisperModel;
  const transcriptionEngine = TRANSCRIPTION_ENGINES.includes(
    input?.transcriptionEngine as TranscriptionEngine,
  )
    ? (input?.transcriptionEngine as TranscriptionEngine)
    : DEFAULT_APP_SETTINGS.transcriptionEngine;
  const openaiTranscriptionModel: OpenAiTranscriptionModel =
    normalizeOpenAiTranscriptionModel(input?.openaiTranscriptionModel);
  const llmProfiles = normalizeLlmProfiles(input ?? {});
  const requestedDefaultId = normalizeLlmProfileId(input?.llmDefaultProfileId);
  const llmDefaultProfileId = llmProfiles.some(
    (profile) => profile.id === requestedDefaultId,
  )
    ? requestedDefaultId
    : llmProfiles[0]?.id ?? '';
  const chatGptProfiles = llmProfiles.filter(
    (profile) => profile.provider === 'chatgpt',
  );
  const requestedTranscriptionProfileId =
    typeof input?.openaiTranscriptionProfileId === 'string'
      ? input.openaiTranscriptionProfileId.trim()
      : '';
  const openaiTranscriptionProfileId = chatGptProfiles.some(
    (profile) => profile.id === requestedTranscriptionProfileId,
  )
    ? requestedTranscriptionProfileId
    : chatGptProfiles.some((profile) => profile.id === llmDefaultProfileId)
      ? llmDefaultProfileId
      : chatGptProfiles[0]?.id ?? '';
  const summaryLanguage = SUMMARY_LANGUAGES.includes(
    input?.summaryLanguage as SummaryLanguage,
  )
    ? (input?.summaryLanguage as SummaryLanguage)
    : DEFAULT_APP_SETTINGS.summaryLanguage;
  const saveRoot =
    typeof input?.saveRoot === 'string' &&
    input.saveRoot.startsWith('/') &&
    !input.saveRoot.includes('\0')
      ? input.saveRoot
      : DEFAULT_APP_SETTINGS.saveRoot;
  const speakerDiarization =
    typeof input?.speakerDiarization === 'boolean'
      ? input.speakerDiarization
      : DEFAULT_APP_SETTINGS.speakerDiarization;
  const speakerCount = SPEAKER_COUNTS.includes(input?.speakerCount as SpeakerCount)
    ? (input?.speakerCount as SpeakerCount)
    : DEFAULT_APP_SETTINGS.speakerCount;
  const whisperInitialPrompt =
    typeof input?.whisperInitialPrompt === 'string'
      ? input.whisperInitialPrompt.trim().slice(0, 1000)
      : DEFAULT_APP_SETTINGS.whisperInitialPrompt;
  const whisperSpeedRatios: Partial<Record<WhisperModel, number>> = {};
  if (input?.whisperSpeedRatios && typeof input.whisperSpeedRatios === 'object') {
    for (const model of WHISPER_MODELS) {
      const value = input.whisperSpeedRatios[model];
      if (typeof value === 'number' && Number.isFinite(value) && value >= 0.01 && value <= 10) {
        whisperSpeedRatios[model] = value;
      }
    }
  }
  const mp3BitrateKbps =
    input?.mp3BitrateKbps === 128 ? 128 : 64;
  const summaryPromptTemplate =
    typeof input?.summaryPromptTemplate === 'string'
      ? input.summaryPromptTemplate.slice(0, 8000)
      : DEFAULT_APP_SETTINGS.summaryPromptTemplate;
  const removeFillersBeforeSummary =
    typeof input?.removeFillersBeforeSummary === 'boolean'
      ? input.removeFillersBeforeSummary
      : DEFAULT_APP_SETTINGS.removeFillersBeforeSummary;

  return {
    inputSource,
    saveRoot,
    theme,
    uiLanguage,
    whisperModel,
    transcriptionEngine,
    openaiTranscriptionProfileId,
    openaiTranscriptionModel,
    speakerDiarization,
    speakerCount,
    whisperInitialPrompt,
    whisperSpeedRatios,
    mp3BitrateKbps,
    llmProfiles,
    llmDefaultProfileId,
    summaryLanguage,
    summaryPromptTemplate,
    removeFillersBeforeSummary,
    clippingConfig: normalizeClippingConfig(
      (input?.clippingConfig as ClippingConfig | undefined) ??
        DEFAULT_APP_SETTINGS.clippingConfig,
    ),
    silenceConfig: normalizeSilenceConfig(
      (input?.silenceConfig as SilenceConfig | undefined) ??
        DEFAULT_APP_SETTINGS.silenceConfig,
    ),
  };
}
