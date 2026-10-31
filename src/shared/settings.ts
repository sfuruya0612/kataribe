import {
  DEFAULT_CLIPPING_CONFIG,
  normalizeClippingConfig,
  type ClippingConfig,
} from './clipping';
import {
  getLlmProviderPreset,
  isLlmProvider,
  normalizeLlmBaseUrl,
} from './llm';
import {
  DEFAULT_SILENCE_CONFIG,
  normalizeSilenceConfig,
  type SilenceConfig,
} from './silence';
import type {
  AppSettings,
  InputSource,
  SummaryLanguage,
  WhisperModel,
} from './types';

const INPUT_SOURCES: InputSource[] = ['microphone', 'system', 'both'];
const WHISPER_MODELS: WhisperModel[] = ['large-v3-turbo', 'medium', 'small'];
const SUMMARY_LANGUAGES: SummaryLanguage[] = ['ja', 'en'];

const DEFAULT_LLM_PROVIDER = 'claude' as const;
const DEFAULT_LLM_PRESET = getLlmProviderPreset(DEFAULT_LLM_PROVIDER);

export const DEFAULT_APP_SETTINGS: AppSettings = {
  inputSource: 'both',
  saveRoot: '',
  whisperModel: 'large-v3-turbo',
  speakerDiarization: true,
  globalShortcutEnabled: true,
  whisperInitialPrompt: '',
  whisperSpeedRatios: {},
  mp3BitrateKbps: 64,
  llmProvider: DEFAULT_LLM_PROVIDER,
  llmModel: DEFAULT_LLM_PRESET.defaultModel,
  llmBaseUrl: DEFAULT_LLM_PRESET.defaultBaseUrl,
  summaryLanguage: 'ja',
  summaryPromptTemplate: '',
  clippingConfig: { ...DEFAULT_CLIPPING_CONFIG },
  silenceConfig: { ...DEFAULT_SILENCE_CONFIG },
};

export function normalizeAppSettings(input: Partial<AppSettings> | null | undefined): AppSettings {
  const inputSource = INPUT_SOURCES.includes(input?.inputSource as InputSource)
    ? (input?.inputSource as InputSource)
    : DEFAULT_APP_SETTINGS.inputSource;
  const whisperModel = WHISPER_MODELS.includes(input?.whisperModel as WhisperModel)
    ? (input?.whisperModel as WhisperModel)
    : DEFAULT_APP_SETTINGS.whisperModel;
  const llmProvider = isLlmProvider(input?.llmProvider)
    ? input.llmProvider
    : DEFAULT_APP_SETTINGS.llmProvider;
  const preset = getLlmProviderPreset(llmProvider);
  const summaryLanguage = SUMMARY_LANGUAGES.includes(
    input?.summaryLanguage as SummaryLanguage,
  )
    ? (input?.summaryLanguage as SummaryLanguage)
    : DEFAULT_APP_SETTINGS.summaryLanguage;
  const llmModel =
    typeof input?.llmModel === 'string' && input.llmModel.trim().length > 0
      ? input.llmModel.trim().slice(0, 120)
      : preset.defaultModel || DEFAULT_APP_SETTINGS.llmModel;
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
  const globalShortcutEnabled =
    typeof input?.globalShortcutEnabled === 'boolean'
      ? input.globalShortcutEnabled
      : DEFAULT_APP_SETTINGS.globalShortcutEnabled;
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

  return {
    inputSource,
    saveRoot,
    whisperModel,
    speakerDiarization,
    globalShortcutEnabled,
    whisperInitialPrompt,
    whisperSpeedRatios,
    mp3BitrateKbps,
    llmProvider,
    llmModel,
    llmBaseUrl: normalizeLlmBaseUrl(llmProvider, input?.llmBaseUrl),
    summaryLanguage,
    summaryPromptTemplate,
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
