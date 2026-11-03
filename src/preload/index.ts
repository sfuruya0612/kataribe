import { contextBridge, ipcRenderer } from 'electron';
import type { IpcRendererEvent } from 'electron';
import type { ClippingConfig } from '../shared/clipping';
import type { SilenceConfig } from '../shared/silence';
import type {
  EnhancementCancelMessage,
  EnhancementStartMessage,
  ReuseLicenseKind,
} from '../shared/reuse';
import type {
  AppInfo,
  AppSettings,
  DiarizationModelProgress,
  DiarizationModelStatus,
  EnhancementFile,
  GenerateSummaryResult,
  InputSource,
  LlmProfilesState,
  LlmRuntimeConfig,
  MeetingDetail,
  MeetingSearchResult,
  MeetingSummary,
  MeetingTodo,
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
  ReuseDiskUsage,
  ReuseModel,
  ReuseModelList,
  ReuseModelProgress,
  SaveLlmProfileRequest,
  StartRecordingOptions,
  SummaryLanguage,
  SummaryPreview,
  TranslationPreview,
  TranslationResult,
  UiLanguage,
  WhisperModel,
  WhisperModelList,
} from '../shared/types';

function subscribe<T>(channel: string, listener: (value: T) => void): () => void {
  const handler = (_event: IpcRendererEvent, value: T) => {
    listener(value);
  };
  ipcRenderer.on(channel, handler);
  return () => {
    ipcRenderer.removeListener(channel, handler);
  };
}

