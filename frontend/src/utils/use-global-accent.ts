import { useEffect } from 'react';
import { accentVars } from './accent-color';

/**
 * Apply the GLOBAL accent colour (chosen in Settings) across the whole app.
 *
 * This is the base accent for everything that isn't inside a specific
 * character's sheet/builder — the Characters page, Settings, drawers, popups,
 * loaders, etc. It overrides the built-in default rust accent (light + dark).
 *
 * A per-character accent (useSheetAccent) injects a HIGHER-specificity rule
 * (`.wg4.wg4 { … !important }`), so on a character's sheet/builder that
 * character's own colour still wins; everywhere else this global accent shows
 * through. `accentVars` clamps luminance so legibility is preserved.
 */
export function useGlobalAccent(color: string | null | undefined) {
  useEffect(() => {
    const id = 'wg4-global-accent';
    const vars = color ? accentVars(color) : null;
    if (!vars) {
      // No global accent set — remove the override so the built-in default shows.
      document.getElementById(id)?.remove();
      return;
    }
    let el = document.getElementById(id) as HTMLStyleElement | null;
    if (!el) {
      el = document.createElement('style');
      el.id = id;
      document.head.appendChild(el);
    }
    const decls = Object.entries(vars)
      .map(([k, v]) => `${k}:${v}!important`)
      .join(';');
    // `:root` covers portaled UI (Select dropdowns, date pickers) that resolve
    // vars from the document root; `.wg4` covers the app surfaces (which declare
    // their own `.wg4` defaults). Both `!important` so they beat the built-in
    // light/dark defaults. The per-character `.wg4.wg4` override outranks this.
    el.textContent = `:root{${decls}}.wg4{${decls}}`;
    return () => document.getElementById(id)?.remove();
  }, [color]);
}
