import '@mantine/core/styles.css';
import '@mantine/dropzone/styles.css';
import '@mantine/notifications/styles.css';
import '@mantine/spotlight/styles.css';
import '@mantine/tiptap/styles.css';
import '@mantine/carousel/styles.css';
import '@mantine/dates/styles.css';
import '@mantine/charts/styles.css';

import BackendReadyGate from '@auth/BackendReadyGate.tsx';
import { createClient } from '@supabase/supabase-js';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Navigate, Outlet, RouterProvider, createBrowserRouter } from 'react-router-dom';
import App from './App.tsx';
import './index.css';
// Codex theme. Loaded after Mantine + index.css so its rules win on
// pages we've migrated to the codex design language.
import './css/codex.css';
import './css/codex-panels.css';
// Codex shell for the character builder Home tab (Sources step).
// Loaded before codex-bridge.css so the bridge can still override
// individual Mantine selectors that bleed through.
import './css/codex-home.css';
// Codex shell for the character builder Build step.
import './css/codex-builder.css';
// Codex Notes + Details tab bodies (parchment page editor +
// dossier hero / origins / proficiencies).
import './css/codex-notes-details.css';
// Mantine → Codex bridge. Overrides Mantine's CSS variables (colors,
// fonts, radius) + component-specific classes so EVERY Mantine
// component in the app picks up the codex aesthetic. Pages that
// haven't been hand-rewritten still look codex-themed; pages that
// have are unaffected (they use codex.css class names directly).
import './css/codex-bridge.css';
// wg4 minimalist parchment redesign. Loaded LAST so wg4-scoped
// (`.wg4`) overrides win against every preceding codex/bridge rule.
// Without this load order, codex-bridge.css's
// [data-mantine-color-scheme='light'] var overrides clobbered the
// wg4 vars and Mantine components still rendered dark codex.
import './css/wg4.css';
// Exhaustive wg4 reskin of every hardcoded font / dark gradient /
// gold glow in codex.css + codex-panels.css that the var remap can't
// reach. Loaded last so these rules always win on .wg4 surfaces.
import './css/wg4-codex-overrides.css';
// Design CSS extracted from D:/Inst/Character Sheet.html — the canonical
// wg4 mockup. Wrapped in @scope (.codex-root.wg4) so it only applies on
// the character-sheet surface and inherits the CSS variables from the
// scope root rather than :root.
import './css/wg4-character-sheet.css';
// Additional wg4 styles (act-card aliases, panel-specific tweaks).
// Loaded LAST so it can fine-tune anything from the design CSS.
import './css/wg4-sheet.css';
// Drawer styling extracted from D:/Inst/Drawer Designs.html — applies
// the design's drawer chrome, stat-hero, breakdown, hero-tile,
// item-hero, coin-row, creature-stats, strike-row styles. Spell slot
// picker (.slot-row) is excluded per request.
import './css/wg4-drawers.css';
// Modal styling extracted from D:/Inst/wg4/modals.jsx (the modalStyles
// template literal). Applies design styling to confirm modals, picker
// modals, the addItems modal, manage-spells modal, encounter generator,
// operations editor, etc. — everything that opens as a Mantine Modal.
import './css/wg4-modals.css';
// Character Builder + Home redesign — ported verbatim from
// D:/Inst/Character Builder.html. Scoped to .codex-home-page /
// .codex-builder-page surfaces; tokens are aliased from --wg4-* so
// the entire builder/home flow lives in the wg4 parchment vocabulary.
import './css/wg4-builder.css';
// Create / Edit Item modal redesign — ported from D:/Inst/Edit Item.html.
// Scoped to .codex-edit-item; tokens come from the wg4 root.
import './css/wg4-edit-item.css';
// Characters page (Codex Atlas) wg4 redesign — parchment landing
// page with the big italic Newsreader title block, search/filter
// toolbar, 3-column character card grid, and the "Forge a New Hero"
// tile at the end of the grid. Scoped under `.codex-atlas`.
import './css/wg4-atlas.css';
// Companion sheet wg4 redesign — single-page PF2e stat block ("Version
// B") followed by the heavier interactive panels inline (no
// collapsibles). Scoped under `.codex-companion`.
import './css/wg4-companion.css';
// wg4 reskin of the previously-dark screens (Account, Homebrew, Stat-Block
// viewer, Content tools, Admin, OAuth, Error/404/401, redirects, window
// bar, Spotlight) + dark-patch components. Component styles ported
// verbatim from proposals/wg4-redesigns.html, scoped under `.wg4-screen`.
import './css/wg4-screens.css';
// wg4 — parchment skin for the remaining dark popups (Select/Combobox
// dropdowns + date-picker calendar) and a fullscreen-modal shell fixup.
// MUST load after wg4-modals.css so the modal/shell overrides win on cascade.
import './css/wg4-popups.css';
// Dark theme (opt-in). Declares the wg4 tokens on :root + neutral-slate
// dark overrides gated by `html.theme-dark`. Imported last so it wins on
// cascade. Toggle + persistence live in utils/theme.ts (Account page).
import './css/wg4-dark.css';
import { ErrorPage } from './pages/ErrorPage.tsx';
import { MantineProvider } from '@mantine/core';