const api = {
  getAppInfo: (): Promise<AppInfo> => ipcRenderer.invoke('app:info'),
  getUiLanguage: (): Promise<UiLanguage> => ipcRenderer.invoke('app:ui-language'),
  getMicrophoneStatus: (): Promise<MicrophonePermissionStatus> =>
    ipcRenderer.invoke('permissions:microphone-status'),
  requestMicrophone: (): Promise<boolean> =>
    ipcRenderer.invoke('permissions:request-microphone'),
  getRecordingState: (): Promise<RecordingAppState> =>
    ipcRenderer.invoke('recording:get-state'),
  requestStartRecording: (): Promise<RecordingRequestResult> =>
    ipcRenderer.invoke('recording:request-start'),
  requestStopRecording: (): Promise<RecordingRequestResult> =>
    ipcRenderer.invoke('recording:request-stop'),
  setInputSource: (source: InputSource): Promise<RecordingAppState> =>
    ipcRenderer.invoke('recording:set-source', source),
  setClippingConfig: (
    config: Partial<ClippingConfig>,
  ): Promise<RecordingAppState> =>
    ipcRenderer.invoke('recording:set-clipping-config', config),
  setSilenceConfig: (
    config: Partial<SilenceConfig>,
  ): Promise<RecordingAppState> =>
    ipcRenderer.invoke('recording:set-silence-config', config),
  onRecordingState: (listener: (state: RecordingAppState) => void): (() => void) =>
    subscribe('recording:state', listener),
  onRecordingLevel: (listener: (update: RecordingLevelUpdate) => void): (() => void) =>
    subscribe('recording:level', listener),
  onRecordingCommand: (listener: (command: RecordingCommand) => void): (() => void) =>
    subscribe('recording:command', listener),
  onRecordingPower: (listener: (event: RecordingPowerEvent) => void): (() => void) =>
    subscribe('recording:power', listener),
  startRecording: (options: StartRecordingOptions): Promise<RecordingSession> =>
    ipcRenderer.invoke('recording:start', options),
  appendChunk: (chunk: RecordingChunk): Promise<{ file: string; frames: number }> =>
    ipcRenderer.invoke('recording:chunk', chunk),
  appendGap: (frames: number): Promise<{ file: string; frames: number }> =>
    ipcRenderer.invoke('recording:gap', frames),
  stopRecording: (stats?: RecordingCaptureStats): Promise<RecordingStopResult> =>
    ipcRenderer.invoke('recording:stop', stats),
  reportRecordingLevel: (update: RecordingLevelUpdate): Promise<void> =>
    ipcRenderer.invoke('recording:level', update),
  reportRecordingError: (message: string): Promise<void> =>
    ipcRenderer.invoke('recording:capture-error', message),
  reportDeviceEvent: (event: RecordingEvent): Promise<RecordingDeviceEventResult> =>
    ipcRenderer.invoke('recording:device-event', event),
  reportClipping: (report: RecordingClippingReport): Promise<void> =>
    ipcRenderer.invoke('recording:clipping', report),
  reportSilence: (report: RecordingSilenceReport): Promise<void> =>
    ipcRenderer.invoke('recording:silence', report),
  recordStartupFailure: (
    payload: RecordingStartupFailure,
  ): Promise<RecordingStartupFailureResult> =>
    ipcRenderer.invoke('recording:startup-failure', payload),
  listRecoverableRecordings: (): Promise<RecoverableRecording[]> =>
    ipcRenderer.invoke('recording:list-recoverable'),
  recoverRecording: (meetingId: string): Promise<RecordingStopResult> =>
    ipcRenderer.invoke('recording:recover', meetingId),
  openRecordingFolder: (): Promise<void> =>
    ipcRenderer.invoke('recording:open-folder'),
  listMeetings: (): Promise<MeetingSummary[]> =>
    ipcRenderer.invoke('meetings:list'),
  listMeetingTodos: (): Promise<MeetingTodo[]> =>
    ipcRenderer.invoke('meetings:list-todos'),
  setMeetingTodoChecked: (
    meetingId: string,
    lineNumber: number,
    expectedText: string,
    checked: boolean,
  ): Promise<void> =>
    ipcRenderer.invoke(
      'meetings:set-todo-checked',
      meetingId,
      lineNumber,
      expectedText,
      checked,
    ),
  getMeetingDetail: (meetingId: string): Promise<MeetingDetail | null> =>
    ipcRenderer.invoke('meetings:detail', meetingId),
  updateMeetingTitle: (
    meetingId: string,
    title: string,
  ): Promise<MeetingSummary> =>
    ipcRenderer.invoke('meetings:update-title', meetingId, title),
  searchMeetings: (query: string): Promise<MeetingSearchResult> =>
    ipcRenderer.invoke('meetings:search', query),
  importAudio: (): Promise<MeetingSummary | null> =>
    ipcRenderer.invoke('meetings:import-audio'),
  setMeetingPinned: (
    meetingId: string,
    pinned: boolean,
  ): Promise<MeetingSummary> =>
    ipcRenderer.invoke('meetings:set-pinned', meetingId, pinned),
  deleteMeeting: (meetingId: string): Promise<void> =>
    ipcRenderer.invoke('meetings:delete', meetingId),
  setMeetingSummaryLanguage: (
    meetingId: string,
    language: SummaryLanguage | null,
  ): Promise<MeetingSummary> =>
    ipcRenderer.invoke('meetings:set-summary-language', meetingId, language),
  saveTranscript: (meetingId: string, markdown: string): Promise<MeetingDetail> =>
    ipcRenderer.invoke('meetings:save-transcript', meetingId, markdown),
  saveSummary: (meetingId: string, markdown: string): Promise<MeetingDetail> =>
    ipcRenderer.invoke('meetings:save-summary', meetingId, markdown),
  renameMeetingSpeakers: (
    meetingId: string,
    names: string[],
  ): Promise<MeetingDetail> =>
    ipcRenderer.invoke('meetings:rename-speakers', meetingId, names),
  retryTranscription: (meetingId: string): Promise<ProcessingState> =>
    ipcRenderer.invoke('meetings:retry-transcription', meetingId),
  retryTranscriptionComparison: (
    meetingId: string,
  ): Promise<ProcessingState> =>
    ipcRenderer.invoke('meetings:retry-comparison', meetingId),
  getMeetingWaveform: (meetingId: string): Promise<MeetingWaveform> =>
    ipcRenderer.invoke('meetings:waveform', meetingId),
  openMeetingFolder: (meetingId: string): Promise<void> =>
    ipcRenderer.invoke('meetings:open-folder', meetingId),
  getProcessingState: (): Promise<ProcessingState> =>
    ipcRenderer.invoke('processing:get-state'),
  cancelProcessing: (): Promise<boolean> =>
    ipcRenderer.invoke('processing:cancel'),
  previewSummary: (
    meetingId: string,
    profileId?: string,
  ): Promise<SummaryPreview> =>
    ipcRenderer.invoke('summary:preview', meetingId, profileId),
  generateSummary: (
    meetingId: string,
    token: string,
  ): Promise<GenerateSummaryResult> =>
    ipcRenderer.invoke('summary:generate', meetingId, token),
  previewTranslation: (
    meetingId: string,
    targetLanguage: SummaryLanguage,
    profileId?: string,
  ): Promise<TranslationPreview> =>
    ipcRenderer.invoke('translation:preview', meetingId, targetLanguage, profileId),
  generateTranslation: (
    meetingId: string,
    token: string,
  ): Promise<TranslationResult> =>
    ipcRenderer.invoke('translation:generate', meetingId, token),
  chooseSaveRoot: (): Promise<{
    settings: AppSettings;
    info: AppInfo;
  } | null> => ipcRenderer.invoke('save-root:choose'),
  getMultiOutputStatus: (): Promise<MultiOutputStatus> =>
    ipcRenderer.invoke('multi-output:status'),
  createMultiOutput: (outputUid: string): Promise<MultiOutputStatus | null> =>
    ipcRenderer.invoke('multi-output:create', outputUid),
  removeMultiOutput: (): Promise<MultiOutputStatus | null> =>
    ipcRenderer.invoke('multi-output:remove'),
  getLlmRuntime: (profileId?: string): Promise<LlmRuntimeConfig | null> =>
    ipcRenderer.invoke('llm:runtime', profileId),
  getLlmProfiles: (): Promise<LlmProfilesState> =>
    ipcRenderer.invoke('llm:profiles'),
  saveLlmProfile: (request: SaveLlmProfileRequest): Promise<LlmProfilesState> =>
    ipcRenderer.invoke('llm:save-profile', request),
  deleteLlmProfile: (profileId: string): Promise<LlmProfilesState> =>
    ipcRenderer.invoke('llm:delete-profile', profileId),
  setDefaultLlmProfile: (profileId: string): Promise<LlmProfilesState> =>
    ipcRenderer.invoke('llm:set-default-profile', profileId),
  setLlmApiKey: (
    profileId: string,
    apiKey: string,
  ): Promise<LlmProfilesState> =>
    ipcRenderer.invoke('llm:set-key', profileId, apiKey),
  clearLlmApiKey: (profileId: string): Promise<LlmProfilesState> =>
    ipcRenderer.invoke('llm:clear-key', profileId),
  listWhisperModels: (): Promise<WhisperModelList> =>
    ipcRenderer.invoke('models:list'),
  downloadWhisperModel: (model: WhisperModel): Promise<WhisperModelList> =>
    ipcRenderer.invoke('models:download', model),
  cancelWhisperModelDownload: (model: WhisperModel): Promise<WhisperModelList> =>
    ipcRenderer.invoke('models:cancel', model),
  deleteWhisperModel: (model: WhisperModel): Promise<WhisperModelList> =>
    ipcRenderer.invoke('models:delete', model),
  listReuseModels: (): Promise<ReuseModelList> =>
    ipcRenderer.invoke('reuse:list-models'),
  downloadReuseModel: (model: ReuseModel): Promise<ReuseModelList> =>
    ipcRenderer.invoke('reuse:download-model', model),
  cancelReuseModelDownload: (model: ReuseModel): Promise<ReuseModelList> =>
    ipcRenderer.invoke('reuse:cancel-download', model),
  deleteReuseModel: (model: ReuseModel): Promise<ReuseModelList> =>
    ipcRenderer.invoke('reuse:delete-model', model),
  getReuseEnhancement: (meetingId: string): Promise<EnhancementFile | null> =>
    ipcRenderer.invoke('reuse:get-enhancement', meetingId),
  getReuseDiskUsage: (): Promise<ReuseDiskUsage> =>
    ipcRenderer.invoke('reuse:disk-usage'),
  deleteReuseSavedAudio: (): Promise<ReuseDiskUsage> =>
    ipcRenderer.invoke('reuse:delete-saved-audio'),
  enhanceReuseSavedAudio: (
    meetingId: string,
    model: ReuseModel,
  ): Promise<ProcessingState> =>
    ipcRenderer.invoke('reuse:enhance-saved-audio', meetingId, model),
  openReuseLicense: (kind: ReuseLicenseKind): Promise<void> =>
    ipcRenderer.invoke('reuse:open-license', kind),
  onReuseModelProgress: (
    listener: (progress: ReuseModelProgress) => void,
  ): (() => void) => subscribe('reuse:model-progress', listener),
  onReuseModelsChanged: (
    listener: (list: ReuseModelList) => void,
  ): (() => void) => subscribe('reuse:models-changed', listener),
  onEnhancementStart: (
    listener: (message: EnhancementStartMessage) => void,
  ): (() => void) => subscribe('enhancement:start', listener),
  onEnhancementCancel: (
    listener: (message: EnhancementCancelMessage) => void,
  ): (() => void) => subscribe('enhancement:cancel', listener),
  reportEnhancementProgress: (
    requestId: string,
    progress: number,
  ): Promise<void> =>
    ipcRenderer.invoke('enhancement:progress', requestId, progress),
  sendEnhancementChunk: (
    requestId: string,
    index: number,
    samples: Float32Array,
  ): Promise<void> =>
    ipcRenderer.invoke('enhancement:chunk', requestId, index, samples),
  reportEnhancementDone: (requestId: string): Promise<void> =>
    ipcRenderer.invoke('enhancement:done', requestId),
  reportEnhancementReady: (): Promise<void> =>
    ipcRenderer.invoke('enhancement:ready'),
  reportEnhancementError: (
    requestId: string,
    message: string,
  ): Promise<void> =>
    ipcRenderer.invoke('enhancement:error', requestId, message),
  getDiarizationModelStatus: (): Promise<DiarizationModelStatus> =>
    ipcRenderer.invoke('diarization:model-status'),
  downloadDiarizationModels: (): Promise<DiarizationModelStatus> =>
    ipcRenderer.invoke('diarization:model-download'),
  cancelDiarizationModelDownload: (): Promise<DiarizationModelStatus> =>
    ipcRenderer.invoke('diarization:model-cancel'),
  copyText: (text: string): Promise<void> =>
    ipcRenderer.invoke('app:copy-text', text),
  onProcessingState: (listener: (state: ProcessingState) => void): (() => void) =>
    subscribe('processing:state', listener),
  onMeetingUpdated: (
    listener: (payload: { meetingId: string }) => void,
  ): (() => void) => subscribe('meetings:updated', listener),
  onMeetingsChanged: (listener: (list: MeetingSummary[]) => void): (() => void) =>
    subscribe('meetings:changed', listener),
  rebuildMeetingIndex: (): Promise<MeetingSummary[]> =>
    ipcRenderer.invoke('index:rebuild'),
  onModelProgress: (
    listener: (progress: ModelDownloadProgress) => void,
  ): (() => void) => subscribe('models:progress', listener),
  onModelsChanged: (listener: (list: WhisperModelList) => void): (() => void) =>
    subscribe('models:changed', listener),
  onDiarizationModelProgress: (
    listener: (progress: DiarizationModelProgress) => void,
  ): (() => void) => subscribe('diarization:model-progress', listener),
  onDiarizationModelsChanged: (listener: () => void): (() => void) =>
    subscribe('diarization:models-changed', listener),
  onLlmChanged: (listener: (state: LlmProfilesState) => void): (() => void) =>
    subscribe('llm:changed', listener),
  getSettings: (): Promise<AppSettings> => ipcRenderer.invoke('settings:get'),
  updateSettings: (patch: Partial<AppSettings>): Promise<AppSettings> =>
    ipcRenderer.invoke('settings:set', patch),
  showAbout: (): Promise<void> => ipcRenderer.invoke('app:show-about'),
  closeWindow: (): Promise<void> => ipcRenderer.invoke('app:close-window'),
  openReadme: (): Promise<void> => ipcRenderer.invoke('app:open-readme'),
  openBlackHoleSite: (): Promise<void> => ipcRenderer.invoke('app:open-blackhole'),
  openMicrophoneSettings: (): Promise<void> =>
    ipcRenderer.invoke('app:open-microphone-settings'),
  ready: (): void => {
    ipcRenderer.send('app:renderer-ready');
  },
};

contextBridge.exposeInMainWorld('kataribe', api);
