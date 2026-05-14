/// <reference types="vite/client" />

// Local-only build: IPC bridge exposed by electron/preload.cjs.
// Only available when the renderer runs inside the Electron app.
// May be undefined in tests / dev-server contexts — callers should
// guard with `if (window.wgElectron)`.
declare global {
  interface Window {
    wgElectron?: {
      /**
       * Wipe user data + the app's install directory and quit.
       * Resolves immediately after the cleanup batch has been queued;
       * the actual wipe happens after the app exits. No undo.
       */
      uninstall(): Promise<{ ok: boolean }>;
    };
  }
}

export {};
