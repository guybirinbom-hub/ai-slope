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
// pages we've migrated to the codex design language. Existing pages
// that still use Mantine classes are unaffected — codex.css only
// styles its own class names (.winbar, .topbar, .col, .vital, .sk, etc.)
// and CSS variables under :root.
import './css/codex.css';
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
            path: 'auth/patreon/redirect',
            lazy: async () => import('@pages/PatreonRedirectPage.tsx'),
          },
          {
            path: 'gm-share/:gmUserId',
            lazy: () => import('@pages/GmSharePage.tsx'),
            loader: async ({ params }: { params: any }) => {
              return { gmUserId: params.gmUserId };
            },
          },
          {
            path: 'oauth/access',
            lazy: async () => import('@pages/OAuthAccessPage.tsx'),
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
        path: 'sheet-unauthorized',
        lazy: () => import('@pages/character_sheet/UnauthorizedSheetPage.tsx'),
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
        // Legacy Character Redirect
        path: 'profile/characters/:id',
        lazy: () => import('@pages/LegacyRedirectPage.tsx'),
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
