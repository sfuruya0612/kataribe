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
};

export type MeetingWaveform = {
  peaks: number[];
  duration: number;
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

export type AppSettings = {
  inputSource: InputSource;
  whisperModel: WhisperModel;
  llmProvider: LlmProvider;
  llmModel: string;
  summaryLanguage: SummaryLanguage;
  clippingConfig: ClippingConfig;
  silenceConfig: SilenceConfig;
};

import type { ClippingConfig } from './clipping';
import type { SilenceConfig } from './silence';

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
