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

// Single-instance lock. Without this, if the user closes the window
// and re-launches before the previous process has finished shutting
// down (pg.stop has up to ~10s of pg_ctl grace + a 6s outer cap), the
// 2nd instance tries to bind port 9000 and the embedded pg lock file
// at the same time as the 1st, and both end up half-broken — the user
// sees an indefinitely-stuck "Starting…" splash on the 2nd launch and
// the 3rd launch finally works because by then the 1st is fully gone.
//
// With this lock: the 2nd launch's process exits immediately, and we
// surface the existing window instead. The Electron docs recommend
// doing this synchronously at the top of main, BEFORE any window or
// backend init, so we get out of the way before grabbing any
// resources.
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  // Another instance is already running. Quit immediately — the
  // running instance will handle the 'second-instance' event below
  // and focus its window.
  app.quit();
  process.exit(0);
}
app.on('second-instance', () => {
  // Someone tried to launch us again while we're alive — bring our
  // existing window to the front so the user sees something happened.
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

// Codex parchment loading screen. Lives in electron/codex-loading.html
// (so the file picker / design canvas can preview it) and is loaded
// into the main window via loadFile() at startup, then swapped for the
// real APP_URL once the gateway is listening. The React shell renders
// the SAME file inside BackendReadyGate (served from
// frontend/public/codex-loading.html) so users never see a style
// break between the Electron-level boot stage and the React-level
// "warming up the database" stage.
const LOADING_FILE = path.join(__dirname, 'codex-loading.html');

// setStatus() is now error-only: the loading HTML cycles its own
// status flavour text on a loop, but if the backend fails to start
// we still need to surface the real error to the user. We flip the
// hidden .err-overlay visible and write the message into #err-msg.
function setStatus(win, text, isError = false) {
  if (!win || win.isDestroyed()) return;
  // Non-error status pings are no-ops — the new codex loader owns
  // its own flavour rotation and doesn't expose a "current step"
  // hook. We keep the parameter for source-compat with callers.
  if (!isError) return;
  const escaped = JSON.stringify(text);
  win.webContents
    .executeJavaScript(
      'var o=document.getElementById("err-overlay"),m=document.getElementById("err-msg");' +
      'if(m)m.textContent=' + escaped + ';' +
      'if(o)o.classList.add("on");'
    )
    .catch(() => {});
}

// Push a real progress value (0–100) to the codex loader. Safe to call
// before the page is parsed — failed executeJavaScripts are swallowed.
function setLoaderProgress(win, pct) {
  if (!win || win.isDestroyed()) return;
  const n = Math.max(0, Math.min(100, Number(pct) || 0));
  win.webContents
    .executeJavaScript(
      'window.codexProgress && window.codexProgress(' + n + ');'
    )
    .catch(() => {});
}

// Trigger the d20 land + final 100% jump. Called RIGHT before we swap
// the splash for APP_URL so the dice lock is the last thing the user
// sees before the real frontend mounts.
function completeLoader(win) {
  if (!win || win.isDestroyed()) return;
  win.webContents
    .executeJavaScript('window.codexComplete && window.codexComplete();')
    .catch(() => {});
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: "Wanderer's Guide (local)",
    // Codex splash + BackendReadyGate both use #15110b. Keep the
    // window backdrop on the same colour so the loadURL navigation
    // from splash → React doesn't flash a different tone in the gap
    // between documents unloading.
    backgroundColor: '#15110b',
    autoHideMenuBar: true,
    show: false,
    // Frameless window. Codex design renders its own gold-styled
    // min/max/close inside the .winbar (top of the page), wired via
    // wgElectron.windowMinimize/Maximize/Close IPC. titleBarOverlay
    // is intentionally omitted so we don't get a competing native
    // button strip overlapping the codex chrome. Drag region is set
    // via CSS `-webkit-app-region: drag` on the .winbar element.
    titleBarStyle: 'hidden',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // Narrow IPC surface for privileged renderer-initiated actions
      // (currently just the Settings page "Uninstall" button).
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });
  // Start with the codex loading file so the user sees the window
  // immediately even before the backend is up.
  mainWindow.loadFile(LOADING_FILE);
  // Open fullscreen. Per request — the user wants the app to fill the
  // entire display (no taskbar visible) on launch, not just maximize
  // inside the available work area. setFullScreen(true) hides the OS
  // taskbar; the codex's custom min/max/close buttons in the .winbar
  // still drive the window through the wg-window-* IPC, including the
  // middle "restore" button which un-fullscreens via the existing
  // wg-window-toggle-maximize handler (we update that below to also
  // exit fullscreen when active).
  //
  // BrowserWindow.width / .height still define the restore-size so
  // un-fullscreening lands at a sane window size, not the last frame
  // the user happened to have.
  mainWindow.once('ready-to-show', () => {
    mainWindow.setFullScreen(true);
    mainWindow.show();
  });

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

  // Stage 1 — backend module imported (filesystem + JS parse).
  // The codex loader currently sits at 0; nudge it to 15% so the bar
  // moves immediately after Electron paints the first frame.
  setLoaderProgress(mainWindow, 15);
  backend = await import('./backend/index.mjs');
  console.log('[main] backend module loaded after', Date.now() - t0, 'ms');
  setLoaderProgress(mainWindow, 35);

  // Stage 2 — gateway listening. This is the point at which the
  // renderer COULD load /auth/v1 and /wg/ready, but we want the
  // splash to finish its landing animation first.
  const t1 = Date.now();
  await backend.startGateway();
  console.log('[main] backend.startGateway() took', Date.now() - t1, 'ms');
  setLoaderProgress(mainWindow, 60);

  // Stage 3 — kick off pg + postgrest warm-up in the background. We
  // intentionally don't await it before the loadURL below; the
  // frontend bundle parses while pg starts. BackendReadyGate inside
  // the React app shows its own copy of the loader (iframed) while
  // pg finishes warming, and that one gets its 100% from
  // markReady(). The progress reported here covers the Electron
  // side only: module → gateway → "about to navigate".
  const t2 = Date.now();
  const startPromise = backend.start();
  startPromise.then(() => {
    console.log('[main] backend.start() took', Date.now() - t2, 'ms');
    console.log('[main] total boot:', Date.now() - t0, 'ms');
    backend.markReady();
  }).catch((err) => {
    console.error('[main] backend.start() failed:', err);
    backend.markReady({ error: String(err && err.message || err) });
  });

  // Trigger the d20 land + 100% jump on the splash, then swap to
  // APP_URL. Give the lock animation just enough time to be visibly
  // registered (200ms — about half the .42s land keyframe; the rest
  // of the animation gets cut off by the navigation, but by then the
  // user has clearly seen the rolled number snap onto a stable face).
  //
  // Was 700ms — the user complained the loader "stays at 100" too
  // long after the roll. Combined with the React-level
  // BackendReadyGate that ALSO shows a fresh dice for another
  // 900+500ms on the warm path, the original 700ms here ballooned
  // the total post-first-roll wait to ~2.1s. BackendReadyGate now
  // skips its iframe on the warm path (renders a plain black screen
  // for up to 500ms, only mounts the second dice if the backend is
  // genuinely slow), so the perceived loader closes within ~1s of
  // the splash dice locking.
  completeLoader(mainWindow);
  setTimeout(() => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.loadURL(APP_URL).catch((err) => {
        console.error('[main] loadURL failed:', err);
      });
    }
  }, 200);
}

