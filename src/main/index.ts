import { join, resolve } from 'node:path';
import { access, mkdir, rm } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { pathToFileURL } from 'node:url';
import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  nativeTheme,
  net,
  powerMonitor,
  powerSaveBlocker,
  protocol,
  safeStorage,
  session,
  shell,
  systemPreferences,
} from 'electron';
import type { MenuItemConstructorOptions, MessageBoxOptions, OpenDialogOptions } from 'electron';
import type { ClippingConfig } from '../shared/clipping';
import type { SilenceConfig } from '../shared/silence';
import type {
  AppInfo,
  AppSettings,
  InputSource,
  LlmProfilesState,
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
  SaveLlmProfileRequest,
  StartRecordingOptions,
  SummaryLanguage,
  ThemeMode,
  WhisperModel,
} from '../shared/types';
import { ApiKeyStore, type SecretCrypto } from './api-keys';
import { ChildProcessRegistry } from './child-registry';
import { DiarizationService } from './diarization';
import { DiarizationModelManager } from './diarization-models';
import { getUiLanguage, setUiLanguage, t } from './i18n';
import { LlmClient } from './llm';
import { LlmProfileManager } from './llm-profiles';
import { BinaryLocator, MediaEncoder } from './media';
import { MeetingStore } from './meetings';
import { ModelManager } from './models';
import { MultiOutputController } from './multi-output';
import { ProcessingCoordinator } from './processing';
import { configureChildProcessRegistry } from './process';
import { RecordingCoordinator } from './recording-coordinator';
import { RecordingManager } from './recording';
import { RecordingStateStore } from './recording-state';
import { MeetingSearchIndex } from './search-index';
import { SettingsStore } from './settings';
import {
  isAllowedPermission,
  type PermissionDetails,
} from './security';
import { TranscriptionService } from './transcription';
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
let shutdownInProgress = false;
let stateTimer: NodeJS.Timeout | null = null;
let processingCoordinator: ProcessingCoordinator | null = null;
let activeMeetingIndex: MeetingSearchIndex | null = null;
let meetingIndexRoot = '';

const electronFetch: typeof fetch = (input, init) => {
  const value =
    typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.toString()
        : input instanceof Request
          ? input.url
          : String(input);
  return net.fetch(value, init) as unknown as Promise<Response>;
};

app.setName('Kataribe');

app.commandLine.appendSwitch('disable-background-networking');
app.commandLine.appendSwitch('disable-component-update');
app.commandLine.appendSwitch('disable-domain-reliability');
app.commandLine.appendSwitch('disable-sync');
app.commandLine.appendSwitch('disable-client-side-phishing-detection');
app.commandLine.appendSwitch('disable-default-apps');
app.commandLine.appendSwitch('metrics-recording-only');
app.commandLine.appendSwitch('no-first-run');
app.commandLine.appendSwitch('no-pings');
app.commandLine.appendSwitch('disable-breakpad');
app.commandLine.appendSwitch(
  'disable-features',
  'Spellcheck,SpellcheckService,OptimizationHints,MediaRouter,Translate',
);

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

function broadcast(channel: string, payload: unknown): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send(channel, payload);
    }
  }
}

