// Shared filter-pipeline helpers used by SelectContentModal (the
// universal content picker) and AddItemsModal (the codex Add Items
// table). Pulled out so the two surfaces apply identical semantics
// when the user toggles the same filter chip.
//
// Two non-obvious problems handled here:
//
//   1. ITEM GROUP — the filter UI offers 37 PF2e-style category labels
//      (Adjustments, Adventuring Gear, …, Worn Items), but the
//      Postgres schema only stores 7 enum values on `item.group`
//      (GENERAL, WEAPON, ARMOR, SHIELD, RUNE, UPGRADE, MATERIAL). Most
//      of the 37 labels correspond to TRAITS on the item rather than
//      to its group enum — e.g. "Alchemical Items" → has the
//      "Alchemical" trait, "Held Items" → usage starts with "held",
//      "Worn Items" → usage starts with "worn". `matchesItemCategory`
//      below resolves the label to the correct check.
//
//   2. ANCESTRY SIZE — the ancestry table has no `size` column. Size
//      is set indirectly by an operation in the ancestry's
//      `operations` JSON array: an `adjValue`/`setValue` op targeting
//      the SIZE variable with a string value like "medium" / "small".
//      `extractAncestrySize` scans the operations JSON and returns
//      the uppercased size (or undefined).

import { getCachedContent } from '@content/content-store';
import { Trait } from '@schemas/content';
import { Size } from '@schemas/shared';

// ─── Item group → criteria mapping ──────────────────────────────────────────
//
// For each label the user sees in the chip list, define how to match
// against an actual item record. We support three match kinds:
//
//   - groupEnum: direct equality with item.group
//   - traitName: case-insensitive name lookup against the trait cache;
//                if a trait with that name exists, the item must have
//                its id in item.traits
//   - usagePrefix: item.usage starts with one of the listed prefixes
//                  (lowercased)
//
// Labels that can't be cleanly mapped to any of the above resolve to
// `null` — the filter then treats those labels as unmatchable, so an
// "include" chip on them silently shows no rows (better than showing
// every row, which would mask the broken filter from the user). The
// 37-label list lives in SelectContentFilters.tsx; if a label there
// is missing from this map, add it here.
type ItemGroupCriteria =
  | { kind: 'groupEnum'; value: string }
  | { kind: 'traitName'; name: string }
  | { kind: 'usagePrefix'; prefixes: string[] }
  | null;

const ITEM_GROUP_CRITERIA: Record<string, ItemGroupCriteria> = {
  // Direct group-enum matches (5)
  'Weapons': { kind: 'groupEnum', value: 'WEAPON' },
  'Armor': { kind: 'groupEnum', value: 'ARMOR' },
  'Shields': { kind: 'groupEnum', value: 'SHIELD' },
  'Runes': { kind: 'groupEnum', value: 'RUNE' },
  'Materials': { kind: 'groupEnum', value: 'MATERIAL' },

  // Trait-name matches (verified to exist in the WG trait cache)
  'Adjustments': { kind: 'traitName', name: 'Adjustment' },
  'Alchemical Items': { kind: 'traitName', name: 'Alchemical' },
  'Animals and Gear': { kind: 'traitName', name: 'Animal' },
  'Apex Items': { kind: 'traitName', name: 'Apex' },
  'Artifacts': { kind: 'traitName', name: 'Artifact' },
  'Banners': { kind: 'traitName', name: 'Banner' },
  'Censer': { kind: 'traitName', name: 'Censer' },
  'Consumables': { kind: 'traitName', name: 'Consumable' },
  'Contracts': { kind: 'traitName', name: 'Contract' },
  'Cursed Items': { kind: 'traitName', name: 'Cursed' },
  'Figurehead': { kind: 'traitName', name: 'Figurehead' },
  'Grafts': { kind: 'traitName', name: 'Graft' },
  'Grimoires': { kind: 'traitName', name: 'Grimoire' },
  'High-tech': { kind: 'traitName', name: 'Tech' },
  'Intelligent Items': { kind: 'traitName', name: 'Intelligent' },
  'Relics': { kind: 'traitName', name: 'Relic' },
  'Snares': { kind: 'traitName', name: 'Snare' },
  'Spellhearts': { kind: 'traitName', name: 'Spellheart' },
  'Staves': { kind: 'traitName', name: 'Staff' },
  'Structures': { kind: 'traitName', name: 'Structure' },
  'Tattoos': { kind: 'traitName', name: 'Tattoo' },
  'Vehicles': { kind: 'traitName', name: 'Vehicle' },
  'Wands': { kind: 'traitName', name: 'Wand' },

  // Usage-based matches — PF2e items carry a `usage` field like "held
  // in 1 hand", "worn (forehead)", "etched onto armor". Match by prefix.
  'Held Items': { kind: 'usagePrefix', prefixes: ['held', 'held-'] },
  'Worn Items': { kind: 'usagePrefix', prefixes: ['worn', 'worn-'] },

  // No clean mapping in the current schema — keep the chip visible
  // but unmatched. Users get an empty list when they click these,
  // which clearly signals "nothing here" rather than producing
  // spurious matches.
  'Adventuring Gear': null,
  'Assistive Items': null,
  'Blighted Boons': null,
  'Customizations': null,
  'Other': null,
  'Services': null,
  'Trade Goods': null,
};

