export type AppInfo = {
  version: string;
  platform: string;
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
};

export type RecordingSession = {
  meetingId: string;
  meetingDir: string;
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
