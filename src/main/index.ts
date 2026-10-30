import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  net,
  powerMonitor,
  powerSaveBlocker,
  protocol,
  session,
  shell,
  systemPreferences,
} from 'electron';
import type { MenuItemConstructorOptions } from 'electron';
import type { ClippingConfig } from '../shared/clipping';
import type { SilenceConfig } from '../shared/silence';
import type {
  AppInfo,
  AppSettings,
  InputSource,
  MicrophonePermissionStatus,
  RecordingCaptureStats,
  RecordingChunk,
  RecordingClippingReport,
  RecordingCommand,
  RecordingDeviceEventResult,
  RecordingEvent,
  RecordingLevelUpdate,
  RecordingPowerEvent,
  RecordingRequestResult,
  RecordingSilenceReport,
  RecordingStartupFailure,
  RecordingStartupFailureResult,
  StartRecordingOptions,
} from '../shared/types';
import { MeetingStore } from './meetings';
import { RecordingCoordinator } from './recording-coordinator';
import { RecordingManager } from './recording';
import { RecordingStateStore } from './recording-state';
import { SettingsStore } from './settings';
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

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'kataribe-audio',
    privileges: {
      standard: false,
      secure: true,
      supportFetchAPI: true,
      stream: true,
    },
  },
]);

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

function meetingIdFromAudioUrl(rawUrl: string): string | null {
  const prefix = 'kataribe-audio://meeting/';
  if (!rawUrl.startsWith(prefix)) {
    return null;
  }
  const value = decodeURIComponent(rawUrl.slice(prefix.length).split('?')[0]);
  return value.length > 0 ? value : null;
}

function registerAudioProtocol(meetingStore: MeetingStore): void {
  protocol.handle('kataribe-audio', async (request) => {
    const meetingId = meetingIdFromAudioUrl(request.url);
    if (!meetingId) {
      return new Response('Not found', { status: 404 });
    }
    const audioPath = await meetingStore.audioPath(meetingId);
    if (!audioPath) {
      return new Response('Not found', { status: 404 });
    }

    try {
      return await net.fetch(pathToFileURL(audioPath).toString());
    } catch (error) {
      console.error(`failed to serve meeting audio: ${meetingId}`, error);
      return new Response('Not found', { status: 404 });
    }
  });
}

