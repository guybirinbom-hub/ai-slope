// Gates backend-dependent routes on the backend being warmed up.
//
// During parallel-boot, the React shell renders before pg + postgrest are
// ready. Without this gate, useQuery hooks on pages like /characters and
// /homebrew fire immediately, get 503 from the gateway's not-ready guard,
// and either show an empty page or pop "Request Function returned an error"
// toasts. This wrapper holds the user at a polished waiting screen until
// the backend reports ready (typically 1-3 seconds after the window opens).
//
// Once ready, the children mount normally and React Query fires the real
// data fetches against a fully-functional gateway.
//
// The waiting screen is the codex parchment loader from
// frontend/public/codex-loading.html (kept in sync with the identical
// copy at electron/codex-loading.html that Electron loads BEFORE the
// React bundle is even fetched). When `ready` flips true we
// postMessage 'codex-complete' to the iframe, which triggers the d20
// land + 100% animation; after a short tail we unmount the gate so
// the user gets to see the d20 settle into its final number before
// the real app paints over the loader.

import { backendReadyState } from '@atoms/backendAtoms';
import { useAtomValue } from 'jotai';
import { useEffect, useRef, useState, type ReactNode } from 'react';

const LAND_TAIL_MS = 480;

export default function BackendReadyGate(props: { children: ReactNode }) {
  const { ready, error } = useAtomValue(backendReadyState);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [hideAfterLand, setHideAfterLand] = useState(false);

  // When the backend reports ready, send the iframe a 'codex-complete'
  // postMessage so the d20 lock + 100% jump plays, then unmount the
  // gate after the land animation has had time to finish. If we
  // unmounted immediately on `ready`, the user would never see the
  // final d20 face.
  useEffect(() => {
    if (!ready) return;
    const iframe = iframeRef.current;
    if (iframe && iframe.contentWindow) {
      try {
        iframe.contentWindow.postMessage({ type: 'codex-complete' }, '*');
      } catch {
        // Cross-origin failures are silenced — same-origin in
        // production, but a sandboxed dev preview can occasionally
        // throw. Either way we still want to hide the gate.
      }
    }
    const t = setTimeout(() => setHideAfterLand(true), LAND_TAIL_MS);
    return () => clearTimeout(t);
  }, [ready]);

  if (ready && hideAfterLand) return <>{props.children}</>;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: '#15110b',
        zIndex: 9999,
      }}
    >
      <iframe
        ref={iframeRef}
        src='/codex-loading.html'
        title='Loading'
        style={{
          width: '100%',
          height: '100%',
          border: 0,
          display: 'block',
        }}
      />
      {/* Real error from backend boot — overlay it on top of the
          iframe instead of trying to message-pass into the iframe's
          DOM. The iframe is purely visual; this overlay is the
          escape-hatch surface for actual failures so users never end
          up staring at a forever-spinning d20. */}
      {error && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(13, 9, 5, 0.92)',
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
              border: '1px solid #a83a25',
              background: '#211a11',
              color: '#ede4ce',
              padding: '24px 28px',
              fontFamily: "'Cormorant Garamond', serif",
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
