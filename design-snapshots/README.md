# Wanderer's Guide — design snapshots

Five standalone HTML files, one per main screen, captured live from the running
app on 2026-05-17. Each file is a full DOM dump (head + body + every inline
style + every Mantine class) at the moment the page finished loading.

## How to view

Just double-click an `.html` file — it opens in any browser. No server, no
build step. The page renders against its own embedded styles, so what you see
is exactly what the user sees in the app.

A few notes:

- **No images / icons.** Tabler icons render as inline SVG and survive. Static
  assets (background art, character portraits) are loaded from `/src/assets/...`
  paths which won't resolve when you open the file directly. The layout, copy,
  spacing, and color palette are all intact; the missing visuals are just
  placeholders.
- **Not interactive.** Buttons won't click, drawers won't open, tabs won't
  switch. These are static design references, not a runnable copy of the app.
- **Dark theme.** This is the only theme the app ships today. Color tokens are
  defined in `frontend/src/App.tsx` (Mantine theme) and `frontend/src/index.css`
  (CSS variables) — see those if you want to redesign the palette.

## The screens

| File | URL | What it is |
|---|---|---|
| `01-characters-list.html` | `/characters` | Landing page after login. Grid of character cards with portrait, name, ancestry, background, class, level, edit button. Top bar has the user avatar and an import dropdown. |
| `02-settings.html` | `/account` | User account & app settings. Theme, sheet defaults, customization options. |
| `03-homebrew.html` | `/homebrew` | Homebrew content management — bundles of custom rules the user has created or subscribed to. |
| `04-character-sheet.html` | `/sheet/67` | The character sheet for **TAKT**, an Elf Bard. This is where players spend ~90% of their time. Tabs along the top for the different sections (default tab shown). |
| `05-character-builder.html` | `/builder/67` | The build flow for the same character. Where you pick ancestry / background / class / feats / skills at level-up. |

## What the designer should know

- The app is **Pathfinder 2e**-specific. Every UI element is in service of one
  game's rules — character creation, leveling, running a session.
- The visual identity is **fantasy parchment + dark glass**. Subtle textures,
  amber/gold accents on a near-black background, mid-weight serif headings,
  sans-serif body.
- Density is **high**. A character sheet shows dozens of numeric fields, modal
  drawers, action chips, hover popovers. Whitespace exists, but compactness
  matters — players have a stat block open during combat.
- **Tabler icons** everywhere. If you swap iconography, keep it line-style and
  ~1.5px stroke to match.
- The character sheet uses **collapsible cards** for big sections (stats,
  skills, attacks). Click-to-expand is core to the navigation.

## Captured how

The dev server (Vite on `:5173`) was running against the Electron backend
(`:9000`). For each route, a Puppeteer-like preview tool navigated via
`history.pushState`, waited 2.5s for the data to settle, then snapshotted
`document.documentElement.outerHTML`. `extract.js` is the helper that
unwraps the tool-result file into the named `.html`.

If a new page needs capturing, restart the dev stack (Electron app + `npm run
dev` in `frontend/`) and re-run the same flow.
