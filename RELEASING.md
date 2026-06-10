# Cutting a release

The installed app **auto-updates from GitHub Releases** (electron-updater +
the `publish` config in `package.json`). For that to keep working, every
release must carry the updater's metadata and the *exact* artifact names it
references. Follow this recipe:

## 1. Bump the version

`package.json` → `"version"` (e.g. `1.0.6`). The updater only offers
upgrades when the release tag's version is **greater** than the installed one.

## 2. Build

```
npm run frontend:build
npm run build:installer     # NSIS Setup + latest.yml + .blockmap
npm run build:portable      # portable one-file exe
```

`build:installer` produces in `release/`:

- `Wanderers-Guide-Setup-<version>.exe`   ← name comes from nsis.artifactName
- `Wanderers-Guide-Setup-<version>.exe.blockmap`  (differential downloads)
- `latest.yml`                            ← the updater's feed file

## 3. Publish the GitHub release

Tag `v<version>` on `guybirinbom-hub/ai-slope`, uploading **all of**:

| Asset | Why |
|---|---|
| `Wanderers-Guide-Setup-<version>.exe` | referenced by `latest.yml` — required for auto-update |
| `Wanderers-Guide-Setup-<version>.exe.blockmap` | smaller delta updates |
| `latest.yml` | the feed installed apps poll |
| `Wanderers-Guide-Setup.exe` (a **copy** of the versioned Setup) | the README's stable download link |
| `Wanderers-Guide-Portable.exe` (a copy of `Wanderer's Guide <version>.exe`) | stable portable link |

```
gh release create v<version> --repo guybirinbom-hub/ai-slope --target master \
  --title "Wanderer's Guide (Local) - v<version>" --notes-file <notes.md> \
  "release/Wanderers-Guide-Setup-<version>.exe" \
  "release/Wanderers-Guide-Setup-<version>.exe.blockmap" \
  "release/latest.yml" \
  "release/Wanderers-Guide-Setup.exe" \
  "release/Wanderers-Guide-Portable.exe"
```

> Do NOT rename the versioned Setup or `latest.yml` — electron-updater
> downloads the file by the exact name inside `latest.yml`. The stable-named
> `Wanderers-Guide-Setup.exe` is an extra copy purely for the README link.

## Notes

- Auto-update applies to **installed (NSIS)** builds only. The portable exe
  has no updater (no `app-update.yml` in its resources) by design.
- Installs older than v1.0.6 predate the updater and need one final manual
  download; everything after self-updates.
- The update check is silent and fully offline-safe: no network → logged and
  ignored, the app runs as normal.
