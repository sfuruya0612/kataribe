import { join } from 'node:path';
import {
  app,
  BrowserWindow,
  ipcMain,
  powerSaveBlocker,
  session,
  shell,
  systemPreferences,
} from 'electron';
import type {
  AppInfo,
  MicrophonePermissionStatus,
  RecordingCaptureStats,
  RecordingChunk,
  StartRecordingOptions,
} from '../shared/types';
import {
  isAllowedPermission,
  type PermissionDetails,
} from './security';
import { RecordingManager } from './recording';

const isSmokeTest = process.env.KATARIBE_SMOKE_TEST === '1';
const rendererUrl = process.env.ELECTRON_RENDERER_URL;
let mainWindow: BrowserWindow | null = null;

app.setName('Kataribe');

function configureSession(): void {
  const defaultSession = session.defaultSession;

  defaultSession.setPermissionCheckHandler((_webContents, permission, _origin, details) => {
    return isAllowedPermission(permission, details as unknown as PermissionDetails);
  });

  defaultSession.setPermissionRequestHandler((_webContents, permission, callback, details) => {
    callback(isAllowedPermission(permission, details as unknown as PermissionDetails));
  });
}

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1120,
    height: 760,
    minWidth: 900,
    minHeight: 600,
    show: false,
    title: 'Kataribe',
    backgroundColor: '#f6f4ff',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });

  window.once('ready-to-show', () => {
    window.show();
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) {
      void shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  window.webContents.on('will-navigate', (event, url) => {
    if (url !== window.webContents.getURL()) {
      event.preventDefault();
    }
  });

  window.webContents.on('will-attach-webview', (event) => {
    event.preventDefault();
  });

  window.webContents.on('did-fail-load', (_event, code, description, url, isMainFrame) => {
    if (!isMainFrame) {
      return;
    }
    console.error(`renderer load failed: ${code} ${description} ${url}`);
    if (isSmokeTest) {
      app.exit(1);
    }
  });

  if (rendererUrl) {
    void window.loadURL(rendererUrl);
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'));
  }

  return window;
}

function focusMainWindow(): void {
  if (!mainWindow) {
    mainWindow = createWindow();
    return;
  }
  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  mainWindow.show();
  mainWindow.focus();
}

function registerIpc(recordingManager: RecordingManager): void {
  ipcMain.handle('app:info', (): AppInfo => {
    return {
      version: app.getVersion(),
      platform: process.platform,
    };
  });

  ipcMain.handle('permissions:microphone-status', (): MicrophonePermissionStatus => {
    return systemPreferences.getMediaAccessStatus(
      'microphone',
    ) as MicrophonePermissionStatus;
  });

  ipcMain.handle('permissions:request-microphone', async (): Promise<boolean> => {
    const status = systemPreferences.getMediaAccessStatus('microphone');
    if (status === 'granted') {
      return true;
    }
    if (status === 'denied' || status === 'restricted') {
      return false;
    }
    return systemPreferences.askForMediaAccess('microphone');
  });

  ipcMain.handle('recording:start', (_event, options: StartRecordingOptions) => {
    return recordingManager.start(options);
  });

  ipcMain.handle('recording:chunk', (_event, chunk: RecordingChunk) => {
    return recordingManager.appendChunk(chunk);
  });

  ipcMain.handle('recording:stop', (_event, stats?: RecordingCaptureStats) => {
    return recordingManager.stop(stats);
  });

  ipcMain.handle('recording:status', () => {
    return recordingManager.getState();
  });

  ipcMain.handle('recording:list-recoverable', () => {
    return recordingManager.listRecoverable();
  });

  ipcMain.handle('recording:recover', (_event, meetingId: string) => {
    return recordingManager.recover(meetingId);
  });

  ipcMain.handle('recording:open-folder', () => {
    const meetingDir = recordingManager.getLastMeetingDir();
    if (!meetingDir) {
      throw new Error('no recording folder');
    }
    shell.showItemInFolder(meetingDir);
  });

  ipcMain.on('app:renderer-ready', () => {
    if (!isSmokeTest) {
      return;
    }
    console.log('KATARIBE_SMOKE_TEST_OK');
    setTimeout(() => {
      app.quit();
    }, 100);
  });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    focusMainWindow();
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      focusMainWindow();
    }
  });

  app.on('web-contents-created', (_event, contents) => {
    contents.on('will-attach-webview', (event) => {
      event.preventDefault();
    });
  });

  app.whenReady().then(() => {
    configureSession();
    const recordingManager = new RecordingManager({
      saveRoot: join(app.getPath('documents'), 'Kataribe'),
      tempRoot: join(app.getPath('userData'), 'tmp'),
      appVersion: app.getVersion(),
      blocker: {
        start: () => {
          const id = powerSaveBlocker.start('prevent-app-suspension');
          console.log(`power save blocker started: ${id}`);
          return id;
        },
        stop: (id) => {
          powerSaveBlocker.stop(id);
          console.log(`power save blocker stopped: ${id}`);
        },
      },
    });
    registerIpc(recordingManager);
    mainWindow = createWindow();
    mainWindow.on('closed', () => {
      mainWindow = null;
    });

    if (isSmokeTest) {
      setTimeout(() => {
        console.error('KATARIBE_SMOKE_TEST_TIMEOUT');
        app.exit(1);
      }, 15000);
    }
  }).catch((error: unknown) => {
    console.error('failed to start Kataribe', error);
    app.exit(1);
  });
}
