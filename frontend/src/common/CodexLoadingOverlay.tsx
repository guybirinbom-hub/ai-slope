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
// before actually removing the overlay (default 500ms — just enough
// for the .42s d20-land keyframe to play visibly with a tiny breath
// before unmount, so the loader doesn't appear to "stay at 100" after
// the dice has clearly settled).

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CodexWinBar } from './CodexWinBar';

interface Props {
  visible: boolean;
  /**
   * Position the overlay over a specific container (default) or
   * fullscreen. `absolute` fills the closest positioned ancestor;
   * `fixed` covers the entire viewport. Defaults to `fixed`.
   */
  position?: 'absolute' | 'fixed';
  /** Defaults to 500ms — just past the .42s d20-land keyframe so the
   *  user sees the dice lock on its number and the overlay then snaps
   *  away. Bumping much past 500ms causes the "stays at 100 forever"
   *  perception; trimming below ~440ms cuts the lock animation off. */
  tailMs?: number;
  /**
   * Minimum time the loader stays mounted from first show, even if
   * `visible` flipped false immediately. Defaults to 900ms — long
   * enough for the d20 rolling animation to be visible and the lock
   * + 100% to play out. Without this, a loader whose data was already
   * cached (e.g. opening a sheet right after another sheet of the
   * same character) flashes for a few frames without ever showing
   * the dice rolling — the "loading screen that finishes without
   * rolling" symptom.
   */
  minMountMs?: number;
  /** Stacking context; defaults to 9999 so it sits above page chrome
   *  and modal portals. Bump for special cases. */
  zIndex?: number;
}

export default function CodexLoadingOverlay(props: Props) {
  // Default to `fixed` so the loader ALWAYS covers the entire
  // viewport, not just whatever container we're rendered into. Pass
  // `position='absolute'` explicitly when you want a sub-region
  // loader (rare).
  const {
    visible,
    position = 'fixed',
    tailMs = 500,
    minMountMs = 900,
    zIndex = 9999,
  } = props;
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  // `mounted` tracks whether the overlay JSX is rendered. We keep it
  // mounted for at least `minMountMs` from first show + at least
  // `tailMs` after `visible` flips false, so:
  //  1. The dice always has time to roll visibly.
  //  2. The lock animation has time to play out before unmount.
  const [mounted, setMounted] = useState(visible);
  const mountedAtRef = useRef<number | null>(visible ? Date.now() : null);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      if (mountedAtRef.current === null) mountedAtRef.current = Date.now();
      return;
    }
    // visible flipped false. Calculate remaining min-mount time +
    // tail. If the loader was only on screen briefly, the additional
    // wait (up to minMountMs) gives the dice time to roll before we
    // fire complete and unmount.
    const shownFor = mountedAtRef.current ? Date.now() - mountedAtRef.current : 0;
    const minRemaining = Math.max(0, minMountMs - shownFor);
    // Retry loop for codex-complete. The iframe's <script> may not
    // have wired its message listener yet at the moment we
    // postMessage (cache-warm path mounts iframe and flips visible=
    // false within a few frames). Resend every 80ms until the lock
    // animation has had time to play. complete() inside the loader
    // is idempotent so resends are no-ops once it's caught.
    let cancelled = false;
    const startComplete = () => {
      if (cancelled) return;
      const sendDeadline = Date.now() + 1500;
      const sendOne = () => {
        if (cancelled) return;
        const w = iframeRef.current?.contentWindow;
        if (w) {
          try { w.postMessage({ type: 'codex-complete' }, '*'); } catch {}
        }
        if (Date.now() < sendDeadline) setTimeout(sendOne, 80);
      };
      sendOne();
    };
    const completeTimer = setTimeout(startComplete, minRemaining);
    const unmountTimer = setTimeout(() => {
      if (!cancelled) setMounted(false);
      mountedAtRef.current = null;
    }, minRemaining + tailMs);
    return () => {
      cancelled = true;
      clearTimeout(completeTimer);
      clearTimeout(unmountTimer);
    };
  }, [visible, tailMs, minMountMs]);

  if (!mounted) return null;

  // Render via createPortal to document.body so the overlay escapes
  // any transformed ancestor (Mantine ScrollArea wraps every route in
  // Layout.tsx — Radix ScrollArea uses a CSS transform on its viewport
  // wrapper, which establishes a containing block and confines
  // position:fixed descendants to that wrapper instead of the
  // browser viewport). Without the portal the loader rendered as a
  // small box in the top-left of the page content area.
  const overlay = (
    <div
      style={{
        position,
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        width: position === 'fixed' ? '100vw' : '100%',
        height: position === 'fixed' ? '100vh' : '100%',
        background: '#e8e4d8', // wg4 parchment to match the iframe's interior
        zIndex,
        pointerEvents: 'auto',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Full-screen loaders show the working window bar on top so
          min / max / close stay usable while loading (the iframe would
          otherwise cover the page's own bar). */}
      {position === 'fixed' && <CodexWinBar />}
      <iframe
        ref={iframeRef}
        src='/codex-loading.html'
        title='Loading'
        style={{
          width: '100%',
          flex: 1,
          minHeight: 0,
          border: 0,
          display: 'block',
        }}
      />
    </div>
  );
  // 'absolute' callers (rare — sub-region loaders) keep the in-place
  // render so they fill the closest positioned ancestor as before.
  // 'fixed' (the default + 99% of usages) goes through the portal.
  return position === 'fixed' ? createPortal(overlay, document.body) : overlay;
}
