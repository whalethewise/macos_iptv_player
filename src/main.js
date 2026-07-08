const { app, BrowserWindow, ipcMain, session, safeStorage, screen } = require('electron');
const path = require('path');
const https = require('https');
const http = require('http');
const { execFile, execSync } = require('child_process');
const mpvAPI = require('node-mpv');

process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = 'true';

let mainWindow;
let mpv = null;

function createWindow() {
  const { width: screenW, height: screenH } = screen.getPrimaryDisplay().workAreaSize;
  const sidebarW = 380;

  mainWindow = new BrowserWindow({
    width: sidebarW,
    height: screenH,
    x: 0,
    y: 0,
    minWidth: 320,
    maxWidth: 500,
    minHeight: 500,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#0a0a0f',
    vibrancy: 'under-window',
    visualEffectState: 'active',
    alwaysOnTop: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      webSecurity: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));
  mainWindow.setMenuBarVisibility(false);
}

// ─── MPV PLAYER ──────────────────────────────────────────
function resolveMpvBinary() {
  if (process.env.MPV_PATH) return process.env.MPV_PATH;
  try { return execSync('which mpv', { encoding: 'utf8' }).trim(); } catch {}
  const fallbacks = ['/opt/homebrew/bin/mpv', '/usr/local/bin/mpv', '/usr/bin/mpv'];
  return fallbacks.find(p => { try { require('fs').accessSync(p); return true; } catch {} }) || 'mpv';
}

function initMpv() {
  const { width: screenW, height: screenH } = screen.getPrimaryDisplay().workAreaSize;

  try {
    mpv = new mpvAPI({
      binary: resolveMpvBinary(),
      verbose: false,
    }, [
      '--no-terminal',
      '--keep-open=yes',
      '--idle=yes',
      '--force-window=yes',
      `--title=IPTV Player`,
      '--osc=yes',
      '--input-default-bindings=yes',
      '--input-vo-keyboard=yes',
      '--sub-auto=fuzzy',
      '--hwdec=auto',
      '--cursor-autohide=1000',
    ]);

    console.log('[MPV] Initializing...');

    // Position the mpv window next to the sidebar via AppleScript (one-time, won't reset on load)
    setTimeout(() => {
      const x = 385;
      const y = 0;
      const w = screenW - 390;
      const h = screenH;
      const script = `tell application "System Events" to tell (first process whose name is "mpv")
        set position of first window to {${x}, ${y}}
        set size of first window to {${w}, ${h}}
      end tell`;
      execFile('osascript', ['-e', script], (err) => {
        if (err) console.error('[MPV] AppleScript position error:', err.message);
        else console.log('[MPV] Window positioned via AppleScript');
      });
    }, 1500);

  } catch (err) {
    console.error('[MPV] Failed to init:', err.message);
    mpv = null;
  }
}

// MPV IPC handlers
ipcMain.handle('mpv-play', async (event, url) => {
  if (!mpv) return { error: 'mpv not available' };
  try {
    await mpv.load(url);
    return { ok: true };
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('mpv-stop', async () => {
  if (!mpv) return;
  try { await mpv.stop(); } catch {}
});

// ─── APP LIFECYCLE ───────────────────────────────────────
app.whenReady().then(() => {
  const allowedPermissions = ['media', 'mediaKeySystem'];
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    callback(allowedPermissions.includes(permission));
  });

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const headers = { ...details.responseHeaders };
    delete headers['content-security-policy'];
    delete headers['Content-Security-Policy'];
    delete headers['x-frame-options'];
    delete headers['X-Frame-Options'];
    headers['Access-Control-Allow-Origin'] = ['*'];
    headers['Access-Control-Allow-Headers'] = ['*'];
    callback({ responseHeaders: headers });
  });

  createWindow();
  initMpv();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (mpv) { try { mpv.quit(); } catch {} }
  app.quit();
});

// ─── CREDENTIALS ─────────────────────────────────────────
const fs = require('fs');
const credsPath = path.join(app.getPath('userData'), 'credentials.enc');

ipcMain.handle('save-creds', (event, creds) => {
  try {
    const json = JSON.stringify(creds);
    if (safeStorage.isEncryptionAvailable()) {
      const encrypted = safeStorage.encryptString(json);
      fs.writeFileSync(credsPath, encrypted);
    } else {
      fs.writeFileSync(credsPath, json);
    }
    return true;
  } catch { return false; }
});

ipcMain.handle('load-creds', () => {
  try {
    if (!fs.existsSync(credsPath)) return null;
    const raw = fs.readFileSync(credsPath);
    if (safeStorage.isEncryptionAvailable()) {
      const decrypted = safeStorage.decryptString(raw);
      return JSON.parse(decrypted);
    }
    return JSON.parse(raw.toString('utf8'));
  } catch { return null; }
});

ipcMain.handle('clear-creds', () => {
  try {
    if (fs.existsSync(credsPath)) fs.unlinkSync(credsPath);
    return true;
  } catch { return false; }
});

// ─── XTREAM API PROXY ────────────────────────────────────
let configuredServer = null;

ipcMain.handle('set-server', (event, server) => {
  configuredServer = server ? server.replace(/\/$/, '') : null;
});

ipcMain.handle('xtream-request', async (event, { url }) => {
  if (!configuredServer || !url.startsWith(configuredServer)) {
    throw new Error('Request blocked: URL does not match configured server');
  }

  return new Promise((resolve, reject) => {
    const proto = url.startsWith('https') ? https : http;
    const req = proto.get(url, { timeout: 15000 }, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve(data); }
      });
    });
    req.on('error', (err) => reject(err.message));
    req.on('timeout', () => { req.destroy(); reject('Request timed out'); });
  });
});