async function broadcastModelList(modelManager: ModelManager): Promise<void> {
  try {
    broadcast('models:changed', await modelManager.list());
  } catch (error) {
    console.error(
      `failed to broadcast model list: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

async function refreshMeetingIndex(
  meetingStore: MeetingStore,
  meetingId: string,
): Promise<void> {
  if (!activeMeetingIndex) {
    return;
  }
  try {
    await activeMeetingIndex.refresh(meetingStore, meetingId);
  } catch (error) {
    console.error(
      `failed to refresh the meeting index: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

async function showOpenDirectoryDialog(options: OpenDialogOptions) {
  return mainWindow
    ? dialog.showOpenDialog(mainWindow, options)
    : dialog.showOpenDialog(options);
}

async function showMessageDialog(options: MessageBoxOptions) {
  return mainWindow
    ? dialog.showMessageBox(mainWindow, options)
    : dialog.showMessageBox(options);
}

function cloudSyncService(path: string): string | null {
  const value = path.toLowerCase();
  if (value.includes('/library/mobile documents/')) {
    return 'iCloud Drive';
  }
  if (value.includes('/dropbox/')) {
    return 'Dropbox';
  }
  if (value.includes('/onedrive')) {
    return 'OneDrive';
  }
  if (value.includes('/google drive') || value.includes('/googledrive')) {
    return 'Google Drive';
  }
  if (value.includes('/obsidian')) {
    return 'Obsidian';
  }
  return null;
}

const coordinator = new RecordingCoordinator(stateStore, sendRecordingCommand);

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function configureSession(): void {
  const defaultSession = session.defaultSession;
  defaultSession.setSpellCheckerEnabled(false);

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
    applicationName: t('Kataribe 会議録'),
    applicationVersion: app.getVersion(),
    version: app.getVersion(),
    copyright: 'Copyright 2026 Shoichi Furuya',
    credits: t(
      'BlackHole 2ch は GPLv3 のソフトウェアです。Kataribe は BlackHole 2ch を同梱せず、再配布しません。配布元: https://existential.audio/blackhole/',
    ),
  });

  const template: MenuItemConstructorOptions[] = [
    {
      label: app.name,
      submenu: [
        {
          label: t('Kataribe 会議録 について'),
          click: () => app.showAboutPanel(),
        },
        { type: 'separator' },
        { role: 'hide', label: t('Kataribe を隠す') },
        { role: 'hideOthers', label: t('ほかのアプリを隠す') },
        { role: 'unhide', label: t('すべてを表示') },
        { type: 'separator' },
        { role: 'quit', label: t('Kataribe を終了') },
      ],
    },
    {
      label: t('ファイル'),
      submenu: [{ role: 'close', label: t('ウインドウを閉じる') }],
    },
    { role: 'editMenu', label: t('編集') },
    { role: 'windowMenu', label: t('ウインドウ') },
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
    icon: appIconPath(),
    backgroundColor: windowBackgroundColor(),
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 18 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
      spellcheck: false,
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

function appIconPath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'app-icon.png')
    : join(app.getAppPath(), 'build', 'icon.iconset', 'icon_512x512@2x.png');
}

function windowBackgroundColor(): string {
  return nativeTheme.shouldUseDarkColors ? '#1c1c1f' : '#e9e9ee';
}

function applyThemeMode(theme: ThemeMode): void {
  nativeTheme.themeSource = theme;
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.setBackgroundColor(windowBackgroundColor());
    }
  }
}

function applyDockIcon(): void {
  if (process.platform !== 'darwin' || !app.dock) {
    return;
  }
  const candidates = app.isPackaged
    ? [join(process.resourcesPath, 'app-icon.png'), join(process.resourcesPath, 'icon.icns')]
    : [
        join(app.getAppPath(), 'build', 'icon.iconset', 'icon_512x512@2x.png'),
        join(app.getAppPath(), 'build', 'icon.icns'),
      ];
  for (const candidate of candidates) {
    const image = nativeImage.createFromPath(candidate);
    if (!image.isEmpty()) {
      app.dock.setIcon(image);
      return;
    }
  }
  console.warn('dock icon could not be loaded');
}

