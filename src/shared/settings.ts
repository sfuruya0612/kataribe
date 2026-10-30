import {
  DEFAULT_CLIPPING_CONFIG,
  normalizeClippingConfig,
  type ClippingConfig,
} from './clipping';
import {
  DEFAULT_SILENCE_CONFIG,
  normalizeSilenceConfig,
  type SilenceConfig,
} from './silence';
import type {
  AppSettings,
  InputSource,
  LlmProvider,
  SummaryLanguage,
  WhisperModel,
} from './types';

const INPUT_SOURCES: InputSource[] = ['microphone', 'system', 'both'];
const WHISPER_MODELS: WhisperModel[] = ['large-v3-turbo', 'medium', 'small'];
const LLM_PROVIDERS: LlmProvider[] = [
  'claude',
  'chatgpt',
  'gemini',
  'ollama',
  'fireworks',
  'custom',
];
const SUMMARY_LANGUAGES: SummaryLanguage[] = ['ja', 'en'];

export const DEFAULT_APP_SETTINGS: AppSettings = {
  inputSource: 'both',
  whisperModel: 'large-v3-turbo',
  llmProvider: 'claude',
  llmModel: 'claude-sonnet-5-5',
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
  const llmProvider = LLM_PROVIDERS.includes(input?.llmProvider as LlmProvider)
    ? (input?.llmProvider as LlmProvider)
    : DEFAULT_APP_SETTINGS.llmProvider;
  const summaryLanguage = SUMMARY_LANGUAGES.includes(
    input?.summaryLanguage as SummaryLanguage,
  )
    ? (input?.summaryLanguage as SummaryLanguage)
    : DEFAULT_APP_SETTINGS.summaryLanguage;
  const llmModel =
    typeof input?.llmModel === 'string' && input.llmModel.trim().length > 0
      ? input.llmModel.trim().slice(0, 120)
      : DEFAULT_APP_SETTINGS.llmModel;

  return {
    inputSource,
    whisperModel,
    llmProvider,
    llmModel,
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
