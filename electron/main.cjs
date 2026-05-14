const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');

// The gateway now serves both the API and the static frontend (built into
// frontend/dist with VITE_SUPABASE_URL=http://localhost:9000). One port,
// no Docker frontend container needed.
const APP_URL = process.env.WG_APP_URL || 'http://localhost:9000';

// Resolve all paths the backend needs and pass them via env vars before we
// dynamically-import the ESM backend. Two distinct roots:
//   - read-only resources (bundled SQL, postgrest binary, embedded-postgres
//     binary) live next to the packaged app. Under asar these get unpacked
//     to app.asar.unpacked/ by electron-builder.
//   - writable state (the Postgres data dir, uploaded files) belongs in
//     %AppData% (Electron's userData path).
function configureBackendPaths() {
  const isPackaged = app.isPackaged;
  // appResourcesRoot: where the app's bundled files live on disk. When
  // packaged it's resources/app.asar.unpacked (we mark binaries asarUnpack
  // in package.json so spawn() can run them); when dev it's the repo root.
  const repoRoot = path.resolve(__dirname, '..');
  const appResourcesRoot = isPackaged
    ? path.join(process.resourcesPath, 'app.asar.unpacked')
    : repoRoot;
  // For schema.sql / data.sql we DON'T need unpacked — readFileSync works
  // transparently with paths inside asar.
  const dataFilesRoot = isPackaged ? app.getAppPath() : repoRoot;
  const userData = app.getPath('userData');
  const writableDataDir = path.join(userData, 'data');
  fs.mkdirSync(writableDataDir, { recursive: true });

  process.env.WG_PG_DATA = process.env.WG_PG_DATA || path.join(writableDataDir, 'embedded-pg');
  process.env.WG_STORAGE_DIR = process.env.WG_STORAGE_DIR || path.join(writableDataDir, 'storage');
  process.env.WG_POSTGREST_BIN = process.env.WG_POSTGREST_BIN || path.join(appResourcesRoot, 'electron', 'bin', 'postgrest.exe');
  process.env.WG_PG_BIN_DIR = process.env.WG_PG_BIN_DIR || path.join(appResourcesRoot, 'node_modules', '@embedded-postgres', 'windows-x64', 'native', 'bin');
  process.env.WG_SCHEMA_SQL = process.env.WG_SCHEMA_SQL || path.join(dataFilesRoot, 'data', 'schema.sql');
  process.env.WG_DATA_SQL = process.env.WG_DATA_SQL || path.join(dataFilesRoot, 'data', 'data.sql');
}
configureBackendPaths();

let mainWindow = null;
let backend = null;

// Inline loading screen that lives inside the main window itself — no
// separate splash. We open the main window immediately on app.whenReady,
// show this while the backend boots, and swap to APP_URL once the gateway
// is listening. This makes perceived startup ~Chromium's load time instead
// of (Chromium + Postgres + PostgREST).
const LOADING_HTML = `<!doctype html><html><head><meta charset="utf-8">
<title>Wanderer's Guide</title>
<style>
  body { margin:0; font-family: system-ui, sans-serif; background:#1a1b1e; color:#c1c2c5;
         display:flex; align-items:center; justify-content:center; height:100vh; }
  .box { text-align:center; }
  .title { font-size: 28px; margin-bottom: 18px; letter-spacing: 0.5px; }
  .status { font-size: 14px; color:#909296; min-height: 1.4em; }
  .err { color:#ff6b6b; white-space: pre-wrap; text-align:left; max-width: 520px;
         margin: 12px auto 0; font-family: ui-monospace, monospace; font-size: 12px; }
  .spinner { width: 40px; height: 40px; border-radius: 50%;
             border: 3px solid #2c2e33; border-top-color: #4dabf7;
             margin: 0 auto 22px; animation: spin 0.8s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
</style></head><body>
  <div class="box">
    <div class="spinner"></div>
    <div class="title">Wanderer's Guide</div>
    <div class="status" id="s">Starting local backend…</div>
    <div class="err" id="e"></div>
  </div>
</body></html>`;
const LOADING_DATA_URL = 'data:text/html;charset=utf-8,' + encodeURIComponent(LOADING_HTML);