// Local-only build: every "authed" route in the upstream app is now
// just a backend-ready route. App.tsx auto-creates a session against
// the in-process /auth/v1 shim so a session is always present; the
// only thing routes still need to wait on is pg + postgrest warming
// up. BackendReadyGate handles that — wrap it around <Outlet/> and
// react-router renders the child route once the backend reports ready.
function BackendReadyRoute() {
  return (
    <BackendReadyGate>
      <Outlet />
    </BackendReadyGate>
  );
}

const queryClient = new QueryClient();

export const supabase = createClient(
  /*<Database>*/
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_KEY
);

// Cache-wipe + service-worker unregister was leftover from the web build's
// stale-cache workaround. The Electron build doesn't need it — there's no
// CDN-cached bundle to invalidate and the SW does more harm than good here
// (intercepts gateway fetches during startup). Skipping saves ~150-300ms
// of boot work and prevents transient SW-cache hits to /rest/v1 fetches.

// The DOM router for determining what pages are rendered at which paths
const router = createBrowserRouter([
  {
    path: '/',
    element: <App />,
    errorElement: <ErrorPage />,
    children: [
      {
        Component: BackendReadyRoute,
        children: [
          {
            path: 'characters',
            lazy: () => import('@pages/CharactersPage.tsx'),
          },
          {
            path: 'account',
            lazy: () => import('@pages/AccountPage.tsx'),
          },
          {
            path: 'admin',
            lazy: async () => import('@pages/admin_panel/AdminPage.tsx'),
          },
          {
            path: 'builder/:characterId',
            lazy: () => import('@pages/character_builder/CharacterBuilderPage.tsx'),
            loader: async ({ params }: { params: any }) => {
              return { characterId: params.characterId };
            },
          },
          {
            path: 'homebrew',
            lazy: () => import('@pages/homebrew/HomebrewPage.tsx'),
          },
        ],
      },
      {
        path: 'sheet/:characterId',
        lazy: () => import('@pages/character_sheet/CharacterSheetPage.tsx'),
        loader: async ({ params }: { params: any }) => {
          return { characterId: params.characterId };
        },
      },
      {
        // Local-only build: there's no marketing landing page, the
        // app is one user and one machine. Send root straight to the
        // character list instead of the upstream HomePage.
        path: '',
        element: <Navigate to='/characters' replace />,
      },
      {
        path: 'content-update/:id',
        lazy: () => import('@pages/ContentUpdatePage.tsx'),
        loader: async ({ params }: { params: any }) => {
          return { updateId: params.id };
        },
      },
      {
        path: 'content-update-overview',
        lazy: () => import('@pages/ContentUpdateOverviewPage.tsx'),
      },
      {
        path: 'content-cleaning/:id',
        lazy: () => import('@pages/ContentCleaningPage.tsx'),
        loader: async ({ params }: { params: any }) => {
          return { recordId: params.id };
        },
      },
      {
        path: 'content-cleaning-source',
        lazy: () => import('@pages/ContentCleaningSourcePage.tsx'),
      },
      {
        // Local-only build: dropped /login + /update-password.
        // The app auto-signs-in against the in-process auth shim, so
        // there's nothing to sign into and no password to reset.
        path: '*',
        lazy: () => import('./pages/MissingPage.tsx'),
      },
    ],
  },
  {
    path: 'stat-block/:type/:id',
    lazy: () => import('@pages/StatBlockPage.tsx'),
    loader: async ({ params }: { params: any }) => {
      return { type: params.type, id: params.id };
    },
  },
]);

// Remove dumb warning (errors) caused by Mantine in dev
const consoleError = console.error;
console.error = function (message, ...args) {
  if (/validateDOMNesting|changing an uncontrolled input/.test(message)) {
    return;
  }
  consoleError(message, ...args);
};

const root = createRoot(document.getElementById('root') as HTMLElement);
root.render(
  <StrictMode>
    <MantineProvider forceColorScheme='dark'>
      <QueryClientProvider client={queryClient}>
          <RouterProvider router={router} />
      </QueryClientProvider>
    </MantineProvider>
  </StrictMode>
);

// Remove the boot bridge (#wg-boot in index.html) once React has painted its
// first frame, fading out so the hand-off to the app's own loading UI is
// seamless — no blank/white flash between the Electron splash and React.
requestAnimationFrame(() =>
  requestAnimationFrame(() => {
    const boot = document.getElementById('wg-boot');
    if (!boot) return;
    boot.style.transition = 'opacity 0.25s ease';
    boot.style.opacity = '0';
    setTimeout(() => boot.remove(), 260);
  })
);
