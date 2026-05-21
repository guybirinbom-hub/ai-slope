// Reusable codex-themed loading overlay. Renders the same
// /codex-loading.html iframe BackendReadyGate uses, but as a positioned
// overlay (default absolute) so it works inside any container — page
// loaders, drawer loaders, modal loaders, etc.
//
// Why an iframe instead of porting the SVG dial to React: the loading
// HTML is the single source of truth across THREE surfaces (Electron
// splash, BackendReadyGate, in-app navigation). Re-implementing it as
// a React component would mean three places to keep in sync. The
// iframe approach means one file owns the visual + animation, and
// every consumer just renders it.
//
// When `visible` flips false, we send postMessage 'codex-complete'
// so the d20 lock + 100% animation plays before the overlay unmounts.
// The `tailMs` prop controls how long we wait after that signal
// before actually removing the overlay (default 480ms — long enough
// for the .42s d20-land keyframe to finish).

import { useEffect, useRef, useState } from 'react';

interface Props {
  visible: boolean;
  /**
   * Position the overlay over a specific container (default) or
   * fullscreen. `absolute` fills the closest positioned ancestor;
   * `fixed` covers the entire viewport.
   */
  position?: 'absolute' | 'fixed';
  /** Defaults to 480ms — matches the d20-land keyframe duration. */
  tailMs?: number;
  /** Stacking context; defaults to 100 so it sits above page chrome
   *  but below modal portals (~200). Bump for special cases. */
  zIndex?: number;
}

export default function CodexLoadingOverlay(props: Props) {
  // Default to `fixed` so the loader ALWAYS covers the entire
  // viewport, not just whatever container we're rendered into. Pass
  // `position='absolute'` explicitly when you want a sub-region
  // loader (rare).
  const { visible, position = 'fixed', tailMs = 700, zIndex = 9999 } = props;
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  // `mounted` tracks whether the overlay JSX is rendered. We keep it
  // mounted for `tailMs` after `visible` flips false so the lock
  // animation plays out instead of the overlay just vanishing.
  const [mounted, setMounted] = useState(visible);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      return;
    }
    // visible has flipped false — fire complete, then unmount after
    // the tail.
    const iframe = iframeRef.current;
    if (iframe && iframe.contentWindow) {
      try {
        iframe.contentWindow.postMessage({ type: 'codex-complete' }, '*');
      } catch {
        // Same-origin in production; cross-origin in a stray dev
        // preview throws — swallow so the overlay still unmounts.
      }
    }
    const t = setTimeout(() => setMounted(false), tailMs);
    return () => clearTimeout(t);
  }, [visible, tailMs]);

  if (!mounted) return null;

  return (
    <div
      style={{
        position,
        inset: 0,
        background: '#15110b',
        zIndex,
        // Pointer events on so the iframe also blocks clicks behind
        // it — same expectation as Mantine's LoadingOverlay.
        pointerEvents: 'auto',
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
    </div>
  );
}