function setStatus(win, text, isError = false) {
  if (!win || win.isDestroyed()) return;
  const escaped = JSON.stringify(text);
  const target = isError ? 'e' : 's';
  win.webContents
    .executeJavaScript(`document.getElementById(${JSON.stringify(target)})&&(document.getElementById(${JSON.stringify(target)}).textContent = ${escaped})`)
    .catch(() => {});
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: "Wanderer's Guide (local)",
    backgroundColor: '#1a1b1e',
    autoHideMenuBar: true,
    show: false,
    // Frameless window with the native Windows min/max/close still
    // visible in the top-right via titleBarOverlay. Lets the web view
    // claim the whole window — no separate OS title bar strip — while
    // the user can still drag the window from any element styled with
    // CSS `-webkit-app-region: drag` (a thin strip at the top of the
    // app's own UI handles that). `symbolColor` matches the dimmed
    // body text so the controls don't clash on the dark background.
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#1a1b1e',
      symbolColor: '#aaaaaa',
      height: 32,
    },
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // Narrow IPC surface for privileged renderer-initiated actions
      // (currently just the Settings page "Uninstall" button).
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });
  // Start with the inline loading screen so the user sees the window
  // immediately even before the backend is up.
  mainWindow.loadURL(LOADING_DATA_URL);
  mainWindow.once('ready-to-show', () => mainWindow.show());

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://localhost') || url.startsWith('app://')) {
      return { action: 'allow' };
    }
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

// Parallel-boot startup. The previous "wait for everything, THEN show app"
// flow added ~3-5s of dead time because the frontend bundle (10MB) couldn't
// start downloading + parsing until the backend was fully up.
//
// New order:
//   1. Import backend module + start gateway (fast: ~300-800ms total)
//   2. Navigate the window to APP_URL — frontend bundle downloads + parses
//      WHILE pg + postgrest are still warming up in the background
//   3. backend.start() (pg init + bootstrap + postgrest) runs in parallel
//   4. When pg is ready, call backend.markReady() so the frontend's poll of
//      /wg/ready flips and content fetches kick off
//
// The frontend handles "backend not ready yet" by checking /wg/ready before
// issuing data queries. Auth queries (/auth/v1) are served by the gateway
// without touching pg, so they work the whole time.
async function startBackend() {
  const t0 = Date.now();
  setStatus(mainWindow, 'Starting…');
  backend = await import('./backend/index.mjs');
  console.log('[main] backend module loaded after', Date.now() - t0, 'ms');

  // Gateway first — it can serve the frontend static bundle (and the
  // /auth/v1 stub + /wg/ready) without pg being up.
  const t1 = Date.now();
  await backend.startGateway();
  console.log('[main] backend.startGateway() took', Date.now() - t1, 'ms');

  // Swap the loading-data-URL for the real app NOW. The bundle starts
  // downloading + parsing on the renderer side while we kick off the
  // expensive pg + postgrest warm-up below.
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.loadURL(APP_URL).catch((err) => {
      console.error('[main] loadURL failed:', err);
    });
  }

  // pg + postgrest warm-up runs in the background. We don't await this
  // before the loadURL above — it's allowed to take its time. Once it
  // resolves we mark the backend ready, which the frontend polls for via
  // /wg/ready before firing data fetches.
  const t2 = Date.now();
  backend
    .start()
    .then(() => {
      console.log('[main] backend.start() took', Date.now() - t2, 'ms');
      console.log('[main] total boot:', Date.now() - t0, 'ms');
      backend.markReady();
    })
    .catch((err) => {
      console.error('[main] backend.start() failed:', err);
      backend.markReady({ error: String(err && err.message || err) });
    });
}

app.whenReady().then(async () => {
  createMainWindow();
  try {
    await startBackend();
  } catch (err) {
    console.error('[main] backend failed to start:', err);
    setStatus(mainWindow, 'Failed to start the local backend.');
    setStatus(mainWindow, String(err && err.stack || err), true);
  }
});

