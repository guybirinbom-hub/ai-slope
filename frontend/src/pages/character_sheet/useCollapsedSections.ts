/**
 * useCollapsedSections — small hook that tracks which character-sheet
 * sections are collapsed (body hidden under the header), persisting the
 * set across mounts via localStorage.
 *
 * Each section is identified by a stable string ID. Toggling a section
 * flips its presence in the persisted Set, then writes the new Set back
 * to localStorage so the collapse state survives reloads of the sheet.
 *
 * The hook returns:
 *   - isCollapsed(id):  true when the section with that ID is currently
 *                       collapsed.
 *   - toggle(id):       flip the collapsed state for that section ID.
 *
 * Failures reading or writing localStorage are swallowed silently — the
 * hook degrades to in-memory state without throwing.
 */
import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'wg4-collapsed-sections';

function loadCollapsed(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return new Set(Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
}

function saveCollapsed(set: Set<string>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...set]));
  } catch {
    /* localStorage unavailable — silently skip persistence. */
  }
}

export function useCollapsedSections() {
  const [collapsed, setCollapsed] = useState<Set<string>>(() => loadCollapsed());

  // Cross-tab / cross-mount sync. If another sheet instance toggles a
  // section, this listener picks it up. Mostly defensive; the desktop
  // app only renders one sheet at a time.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== STORAGE_KEY) return;
      setCollapsed(loadCollapsed());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const toggle = useCallback((id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      saveCollapsed(next);
      return next;
    });
  }, []);

  const isCollapsed = useCallback(
    (id: string) => collapsed.has(id),
    [collapsed]
  );

  return { isCollapsed, toggle };
}