app.whenReady().then(async () => {
  createMainWindow();
  try {
    await startBackend();
  } catch (err) {
    console.error('[main] backend failed to start:', err);
    setStatus(mainWindow, 'The codex is sealed shut.');
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

// ---- Window control IPC (used by codex-styled winbar buttons) ----
// The renderer's custom min/max/close buttons in the codex .winbar
// invoke these. We use the focused BrowserWindow so the right window
// gets controlled even if multiple are open (currently we only ever
// have one, but cheap insurance).

ipcMain.handle('wg-window-minimize', () => {
  const w = BrowserWindow.getFocusedWindow() || mainWindow;
  if (w) w.minimize();
});

ipcMain.handle('wg-window-toggle-maximize', () => {
  const w = BrowserWindow.getFocusedWindow() || mainWindow;
  if (!w) return;
  // Three-state toggle: fullscreen → maximized → restore. The app
  // launches in fullscreen now (mainWindow.setFullScreen(true)) so
  // the codex restore button needs to exit fullscreen first — if we
  // just called unmaximize() on a fullscreen window it'd no-op and
  // the user would be stuck at full screen with no taskbar.
  if (w.isFullScreen()) {
    w.setFullScreen(false);
    return;
  }
  if (w.isMaximized()) w.unmaximize();
  else w.maximize();
});

ipcMain.handle('wg-window-close', () => {
  const w = BrowserWindow.getFocusedWindow() || mainWindow;
  if (w) w.close();
});

ipcMain.handle('wg-window-is-maximized', () => {
  // Treat fullscreen as "maximized" for icon purposes — the restore
  // button shows the same chrome whether the window is fullscreen or
  // OS-maximized, and clicking it exits whichever mode is active.
  const w = BrowserWindow.getFocusedWindow() || mainWindow;
  return !!(w && (w.isMaximized() || w.isFullScreen()));
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
