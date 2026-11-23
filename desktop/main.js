// Electron shell: opens the game in a desktop window and can host the live office.
// Network access is limited to this computer and the private office network.
const { app, BrowserWindow, Menu, session, ipcMain, shell } = require('electron');
const path = require('path');
const liveServer = require('./server.js');

const fs = require('fs');

const PORT = 8787;

// Drop-in updates: an innovation-office.html placed next to the .exe is used instead of the built-in copy,
// so updating the game only means replacing that one file.
const BUILT_IN = path.join(__dirname, 'app', 'index.html');
const appDirs = () => [process.env.PORTABLE_EXECUTABLE_DIR, path.dirname(process.execPath)].filter(Boolean);
// Office names: config.yaml next to the .exe (kept out of git and out of the .exe itself).
function configFile() {
  for (const d of appDirs()) { const f = path.join(d, 'config.yaml'); if (fs.existsSync(f)) return f; }
  return null;
}
function gameFile() {
  for (const d of appDirs()) {
    const f = path.join(d, 'innovation-office.html');
    try {
      const head = fs.readFileSync(f, 'utf8');
      if (head.includes('<canvas id="cv"') && head.includes('Innovation')) return { file: f, src: 'folder' };
    } catch (e) { /* not there */ }
  }
  return { file: BUILT_IN, src: 'built-in' };
}

let hosted = null;

function isPrivateHost(host) {
  host = host.replace(/^\[|\]$/g, '');
  return host === 'localhost' || host === '::1' || host.endsWith('.local') ||
    /^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host);
}
function allowed(url) {
  if (/^(file|devtools|data|blob):/.test(url)) return true;
  try {
    const u = new URL(url);
    return /^(https?|wss?):$/.test(u.protocol) && isPrivateHost(u.hostname);
  } catch (e) { return false; }
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1000,
    minHeight: 650,
    title: 'Innovation Office',
    backgroundColor: '#d8ecff',
    webPreferences: {
      contextIsolation: true, nodeIntegration: false, sandbox: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });
  Menu.setApplicationMenu(null);
  // Links (e.g. the leaderboard) open in the normal browser, but only office-network addresses.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url) && allowed(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  const g = gameFile();
  win.loadFile(g.file, { query: { src: g.src } });
}

ipcMain.handle('host-start', async () => {
  if (hosted) return { ok: true, port: hosted.port, ips: liveServer.lanIPs() };
  try {
    const s = liveServer.start({
      port: PORT,
      gamePath: gameFile().file, // colleagues who open the host's address get the same version
      configPath: configFile() || path.join(app.getPath('userData'), 'config.yaml'),
      dataDir: app.getPath('userData'),
    });
    await new Promise((resolve, reject) => {
      s.server.once('listening', resolve);
      s.server.once('error', reject);
    });
    hosted = s;
    return { ok: true, port: PORT, ips: liveServer.lanIPs() };
  } catch (e) {
    const msg = e && e.code === 'EADDRINUSE' ? 'port ' + PORT + ' is already in use' : (e && e.message) || 'unknown error';
    return { ok: false, error: msg };
  }
});

ipcMain.on('get-config', e => { const f = configFile(); e.returnValue = f ? liveServer.readConfig(f) : null; });

app.whenReady().then(() => {
  session.defaultSession.webRequest.onBeforeRequest((details, cb) => cb({ cancel: !allowed(details.url) }));
  createWindow();
});
app.on('window-all-closed', () => { if (hosted) hosted.close(); app.quit(); });
