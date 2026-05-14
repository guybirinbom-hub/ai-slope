## Local desktop fork of Wanderer's Guide

A Pathfinder 2e character builder + sheet, running entirely on your own
machine — no Docker, no Supabase cloud, no internet required after install.

## Download

**[➡ Download the latest portable Windows build](https://github.com/guybirinbom-hub/wg/releases/latest/download/Wanderers-Guide-Portable.exe)**

One file. Double-click to run — no installer, no admin rights, no setup
wizard. Postgres + content (~47 MB) initialize on first launch (takes
~30-60 seconds); after that, startup is fast.

To uninstall: open Settings → Uninstall inside the app. That wipes both
the user data folder and the app itself in one click.

Forked from the open-source [wanderers-guide/wanderers-guide][upstream]
(GPL-3.0). The upstream targets cloud-hosted Supabase. This fork replaces
each piece of that backend with an embedded, in-process equivalent so the
whole app ships as one Electron desktop application.

[upstream]: https://github.com/wanderers-guide/wanderers-guide

## What's in here

- **Electron desktop window** wrapping the React frontend, served from the
  same Node process as the backend.
- **Embedded Postgres** (the `embedded-postgres` npm package — a Postgres
  binary started as a child process on app launch).
- **Bundled PostgREST** in `electron/bin/` to serve `/rest/v1/*` against
  the embedded database.
- **In-process Express gateway** on port 9000 that fronts everything:
  - serves the built frontend bundle (`frontend/dist/`)
  - serves `/rest/v1/*` via PostgREST
  - serves `/auth/v1/*` as a single-user stub (no GoTrue)
  - serves `/storage/v1/*` from a local folder on disk
  - serves `/functions/v1/*` from `electron/functions/*.mjs` — Node.js
    ports of the original Deno edge functions
- **PF2e content** loaded from `data/data.sql` (the Wanderer's Guide
  Pathfinder dataset) into the embedded Postgres on first launch.

## Running

```
npm install               # one-time, installs Electron and backend deps
npm --prefix frontend install   # one-time, installs frontend deps
npm run frontend:build    # builds the React bundle into frontend/dist/
npm run app               # starts the Electron app
```

First launch initializes Postgres and applies the schema + ~47 MB
content dump — takes about a minute. Subsequent launches are fast.

## Removed compared to upstream

- Campaigns, encounters, GM groups (single-user PC, no multiplayer).
- Patreon tier gating (everything unlocked).
- AI / vector-DB endpoints (no API keys to provide).
- Original docker-compose self-host stack + bundled Supabase Deno functions
  (all ported in-process to `electron/functions/`). `npm run app` is the
  only way to run the app.
