const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
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
// Reference to the backend's synchronous force-kill, kept separately so the
// process-'exit' safety net below can always call it — even after shutdown()
// nulls `backend`. Set once the backend module is imported.
let backendForceKill = null;

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
    backgroundColor: '#14161a',
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
  // The window is created hidden (show:false) and intentionally loads
  // NOTHING here. startBackend() navigates it to APP_URL once the gateway
  // is up, and the window only reveals on 'ready-to-show' — i.e. once
  // index.html has painted its #wg-boot spinner. By never loading a
  // file:// splash and never showing the raw window, we avoid the blank
  // window, the wrong-theme backdrop, and the file://→http:// cross-process
  // navigation flash the previous splash-then-loadURL flow produced.
  // (LOADING_FILE is still used as an error surface in whenReady()'s catch.)
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
  // Safety net: if 'ready-to-show' never fires (e.g. the backend errors
  // before APP_URL can load), reveal the window anyway after a few seconds
  // so it can't get stuck permanently invisible.
  setTimeout(() => {
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) {
      mainWindow.setFullScreen(true);
      mainWindow.show();
    }
  }, 6000);

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

  // Stage 1 — import the backend module (filesystem read + JS parse).
  backend = await import('./backend/index.mjs');
  backendForceKill = backend.hardKillBackendChildren || null;
  console.log('[main] backend module loaded after', Date.now() - t0, 'ms');

  // Stage 2 — gateway listening. Once this resolves the gateway can
  // serve APP_URL (index.html + the static bundle) and the /auth/v1
  // shim, so it's safe to navigate the window to it.
  const t1 = Date.now();
  await backend.startGateway();
  console.log('[main] backend.startGateway() took', Date.now() - t1, 'ms');

  // Stage 3 — kick off pg + postgrest warm-up in the background. We
  // intentionally don't await it before the loadURL below; the frontend
  // bundle downloads + parses while pg starts. BackendReadyGate inside
  // the React app holds the user at a theme-aware spinner until
  // markReady() flips /wg/ready, then swaps to the real page.
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

  // Navigate to the app now that the gateway is up. The window is still
  // hidden (show:false) and only reveals on 'ready-to-show' — once
  // index.html has painted its #wg-boot spinner. So there's no file→http
  // cross-process flash, no raw-window backdrop, and no separate splash
  // document to blank between: index.html's spinner hands straight off to
  // React's BackendReadyGate spinner while pg finishes warming in the
  // background.
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.loadURL(APP_URL).catch((err) => console.error('[main] loadURL failed:', err));
  }
}

// ─── Auto-update ────────────────────────────────────────────────────────────
// Installed (NSIS) builds check the GitHub releases feed (the `publish`
// config in package.json → guybirinbom-hub/ai-slope), download the new
// Setup in the background, and offer a one-click "restart & update" — so
// users never have to re-download installers from the Releases page.
//
// Quietly does nothing when:
//   - running from source (`npm run app`) — app.isPackaged is false
//   - running the PORTABLE build — no resources/app-update.yml is bundled
//   - offline / GitHub unreachable — errors are logged and swallowed;
//     the app must keep working fully offline.
let updatePromptOpen = false;
function setupAutoUpdate() {
  if (!app.isPackaged) return;
  try {
    if (!fs.existsSync(path.join(process.resourcesPath, 'app-update.yml'))) {
      console.log('[update] no app-update.yml (portable build) — auto-update disabled');
      return;
    }
    const { autoUpdater } = require('electron-updater');
    autoUpdater.autoDownload = true;
    // If the user dismisses the prompt, still apply the downloaded update
    // the next time the app quits normally.
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.on('error', (err) => {
      console.log('[update] error (ignored):', err && err.message ? err.message : err);
    });
    autoUpdater.on('update-downloaded', (info) => {
      if (updatePromptOpen) return;
      updatePromptOpen = true;
      const w = mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined;
      dialog
        .showMessageBox(w, {
          type: 'info',
          title: 'Update ready',
          message: `Wanderer's Guide ${info.version} has been downloaded.`,
          detail: 'Restart now to install the update? Your characters and data are kept.',
          buttons: ['Restart && Update', 'Later'],
          defaultId: 0,
          cancelId: 1,
        })
        .then(({ response }) => {
          updatePromptOpen = false;
          if (response === 0) {
            // Spawns the installer (silent) and quits. Our shutdown path
            // stops Postgres on before-quit, then the installer swaps the
            // app files and relaunches.
            autoUpdater.quitAndInstall(true, true);
          }
        })
        .catch(() => {
          updatePromptOpen = false;
        });
    });
    const check = () => {
      autoUpdater.checkForUpdates().catch((err) => {
        console.log('[update] check failed (ignored):', err && err.message ? err.message : err);
      });
    };
    // First check shortly after boot (let the backend/window settle), then
    // every 4 hours for long-running sessions.
    setTimeout(check, 15_000);
    setInterval(check, 4 * 60 * 60 * 1000);
  } catch (err) {
    console.log('[update] setup failed (ignored):', err && err.message ? err.message : err);
  }
}

