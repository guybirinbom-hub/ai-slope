import { useEffect } from 'react';
import { accentVars } from './accent-color';

/**
 * Apply a character's chosen sheet accent colour across the whole `.wg4` tree
 * (the character sheet, the builder, popups/drawers, and the loading screen)
 * for as long as the calling component is mounted.
 *
 * The colour replaces the default rust accent (`--wg4-accent` and friends) via
 * a single injected stylesheet. `accentVars` clamps the colour's luminance so
 * it stays legible as both a background (light text on it) and a detail on the
 * light/dark surfaces — so changing the colour never breaks visibility.
 *
 * Used by both the sheet and the builder so the accent updates live as the
 * player edits it (no save button needed) and persists when they revisit.
 */
export function useSheetAccent(color: string | null | undefined) {
  useEffect(() => {
    const id = 'wg4-sheet-accent';
    const vars = color ? accentVars(color) : null;
    if (!vars) {
      document.getElementById(id)?.remove();
      return;
    }
    let el = document.getElementById(id) as HTMLStyleElement | null;
    if (!el) {
      el = document.createElement('style');
      el.id = id;
      document.head.appendChild(el);
    }
    // `.wg4.wg4` (deliberately doubled class) raises specificity above the
    // global-accent injector (which targets `.wg4`/`:root`), so a character's
    // own accent always wins on its sheet/builder no matter the stylesheet
    // load order. It matches exactly the same elements as `.wg4`.
    const body = Object.entries(vars).map(([k, v]) => `${k}:${v}!important`).join(';');
    // Also target the codex modal portal classes (item editor, spell/item
    // search, confirm/operations dialogs, image picker, homebrew editor). They
    // render at <body>, OUTSIDE the .wg4 sheet root, so without this they keep
    // codex-bridge.css's hardcoded default rust and show orange instead of the
    // character's chosen accent.
    const sel = [
      '.wg4.wg4', '.codex-add-items', '.codex-manage-spells', '.codex-spell-picker',
      '.codex-select-content', '.codex-confirm-modal', '.codex-operations-modal',
      '.codex-select-image-modal', '.codex-edit-item', '.codex-hb-editor',
    ].join(',');
    el.textContent = sel + '{' + body + '}';
    return () => document.getElementById(id)?.remove();
  }, [color]);
}
