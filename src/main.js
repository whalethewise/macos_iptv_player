const { app, BrowserWindow, ipcMain, session, safeStorage, screen } = require('electron');
const path = require('path');
const https = require('https');
const http = require('http');
const { execFile } = require('child_process');
const mpvAPI = require('node-mpv');

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
      sandbox: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file://')) event.preventDefault();
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.setMenuBarVisibility(false);
}

// ─── MPV PLAYER ──────────────────────────────────────────
function resolveMpvBinary() {
  const fs = require('fs');
  if (process.env.MPV_PATH) {
    const p = process.env.MPV_PATH;
    if (path.isAbsolute(p) && !/[;&|`$<>]/.test(p)) {
      try { fs.accessSync(p, fs.constants.X_OK); return p; } catch {}
    }
  }
  const fallbacks = ['/opt/homebrew/bin/mpv', '/usr/local/bin/mpv', '/usr/bin/mpv'];
  return fallbacks.find(p => { try { fs.accessSync(p); return true; } catch {} }) || 'mpv';
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
  if (!url || !configuredServer) return { error: 'Blocked: no server configured' };
  try {
    const reqUrl = new URL(url);
    const srvUrl = new URL(configuredServer);
    if (!['http:', 'https:'].includes(reqUrl.protocol) ||
        reqUrl.hostname !== srvUrl.hostname || reqUrl.port !== srvUrl.port) {
      return { error: 'Blocked: stream URL does not match configured server' };
    }
  } catch {
    return { error: 'Blocked: invalid stream URL' };
  }
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

ipcMain.handle('fetch-image', async (event, url) => {
  if (!url || !url.match(/^https?:\/\//)) return null;
  const MAX_SIZE = 2 * 1024 * 1024;
  return new Promise((resolve) => {
    const proto = url.startsWith('https') ? https : http;
    const req = proto.get(url, { timeout: 8000 }, (res) => {
      if (res.statusCode !== 200) { res.resume(); return resolve(null); }
      const chunks = [];
      let size = 0;
      res.on('data', chunk => {
        size += chunk.length;
        if (size > MAX_SIZE) { req.destroy(); resolve(null); return; }
        chunks.push(chunk);
      });
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        const ct = (res.headers['content-type'] || 'image/png').split(';')[0].trim();
        if (!ct.startsWith('image/')) return resolve(null);
        resolve(`data:${ct};base64,${buf.toString('base64')}`);
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
});

// ─── APP LIFECYCLE ───────────────────────────────────────
app.whenReady().then(() => {
  const allowedPermissions = ['media', 'mediaKeySystem'];
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    callback(allowedPermissions.includes(permission));
  });

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const headers = { ...details.responseHeaders };
    if (details.url.startsWith('file://')) {
      headers['Content-Security-Policy'] = [
        "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src data: blob:; connect-src 'none';"
      ];
    }
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
    if (!safeStorage.isEncryptionAvailable()) return false;
    const json = JSON.stringify(creds);
    const encrypted = safeStorage.encryptString(json);
    fs.writeFileSync(credsPath, encrypted);
    return true;
  } catch { return false; }
});

ipcMain.handle('load-creds', () => {
  try {
    if (!fs.existsSync(credsPath) || !safeStorage.isEncryptionAvailable()) return null;
    const raw = fs.readFileSync(credsPath);
    const decrypted = safeStorage.decryptString(raw);
    return JSON.parse(decrypted);
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
  if (!server) { configuredServer = null; return; }
  try {
    const parsed = new URL(server);
    if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname) {
      configuredServer = null;
      return;
    }
    configuredServer = server.replace(/\/$/, '');
  } catch { configuredServer = null; }
});

ipcMain.handle('xtream-request', async (event, { url }) => {
  if (!configuredServer) throw new Error('Request blocked: no server configured');
  try {
    const reqUrl = new URL(url);
    const srvUrl = new URL(configuredServer);
    if (!['http:', 'https:'].includes(reqUrl.protocol) ||
        reqUrl.hostname !== srvUrl.hostname || reqUrl.port !== srvUrl.port) {
      throw new Error('URL does not match configured server');
    }
  } catch (e) {
    throw new Error('Request blocked: ' + e.message);
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
