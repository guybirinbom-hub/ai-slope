// Resizable, size-persistent Mantine Modals.
//
// Mantine v9 has no built-in `resizable` prop. Two ingredients give us
// a usable approximation:
//
//   1. CSS `resize: both` + `overflow: hidden` on the modal's `content`
//      slot. The browser draws a corner handle the user can drag; the
//      content panel grows / shrinks live without any JS.
//   2. A `ResizeObserver` attached after mount writes the new size to
//      localStorage, and the next open seeds the panel with that size.
//
// Important wrinkle: we deliberately do NOT pass `width`/`height` via
// React's `styles.content`. If we did, every component re-render
// (e.g. CreateItemModal's form-state churn) would re-apply the
// initial dimensions and clobber whatever size the user has dragged
// to. Instead we set width/height directly on the DOM element once,
// in a `useEffect`. React's style prop diff only removes keys it
// previously controlled — since it never controlled width/height,
// the user's drag survives all subsequent React renders.
//
// We can't get a React ref to Mantine's `Modal.Content` slot from the
// outside, so we tag it with a stable className via the Modal's
// `classNames` prop, then look it up in the DOM after mount. Brittle
// in theory; fine in practice because (a) modals are usually
// singletons, (b) we retry every 50 ms if the element isn't there yet
// (transitions / portal mount delay).

import { useEffect, useMemo } from 'react';

const STORAGE_PREFIX = 'wg.modal-size.';

export interface ModalSize {
  width: number;
  height: number;
}

/**
 * Synchronously read a previously-saved modal size, or return defaults.
 * Safe to call from non-React contexts (e.g. before openContextModal).
 *
 * The saved size is clamped to *at least* the passed defaults — this
 * way bumping the default width/height in code immediately applies to
 * users with a smaller saved size, without them having to drag-resize
 * by hand. The user can still drag SMALLER than the new default once
 * the modal opens (the observer will persist that), but the initial
 * mount always meets the design's minimum.
 */
export function readSavedModalSize(key: string, defaults: ModalSize): ModalSize {
  try {
    const raw = localStorage.getItem(`${STORAGE_PREFIX}${key}`);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed.width === 'number' &&
      typeof parsed.height === 'number' &&
      parsed.width > 0 &&
      parsed.height > 0
    ) {
      return {
        width: Math.max(parsed.width, defaults.width),
        height: Math.max(parsed.height, defaults.height),
      };
    }
  } catch {
    // localStorage unavailable / JSON parse failed — fall through.
  }
  return defaults;
}

/**
 * Static CSS bits to put on `styles.content`. Notably *no* width or
 * height — those are set imperatively via the DOM by the effect in
 * `useResizableModalProps` / `useModalSizePersistence` so they don't
 * get reverted on every React render.
 *
 * Sizing tokens picked so the codex popups feel large by default:
 *   minWidth 1300 — never shrink below this regardless of viewport
 *   maxWidth 99vw — only kiss the screen edges, not crowd them
 *   minHeight 600 — never collapse to a postage-stamp
 *   maxHeight 98vh — full vertical room minus a sliver
 */
function staticContentStyle() {
  return {
    maxWidth: '99vw',
    maxHeight: '98vh',
    minWidth: 1300,
    minHeight: 600,
    // The browser's `resize` handle requires non-visible overflow on
    // the resizing element. `hidden` is correct here — the body
    // inside has its own scrolling.
    resize: 'both' as const,
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column' as const,
  };
}

/**
 * Body slot styling so the contents flex-fill whatever vertical space
 * the user has dragged the panel to. Pair with a ScrollArea that uses
 * `h='100%'` to make the scrollable region match.
 */
function staticBodyStyle() {
  return {
    flex: 1,
    minHeight: 0,
  };
}

interface AttachOptions {
  key: string;
  className: string;
  defaults: ModalSize;
  /** Whether to seed the element with the saved width/height on attach.
   *  - true for component-rendered modals where React doesn't manage
   *    width/height (so we have to seed via DOM).
   *  - false for openContextModal callsites where the static initial
   *    size was already passed via `styles.content`. */
  seedInitialSize: boolean;
}

