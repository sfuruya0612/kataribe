import { contextBridge, ipcRenderer } from 'electron';
import type { AppInfo } from '../shared/types';

const api = {
  getAppInfo: (): Promise<AppInfo> => ipcRenderer.invoke('app:info'),
  ready: (): void => {
    ipcRenderer.send('app:renderer-ready');
  },
};

contextBridge.exposeInMainWorld('kataribe', api);