// Memoised trait-name → trait-id lookup. We can't compute this at module
// load because the trait cache is populated asynchronously after first
// fetch. Resolve on first call after the cache warms; null result means
// "no such trait yet" and we just return false from the match.
const traitNameToIdCache = new Map<string, number | null>();

function resolveTraitId(name: string): number | null {
  const key = name.toLowerCase();
  const cached = traitNameToIdCache.get(key);
  if (cached !== undefined) return cached;
  const traits = getCachedContent<Trait>('trait') ?? [];
  const hit = traits.find((t) => t?.name?.toLowerCase() === key);
  const id = hit ? hit.id : null;
  // Only cache hits — keep retrying misses in case the cache wasn't
  // ready yet on the first call.
  if (id !== null) traitNameToIdCache.set(key, id);
  return id;
}

/**
 * Match a single item against a single item-group label. Returns true
 * if the item belongs to the category the label represents.
 *
 * Examples:
 *   matchesItemCategory({ group: 'WEAPON' }, 'Weapons')        // true
 *   matchesItemCategory({ traits: [3, 17] }, 'Alchemical Items')
 *     // true if trait id 17 has name 'Alchemical' in the cache
 *   matchesItemCategory({ usage: 'held-in-one-hand' }, 'Held Items')  // true
 */
export function matchesItemCategory(item: Record<string, any>, label: string): boolean {
  const criteria = ITEM_GROUP_CRITERIA[label];
  if (!criteria) return false;

  if (criteria.kind === 'groupEnum') {
    return item.group === criteria.value;
  }

  if (criteria.kind === 'traitName') {
    const id = resolveTraitId(criteria.name);
    if (id === null) return false;
    const itemTraits = (item.traits ?? []) as number[];
    return itemTraits.includes(id);
  }

  if (criteria.kind === 'usagePrefix') {
    const usage = String(item.usage ?? '').toLowerCase();
    return criteria.prefixes.some((p) => usage.startsWith(p));
  }

  return false;
}

/**
 * Apply a tri-state itemGroup filter to a single item. Mirrors the
 * semantics of triStateMatches but iterates over labels because each
 * label maps to its own check rather than a single enum comparison.
 *
 *   - Empty map → pass (no filter)
 *   - Item matches a label marked 'exclude' → reject
 *   - At least one label marked 'include' AND item matches none of
 *     those → reject
 *   - Otherwise → accept
 */
export function passesItemGroupFilter(
  item: Record<string, any>,
  itemGroups: Map<string, 'include' | 'exclude'>
): boolean {
  if (itemGroups.size === 0) return true;

  let hasInclude = false;
  let matchesAnyInclude = false;

  for (const [label, state] of itemGroups.entries()) {
    const matched = matchesItemCategory(item, label);
    if (state === 'exclude' && matched) return false;
    if (state === 'include') {
      hasInclude = true;
      if (matched) matchesAnyInclude = true;
    }
  }
  if (hasInclude && !matchesAnyInclude) return false;
  return true;
}