function registerIpc(
  recordingManager: RecordingManager,
  meetingStore: MeetingStore,
  settingsStore: SettingsStore,
  processing: ProcessingCoordinator,
  modelManager: ModelManager,
  diarizationModelManager: DiarizationModelManager,
  llmProfileManager: LlmProfileManager,
  multiOutput: MultiOutputController,
): void {
  ipcMain.handle('app:info', (): AppInfo => {
    return {
      version: app.getVersion(),
      platform: process.platform,
      saveRoot: settingsStore.get().saveRoot,
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
    processing.pauseForRecording();
    const result = coordinator.start();
    if (!result.accepted) {
      void processing.resumeAfterRecording(null);
    }
    return result;
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
    const {
      saveRoot: _ignoredSaveRoot,
      llmProfiles: _ignoredLlmProfiles,
      llmDefaultProfileId: _ignoredLlmDefaultProfileId,
      ...safePatch
    } = patch as Partial<AppSettings>;
    if (_ignoredLlmProfiles !== undefined || _ignoredLlmDefaultProfileId !== undefined) {
      throw new Error('LLM profiles must be updated through the LLM profile API');
    }
    const settings = await settingsStore.save(safePatch);
    stateStore.setInputSource(settings.inputSource);
    stateStore.setClippingConfig(settings.clippingConfig);
    stateStore.setSilenceConfig(settings.silenceConfig);
    applyThemeMode(settings.theme);
    if (settings.uiLanguage !== getUiLanguage()) {
      setUiLanguage(settings.uiLanguage);
      registerAppMenu();
      trayController?.update(stateStore.getState());
    }
    return settings;
  });

  ipcMain.handle('save-root:choose', async () => {
    const recordingStatus = stateStore.getStatus();
    if (
      recordingStatus === 'starting' ||
      recordingStatus === 'recording' ||
      recordingStatus === 'stopping' ||
      processing.isBusy()
    ) {
      throw new Error(t('録音または処理中は保存先を変更できません。'));
    }
    const settings = settingsStore.get();
    const options: OpenDialogOptions = {
      title: t('保存先フォルダを選択'),
      defaultPath: settings.saveRoot,
      properties: ['openDirectory', 'createDirectory'],
    };
    const result = await showOpenDirectoryDialog(options);
    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }
    const selected = resolve(result.filePaths[0]);
    await mkdir(selected, { recursive: true, mode: 0o700 });
    await access(selected, fsConstants.W_OK);
    const syncService = cloudSyncService(selected);
    const syncWarning = syncService
      ? `${t(
          '選択したフォルダは {service} の同期対象です。音声と文字起こしが端末外に同期されます。',
          { service: t('{service} の同期フォルダ', { service: syncService }) },
        )}\n\n`
      : '';
    const confirmation = await showMessageDialog({
      type: 'warning',
      title: t('保存先を変更'),
      message: t('既存の会議は新しい保存先の一覧に表示されません。'),
      detail: `${syncWarning}${t(
        '会議フォルダは移動しません。元のフォルダは Finder から引き続き参照できます。保存先を変更しますか？',
      )}`,
      buttons: [t('変更'), t('キャンセル')],
      defaultId: 1,
      cancelId: 1,
    });
    if (confirmation.response !== 0) {
      return null;
    }
    const saved = await settingsStore.save({ saveRoot: selected });
    meetingStore.setSaveRoot(selected);
    recordingManager.setSaveRoot(selected);
    if (activeMeetingIndex) {
      activeMeetingIndex.close();
      activeMeetingIndex = null;
    }
    try {
      activeMeetingIndex = await MeetingSearchIndex.open(meetingIndexRoot, selected);
      await activeMeetingIndex.rebuild(meetingStore);
    } catch (error) {
      activeMeetingIndex?.close();
      activeMeetingIndex = null;
      console.error(
        `failed to build the meeting search index: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    return {
      settings: saved,
      info: {
        version: app.getVersion(),
        platform: process.platform,
        saveRoot: selected,
      },
    };
  });

  ipcMain.handle('meetings:update-title', async (_event, meetingId: string, title: string) => {
    if (processing.isBusy()) {
      throw new Error(t('処理中はタイトルを変更できません。'));
    }
    const status = stateStore.getStatus();
    if (status === 'starting' || status === 'recording' || status === 'stopping') {
      throw new Error(t('録音中はタイトルを変更できません。'));
    }
    const updated = await meetingStore.updateTitle(meetingId, String(title));
    await refreshMeetingIndex(meetingStore, meetingId);
    broadcast('meetings:updated', { meetingId });
    return updated;
  });

  ipcMain.handle('meetings:search', (_event, query: string) => {
    const index = activeMeetingIndex;
    return index?.isReady() ? index.search(String(query)) : meetingStore.search(String(query));
  });

  ipcMain.handle(
    'meetings:set-pinned',
    async (_event, meetingId: string, pinned: boolean) => {
      const updated = await meetingStore.setPinned(meetingId, pinned === true);
      await refreshMeetingIndex(meetingStore, meetingId);
      broadcast('meetings:updated', { meetingId });
      return updated;
    },
  );

  ipcMain.handle('meetings:delete', async (_event, meetingId: string) => {
    const status = stateStore.getStatus();
    if (
      status === 'starting' ||
      status === 'recording' ||
      status === 'stopping' ||
      processing.isBusy()
    ) {
      throw new Error(t('録音または処理中は会議を削除できません。'));
    }
    await meetingStore.delete(meetingId);
    await rm(join(app.getPath('userData'), 'tmp', meetingId), {
      recursive: true,
      force: true,
    }).catch(() => undefined);
    await refreshMeetingIndex(meetingStore, meetingId);
    const list = activeMeetingIndex?.isReady()
      ? activeMeetingIndex.list()
      : await meetingStore.list();
    broadcast('meetings:changed', list);
  });

  ipcMain.handle('meetings:import-audio', async () => {
    const status = stateStore.getStatus();
    if (
      status === 'starting' ||
      status === 'recording' ||
      status === 'stopping' ||
      processing.isBusy()
    ) {
      throw new Error(t('録音または処理中は音声を取り込めません。'));
    }
    const options: OpenDialogOptions = {
      title: t('文字起こしする音声ファイルを選択'),
      properties: ['openFile'],
      filters: [
        { name: t('音声ファイル'), extensions: ['mp3', 'wav'] },
      ],
    };
    const result = await showOpenDirectoryDialog(options);
    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }
    const meeting = await meetingStore.importAudio(
      result.filePaths[0],
      app.getVersion(),
    );
    await refreshMeetingIndex(meetingStore, meeting.id);
    broadcast('meetings:updated', { meetingId: meeting.id });
    void processing.requestTranscription(meeting.id).catch((error: unknown) => {
      console.error(
        `failed to start imported audio transcription: ${error instanceof Error ? error.message : String(error)}`,
      );
    });
    return meeting;
  });

  ipcMain.handle(
    'meetings:set-summary-language',
    async (_event, meetingId: string, language: SummaryLanguage | null) => {
      const updated = await meetingStore.setSummaryLanguage(meetingId, language);
      await refreshMeetingIndex(meetingStore, meetingId);
      broadcast('meetings:updated', { meetingId });
      return updated;
    },
  );

  ipcMain.handle(
    'translation:preview',
    (
      _event,
      meetingId: string,
      targetLanguage: SummaryLanguage,
      profileId?: string,
    ) => {
      return processing.createTranslationPreview(
        meetingId,
        targetLanguage,
        typeof profileId === 'string' && profileId ? profileId : undefined,
      );
    },
  );

  ipcMain.handle('translation:generate', (_event, meetingId: string, token: string) => {
    return processing.generateTranslation(meetingId, token);
  });

  ipcMain.handle('multi-output:status', () => multiOutput.status());

  ipcMain.handle('multi-output:create', async (_event, outputUid: string) => {
    const status = stateStore.getStatus();
    if (
      status === 'starting' ||
      status === 'recording' ||
      status === 'stopping' ||
      processing.isBusy()
    ) {
      throw new Error(t('録音または処理中は Multi-Output Device を作成できません。'));
    }
    const current = await multiOutput.status();
    if (!current.helperAvailable) {
      throw new Error(current.error ?? 'Multi-Output helper is not available');
    }
    const output = current.outputDevices.find((device) => device.uid === outputUid);
    if (!output) {
      throw new Error(t('出力デバイスが見つかりません。'));
    }
    const blackHole = current.outputDevices.find((device) =>
      device.name.toLowerCase().includes('blackhole'),
    );
    const confirmation = await showMessageDialog({
      type: 'warning',
      title: t('Multi-Output Device を自動作成'),
      message: t('macOS の音声出力を変更します。'),
      detail: t(
        '{output} と {blackhole} を含む「Kataribe Multi-Output」を作成し、既定の出力に設定します。音量キーが効かなくなる場合があります。',
        {
          output: output.name,
          blackhole: blackHole?.name ?? 'BlackHole 2ch',
        },
      ),
      buttons: [t('作成'), t('キャンセル')],
      defaultId: 1,
      cancelId: 1,
    });
    if (confirmation.response !== 0) {
      return null;
    }
    return multiOutput.create(outputUid);
  });

  ipcMain.handle('multi-output:remove', async () => {
    const confirmation = await showMessageDialog({
      type: 'warning',
      title: t('Multi-Output Device を削除'),
      message: t('Kataribe Multi-Output を削除しますか？'),
      detail: t(
        'macOS の出力が Kataribe Multi-Output の場合は、削除後に別の出力デバイスを選び直してください。',
      ),
      buttons: [t('削除'), t('キャンセル')],
      defaultId: 1,
      cancelId: 1,
    });
    if (confirmation.response !== 0) {
      return null;
    }
    return multiOutput.remove();
  });

  ipcMain.handle('processing:get-state', () => processing.getState());

  ipcMain.handle('processing:cancel', () => processing.cancel());

  ipcMain.handle('llm:runtime', (_event, profileId?: string) => {
    return processing.runtimeConfig(
      typeof profileId === 'string' && profileId ? profileId : undefined,
    );
  });

  ipcMain.handle('llm:profiles', (): Promise<LlmProfilesState> => {
    return llmProfileManager.state();
  });

  ipcMain.handle(
    'llm:save-profile',
    async (_event, request: SaveLlmProfileRequest): Promise<LlmProfilesState> => {
      const state = await llmProfileManager.saveProfile(request);
      broadcast('llm:changed', state);
      return state;
    },
  );

  ipcMain.handle(
    'llm:delete-profile',
    async (_event, profileId: string): Promise<LlmProfilesState> => {
      const state = await llmProfileManager.deleteProfile(String(profileId));
      broadcast('llm:changed', state);
      return state;
    },
  );

  ipcMain.handle(
    'llm:set-default-profile',
    async (_event, profileId: string): Promise<LlmProfilesState> => {
      const state = await llmProfileManager.setDefaultProfile(String(profileId));
      broadcast('llm:changed', state);
      return state;
    },
  );

  ipcMain.handle(
    'llm:set-key',
    async (_event, profileId: string, apiKey: unknown): Promise<LlmProfilesState> => {
      if (typeof apiKey !== 'string') {
        throw new Error('invalid API key');
      }
      const state = await llmProfileManager.setApiKey(String(profileId), apiKey);
      broadcast('llm:changed', state);
      return state;
    },
  );

  ipcMain.handle(
    'llm:clear-key',
    async (_event, profileId: string): Promise<LlmProfilesState> => {
      const state = await llmProfileManager.clearApiKey(String(profileId));
      broadcast('llm:changed', state);
      return state;
    },
  );

  ipcMain.handle('models:list', () => modelManager.list());

  ipcMain.handle('models:download', async (_event, model: WhisperModel) => {
    if (!['large-v3-turbo', 'medium', 'small'].includes(model)) {
      throw new Error('invalid whisper model');
    }
    void modelManager
      .download(model)
      .catch((error: unknown) => {
        console.error(
          `model download failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      })
      .finally(() => {
        void broadcastModelList(modelManager);
      });
    return modelManager.list();
  });

  ipcMain.handle('models:cancel', async (_event, model: WhisperModel) => {
    modelManager.cancel(model);
    return modelManager.list();
  });

  ipcMain.handle('models:delete', async (_event, model: WhisperModel) => {
    await modelManager.delete(model);
    const list = await modelManager.list();
    broadcast('models:changed', list);
    return list;
  });

  ipcMain.handle('diarization:model-status', () => diarizationModelManager.status());

  ipcMain.handle('diarization:model-download', async () => {
    void diarizationModelManager
      .ensureInstalled()
      .catch((error: unknown) => {
        if (error instanceof Error && error.name === 'AbortError') {
          return;
        }
        console.error(
          `speaker diarization model download failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      })
      .finally(() => {
        broadcast('diarization:models-changed', null);
      });
    return diarizationModelManager.status();
  });

  ipcMain.handle('diarization:model-cancel', async () => {
    diarizationModelManager.cancel();
    return diarizationModelManager.status();
  });

  ipcMain.handle(
    'meetings:rename-speakers',
    async (_event, meetingId: string, names: unknown) => {
      if (
        typeof meetingId !== 'string' ||
        !Array.isArray(names) ||
        !names.every((name): name is string => typeof name === 'string')
      ) {
        throw new Error('invalid speaker names');
      }
      if (processing.isBusy()) {
        throw new Error(t('処理中は話者名を変更できません。'));
      }
      const status = stateStore.getStatus();
      if (status === 'starting' || status === 'recording' || status === 'stopping') {
        throw new Error(t('録音中は話者名を変更できません。'));
      }
      const detail = await meetingStore.renameSpeakers(meetingId, names);
      await refreshMeetingIndex(meetingStore, meetingId);
      broadcast('meetings:updated', { meetingId });
      return detail;
    },
  );

  ipcMain.handle('meetings:detail', (_event, meetingId: string) => {
    return meetingStore.detail(meetingId);
  });

  ipcMain.handle('meetings:save-transcript', (_event, meetingId: string, markdown: string) => {
    return processing.saveTranscript(meetingId, markdown);
  });

  ipcMain.handle('meetings:save-summary', (_event, meetingId: string, markdown: string) => {
    return processing.saveSummary(meetingId, markdown);
  });

  ipcMain.handle('meetings:retry-transcription', (_event, meetingId: string) => {
    void processing.requestTranscription(meetingId).catch((error: unknown) => {
      console.error(
        `failed to retry transcription: ${error instanceof Error ? error.message : String(error)}`,
      );
    });
    return processing.getState();
  });

  ipcMain.handle('summary:preview', (_event, meetingId: string, profileId?: string) => {
    return processing.createSummaryPreview(
      meetingId,
      typeof profileId === 'string' && profileId ? profileId : undefined,
    );
  });

  ipcMain.handle('summary:generate', (_event, meetingId: string, token: string) => {
    return processing.generateSummary(meetingId, token);
  });

  ipcMain.handle('app:copy-text', (_event, text: string) => {
    clipboard.writeText(String(text));
  });

  ipcMain.handle('meetings:list', () => {
    const index = activeMeetingIndex;
    return index?.isReady() ? index.list() : meetingStore.list();
  });

  ipcMain.handle('index:rebuild', async () => {
    const status = stateStore.getStatus();
    if (
      status === 'starting' ||
      status === 'recording' ||
      status === 'stopping' ||
      processing.isBusy()
    ) {
      throw new Error(t('録音または処理中は索引を再構築できません。'));
    }
    if (activeMeetingIndex) {
      activeMeetingIndex.close();
      activeMeetingIndex = null;
    }
    activeMeetingIndex = await MeetingSearchIndex.open(
      meetingIndexRoot,
      meetingStore.getSaveRoot(),
    );
    await activeMeetingIndex.rebuild(meetingStore);
    const list = activeMeetingIndex.list();
    broadcast('meetings:changed', list);
    return list;
  });

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
    processing.pauseForRecording();
    try {
      const state = stateStore.getState();
      const created = await recordingManager.start({
        ...options,
        clippingConfig: state.clippingConfig,
        silenceConfig: state.silenceConfig,
      });
      stateStore.markRecording(created);
      await refreshMeetingIndex(meetingStore, created.meetingId);
      broadcast('meetings:updated', { meetingId: created.meetingId });
      return created;
    } catch (error) {
      stateStore.markError(errorMessage(error));
      void processing.resumeAfterRecording(null);
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
    if (
      status !== 'recording' &&
      status !== 'stopping' &&
      !(status === 'error' && recordingManager.hasActiveSession())
    ) {
      throw new Error('recording is not active');
    }
    try {
      const result = await recordingManager.stop(stats);
      stateStore.markStopped(result);
      await refreshMeetingIndex(meetingStore, result.meetingId);
      broadcast('meetings:updated', { meetingId: result.meetingId });
      void processing
        .resumeAfterRecording(result.meetingId)
        .catch((error: unknown) => {
          console.error(
            `failed to start post-recording processing: ${error instanceof Error ? error.message : String(error)}`,
          );
        });
      return result;
    } catch (error) {
      const meetingId = stateStore.getState().session?.meetingId ?? null;
      stateStore.markError(errorMessage(error));
      if (meetingId) {
        await refreshMeetingIndex(meetingStore, meetingId);
        broadcast('meetings:updated', { meetingId });
      }
      void processing.resumeAfterRecording(null);
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
      await refreshMeetingIndex(meetingStore, result.meetingId);
      broadcast('meetings:updated', { meetingId: result.meetingId });
      void processing
        .resumeAfterRecording(result.meetingId)
        .catch((error: unknown) => {
          console.error(
            `failed to start post-recovery processing: ${error instanceof Error ? error.message : String(error)}`,
          );
        });
      return result;
    } catch (error) {
      stateStore.markError(errorMessage(error));
      await refreshMeetingIndex(meetingStore, meetingId);
      broadcast('meetings:updated', { meetingId });
      void processing.resumeAfterRecording(null);
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
        message: t(
          'マイク入力がクリップしています（ピーク {peak}%）。macOS の入力音量、マイクのゲイン、マイクとの距離を調整してください。',
          { peak: Math.round(report.peak * 100) },
        ),
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
        message: t('マイク入力のクリッピングが収まりました。'),
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
          t(
            'システム音声が届いていません。Multi-Output Device と macOS の出力設定を確認してください。',
          ),
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
        message: t('システム音声が戻りました。'),
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
      await refreshMeetingIndex(meetingStore, failure.meetingId);
      broadcast('meetings:updated', { meetingId: failure.meetingId });
      void processing.resumeAfterRecording(null);
      return failure;
    },
  );

  ipcMain.handle('recording:capture-error', async (_event, message: string) => {
    const status = stateStore.getStatus();
    if (status !== 'starting' && status !== 'recording' && status !== 'stopping') {
      return;
    }
    let meetingId: string | null = null;
    try {
      meetingId = await recordingManager.recordCaptureError(message);
    } catch (error) {
      console.error(`failed to record the capture error: ${errorMessage(error)}`);
    }
    stateStore.markError(message);
    if (meetingId) {
      await refreshMeetingIndex(meetingStore, meetingId);
      broadcast('meetings:updated', { meetingId });
    }
    void processing.resumeAfterRecording(null);
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

  app.on('before-quit', (event) => {
    if (shutdownInProgress) {
      return;
    }
    shutdownInProgress = true;
    isQuitting = true;
    if (stateTimer) {
      clearInterval(stateTimer);
      stateTimer = null;
    }
    trayController?.destroy();
    trayController = null;
    activeMeetingIndex?.close();
    activeMeetingIndex = null;
    const coordinator = processingCoordinator;
    processingCoordinator = null;
    if (coordinator) {
      event.preventDefault();
      void coordinator.shutdown().finally(() => {
        app.quit();
      });
    }
  });

  app.on('web-contents-created', (_event, contents) => {
    contents.on('will-attach-webview', (event) => {
      event.preventDefault();
    });
  });

  app.whenReady().then(async () => {
    configureSession();
    applyDockIcon();

    const defaultSaveRoot = join(app.getPath('documents'), 'Kataribe');
    const settingsStore = new SettingsStore(
      join(app.getPath('userData'), 'settings.json'),
    );
    let storedSettings = await settingsStore.load();
    if (!storedSettings.saveRoot) {
      storedSettings = await settingsStore.save({ saveRoot: defaultSaveRoot });
    }
    setUiLanguage(storedSettings.uiLanguage);
    registerAppMenu();
    applyThemeMode(storedSettings.theme);
    const saveRoot = storedSettings.saveRoot;
    const meetingStore = new MeetingStore(saveRoot);
    const childRegistry = new ChildProcessRegistry(
      join(app.getPath('userData'), 'tmp', 'children'),
    );
    await childRegistry.cleanupOrphaned();
    configureChildProcessRegistry(childRegistry);
    stateStore.setInputSource(storedSettings.inputSource);
    stateStore.setClippingConfig(storedSettings.clippingConfig);
    stateStore.setSilenceConfig(storedSettings.silenceConfig);

    const modelManager = new ModelManager({
      modelsDir: join(app.getPath('userData'), 'models'),
      fetch: electronFetch,
      onProgress: (progress) => {
        broadcast('models:progress', progress);
      },
    });
    const diarizationModelManager = new DiarizationModelManager({
      modelsDir: join(app.getPath('userData'), 'models', 'diarization'),
      fetch: electronFetch,
      onProgress: (progress) => {
        broadcast('diarization:model-progress', progress);
      },
      onChange: () => {
        broadcast('diarization:models-changed', null);
      },
    });
    const secretCrypto: SecretCrypto = {
      isAvailable: () => safeStorage.isAsyncEncryptionAvailable(),
      encrypt: (plainText) => safeStorage.encryptStringAsync(plainText),
      decrypt: async (encrypted) => {
        const result = await safeStorage.decryptStringAsync(encrypted);
        return {
          result: result.result,
          shouldReEncrypt: result.shouldReEncrypt,
        };
      },
    };
    const apiKeyStore = new ApiKeyStore({
      filePath: join(app.getPath('userData'), 'config.json'),
      crypto: secretCrypto,
    });
    await apiKeyStore.load();
    const llmProfileManager = new LlmProfileManager({
      settingsStore,
      apiKeyStore,
    });

    const locator = new BinaryLocator({
      isPackaged: app.isPackaged,
      resourcesPath: process.resourcesPath,
      appPath: app.getAppPath(),
      platform: process.platform,
      arch: process.arch,
    });
    const mediaEncoder = new MediaEncoder({ locator });
    const transcriptionService = new TranscriptionService({ locator });
    const diarizationService = new DiarizationService({
      locator,
      models: diarizationModelManager,
    });
    const llmClient = new LlmClient({ fetch: electronFetch });
    const multiOutput = new MultiOutputController({ locator });
    const processing = new ProcessingCoordinator({
      tempRoot: join(app.getPath('userData'), 'tmp'),
      meetingStore,
      modelManager,
      apiKeyStore,
      mediaEncoder,
      transcriptionService,
      diarizationService,
      llmClient,
      settings: () => settingsStore.get(),
      onStateChange: (state) => {
        broadcast('processing:state', state);
      },
      onMeetingUpdated: (meetingId) => {
        void refreshMeetingIndex(meetingStore, meetingId).finally(() => {
          broadcast('meetings:updated', { meetingId });
        });
      },
      onSpeedRatioMeasured: async (model, ratio) => {
        const current = settingsStore.get();
        await settingsStore.save({
          whisperSpeedRatios: {
            ...current.whisperSpeedRatios,
            [model]: ratio,
          },
        });
      },
      confirmContinue: async (message, detail) => {
        const result = await showMessageDialog({
          type: 'question',
          title: t('文字起こしの継続確認'),
          message,
          detail,
          buttons: [t('継続'), t('停止')],
          defaultId: 0,
          cancelId: 1,
        });
        return result.response === 0;
      },
    });
    processingCoordinator = processing;
    await processing.markInterruptedMeetings();
    meetingIndexRoot = join(app.getPath('userData'), 'index');
    try {
      activeMeetingIndex = await MeetingSearchIndex.open(meetingIndexRoot, saveRoot);
      await activeMeetingIndex.rebuild(meetingStore);
    } catch (error) {
      activeMeetingIndex?.close();
      activeMeetingIndex = null;
      console.error(
        `failed to build the meeting search index: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

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
    registerIpc(
      recordingManager,
      meetingStore,
      settingsStore,
      processing,
      modelManager,
      diarizationModelManager,
      llmProfileManager,
      multiOutput,
    );

    let suspendedAt: number | null = null;
    powerMonitor.on('suspend', () => {
      processingCoordinator?.pauseTranscription();
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
        message: t('システムスリープに入りました。'),
      };
      stateStore.setNotice(event);
      void recordingManager.recordEvent(event).catch((error: unknown) => {
        console.error('failed to record suspend event', error);
      });
    });

    powerMonitor.on('resume', () => {
      processingCoordinator?.resumeTranscription();
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
            ? t(
                'システムスリープから復帰しました。{seconds} 秒の無音を補います。',
                { seconds: (gapFrames / sampleRate).toFixed(1) },
              )
            : t('システムスリープから復帰しました。'),
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
          processingCoordinator?.pauseForRecording();
          const result = coordinator.start();
          if (!result.accepted) {
            void processingCoordinator?.resumeAfterRecording(null);
          }
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
        const wasRecording = stateStore.canStop();
        if (!wasRecording) {
          processingCoordinator?.pauseForRecording();
        }
        const result = coordinator.toggle();
        if (!result.accepted && !wasRecording) {
          void processingCoordinator?.resumeAfterRecording(null);
        }
      },
    });
    trayController.update(stateStore.getState());
    console.log('tray created');

    stateTimer = setInterval(() => stateStore.tick(), 1000);

    nativeTheme.on('updated', () => {
      for (const window of BrowserWindow.getAllWindows()) {
        if (!window.isDestroyed()) {
          window.setBackgroundColor(windowBackgroundColor());
        }
      }
    });

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
