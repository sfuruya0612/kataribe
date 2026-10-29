/// <reference types="vite/client" />

import type {
  AppInfo,
  MicrophonePermissionStatus,
  RecordingCaptureStats,
  RecordingChunk,
  RecordingSession,
  RecordingState,
  RecordingStopResult,
  RecoverableRecording,
  StartRecordingOptions,
} from '../../shared/types';

declare global {
  interface Window {
    kataribe: {
      getAppInfo: () => Promise<AppInfo>;
      getMicrophoneStatus: () => Promise<MicrophonePermissionStatus>;
      requestMicrophone: () => Promise<boolean>;
      startRecording: (options: StartRecordingOptions) => Promise<RecordingSession>;
      appendChunk: (
        chunk: RecordingChunk,
      ) => Promise<{ file: string; frames: number }>;
      stopRecording: (
        stats?: RecordingCaptureStats,
      ) => Promise<RecordingStopResult>;
      getRecordingStatus: () => Promise<RecordingState>;
      listRecoverableRecordings: () => Promise<RecoverableRecording[]>;
      recoverRecording: (meetingId: string) => Promise<RecordingStopResult>;
      openRecordingFolder: () => Promise<void>;
      ready: () => void;
    };
  }
}

export {};
