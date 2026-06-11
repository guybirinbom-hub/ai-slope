; Custom NSIS hooks for Wanderer's Guide.
;
; In-place UPDATE support. electron-builder already detects a previous
; installation (via the stable appId) and reuses its location, and it closes
; the app's own window before copying files. But the app spawns embedded
; Postgres + PostgREST CHILD processes that the installer's window-close check
; can't see. If they're still running (or were orphaned by a hard close), they
; hold open files inside the install directory, the file overwrite fails, and
; the update appears "broken" — which is what previously forced a full
; uninstall + reinstall.
;
; Killing them at installer init frees those files so the new version can
; overwrite the existing install cleanly. User data (characters, settings)
; lives under %APPDATA%, NOT the install dir, so it is never touched by this.
!macro customInit
  nsExec::Exec 'taskkill /F /IM postgres.exe'
  Pop $0
  nsExec::Exec 'taskkill /F /IM postgrest.exe'
  Pop $0
!macroend

; Same child-process cleanup for the UNINSTALLER. Without this, an orphaned
; Postgres still holds files under the install dir / data dir and the
; uninstall leaves locked leftovers behind.
!macro customUnInit
  nsExec::Exec 'taskkill /F /IM postgres.exe'
  Pop $0
  nsExec::Exec 'taskkill /F /IM postgrest.exe'
  Pop $0
!macroend

; Full cleanup on REAL uninstalls — the uninstaller itself already removes
; the install dir, shortcuts, and the Add/Remove Programs registry entry;
; this adds every other footprint the app has:
;   - %APPDATA%\Wanderer's Guide      Electron userData: the embedded
;                                     Postgres data dir (characters),
;                                     uploaded images, localStorage, caches.
;   - %LOCALAPPDATA%\Wanderer's Guide Chromium disk caches some Electron
;                                     versions split out of userData.
;   - %LOCALAPPDATA%\wanderers-guide-updater
;                                     electron-updater's downloaded-installer
;                                     cache (auto-update feature).
;
; CRITICAL: ${isUpdated} guards the wipe. Auto-update runs this same
; uninstaller as part of installing a new version — without the guard,
; every app UPDATE would delete the user's characters. Only a real,
; user-initiated uninstall clears data.
!macro customUnInstall
  ${ifNot} ${isUpdated}
    RMDir /r "$APPDATA\Wanderer's Guide"
    RMDir /r "$LOCALAPPDATA\Wanderer's Guide"
    RMDir /r "$LOCALAPPDATA\wanderers-guide-updater"
  ${endIf}
!macroend
