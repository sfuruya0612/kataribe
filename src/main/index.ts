import { join } from 'node:path';
import {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  powerSaveBlocker,
  session,
  shell,
  systemPreferences,
} from 'electron';
import type { MenuItemConstructorOptions } from 'electron';
import type {
  AppInfo,
  InputSource,
  MicrophonePermissionStatus,
  RecordingCaptureStats,
  RecordingChunk,
  RecordingCommand,
  RecordingDeviceEventResult,
  RecordingEvent,
  RecordingLevelUpdate,
  RecordingRequestResult,
  RecordingStartupFailure,
  RecordingStartupFailureResult,
  StartRecordingOptions,
} from '../shared/types';
import { RecordingCoordinator } from './recording-coordinator';
import { RecordingManager } from './recording';
import { RecordingStateStore } from './recording-state';
import {
  isAllowedPermission,
  type PermissionDetails,
} from './security';
import { TrayController } from './tray';

const isSmokeTest = process.env.KATARIBE_SMOKE_TEST === '1';
const isWindowTest = process.env.KATARIBE_WINDOW_TEST === '1';
const rendererUrl = process.env.ELECTRON_RENDERER_URL;
const BLACKHOLE_URL = 'https://existential.audio/blackhole/';

let mainWindow: BrowserWindow | null = null;
let trayController: TrayController | null = null;
let rendererReady = false;
let hasLoadedRenderer = false;
let isQuitting = false;
let stateTimer: NodeJS.Timeout | null = null;

app.setName('Kataribe');

const stateStore = new RecordingStateStore({
  now: () => Date.now(),
  onStateChange: (state) => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) {
        window.webContents.send('recording:state', state);
      }
    }
    trayController?.update(state);
  },
  onLevelChange: (update) => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) {
        window.webContents.send('recording:level', update);
      }
    }
  },
});

function sendRecordingCommand(command: RecordingCommand): boolean {
  if (!mainWindow || mainWindow.isDestroyed() || !rendererReady) {
    return false;
  }
  mainWindow.webContents.send('recording:command', command);
  return true;
}

const coordinator = new RecordingCoordinator(stateStore, sendRecordingCommand);

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function configureSession(): void {
  const defaultSession = session.defaultSession;

  defaultSession.setPermissionCheckHandler((_webContents, permission, _origin, details) => {
    return isAllowedPermission(permission, details as unknown as PermissionDetails);
  });

  defaultSession.setPermissionRequestHandler((_webContents, permission, callback, details) => {
    callback(isAllowedPermission(permission, details as unknown as PermissionDetails));
  });
}

