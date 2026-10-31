import type { ClippingConfig } from './clipping';
import type { SilenceConfig } from './silence';

export type AppInfo = {
  version: string;
  platform: string;
  saveRoot: string;
};

export type MeetingStatus =
  | 'recording'
  | 'encoding'
  | 'transcribing'
  | 'transcribed'
  | 'summarized'
  | 'error';

export type MeetingSummary = {
  id: string;
  title: string;
  meetingDir: string;
  startedAt: string;
  duration: number;
  status: MeetingStatus;
  inputSource: InputSource | null;
  sampleRate: number;
  audioUrl: string | null;
  chunkCount: number;
  hasTranscript: boolean;
  hasSummary: boolean;
  transcriptPartial: boolean;
  translationLanguages: SummaryLanguage[];
  summaryLanguage: SummaryLanguage | null;
  pinned: boolean;
};

export type MeetingWaveform = {
  peaks: number[];
  duration: number;
};

export type TranscriptDocument = {
  markdown: string;
  body: string;
  language: string | null;
  model: string | null;
  partial: boolean;
  updatedAt: string | null;
};

export type SummaryDocument = {
  markdown: string;
  body: string;
  language: string | null;
  provider: string | null;
  model: string | null;
  generatedAt: string | null;
  updatedAt: string | null;
};

export type TranscriptTranslation = {
  language: SummaryLanguage;
  sourceLanguage: string | null;
  markdown: string;
  body: string;
  provider: string | null;
  model: string | null;
  generatedAt: string | null;
  updatedAt: string | null;
  partial: boolean;
};

export type RecordingErrorInfo = {
  message: string;
  at: string;
};

export type MeetingDetail = {
  meeting: MeetingSummary;
  recordingError: RecordingErrorInfo | null;
  transcript: TranscriptDocument | null;
  summary: SummaryDocument | null;
  translations: Partial<Record<SummaryLanguage, TranscriptTranslation>>;
};
export type MeetingSearchKind =
  | 'title'
  | 'transcript'
  | 'translation-ja'
  | 'translation-en'
  | 'summary';

export type MeetingSearchHit = {
  meetingId: string;
  title: string;
  startedAt: string;
  kind: MeetingSearchKind;
  kindLabel: string;
  lineNumber: number | null;
  timestamp: string | null;
  text: string;
};

export type MeetingSearchResult = {
  query: string;
  hits: MeetingSearchHit[];
  truncated: boolean;
};

export type ProcessingStage =
  | 'encoding'
  | 'transcribing'
  | 'translating'
  | 'summarizing';

export type ProcessingState = {
  stage: ProcessingStage | null;
  meetingId: string | null;
  progress: number | null;
  etaSeconds: number | null;
  message: string | null;
  cancellable: boolean;
  error: string | null;
};

export type WhisperModel = 'large-v3-turbo' | 'medium' | 'small';

export type LlmProvider =
  | 'claude'
  | 'chatgpt'
  | 'gemini'
  | 'ollama'
  | 'fireworks'
  | 'custom';

export type SummaryLanguage = 'ja' | 'en';

export type ThemeMode = 'system' | 'light' | 'dark';

export type AppSettings = {
  inputSource: InputSource;
  saveRoot: string;
  theme: ThemeMode;
  whisperModel: WhisperModel;
  speakerDiarization: boolean;
  globalShortcutEnabled: boolean;
  whisperInitialPrompt: string;
  whisperSpeedRatios: Partial<Record<WhisperModel, number>>;
  mp3BitrateKbps: 64 | 128;
  llmProvider: LlmProvider;
  llmModel: string;
  llmBaseUrl: string;
  summaryLanguage: SummaryLanguage;
  summaryPromptTemplate: string;
  clippingConfig: ClippingConfig;
  silenceConfig: SilenceConfig;
};

export type InputSource = 'microphone' | 'system' | 'both';

export type RecordingStatus = 'idle' | 'recording' | 'encoding' | 'error';

export type MicrophonePermissionStatus =
  | 'not-determined'
  | 'granted'
  | 'denied'
  | 'restricted'
  | 'unknown';

export type StartRecordingOptions = {
  inputSource: InputSource;
  sampleRate: number;
  microphoneLabel?: string;
  systemLabel?: string;
  clippingConfig?: ClippingConfig;
  silenceConfig?: SilenceConfig;
};

export type RecordingSession = {
  meetingId: string;
  meetingDir: string;
  startedAt: string;
  sampleRate: number;
  inputSource: InputSource;
};

export type RecordingChunk = {
  sequence: number;
  frames: number;
  sampleRate: number;
  expectedFrames: number;
  samples: Float32Array;
};

export type RecordingCaptureStats = {
  frames: number;
  expectedFrames: number;
  gaps: number;
  maxGapFrames: number;
  missedFrames: number;
  sampleRate: number;
  channels: number;
  currentTime: number;
};

export type RecordingStopResult = {
  meetingId: string;
  meetingDir: string;
  audioPath: string;
  startedAt: string;
  status: 'encoding';
  sampleRate: number;
  actualSamples: number;
  expectedSamples: number;
  captureStats?: RecordingCaptureStats;
  hadChunkFailure: boolean;
};

export type RecoverableRecording = {
  meetingId: string;
  meetingDir: string;
  startedAt: string;
  inputSource: InputSource;
  sampleRate: number;
  chunks: number;
  actualSamples: number;
};

export type RecordingState = {
  status: RecordingStatus;
  session: RecordingSession | null;
  lastMeetingDir: string | null;
};