function attachResizeObserver({ key, className, defaults, seedInitialSize }: AttachOptions) {
  let ro: ResizeObserver | null = null;
  let retry: number | null = null;
  let saveRaf: number | null = null;
  let last: ModalSize | null = null;

  const tryAttach = () => {
    const el = document.querySelector<HTMLElement>(`.${className}`);
    if (!el) {
      // Mantine portals modal content asynchronously; retry until it
      // lands. Cap is implicit via unmount cleanup below.
      retry = window.setTimeout(tryAttach, 50);
      return;
    }

    if (seedInitialSize) {
      const saved = readSavedModalSize(key, defaults);
      el.style.width = `${saved.width}px`;
      el.style.height = `${saved.height}px`;
      last = saved;
    }

    ro = new ResizeObserver(([entry]) => {
      // Coalesce per-frame: a single drag fires dozens of events;
      // we only persist one per frame.
      if (saveRaf !== null) cancelAnimationFrame(saveRaf);
      saveRaf = requestAnimationFrame(() => {
        const w = Math.round(entry.contentRect.width);
        const h = Math.round(entry.contentRect.height);
        if (last && last.width === w && last.height === h) return;
        last = { width: w, height: h };
        try {
          localStorage.setItem(`${STORAGE_PREFIX}${key}`, JSON.stringify(last));
        } catch {
          // QuotaExceeded / private-mode lockdown — silently drop.
        }
      });
    });
    ro.observe(el);
  };
  tryAttach();

  return () => {
    if (retry !== null) clearTimeout(retry);
    if (saveRaf !== null) cancelAnimationFrame(saveRaf);
    ro?.disconnect();
  };
}

/**
 * One-shot helper for a Modal rendered inside a React component:
 * returns the `{ classNames, styles }` you spread onto `<Modal>` to
 * make it resizable, plus runs the persistence effect itself.
 *
 * Use this when the Modal is rendered in the component tree (e.g.
 * `<Modal opened={...} onClose={...}>`). For Mantine's
 * `openContextModal()` callsites, see `getResizableModalContextProps`
 * + `useModalSizePersistence` instead.
 */
export function useResizableModalProps(key: string, defaults: ModalSize) {
  const className = `wg-resizable-modal-${key}`;

  // useEffect deps include the primitive defaults so callers can pass
  // a fresh object literal without re-attaching on every render. The
  // empty memo body ensures the styles object identity is stable
  // across renders too — belt-and-suspenders for any Mantine version
  // that diffs by reference.
  useEffect(
    () =>
      attachResizeObserver({
        key,
        className,
        defaults,
        seedInitialSize: true,
      }),
    [key, className, defaults.width, defaults.height]
  );

  const styles = useMemo(
    () => ({
      content: staticContentStyle(),
      body: staticBodyStyle(),
    }),
    []
  );
  const classNames = useMemo(() => ({ content: className }), [className]);

  return { classNames, styles };
}

/**
 * Variant for `openContextModal` callers — runs outside React, so it
 * returns *static* styles + classNames including the initial width
 * and height from localStorage. The matching `useModalSizePersistence`
 * call inside the modal body wires up the observer for live drags.
 *
 * Width/height are baked into the returned styles here (not seeded
 * via DOM) because openContextModal stores the props at open time and
 * doesn't churn them — so there's no risk of a re-render reverting
 * the user's drag.
 */
export function getResizableModalContextProps(key: string, defaults: ModalSize) {
  const initial = readSavedModalSize(key, defaults);
  return {
    classNames: { content: `wg-resizable-modal-${key}` },
    styles: {
      content: {
        ...staticContentStyle(),
        width: initial.width,
        height: initial.height,
      },
      body: staticBodyStyle(),
    },
  };
}

/**
 * Inside-the-modal-body companion for openContextModal callers:
 * attaches the ResizeObserver so drag-resizes persist to localStorage.
 * The initial size was already seeded by `getResizableModalContextProps`
 * via static styles, so we pass `seedInitialSize: false`.
 */
export function useModalSizePersistence(key: string) {
  const className = `wg-resizable-modal-${key}`;
  useEffect(
    () =>
      attachResizeObserver({
        key,
        className,
        // Defaults unused when seedInitialSize=false; pass a sentinel.
        defaults: { width: 0, height: 0 },
        seedInitialSize: false,
      }),
    [key, className]
  );
  return className;
}