// ─── Cast Time chip → spell.cast substring matcher ────────────────────────
//
// Cast Time chips encode their value as something like 'one-action',
// 'one-or-two', '1 minute'. The actual `spell.cast` field on a record
// is one of:
//   - An ActionCost enum: 'ONE-ACTION', 'TWO-ACTIONS',
//     'ONE-TO-TWO-ACTIONS', 'ONE-TO-THREE-ACTIONS', 'TWO-TO-THREE-ACTIONS',
//     'FREE-ACTION', 'REACTION'
//   - A free-text string for non-standard casts ("1 minute", "10 minutes",
//     "1 hour", …)
//
// The default substring match catches the obvious cases ('one-action'
// matches 'ONE-ACTION'), but blows up on chips that use 'or' phrasing
// ('one-or-two') because the canonical enum is the 'to'-form
// ('ONE-TO-TWO-ACTIONS'). For each chip value we list the substring
// patterns to OR-match against the lowercased `spell.cast`. Any list
// entry that's a substring of the spell's cast is a match.
const CAST_TIME_SUBSTRINGS: Record<string, string[]> = {
  // Single-action enums map cleanly
  'free-action': ['free-action'],
  'reaction': ['reaction'],
  'one-action': ['one-action'],
  'two-actions': ['two-actions'],
  'three-actions': ['three-actions'],
  // Compound action enums — accept either 'to' or 'or' phrasing
  'one-to-two': ['one-to-two', 'one-or-two'],
  'one-or-two': ['one-to-two', 'one-or-two'],
  'one-to-three': ['one-to-three', 'one-or-three', 'one-or-more'],
  'one-or-three': ['one-to-three', 'one-or-three', 'one-or-more'],
  'one-or-more': ['one-to-three', 'one-or-more'],
  'two-to-three': ['two-to-three', 'two-or-three'],
  'two-or-three': ['two-to-three', 'two-or-three'],
  // "2 actions to 2 rounds" (rare; matches the substring on the
  // canonical "two-actions-to-2-rounds" form some sources use).
  'two-to-2-rounds': ['two-to-2-rounds', 'to-2-rounds', '2 rounds'],
  // Free-text durations
  '1 minute': ['1 minute'],
  '5 minutes': ['5 minutes'],
  '10 minutes': ['10 minutes'],
  '30 minutes': ['30 minutes'],
  '1 hour': ['1 hour'],
};

/**
 * Match a `state.cast` chip value against the lowercased spell cast
 * string. Returns true if any of the configured substrings for the
 * chip is present in the cast. Falls back to the raw chip value when
 * no mapping is configured (preserves the legacy substring behaviour
 * so unknown chips still attempt a sensible match).
 */
export function matchesCastTime(spellCast: unknown, chipValue: string): boolean {
  const haystack = String(spellCast ?? '').toLowerCase();
  if (!haystack) return false;
  const needles = CAST_TIME_SUBSTRINGS[chipValue] ?? [chipValue];
  return needles.some((n) => haystack.includes(n.toLowerCase()));
}

// ─── Ancestry size extraction ──────────────────────────────────────────────

const ancestrySizeCache = new WeakMap<object, Size | undefined>();

/**
 * Pull the canonical size off an ancestry record. Ancestry rows don't
 * have a `size` column; instead the size is set by an operation in
 * the ancestry's `operations` JSON array — a setValue/adjValue
 * targeting the SIZE variable. We parse the operations JSON (or
 * already-parsed array) and return the size as one of the Size enum
 * values, or undefined if no SIZE operation is present.
 *
 * Caching: ancestries are immutable in the content cache, so we use
 * a WeakMap keyed by the ancestry object — first call extracts,
 * subsequent calls are O(1).
 */
export function extractAncestrySize(ancestry: Record<string, any>): Size | undefined {
  if (!ancestry || typeof ancestry !== 'object') return undefined;
  const cached = ancestrySizeCache.get(ancestry);
  if (cached !== undefined) return cached === ('NONE' as any) ? undefined : cached;

  const ops = ancestry.operations;
  if (!ops) {
    ancestrySizeCache.set(ancestry, 'NONE' as any);
    return undefined;
  }

  // Operations come back as either an already-parsed array of ops or a
  // JSON string (Postgres COPY paths can land either way depending on
  // the loader). Normalise to a single string we can substring-search.
  const json = typeof ops === 'string' ? ops : JSON.stringify(ops);

  // Look for an operation targeting the SIZE variable with a string
  // value. We don't try to model the full operation structure — a
  // permissive regex is fine here because SIZE values are tightly
  // controlled (always lowercase strings: tiny/small/medium/large/
  // huge/gargantuan).
  const match = json.match(
    /"variable"\s*:\s*"SIZE"[\s\S]{0,160}?"value"\s*:\s*"([^"]+)"/i
  );
  if (!match) {
    ancestrySizeCache.set(ancestry, 'NONE' as any);
    return undefined;
  }

  const raw = match[1].toUpperCase();
  const valid: Size[] = ['TINY', 'SMALL', 'MEDIUM', 'LARGE', 'HUGE', 'GARGANTUAN'];
  const result = valid.includes(raw as Size) ? (raw as Size) : undefined;
  ancestrySizeCache.set(ancestry, result ?? ('NONE' as any));
  return result;
}