// Single, idempotent shutdown path. Wired up to multiple lifecycle events
// because each one fires under different conditions:
//   before-quit       graceful (menu Quit, app.quit())
//   window-all-closed user closed the last window
//   SIGINT/SIGTERM    Ctrl+C in the terminal that launched npm run app
let shuttingDown = false;
async function shutdown(reason) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log('[main] shutdown:', reason);
  if (backend) {
    try {
      // Cap shutdown — if pg_ctl hangs, the hardKillBackendChildren in
      // backend.stop() still gets called via Promise.race inside.
      await Promise.race([
        backend.stop(),
        new Promise((r) => setTimeout(r, 6000)),
      ]);
    } catch (err) {
      console.error('[main] backend stop error:', err);
    }
    backend = null;
  }
  // Force-exit so we don't leak a hung Electron process.
  setImmediate(() => process.exit(0));
}

app.on('before-quit', (e) => {
  if (!backend || shuttingDown) return;
  e.preventDefault();
  shutdown('before-quit');
});

app.on('window-all-closed', () => {
  if (process.platform === 'darwin') return;
  if (!shuttingDown) shutdown('window-all-closed');
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0 && backend) createMainWindow();
});

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// IPC: nuke the app from orbit. Invoked by the Settings page's
// Uninstall button (via preload.cjs → window.wgElectron.uninstall()).
//
// We can't delete the running .exe ourselves because Windows holds
// an exclusive lock on it until the process exits. Workaround: write
// a one-shot batch script to %TEMP%, spawn it detached, then kick off
// our normal graceful shutdown (which releases the pg-data lock so the
// recursive delete actually succeeds). The batch:
//   1. Sleeps ~3 s via `ping` (more portable than `timeout` in non-
//      interactive shells).
//   2. Recursively deletes the userData dir (pg-data, uploaded
//      images, electron caches, localStorage, IndexedDB).
//   3. If packaged, recursively deletes the install dir (the folder
//      holding Wanderer's Guide.exe and its DLLs). Dev mode skips
//      this so we don't blow away node_modules/electron/dist.
//   4. Self-deletes.
//
// There is NO undo — by the time the batch finishes, every byte of
// state this app ever wrote is gone. The renderer's confirm modal
// is the last chance to back out.
ipcMain.handle('wg-uninstall', async () => {
  const userData = app.getPath('userData');
  const exeDir = path.dirname(app.getPath('exe'));
  const isPackaged = app.isPackaged;

  const q = (p) => p.replace(/"/g, '""');

  const lines = [
    '@echo off',
    'rem Wait ~3s for the parent app to fully exit + release pg-data locks.',
    'ping -n 4 127.0.0.1 > nul',
    `rd /s /q "${q(userData)}"`,
  ];
  if (isPackaged) {
    lines.push(`rd /s /q "${q(exeDir)}"`);
  } else {
    lines.push('rem dev mode: leaving the unpacked exe / node_modules alone.');
  }
  lines.push('del "%~f0"');

  const scriptPath = path.join(os.tmpdir(), `wg-uninstall-${Date.now()}.bat`);
  fs.writeFileSync(scriptPath, lines.join('\r\n'));
  console.log('[main] uninstall: wrote cleanup script to', scriptPath);

  // Detached so the batch survives our exit. `windowsHide` hides the
  // console window so the user doesn't see a black flash before the
  // app dies.
  spawn('cmd.exe', ['/c', scriptPath], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  }).unref();

  // Give the IPC reply a beat to make it back to the renderer before
  // we tear the window down (and let the renderer paint its
  // "Uninstalling…" notification).
  setTimeout(() => app.quit(), 150);
  return { ok: true };
});

// During shutdown the pg client / postgrest pipes can emit errors when their
// upstream sockets are force-closed. Without a handler, Electron pops the
// 'A JavaScript error occurred' dialog AFTER the app has already exited.
// Swallow during shutdown; surface anything else.
process.on('uncaughtException', (err) => {
  if (shuttingDown) {
    console.error('[main] suppressed during shutdown:', err && err.message ? err.message : err);
    return;
  }
  console.error('[main] uncaughtException:', err);
});
process.on('unhandledRejection', (reason) => {
  if (shuttingDown) {
    console.error('[main] suppressed during shutdown (rejection):', reason && reason.message ? reason.message : reason);
    return;
  }
  console.error('[main] unhandledRejection:', reason);
});