function registerAppMenu(): void {
  app.setAboutPanelOptions({
    applicationName: 'Kataribe 会議録',
    applicationVersion: app.getVersion(),
    version: app.getVersion(),
    copyright: 'Copyright 2026 Shoichi Furuya',
  });

  const template: MenuItemConstructorOptions[] = [
    {
      label: app.name,
      submenu: [
        {
          label: 'Kataribe 会議録 について',
          click: () => app.showAboutPanel(),
        },
        { type: 'separator' },
        { role: 'hide', label: 'Kataribe を隠す' },
        { role: 'hideOthers', label: 'ほかのアプリを隠す' },
        { role: 'unhide', label: 'すべてを表示' },
        { type: 'separator' },
        { role: 'quit', label: 'Kataribe を終了' },
      ],
    },
    {
      label: 'ファイル',
      submenu: [{ role: 'close', label: 'ウインドウを閉じる' }],
    },
    { role: 'editMenu', label: '編集' },
    { role: 'windowMenu', label: 'ウインドウ' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 960,
    minHeight: 680,
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

  window.on('close', (event) => {
    console.log(`main window close requested (isQuitting=${isQuitting})`);
    if (!isQuitting) {
      event.preventDefault();
      window.hide();
    }
  });

  window.on('closed', () => {
    console.log('main window closed');
    mainWindow = null;
    rendererReady = false;
    const status = stateStore.getStatus();
    if (
      !isQuitting &&
      (status === 'starting' || status === 'recording' || status === 'stopping')
    ) {
      void activeRecordingManager?.stop()
        .then((result) => stateStore.markStopped(result))
        .catch((error: unknown) => {
          stateStore.markError(`recording was interrupted: ${errorMessage(error)}`);
        });
    }
  });

  window.webContents.on('did-start-loading', () => {
    rendererReady = false;
    if (!hasLoadedRenderer || isQuitting) {
      return;
    }
    const status = stateStore.getStatus();
    if (status !== 'starting' && status !== 'recording' && status !== 'stopping') {
      return;
    }
    console.warn('renderer reloaded while recording; stopping the capture');
    void activeRecordingManager?.stop()
      .then((result) => stateStore.markStopped(result))
      .catch((error: unknown) => {
        stateStore.markError(`recording was interrupted: ${errorMessage(error)}`);
      });
  });

  window.webContents.on('did-finish-load', () => {
    hasLoadedRenderer = true;
  });

  window.webContents.on('render-process-gone', (_event, details) => {
    rendererReady = false;
    if (isQuitting) {
      return;
    }
    console.error(`renderer process gone: ${details.reason}`);
    const status = stateStore.getStatus();
    if (status === 'starting' || status === 'recording' || status === 'stopping') {
      void activeRecordingManager?.stop()
        .then((result) => stateStore.markStopped(result))
        .catch((error: unknown) => {
          stateStore.markError(`recording was interrupted: ${errorMessage(error)}`);
        });
    }
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
  if (!mainWindow || mainWindow.isDestroyed()) {
    mainWindow = createWindow();
    return;
  }
  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  mainWindow.show();
  mainWindow.focus();
}

function readmePath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'README.md')
    : join(app.getAppPath(), 'README.md');
}

function registerIpc(recordingManager: RecordingManager): void {
  ipcMain.handle('app:info', (): AppInfo => {
    return {
      version: app.getVersion(),
      platform: process.platform,
      saveRoot: join(app.getPath('documents'), 'Kataribe'),
    };
  });

  ipcMain.handle('app:show-about', (): void => {
    app.showAboutPanel();
  });

  ipcMain.handle('app:close-window', (): void => {
    mainWindow?.close();
  });

  ipcMain.handle('app:open-readme', async (): Promise<void> => {
    const error = await shell.openPath(readmePath());
    if (error) {
      throw new Error(error);
    }
  });

  ipcMain.handle('app:open-blackhole', async (): Promise<void> => {
    await shell.openExternal(BLACKHOLE_URL);
  });

  ipcMain.handle('app:open-microphone-settings', async (): Promise<void> => {
    await shell.openExternal(
      'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone',
    );
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

  ipcMain.handle('recording:get-state', () => stateStore.getState());

  ipcMain.handle('recording:request-start', (): RecordingRequestResult => {
    return coordinator.start();
  });

  ipcMain.handle('recording:request-stop', (): RecordingRequestResult => {
    return coordinator.stop();
  });

  ipcMain.handle('recording:set-source', (_event, source: InputSource) => {
    if (!stateStore.setInputSource(source)) {
      throw new Error('invalid input source');
    }
    return stateStore.getState();
  });

  ipcMain.handle('recording:start', async (_event, options: StartRecordingOptions) => {
    const status = stateStore.getStatus();
    if (status !== 'starting' && status !== 'idle' && status !== 'encoding' && status !== 'error') {
      throw new Error('recording cannot be started');
    }
    try {
      const created = await recordingManager.start(options);
      stateStore.markRecording(created);
      return created;
    } catch (error) {
      stateStore.markError(errorMessage(error));
      throw error;
    }
  });

  ipcMain.handle('recording:chunk', async (_event, chunk: RecordingChunk) => {
    const status = stateStore.getStatus();
    if (status !== 'recording' && status !== 'stopping') {
      throw new Error('recording is not active');
    }
    const saved = await recordingManager.appendChunk(chunk);
    stateStore.incrementChunkCount();
    return saved;
  });

  ipcMain.handle('recording:stop', async (_event, stats?: RecordingCaptureStats) => {
    const status = stateStore.getStatus();
    if (status !== 'recording' && status !== 'stopping') {
      throw new Error('recording is not active');
    }
    try {
      const result = await recordingManager.stop(stats);
      stateStore.markStopped(result);
      return result;
    } catch (error) {
      stateStore.markError(errorMessage(error));
      throw error;
    }
  });

  ipcMain.handle('recording:recover', async (_event, meetingId: string) => {
    if (!stateStore.canStart()) {
      throw new Error('cannot recover while recording');
    }
    try {
      const result = await recordingManager.recover(meetingId);
      stateStore.markRecovered(result);
      return result;
    } catch (error) {
      stateStore.markError(errorMessage(error));
      throw error;
    }
  });

  ipcMain.handle('recording:level', (_event, update: RecordingLevelUpdate) => {
    stateStore.setLevel(update);
  });

  ipcMain.handle(
    'recording:device-event',
    async (_event, event: RecordingEvent): Promise<RecordingDeviceEventResult> => {
      const status = stateStore.getStatus();
      if (status !== 'recording' && status !== 'stopping') {
        return { recorded: false, stopping: false };
      }

      let recorded = false;
      try {
        recorded = await recordingManager.recordEvent(event);
      } catch (error) {
        console.error('failed to record device event', error);
      }
      stateStore.setNotice(event);

      const sessionSource = stateStore.getState().session?.inputSource;
      const fatal =
        event.device === 'system' ||
        (event.device === 'microphone' && sessionSource === 'microphone');
      if (fatal && status === 'recording') {
        const result = coordinator.stop();
        return { recorded, stopping: result.accepted };
      }
      return { recorded, stopping: false };
    },
  );

  ipcMain.handle(
    'recording:startup-failure',
    async (_event, payload: RecordingStartupFailure): Promise<RecordingStartupFailureResult> => {
      const status = stateStore.getStatus();
      if (status !== 'starting' && !stateStore.canStart()) {
        throw new Error('recording cannot be started');
      }
      const failure = await recordingManager.recordStartupFailure(
        payload.options,
        payload.event,
      );
      stateStore.markStartupFailure(payload.event, failure.meetingDir);
      return failure;
    },
  );

  ipcMain.handle('recording:capture-error', (_event, message: string) => {
    const status = stateStore.getStatus();
    if (status === 'starting' || status === 'recording' || status === 'stopping') {
      stateStore.markError(message);
    }
  });

  ipcMain.handle('recording:list-recoverable', () => {
    return recordingManager.listRecoverable();
  });

  ipcMain.handle('recording:open-folder', () => {
    const meetingDir = recordingManager.getLastMeetingDir() ?? stateStore.getState().lastMeetingDir;
    if (!meetingDir) {
      throw new Error('no recording folder');
    }
    shell.showItemInFolder(meetingDir);
  });

  ipcMain.on('app:renderer-ready', () => {
    rendererReady = true;
    if (!isSmokeTest) {
      return;
    }
    console.log('KATARIBE_SMOKE_TEST_OK');
    setTimeout(() => {
      app.quit();
    }, 100);
  });
}

let activeRecordingManager: RecordingManager | null = null;

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
    focusMainWindow();
  });

  app.on('before-quit', () => {
    isQuitting = true;
    if (stateTimer) {
      clearInterval(stateTimer);
      stateTimer = null;
    }
    trayController?.destroy();
    trayController = null;
  });

  app.on('web-contents-created', (_event, contents) => {
    contents.on('will-attach-webview', (event) => {
      event.preventDefault();
    });
  });

  app.whenReady().then(() => {
    configureSession();
    registerAppMenu();

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
    activeRecordingManager = recordingManager;
    registerIpc(recordingManager);

    const iconPath = app.isPackaged
      ? join(process.resourcesPath, 'trayTemplate.png')
      : join(app.getAppPath(), 'build', 'trayTemplate.png');
    trayController = new TrayController({
      iconPath,
      handlers: {
        start: () => {
          coordinator.start();
        },
        stop: () => {
          coordinator.stop();
        },
        selectInputSource: (source) => {
          stateStore.setInputSource(source);
        },
        openWindow: () => focusMainWindow(),
        quit: () => {
          app.quit();
        },
      },
      onToggle: () => {
        coordinator.toggle();
      },
    });
    trayController.update(stateStore.getState());
    console.log('tray created');

    stateTimer = setInterval(() => stateStore.tick(), 1000);

    mainWindow = createWindow();

    if (isSmokeTest) {
      setTimeout(() => {
        console.error('KATARIBE_SMOKE_TEST_TIMEOUT');
        app.exit(1);
      }, 20000);
    }

    if (isWindowTest) {
      setTimeout(() => {
        if (!mainWindow || mainWindow.isDestroyed()) {
          console.log('KATARIBE_WINDOW_TEST_FAILED: main window is not available');
          app.exit(1);
          return;
        }
        mainWindow.close();
        setTimeout(() => {
          const ok =
            mainWindow !== null &&
            !mainWindow.isDestroyed() &&
            !mainWindow.isVisible();
          console.log(ok ? 'KATARIBE_WINDOW_TEST_OK' : 'KATARIBE_WINDOW_TEST_FAILED');
          app.quit();
        }, 1000);
      }, 1000);
    }
  }).catch((error: unknown) => {
    console.error('failed to start Kataribe', error);
    app.exit(1);
  });
}