function registerAppMenu(): void {
  app.setAboutPanelOptions({
    applicationName: 'Kataribe 会議録',
    applicationVersion: app.getVersion(),
    version: app.getVersion(),
    copyright: 'Copyright 2026 Shoichi Furuya',
    credits:
      'BlackHole 2ch は GPLv3 のソフトウェアです。Kataribe は BlackHole 2ch を同梱せず、再配布しません。配布元: https://existential.audio/blackhole/',
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
    width: 1280,
    height: 860,
    minWidth: 1024,
    minHeight: 720,
    show: false,
    title: 'Kataribe',
    backgroundColor: '#E9E9EE',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 18 },
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

function registerIpc(
  recordingManager: RecordingManager,
  meetingStore: MeetingStore,
  settingsStore: SettingsStore,
): void {
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

  ipcMain.handle('recording:set-source', async (_event, source: InputSource) => {
    if (!stateStore.setInputSource(source)) {
      throw new Error('invalid input source');
    }
    await settingsStore.save({ inputSource: source });
    return stateStore.getState();
  });

  ipcMain.handle('recording:set-clipping-config', async (_event, config: unknown) => {
    if (typeof config !== 'object' || config === null) {
      throw new Error('invalid clipping config');
    }
    const updated = stateStore.setClippingConfig(config as Partial<ClippingConfig>);
    await settingsStore.save({ clippingConfig: updated });
    return stateStore.getState();
  });

  ipcMain.handle('recording:set-silence-config', async (_event, config: unknown) => {
    if (typeof config !== 'object' || config === null) {
      throw new Error('invalid silence config');
    }
    const updated = stateStore.setSilenceConfig(config as Partial<SilenceConfig>);
    await settingsStore.save({ silenceConfig: updated });
    return stateStore.getState();
  });

  ipcMain.handle('settings:get', () => settingsStore.get());

  ipcMain.handle('settings:set', async (_event, patch: unknown) => {
    if (typeof patch !== 'object' || patch === null) {
      throw new Error('invalid settings');
    }
    const settings = await settingsStore.save(patch as Partial<AppSettings>);
    stateStore.setInputSource(settings.inputSource);
    stateStore.setClippingConfig(settings.clippingConfig);
    stateStore.setSilenceConfig(settings.silenceConfig);
    return settings;
  });

  ipcMain.handle('meetings:list', () => meetingStore.list());

  ipcMain.handle('meetings:waveform', (_event, meetingId: string) => {
    return meetingStore.waveform(meetingId);
  });

  ipcMain.handle('meetings:open-folder', async (_event, meetingId: string) => {
    const meeting = await meetingStore.find(meetingId);
    if (!meeting) {
      throw new Error('meeting not found');
    }
    shell.showItemInFolder(meeting.meetingDir);
  });

  ipcMain.handle('recording:start', async (_event, options: StartRecordingOptions) => {
    const status = stateStore.getStatus();
    if (status !== 'starting' && status !== 'idle' && status !== 'encoding' && status !== 'error') {
      throw new Error('recording cannot be started');
    }
    try {
      const state = stateStore.getState();
      const created = await recordingManager.start({
        ...options,
        clippingConfig: state.clippingConfig,
        silenceConfig: state.silenceConfig,
      });
      stateStore.markRecording(created);
      return created;
    } catch (error) {
      stateStore.markError(errorMessage(error));
      throw error;
    }
  });

  ipcMain.handle('recording:gap', async (_event, frames: number) => {
    const status = stateStore.getStatus();
    if (status !== 'recording' && status !== 'stopping') {
      throw new Error('recording is not active');
    }
    return recordingManager.appendGap(frames);
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

  ipcMain.handle('recording:clipping', async (_event, report: RecordingClippingReport) => {
    const status = stateStore.getStatus();
    if (status !== 'recording' && status !== 'stopping') {
      return;
    }

    const previous = stateStore.getState().clipping;
    if (report.active && !previous?.active) {
      const event: RecordingEvent = {
        at: report.at,
        kind: 'clipping',
        device: 'microphone',
        severity: 'warning',
        message: `マイク入力がクリップしています（ピーク ${Math.round(report.peak * 100)}%）。macOS の入力音量、マイクのゲイン、マイクとの距離を調整してください。`,
      };
      try {
        await recordingManager.recordEvent(event);
      } catch (error) {
        console.error('failed to record clipping event', error);
      }
    } else if (!report.active && previous?.active) {
      const event: RecordingEvent = {
        at: report.at,
        kind: 'clipping-recovered',
        device: 'microphone',
        severity: 'warning',
        message: 'マイク入力のクリッピングが収まりました。',
      };
      try {
        await recordingManager.recordEvent(event);
      } catch (error) {
        console.error('failed to record clipping recovery event', error);
      }
    }
    stateStore.setClipping(report);
  });

  ipcMain.handle('recording:silence', async (_event, report: RecordingSilenceReport) => {
    const status = stateStore.getStatus();
    if (status !== 'recording' && status !== 'stopping') {
      return;
    }

    const previous = stateStore.getState().silence;
    if (report.active && !previous?.active) {
      const event: RecordingEvent = {
        at: report.at,
        kind: 'system-silence',
        device: 'system',
        severity: 'warning',
        message:
          'システム音声が届いていません。Multi-Output Device と macOS の出力設定を確認してください。',
      };
      try {
        await recordingManager.recordEvent(event);
      } catch (error) {
        console.error('failed to record silence event', error);
      }
    } else if (!report.active && previous?.active) {
      const event: RecordingEvent = {
        at: report.at,
        kind: 'system-silence-recovered',
        device: 'system',
        severity: 'warning',
        message: 'システム音声が戻りました。',
      };
      try {
        await recordingManager.recordEvent(event);
      } catch (error) {
        console.error('failed to record silence recovery event', error);
      }
    }
    stateStore.setSilence(report);
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
      const state = stateStore.getState();
      const failure = await recordingManager.recordStartupFailure(
        {
          ...payload.options,
          clippingConfig: state.clippingConfig,
          silenceConfig: state.silenceConfig,
        },
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

  app.whenReady().then(async () => {
    configureSession();
    registerAppMenu();

    const saveRoot = join(app.getPath('documents'), 'Kataribe');
    const meetingStore = new MeetingStore(saveRoot);
    const settingsStore = new SettingsStore(
      join(app.getPath('userData'), 'settings.json'),
    );
    const storedSettings = await settingsStore.load();
    stateStore.setInputSource(storedSettings.inputSource);
    stateStore.setClippingConfig(storedSettings.clippingConfig);
    stateStore.setSilenceConfig(storedSettings.silenceConfig);

    const recordingManager = new RecordingManager({
      saveRoot,
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
    registerAudioProtocol(meetingStore);
    registerIpc(recordingManager, meetingStore, settingsStore);

    let suspendedAt: number | null = null;
    powerMonitor.on('suspend', () => {
      const status = stateStore.getStatus();
      if (status !== 'recording' && status !== 'stopping') {
        return;
      }
      suspendedAt = Date.now();
      const event = {
        at: new Date(suspendedAt).toISOString(),
        kind: 'sleep-suspend' as const,
        device: 'unknown' as const,
        severity: 'warning' as const,
        message: 'システムスリープに入りました。',
      };
      stateStore.setNotice(event);
      void recordingManager.recordEvent(event).catch((error: unknown) => {
        console.error('failed to record suspend event', error);
      });
    });

    powerMonitor.on('resume', () => {
      if (suspendedAt === null) {
        return;
      }
      const resumedAt = Date.now();
      const suspended = suspendedAt;
      suspendedAt = null;
      const status = stateStore.getStatus();
      if (status !== 'recording' && status !== 'stopping') {
        return;
      }
      const sampleRate = stateStore.getState().session?.sampleRate ?? 0;
      const gapFrames =
        sampleRate > 0
          ? Math.max(0, Math.round(((resumedAt - suspended) / 1000) * sampleRate))
          : 0;
      const event = {
        at: new Date(resumedAt).toISOString(),
        kind: 'sleep-resume' as const,
        device: 'unknown' as const,
        severity: 'warning' as const,
        message:
          gapFrames > 0
            ? `システムスリープから復帰しました。${(gapFrames / sampleRate).toFixed(1)} 秒の無音を補います。`
            : 'システムスリープから復帰しました。',
      };
      stateStore.setNotice(event);
      void recordingManager.recordEvent(event).catch((error: unknown) => {
        console.error('failed to record resume event', error);
      });

      if (mainWindow && !mainWindow.isDestroyed()) {
        const powerEvent: RecordingPowerEvent = {
          action: 'resume',
          gapFrames,
          suspendedAt: new Date(suspended).toISOString(),
          resumedAt: new Date(resumedAt).toISOString(),
        };
        mainWindow.webContents.send('recording:power', powerEvent);
      }
    });

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
          void settingsStore.save({ inputSource: source });
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