app.whenReady().then(async () => {
  createMainWindow();
  setupAutoUpdate();
  try {
    await startBackend();
  } catch (err) {
    console.error('[main] backend failed to start:', err);
    // This path only runs if the module import or gateway start failed —
    // APP_URL can't load, so the window has no page yet. Fall back to the
    // file splash purely so we can surface the error on its overlay.
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow
        .loadFile(LOADING_FILE)
        .then(() => {
          mainWindow.setFullScreen(true);
          mainWindow.show();
          setStatus(mainWindow, 'The codex is sealed shut.');
          setStatus(mainWindow, String((err && err.stack) || err), true);
        })
        .catch(() => {});
    }
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

// Last-resort safety net against orphaned Postgres. PG is spawned as a normal
// child, and Windows does NOT kill child processes when the parent exits — so
// if we ever reach process exit WITHOUT stop() having killed the pg/postgrest
// tree (stop() hung past shutdown()'s 6s race, or an uncaught exception is
// tearing us down), they'd be left running and hold the data-dir lock. The
// 'exit' event allows only synchronous work, which is exactly what
// hardKillBackendChildren() is (a synchronous taskkill). No-op when stop()
// already cleaned up. A hard crash / Task-Manager kill can't fire this — that
// case is covered by runPostgresDirect()'s pre-spawn cleanup on the next launch.
process.on('exit', () => {
  try {
    if (backendForceKill) backendForceKill();
  } catch {
    // Mid-exit: nothing more we can do, just don't throw.
  }
});

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

  // INSTALLED builds have the real NSIS uninstaller sitting next to the
  // exe ("Uninstall Wanderer's Guide.exe"). Running it silently is the
  // only way to remove EVERYTHING the installer created — app files,
  // desktop + Start-menu shortcuts, and the Add/Remove Programs registry
  // entry — and its customUnInstall hook (build/installer.nsh) also wipes
  // userData and the updater/cache dirs. The old approach of `rd /s /q`
  // on the folders left the shortcuts and the registry entry orphaned.
  let uninstallerPath = null;
  if (isPackaged) {
    try {
      const hit = fs.readdirSync(exeDir).find((f) => /^uninstall .*\.exe$/i.test(f));
      if (hit) uninstallerPath = path.join(exeDir, hit);
    } catch (err) {
      console.log('[main] uninstall: no NSIS uninstaller found:', err?.message);
    }
  }

  const lines = [
    '@echo off',
    'rem Run from TEMP so this shell holds no lock on the dirs being removed.',
    'cd /d "%TEMP%"',
    'rem Wait ~3s for the parent app to fully exit + release pg-data locks.',
    'ping -n 4 127.0.0.1 > nul',
    'rem Belt-and-braces: kill any orphaned backend children still holding files.',
    'taskkill /F /IM postgres.exe > nul 2>&1',
    'taskkill /F /IM postgrest.exe > nul 2>&1',
  ];
  if (uninstallerPath) {
    lines.push(`"${q(uninstallerPath)}" /S`);
  } else {
    // Portable / unpacked / dev fallback — no registered uninstaller exists
    // (and no shortcuts or registry entry were ever created for these), so
    // remove every footprint directly.
    lines.push(`rd /s /q "${q(userData)}"`);
    if (process.env.LOCALAPPDATA) {
      lines.push(`rd /s /q "${q(path.join(process.env.LOCALAPPDATA, "Wanderer's Guide"))}"`);
      lines.push(`rd /s /q "${q(path.join(process.env.LOCALAPPDATA, 'wanderers-guide-updater'))}"`);
    }
    if (isPackaged) {
      lines.push(`rd /s /q "${q(exeDir)}"`);
    } else {
      lines.push('rem dev mode: leaving the unpacked exe / node_modules alone.');
    }
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