export type RecordingAppStatus =
  | 'idle'
  | 'starting'
  | 'recording'
  | 'stopping'
  | 'encoding'
  | 'error';

export type RecordingEventKind =
  | 'permission-denied'
  | 'device-lost'
  | 'device-open-failed'
  | 'clipping'
  | 'clipping-recovered'
  | 'system-silence'
  | 'system-silence-recovered'
  | 'sleep-suspend'
  | 'sleep-resume';

export type RecordingEventDevice = 'microphone' | 'system' | 'output' | 'unknown';

export type RecordingEventSeverity = 'warning' | 'error';

export type RecordingEvent = {
  at: string;
  kind: RecordingEventKind;
  device: RecordingEventDevice;
  severity: RecordingEventSeverity;
  message: string;
};

export type RecordingStartupFailure = {
  options: StartRecordingOptions;
  event: RecordingEvent;
};

export type RecordingStartupFailureResult = {
  meetingId: string;
  meetingDir: string;
  metaPath: string;
};

export type RecordingDeviceEventResult = {
  recorded: boolean;
  stopping: boolean;
};

export type RecordingClippingReport = {
  active: boolean;
  peak: number;
  intervals: number;
  at: string;
};

export type RecordingSilenceReport = {
  active: boolean;
  rms: number;
  at: string;
};

export type RecordingPowerEvent = {
  action: 'resume';
  gapFrames: number;
  suspendedAt: string;
  resumedAt: string;
};

export type RecordingLevel = {
  peak: number;
  rms: number;
};

export type RecordingAppState = {
  status: RecordingAppStatus;
  inputSource: InputSource;
  session: RecordingSession | null;
  startedAt: string | null;
  elapsedSeconds: number;
  level: RecordingLevel | null;
  captureStats: RecordingCaptureStats | null;
  chunkCount: number;
  lastResult: RecordingStopResult | null;
  lastMeetingDir: string | null;
  notice: RecordingEvent | null;
  clipping: RecordingClippingReport | null;
  clippingConfig: ClippingConfig;
  silence: RecordingSilenceReport | null;
  silenceConfig: SilenceConfig;
  error: string | null;
};

export type RecordingCommand =
  | { action: 'start'; inputSource: InputSource }
  | { action: 'stop' };

export type RecordingLevelUpdate = {
  level: RecordingLevel;
  stats: RecordingCaptureStats;
};

export type RecordingRequestResult = {
  accepted: boolean;
  reason?: string;
};

export type LlmProviderPreset = {
  provider: LlmProvider;
  label: string;
  kind: 'openai' | 'anthropic';
  defaultBaseUrl: string;
  defaultModel: string;
};

export type LlmRuntimeConfig = {
  provider: LlmProvider;
  providerLabel: string;
  kind: 'openai' | 'anthropic';
  baseUrl: string;
  endpoint: string;
  model: string;
  apiKeyConfigured: boolean;
  apiKeyStored: boolean;
  storedHost: string | null;
  keychainAvailable: boolean;
  keychainError: string | null;
  host: string;
  hostMatchesKey: boolean;
};

export type LlmKeyStatus = {
  provider: LlmProvider;
  configured: boolean;
  host: string | null;
  keychainAvailable: boolean;
  keychainError: string | null;
};

export type WhisperModelInfo = {
  model: WhisperModel;
  fileName: string;
  sizeBytes: number;
  installed: boolean;
  installedBytes: number | null;
  downloadedBytes: number | null;
  progress: number | null;
  state: 'missing' | 'downloading' | 'verifying' | 'installed' | 'error';
  error: string | null;
};

export type WhisperModelList = {
  models: WhisperModelInfo[];
  modelsDir: string;
};

export type ModelDownloadProgress = {
  model: WhisperModel;
  downloadedBytes: number;
  totalBytes: number;
  progress: number;
};

export type SummaryPreview = {
  token: string;
  meetingId: string;
  provider: LlmProvider;
  providerLabel: string;
  model: string;
  endpoint: string;
  language: SummaryLanguage;
  charCount: number;
  estimatedTokens: number;
  contentHash: string;
  text: string;
  partial: boolean;
  warning: string | null;
};

export type TranslationPreview = {
  token: string;
  meetingId: string;
  targetLanguage: SummaryLanguage;
  sourceLanguage: string | null;
  provider: LlmProvider;
  providerLabel: string;
  model: string;
  endpoint: string;
  charCount: number;
  estimatedTokens: number;
  contentHash: string;
  text: string;
  partial: boolean;
  warning: string | null;
};

export type TranslationResult = {
  meeting: MeetingSummary;
  translation: TranscriptTranslation;
  usage: SummaryUsage | null;
};

export type AudioOutputDevice = {
  id: number;
  name: string;
  uid: string;
  channels: number;
  isAggregate?: boolean;
};

export type MultiOutputStatus = {
  supported: boolean;
  helperAvailable: boolean;
  currentOutput: AudioOutputDevice | null;
  outputDevices: AudioOutputDevice[];
  multiOutput: AudioOutputDevice | null;
  error: string | null;
};

export type SummaryUsage = {
  inputTokens: number | null;
  outputTokens: number | null;
};

export type GenerateSummaryResult = {
  meeting: MeetingSummary;
  summary: SummaryDocument;
  usage: SummaryUsage | null;
};

export type SaveMarkdownResult = {
  meeting: MeetingSummary;
  transcript: TranscriptDocument | null;
  summary: SummaryDocument | null;
};
