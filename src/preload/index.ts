import { contextBridge, ipcRenderer } from 'electron';
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
} from '../shared/types';

const api = {
  getAppInfo: (): Promise<AppInfo> => ipcRenderer.invoke('app:info'),
  getMicrophoneStatus: (): Promise<MicrophonePermissionStatus> =>
    ipcRenderer.invoke('permissions:microphone-status'),
  requestMicrophone: (): Promise<boolean> =>
    ipcRenderer.invoke('permissions:request-microphone'),
  startRecording: (options: StartRecordingOptions): Promise<RecordingSession> =>
    ipcRenderer.invoke('recording:start', options),
  appendChunk: (chunk: RecordingChunk): Promise<{ file: string; frames: number }> =>
    ipcRenderer.invoke('recording:chunk', chunk),
  stopRecording: (stats?: RecordingCaptureStats): Promise<RecordingStopResult> =>
    ipcRenderer.invoke('recording:stop', stats),
  getRecordingStatus: (): Promise<RecordingState> =>
    ipcRenderer.invoke('recording:status'),
  listRecoverableRecordings: (): Promise<RecoverableRecording[]> =>
    ipcRenderer.invoke('recording:list-recoverable'),
  recoverRecording: (meetingId: string): Promise<RecordingStopResult> =>
    ipcRenderer.invoke('recording:recover', meetingId),
  openRecordingFolder: (): Promise<void> =>
    ipcRenderer.invoke('recording:open-folder'),
  ready: (): void => {
    ipcRenderer.send('app:renderer-ready');
  },
};

contextBridge.exposeInMainWorld('kataribe', api);
