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
  whisperModel: 'large-v3-turbo',
  llmProvider: DEFAULT_LLM_PROVIDER,
  llmModel: DEFAULT_LLM_PRESET.defaultModel,
  llmBaseUrl: DEFAULT_LLM_PRESET.defaultBaseUrl,
  summaryLanguage: 'ja',
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

  return {
    inputSource,
    whisperModel,
    llmProvider,
    llmModel,
    llmBaseUrl: normalizeLlmBaseUrl(llmProvider, input?.llmBaseUrl),
    summaryLanguage,
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
