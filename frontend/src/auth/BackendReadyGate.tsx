// Gates backend-dependent routes on the backend being warmed up.
//
// During parallel-boot, the React shell renders before pg + postgrest are
// ready. Without this gate, useQuery hooks on pages like /characters and
// /homebrew fire immediately, get 503 from the gateway's not-ready guard, and
// either show an empty page or pop "Request Function returned an error" toasts.
// This holds the user at the app's loading screen until the backend reports
// ready (typically 1-3s after the window opens; longer on a first-launch
// initdb).
//
// We render the SAME d20 codex loader (the iframed /codex-loading.html, via
// CodexLoadingOverlay) that's used for sheet/builder loads, so the STARTUP
// loading screen is the app's real loading screen — not a plain spinner. There
// is no "double dice": the old file:// splash that used to roll its own d20 was
// removed when startup was restructured, so this is the only loader at boot.

import { backendReadyState } from '@atoms/backendAtoms';
import { useAtomValue } from 'jotai';
import { type ReactNode } from 'react';
import CodexLoadingOverlay from '@common/CodexLoadingOverlay';

export default function BackendReadyGate(props: { children: ReactNode }) {
  const { ready, error } = useAtomValue(backendReadyState);

  return (
    <>
      {ready && props.children}
      {/* The app's d20 loader while pg + postgrest warm up. It locks on its
          rolled number and fades out the moment the backend reports ready. */}
      <CodexLoadingOverlay visible={!ready && !error} />
      {/* Real backend-boot failure — surface it so the user never stares at a
          forever-loading screen if pg fails to start. */}
      {error && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(232, 228, 216, 0.94)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 40,
            zIndex: 10001,
          }}
        >
          <div
            style={{
              maxWidth: 720,
              border: '1px solid var(--wg4-accent)',
              background: '#f6f3eb',
              color: '#1a1a1a',
              padding: '24px 28px',
              fontFamily: "'Newsreader', ui-serif, Georgia, serif",
              fontStyle: 'italic',
            }}
          >
            <div
              style={{
                fontFamily: "'Cinzel', serif",
                color: '#a83a25',
                fontSize: 14,
                letterSpacing: '0.28em',
                textTransform: 'uppercase',
                marginBottom: 12,
              }}
            >
              The codex is sealed shut.
            </div>
            <div
              style={{
                fontFamily: 'ui-monospace, monospace',
                fontSize: 12,
                color: '#c3b69a',
                whiteSpace: 'pre-wrap',
                maxHeight: 320,
                overflow: 'auto',
              }}
            >
              {error}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
