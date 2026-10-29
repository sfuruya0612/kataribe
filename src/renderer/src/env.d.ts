/// <reference types="vite/client" />

import type { ClippingConfig } from '../../shared/clipping';
import type {
  AppInfo,
  InputSource,
  MicrophonePermissionStatus,
  RecordingAppState,
  RecordingCaptureStats,
  RecordingChunk,
  RecordingClippingReport,
  RecordingCommand,
  RecordingDeviceEventResult,
  RecordingEvent,
  RecordingLevelUpdate,
  RecordingRequestResult,
  RecordingSession,
  RecordingStartupFailure,
  RecordingStartupFailureResult,
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
      getRecordingState: () => Promise<RecordingAppState>;
      requestStartRecording: () => Promise<RecordingRequestResult>;
      requestStopRecording: () => Promise<RecordingRequestResult>;
      setInputSource: (source: InputSource) => Promise<RecordingAppState>;
      setClippingConfig: (
        config: Partial<ClippingConfig>,
      ) => Promise<RecordingAppState>;
      onRecordingState: (
        listener: (state: RecordingAppState) => void,
      ) => () => void;
      onRecordingLevel: (
        listener: (update: RecordingLevelUpdate) => void,
      ) => () => void;
      onRecordingCommand: (
        listener: (command: RecordingCommand) => void,
      ) => () => void;
      startRecording: (options: StartRecordingOptions) => Promise<RecordingSession>;
      appendChunk: (
        chunk: RecordingChunk,
      ) => Promise<{ file: string; frames: number }>;
      stopRecording: (
        stats?: RecordingCaptureStats,
      ) => Promise<RecordingStopResult>;
      reportRecordingLevel: (update: RecordingLevelUpdate) => Promise<void>;
      reportRecordingError: (message: string) => Promise<void>;
      reportDeviceEvent: (
        event: RecordingEvent,
      ) => Promise<RecordingDeviceEventResult>;
      reportClipping: (report: RecordingClippingReport) => Promise<void>;
      recordStartupFailure: (
        payload: RecordingStartupFailure,
      ) => Promise<RecordingStartupFailureResult>;
      listRecoverableRecordings: () => Promise<RecoverableRecording[]>;
      recoverRecording: (meetingId: string) => Promise<RecordingStopResult>;
      openRecordingFolder: () => Promise<void>;
      showAbout: () => Promise<void>;
      closeWindow: () => Promise<void>;
      openReadme: () => Promise<void>;
      openBlackHoleSite: () => Promise<void>;
      openMicrophoneSettings: () => Promise<void>;
      ready: () => void;
    };
  }
}

export {};
