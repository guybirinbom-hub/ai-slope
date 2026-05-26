// Gates backend-dependent routes on the backend being warmed up.
//
// During parallel-boot, the React shell renders before pg + postgrest are
// ready. Without this gate, useQuery hooks on pages like /characters and
// /homebrew fire immediately, get 503 from the gateway's not-ready guard,
// and either show an empty page or pop "Request Function returned an error"
// toasts. This wrapper holds the user at a polished waiting screen until
// the backend reports ready (typically 1-3 seconds after the window opens).
//
// IMPORTANT — no second dice here on purpose:
//
// The Electron splash (electron/codex-loading.html) ALREADY shows a
// rolling d20 that locks on a number before main.cjs swaps the window to
// APP_URL. If this gate then mounts its OWN iframe of /codex-loading.html
// the user sees TWO consecutive dice rolls back-to-back, which feels like
// the loader is "stuck on the rolled number" because they're really
// staring at a second dice that just landed.
//
// Earlier versions of this file did that — and added timing logic to
// orchestrate codex-complete + tail unmount on top. Every iteration
// shipped with a subtle edge case (cleanup races, dep-array re-fires,
// missing state propagation) that the user kept hitting in production.
//
// The radically simpler design: render a plain dark backdrop (same
// colour as the splash) while we wait, swap to children the moment
// the backend reports ready. No iframe, no postMessage, no timers.
// If pg takes long enough on first-boot for the dark screen to be
// uncomfortable, that's a backend perf bug — fix it there, not by
// papering over it with a second dice animation that confuses the
// user about whether the load is actually progressing.

import { backendReadyState } from '@atoms/backendAtoms';
import { useAtomValue } from 'jotai';
import { type ReactNode } from 'react';

export default function BackendReadyGate(props: { children: ReactNode }) {
  const { ready, error } = useAtomValue(backendReadyState);

  // Backend reported ready — swap to the real app immediately. No
  // tail, no animation, no second dice. The splash already did the
  // visual hand-off; this is just a logical gate.
  if (ready) return <>{props.children}</>;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: '#e8e4d8', // wg4 parchment
        zIndex: 9999,
      }}
    >
      {/* Real error from backend boot — surface to the user so they
          never end up staring at a forever-blank screen if pg fails
          to start. */}
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
            zIndex: 10000,
          }}
        >
          <div
            style={{
              maxWidth: 720,
              border: '1px solid #b0542f',
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
    </div>
  );
}
