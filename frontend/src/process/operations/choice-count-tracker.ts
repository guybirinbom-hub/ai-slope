import { OperationResult } from '@schemas/operations';
import { OperationCharacterResultPackage } from '@schemas/content';

export function getChoiceCounts(element: HTMLDivElement) {
  const selectionChoices = element.querySelectorAll('.selection-choice-base');
  const selectedChoices = element.querySelectorAll('.selection-choice-selected');
  return {
    current: selectedChoices.length,
    max: selectionChoices.length,
  }
}

// Recursive variant — counts the same { current, max } as the DOM-walker
// above, but reads straight from an OperationResult tree so it can be used
// without first mounting the level's UI. Mirrors CodexChoice's pending pip
// math (max = number of selection nodes, current = number of those with a
// chosen result).
function countChoicesInResult(result: OperationResult, acc: { current: number; max: number }): void {
  if (!result) return;
  if (result.selection) {
    acc.max += 1;
    if (result.result?.source) acc.current += 1;
  }
  for (const sub of result.result?.results ?? []) {
    countChoicesInResult(sub, acc);
  }
}

export function countChoicesInResults(results: OperationResult[] | undefined): { current: number; max: number } {
  const acc = { current: 0, max: 0 };
  for (const r of results ?? []) countChoicesInResult(r, acc);
  return acc;
}

// Pending choice counts per character level (1..20). Level 0 (Initial
// Stats — ancestry/background/class/books/items/custom) folds into the
// level-0 slot in the returned record. Anything whose `baseSource.level`
// is undefined or 0 is treated as level 0.
//
// Reused by the .lv chip strip in CharBuilderCreation so each level chip
// can paint `complete` / `incomplete` without DOM-walking every level.
export function getPendingChoicesPerLevel(
  results: OperationCharacterResultPackage | null
): Record<number, number> {
  const out: Record<number, number> = {};
  for (let i = 0; i <= 20; i++) out[i] = 0;
  if (!results) return out;

  const addToLevel = (level: number | undefined, counts: { current: number; max: number }) => {
    const lvl = Math.max(0, level ?? 0);
    if (lvl > 20) return;
    out[lvl] = (out[lvl] ?? 0) + Math.max(0, counts.max - counts.current);
  };

  // Per-feature buckets keyed on baseSource.level.
  for (const r of results.ancestrySectionResults ?? []) {
    addToLevel(r.baseSource?.level ?? 0, countChoicesInResults(r.baseResults));
  }
  for (const r of results.classFeatureResults ?? []) {
    addToLevel(r.baseSource?.level ?? 0, countChoicesInResults(r.baseResults));
  }

  // Level 0 — Initial Stats aggregations. Ancestry / Background / Class
  // selections live at level 0 alongside the other Initial Stats accordion
  // items in the legacy code path.
  addToLevel(0, countChoicesInResults(results.ancestryResults));
  addToLevel(0, countChoicesInResults(results.backgroundResults));
  addToLevel(0, countChoicesInResults(results.classResults));
  addToLevel(0, countChoicesInResults(results.class2Results));
  addToLevel(0, countChoicesInResults(results.characterResults));
  for (const r of results.contentSourceResults ?? []) {
    addToLevel(0, countChoicesInResults(r.baseResults));
  }
  for (const r of results.itemResults ?? []) {
    addToLevel(r.baseSource?.level ?? 0, countChoicesInResults(r.baseResults));
  }

  return out;
}
