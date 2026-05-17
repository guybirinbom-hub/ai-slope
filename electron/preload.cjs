// Tiny IPC bridge for the local-only build.
//
// Renderer runs with contextIsolation + sandbox, so the only way it
// can ask the main process to do something privileged (delete files
// outside the user's profile, quit the app) is over IPC. This preload
// uses contextBridge to expose a small typed surface on
// `window.wgElectron` — nothing else from Electron is exposed.
//
// Currently used by the Settings page's "Uninstall" button. If we
// grow the API, keep it narrow — each method opens an attack surface
// for compromised renderer code, so list-only-what-you-need applies.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('wgElectron', {
  // Wipe user data + the app's install directory and quit. Resolves
  // immediately after the cleanup batch has been queued; the actual
  // wipe happens after the app exits. There's no "cancel" — once the
  // user confirms, all local characters / homebrew / bundles are gone.
  uninstall: () => ipcRenderer.invoke('wg-uninstall'),
  // Window control buttons for the codex-styled winbar. The codex
  // design renders its own min/max/close in the topbar instead of
  // relying on Electron's titleBarOverlay — these hooks let the
  // renderer's button onClicks reach the BrowserWindow APIs.
  windowMinimize: () => ipcRenderer.invoke('wg-window-minimize'),
  windowMaximize: () => ipcRenderer.invoke('wg-window-toggle-maximize'),
  windowClose: () => ipcRenderer.invoke('wg-window-close'),
  windowIsMaximized: () => ipcRenderer.invoke('wg-window-is-maximized'),
});
