/// <reference types="vite/client" />

import type { ClippingConfig } from '../../shared/clipping';
import type { SilenceConfig } from '../../shared/silence';
import type {
  AppInfo,
  AppSettings,
  GenerateSummaryResult,
  InputSource,
  LlmProfilesState,
  LlmRuntimeConfig,
  MeetingDetail,
  MeetingSearchResult,
  MeetingSummary,
  MeetingWaveform,
  MicrophonePermissionStatus,
  ModelDownloadProgress,
  MultiOutputStatus,
  ProcessingState,
  RecordingAppState,
  RecordingCaptureStats,
  RecordingChunk,
  RecordingClippingReport,
  RecordingCommand,
  RecordingDeviceEventResult,
  RecordingEvent,
  RecordingLevelUpdate,
  RecordingPowerEvent,
  RecordingRequestResult,
  RecordingSession,
  RecordingSilenceReport,
  RecordingStartupFailure,
  RecordingStartupFailureResult,
  RecordingStopResult,
  RecoverableRecording,
  SaveLlmProfileRequest,
  StartRecordingOptions,
  SummaryLanguage,
  SummaryPreview,
  TranslationPreview,
  TranslationResult,
  WhisperModel,
  WhisperModelList,
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
      setSilenceConfig: (
        config: Partial<SilenceConfig>,
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
      onRecordingPower: (
        listener: (event: RecordingPowerEvent) => void,
      ) => () => void;
      startRecording: (options: StartRecordingOptions) => Promise<RecordingSession>;
      appendChunk: (
        chunk: RecordingChunk,
      ) => Promise<{ file: string; frames: number }>;
      appendGap: (frames: number) => Promise<{ file: string; frames: number }>;
      stopRecording: (
        stats?: RecordingCaptureStats,
      ) => Promise<RecordingStopResult>;
      reportRecordingLevel: (update: RecordingLevelUpdate) => Promise<void>;
      reportRecordingError: (message: string) => Promise<void>;
      reportDeviceEvent: (
        event: RecordingEvent,
      ) => Promise<RecordingDeviceEventResult>;
      reportClipping: (report: RecordingClippingReport) => Promise<void>;
      reportSilence: (report: RecordingSilenceReport) => Promise<void>;
      recordStartupFailure: (
        payload: RecordingStartupFailure,
      ) => Promise<RecordingStartupFailureResult>;
      listRecoverableRecordings: () => Promise<RecoverableRecording[]>;
      recoverRecording: (meetingId: string) => Promise<RecordingStopResult>;
      openRecordingFolder: () => Promise<void>;
      listMeetings: () => Promise<MeetingSummary[]>;
      getMeetingDetail: (meetingId: string) => Promise<MeetingDetail | null>;
      updateMeetingTitle: (
        meetingId: string,
        title: string,
      ) => Promise<MeetingSummary>;
      searchMeetings: (query: string) => Promise<MeetingSearchResult>;
      importAudio: () => Promise<MeetingSummary | null>;
      setMeetingPinned: (
        meetingId: string,
        pinned: boolean,
      ) => Promise<MeetingSummary>;
      deleteMeeting: (meetingId: string) => Promise<void>;
      setMeetingSummaryLanguage: (
        meetingId: string,
        language: SummaryLanguage | null,
      ) => Promise<MeetingSummary>;
      saveTranscript: (
        meetingId: string,
        markdown: string,
      ) => Promise<MeetingDetail>;
      saveSummary: (meetingId: string, markdown: string) => Promise<MeetingDetail>;
      retryTranscription: (meetingId: string) => Promise<ProcessingState>;
      getMeetingWaveform: (meetingId: string) => Promise<MeetingWaveform>;
      openMeetingFolder: (meetingId: string) => Promise<void>;
      getProcessingState: () => Promise<ProcessingState>;
      cancelProcessing: () => Promise<boolean>;
      previewSummary: (
        meetingId: string,
        profileId?: string,
      ) => Promise<SummaryPreview>;
      generateSummary: (
        meetingId: string,
        token: string,
      ) => Promise<GenerateSummaryResult>;
      previewTranslation: (
        meetingId: string,
        targetLanguage: SummaryLanguage,
        profileId?: string,
      ) => Promise<TranslationPreview>;
      generateTranslation: (
        meetingId: string,
        token: string,
      ) => Promise<TranslationResult>;
      chooseSaveRoot: () => Promise<{
        settings: AppSettings;
        info: AppInfo;
      } | null>;
      getMultiOutputStatus: () => Promise<MultiOutputStatus>;
      createMultiOutput: (
        outputUid: string,
      ) => Promise<MultiOutputStatus | null>;
      removeMultiOutput: () => Promise<MultiOutputStatus | null>;
      getLlmRuntime: (
        profileId?: string,
      ) => Promise<LlmRuntimeConfig | null>;
      getLlmProfiles: () => Promise<LlmProfilesState>;
      saveLlmProfile: (
        request: SaveLlmProfileRequest,
      ) => Promise<LlmProfilesState>;
      deleteLlmProfile: (profileId: string) => Promise<LlmProfilesState>;
      setDefaultLlmProfile: (profileId: string) => Promise<LlmProfilesState>;
      setLlmApiKey: (
        profileId: string,
        apiKey: string,
      ) => Promise<LlmProfilesState>;
      clearLlmApiKey: (profileId: string) => Promise<LlmProfilesState>;
      listWhisperModels: () => Promise<WhisperModelList>;
      downloadWhisperModel: (model: WhisperModel) => Promise<WhisperModelList>;
      cancelWhisperModelDownload: (
        model: WhisperModel,
      ) => Promise<WhisperModelList>;
      deleteWhisperModel: (model: WhisperModel) => Promise<WhisperModelList>;
      copyText: (text: string) => Promise<void>;
      onProcessingState: (
        listener: (state: ProcessingState) => void,
      ) => () => void;
      onMeetingUpdated: (
        listener: (payload: { meetingId: string }) => void,
      ) => () => void;
      onMeetingsChanged: (listener: (list: MeetingSummary[]) => void) => () => void;
      rebuildMeetingIndex: () => Promise<MeetingSummary[]>;
      onModelProgress: (
        listener: (progress: ModelDownloadProgress) => void,
      ) => () => void;
      onModelsChanged: (
        listener: (list: WhisperModelList) => void,
      ) => () => void;
      onLlmChanged: (
        listener: (state: LlmProfilesState) => void,
      ) => () => void;
      getSettings: () => Promise<AppSettings>;
      updateSettings: (patch: Partial<AppSettings>) => Promise<AppSettings>;
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
