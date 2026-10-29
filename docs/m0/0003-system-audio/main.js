const {
  app,
  BrowserWindow,
  desktopCapturer,
  session,
  systemPreferences,
  ipcMain,
  powerMonitor,
} = require('electron');
const path = require('path');
const fs = require('fs');

const MODE = process.env.KATARIBE_M0_MODE || 'display';
const MEASURE_MS = Number(process.env.KATARIBE_M0_MEASURE_MS || 5000);
const WATCHDOG_MS = Number(
  process.env.KATARIBE_M0_WATCHDOG_MS || Math.max(180000, MEASURE_MS + 120000),
);
let logPath;

function log(event, payload = {}) {
  const line = JSON.stringify({ ts: new Date().toISOString(), event, ...payload });
  if (logPath) {
    fs.appendFileSync(logPath, `${line}\n`);
  }
  console.log(line);
}

app.setName('Kataribe M0');

app.whenReady().then(async () => {
  logPath = path.join(app.getPath('logs'), 'm0.log');
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  fs.writeFileSync(logPath, '');

  log('app_ready', {
    mode: MODE,
    measureMs: MEASURE_MS,
    watchdogMs: WATCHDOG_MS,
    platform: process.platform,
    arch: process.arch,
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    screenAccess: systemPreferences.getMediaAccessStatus('screen'),
    microphoneAccess: systemPreferences.getMediaAccessStatus('microphone'),
    logPath,
  });

  powerMonitor.on('suspend', () => {
    log('power_suspend');
  });
  powerMonitor.on('resume', () => {
    log('power_resume');
  });

  const win = new BrowserWindow({
    width: 760,
    height: 560,
    show: true,
    title: 'Kataribe M0 system audio',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });

  if (MODE === 'display') {
    session.defaultSession.setDisplayMediaRequestHandler(
      async (request, callback) => {
        try {
          const sources = await desktopCapturer.getSources({
            types: ['screen'],
            thumbnailSize: { width: 0, height: 0 },
          });
          log('sources', {
            count: sources.length,
            sources: sources.map((source) => ({ id: source.id, name: source.name })),
          });
          if (!sources.length) {
            callback({});
            return;
          }
          callback({ video: sources[0], audio: 'loopback' });
        } catch (error) {
          log('source_error', { error: String(error && error.stack ? error.stack : error) });
          callback({});
        }
      },
      { useSystemPicker: false },
    );
  }

  ipcMain.handle('m0:askMicrophone', async () => {
    const status = systemPreferences.getMediaAccessStatus('microphone');
    log('microphone_permission', { status });
    if (status === 'granted') {
      return true;
    }
    if (status === 'denied' || status === 'restricted') {
      return false;
    }
    const granted = await systemPreferences.askForMediaAccess('microphone');
    log('microphone_permission_result', { granted });
    return granted;
  });

  ipcMain.on('m0:report', (_event, payload) => {
    log('renderer', payload);
    if (payload && payload.done) {
      setTimeout(() => app.quit(), 1500);
    }
  });

  win.webContents.on('render-process-gone', (_event, details) => {
    log('render_process_gone', details);
    app.quit();
  });

  await win.loadFile(path.join(__dirname, 'index.html'));
  setTimeout(() => {
    let expression = 'window.startM0()';
    if (MODE === 'blackhole') {
      expression = `window.startBlackHole(${MEASURE_MS})`;
    } else if (MODE === 'mix') {
      expression = `window.startMix(${MEASURE_MS})`;
    }
    win.webContents
      .executeJavaScript(expression, true)
      .catch((error) => log('execute_error', { error: String(error) }));
  }, 800);
});

app.on('window-all-closed', () => {
  app.quit();
});

setTimeout(() => {
  log('watchdog_timeout');
  app.quit();
}, WATCHDOG_MS);
