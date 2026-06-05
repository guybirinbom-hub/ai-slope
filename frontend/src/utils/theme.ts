/* wg4 light/dark theme toggle.
 *
 * The dark theme (css/wg4-dark.css) is gated by a `theme-dark` class on
 * the <html> element. We persist the choice in localStorage and apply it
 * to <html>. A tiny inline script in index.html applies the stored class
 * before first paint (no flash); this module is the runtime/UI side. */

export type Wg4Theme = 'light' | 'dark';

const STORAGE_KEY = 'wg4-theme';

export function getStoredTheme(): Wg4Theme {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'dark' ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

export function applyTheme(theme: Wg4Theme): void {
  const root = document.documentElement;
  root.classList.toggle('theme-dark', theme === 'dark');
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    /* localStorage unavailable — theme still applies for this session. */
  }
}

export function toggleTheme(): Wg4Theme {
  const next: Wg4Theme = getStoredTheme() === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  return next;
}
