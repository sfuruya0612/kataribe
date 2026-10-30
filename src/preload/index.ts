import { contextBridge, ipcRenderer } from 'electron';
import type { IpcRendererEvent } from 'electron';
import type { ClippingConfig } from '../shared/clipping';
import type { SilenceConfig } from '../shared/silence';
import type {
  AppInfo,
  AppSettings,
  InputSource,
  MeetingSummary,
  MeetingWaveform,
  MicrophonePermissionStatus,
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
  StartRecordingOptions,
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
  getMeetingWaveform: (meetingId: string): Promise<MeetingWaveform> =>
    ipcRenderer.invoke('meetings:waveform', meetingId),
  openMeetingFolder: (meetingId: string): Promise<void> =>
    ipcRenderer.invoke('meetings:open-folder', meetingId),
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
