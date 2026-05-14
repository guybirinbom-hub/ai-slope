// Per-class spell pick tables for PF2e Remaster.
//
// Source of truth: D:\Inst\pf2e-spellcasting-rules.md — every entry below is
// derived from the AoN class pages as verified by the user. If a number here
// is wrong, fix the rules doc first, then update this file.
//
// This file is consumed by the character BUILDER (not the character sheet).
// It tells the builder, for a given (class, level), exactly which "pick N
// spells of rank R" prompts to surface. The builder gates the spell picker
// to the right tradition, rank, and (Common) rarity.
//
// What this file is NOT:
// - It's not the slot table (slots are encoded in the class's SPELL_SLOTS
//   variable via class operations — already wired up upstream).
// - It's not the repertoire/spellbook STORAGE — that lives in
//   character.spells.list. This file just describes the EXPECTED count at
//   each level so the builder can show "you still need to pick X spells."
// - It does not encode subclass-granted spells (bloodline, muse, patron
//   lesson, curriculum, conscious mind). Those are auto-granted by the
//   subclass's own operations and don't need a builder prompt.

export type CastingTradition = 'arcane' | 'divine' | 'occult' | 'primal';

export type CastingType =
  | 'none'
  | 'spontaneous-repertoire'  // Bard, Sorcerer, Oracle, Summoner, Psychic
  | 'prepared-tradition'       // Cleric, Druid (prep daily from tradition, no spellbook/repertoire to fill at builder time)
  | 'prepared-spellbook'       // Wizard, Magus, Witch (familiar's grimoire)
  | 'prepared-hybrid';         // Animist (animist=prepared from tradition, apparition=spontaneous from apparition list)

export type TraditionSource =
  | { mode: 'fixed'; value: CastingTradition }
  | { mode: 'by-subclass' };  // Sorcerer (bloodline), Witch (patron), Summoner (eidolon)

// A single "pick" prompt the builder should show at a given level.
//   kind='cantrip' → "Pick N cantrips of tradition T (Common)"
//   kind='spell'   → "Pick N rank-R spells of tradition T (Common)"
//   kind='spellbook' → "Add N spells to your spellbook (any rank you can cast, Common)"
//   kind='curriculum-spell' → wizard-only: "Pick N rank-R curriculum spells from school X"
//   kind='apparition' → animist-only: "Pick an apparition"
export type SpellPick =
  | { kind: 'cantrip'; count: number }
  | { kind: 'spell'; rank: number; count: number }
  | { kind: 'spellbook'; count: number }
  | { kind: 'curriculum-spell'; rank: number; count: number }
  | { kind: 'apparition'; count: number; primary?: boolean };

export type ClassCastingProfile = {
  // Lowercased class name; matches character.details.class.name.toLowerCase()
  className: string;
  // High-level paradigm — drives which slot/repertoire UI to show
  castingType: CastingType;
  // Tradition source — fixed for most classes, 'by-subclass' for those that
  // read tradition from their subclass row (bloodline / patron / eidolon)
  tradition: TraditionSource;
  // Per-level picks (1..20). Each entry is the DELTA at that specific level
  // (i.e. what the player gains AT that level, not the cumulative total).
  // Empty array = nothing to pick at this level.
  picksByLevel: Record<number, SpellPick[]>;
};

// Helpers used to build the per-rank picks for the standard full-caster
// progression. PF2e Remaster unlocks each rank at:
//   R1 = L1, R2 = L3, R3 = L5, R4 = L7, R5 = L9, R6 = L11, R7 = L13, R8 = L15, R9 = L17
// (R10 is only ever granted via class capstone features, separately.)
function fullCasterSpontaneousFreePicks(opts: {
  // Number of R1 spells picked at L1 (e.g. 2 for Bard, 3 for Oracle, 2 for
  // Sorcerer net of bloodline auto-grant)
  l1R1Picks: number;
  // Cap on player-chosen spells per rank after rank unlock (excludes auto-grants).
  // Bard/Oracle cap = 3; Sorcerer effective free-pick cap = 3 (bloodline auto-grants the 4th).
  capPerRank: number;
  // R10 free picks (granted by L19 capstone; varies)
  r10FreePicks: number;
}): Record<number, SpellPick[]> {
  const rankUnlockLevel: Record<number, number> = {
    1: 1, 2: 3, 3: 5, 4: 7, 5: 9, 6: 11, 7: 13, 8: 15, 9: 17,
  };
  const picks: Record<number, SpellPick[]> = {};
  for (let lvl = 1; lvl <= 20; lvl++) picks[lvl] = [];

  for (const rank of [1, 2, 3, 4, 5, 6, 7, 8, 9]) {
    const unlock = rankUnlockLevel[rank];
    if (unlock === undefined) continue;
    // At unlock level: pick the initial chunk
    const initial = rank === 1 ? opts.l1R1Picks : 2;
    picks[unlock].push({ kind: 'spell', rank, count: initial });
    // The following level (rank's second exposure) fills toward the cap
    const next = unlock + 1;
    if (next <= 20) {
      const remaining = Math.max(0, opts.capPerRank - initial);
      if (remaining > 0) picks[next].push({ kind: 'spell', rank, count: remaining });
    }
  }
  if (opts.r10FreePicks > 0) picks[19].push({ kind: 'spell', rank: 10, count: opts.r10FreePicks });
  return picks;
}

// Same as above but for half-casters (rank unlocks pace slowed) — used by Magus
// and Summoner. Both have rank unlocks at L1/3/5/7/9/11/13/15/17 (same as full
// casters) but smaller slot caps.
function halfCasterSpontaneousFreePicks(opts: {
  l1R1Picks: number;
  capPerRank: number;
  r10FreePicks: number;
}): Record<number, SpellPick[]> {
  // Pace is identical to full caster's unlock schedule in PF2e — what's
  // different is the slot cap, which is implicit in capPerRank.
  return fullCasterSpontaneousFreePicks(opts);
}

// ─── Bard ─────────────────────────────────────────────────────────────────
const bard: ClassCastingProfile = {
  className: 'bard',
  castingType: 'spontaneous-repertoire',
  tradition: { mode: 'fixed', value: 'occult' },
  picksByLevel: {
    ...fullCasterSpontaneousFreePicks({ l1R1Picks: 2, capPerRank: 3, r10FreePicks: 2 }),
    // L1 cantrips: 5 free picks. Muse-granted R1 spell is auto from subclass.
    1: [
      { kind: 'cantrip', count: 5 },
      { kind: 'spell', rank: 1, count: 2 },
    ],
  },
};

// ─── Cleric ───────────────────────────────────────────────────────────────
// Prepared from tradition: nothing to pick at character creation. Daily-prep
// flow handles the spell selection at play time.
const cleric: ClassCastingProfile = {
  className: 'cleric',
  castingType: 'prepared-tradition',
  tradition: { mode: 'fixed', value: 'divine' },
  picksByLevel: { 1: [], 2: [], 3: [], 4: [], 5: [], 6: [], 7: [], 8: [], 9: [], 10: [],
                  11: [], 12: [], 13: [], 14: [], 15: [], 16: [], 17: [], 18: [], 19: [], 20: [] },
};

// ─── Druid ────────────────────────────────────────────────────────────────
// Same shape as Cleric (prepared from tradition).
const druid: ClassCastingProfile = {
  className: 'druid',
  castingType: 'prepared-tradition',
  tradition: { mode: 'fixed', value: 'primal' },
  picksByLevel: { ...cleric.picksByLevel },
};

// ─── Sorcerer ─────────────────────────────────────────────────────────────
// Free-pick cap effectively 3 per rank (the +1 slot per rank is the bloodline
// auto-grant). At L1 the player picks 2 R1 (the 3rd is the bloodline spell).
// Bloodline also auto-grants 1 cantrip, so free cantrip picks = 4 (not 5).
const sorcerer: ClassCastingProfile = {
  className: 'sorcerer',
  castingType: 'spontaneous-repertoire',
  tradition: { mode: 'by-subclass' },
  picksByLevel: {
    ...fullCasterSpontaneousFreePicks({ l1R1Picks: 2, capPerRank: 3, r10FreePicks: 0 }),
    1: [
      { kind: 'cantrip', count: 4 },
      { kind: 'spell', rank: 1, count: 2 },
    ],
    // L19 Bloodline Paragon: 1 R10 slot, both R10 spells in repertoire are
    // bloodline-granted — zero free R10 picks.
  },
};

// ─── Witch ────────────────────────────────────────────────────────────────
// Prepared with a familiar grimoire (Wizard-shape spellbook). At L1 the
// player picks 5 cantrips + 5 R1 spells (patron lesson adds 1 R1
// auto-granted; patron hex cantrip is separate from regular cantrips).
// Per-level: +2 spells of any rank you can cast.
const witch: ClassCastingProfile = {
  className: 'witch',
  castingType: 'prepared-spellbook',
  tradition: { mode: 'by-subclass' },
  picksByLevel: {
    1: [
      { kind: 'cantrip', count: 5 },
      { kind: 'spell', rank: 1, count: 5 },
    ],
    2: [{ kind: 'spellbook', count: 2 }],
    3: [{ kind: 'spellbook', count: 2 }],
    4: [{ kind: 'spellbook', count: 2 }],
    5: [{ kind: 'spellbook', count: 2 }],
    6: [{ kind: 'spellbook', count: 2 }],
    7: [{ kind: 'spellbook', count: 2 }],
    8: [{ kind: 'spellbook', count: 2 }],
    9: [{ kind: 'spellbook', count: 2 }],
    10: [{ kind: 'spellbook', count: 2 }],
    11: [{ kind: 'spellbook', count: 2 }],
    12: [{ kind: 'spellbook', count: 2 }],
    13: [{ kind: 'spellbook', count: 2 }],
    14: [{ kind: 'spellbook', count: 2 }],
    15: [{ kind: 'spellbook', count: 2 }],
    16: [{ kind: 'spellbook', count: 2 }],
    17: [{ kind: 'spellbook', count: 2 }],
    18: [{ kind: 'spellbook', count: 2 }],
    19: [{ kind: 'spellbook', count: 2 }],
    20: [{ kind: 'spellbook', count: 2 }],
  },
};

// ─── Wizard ───────────────────────────────────────────────────────────────
// Starting spellbook: 10 cantrips + 5 R1 spells (player choice from common
// arcane) + 2 R1 curriculum spells (player choice from school's curriculum
// list — Universalist excepted, handled in the UI via subclass check).
// Per-level: +2 spells of any rank you can cast.
// New-rank-unlock levels (L3/L5/L7/...): +1 curriculum spell of that new rank
// (auto-granted via school operations — does NOT appear as a builder prompt
// since the school picks the spell).
const wizard: ClassCastingProfile = {
  className: 'wizard',
  castingType: 'prepared-spellbook',
  tradition: { mode: 'fixed', value: 'arcane' },
  picksByLevel: {
    1: [
      { kind: 'cantrip', count: 10 },
      { kind: 'spell', rank: 1, count: 5 },
      { kind: 'curriculum-spell', rank: 1, count: 2 },
    ],
    2: [{ kind: 'spellbook', count: 2 }],
    3: [{ kind: 'spellbook', count: 2 }],
    4: [{ kind: 'spellbook', count: 2 }],
    5: [{ kind: 'spellbook', count: 2 }],
    6: [{ kind: 'spellbook', count: 2 }],
    7: [{ kind: 'spellbook', count: 2 }],
    8: [{ kind: 'spellbook', count: 2 }],
    9: [{ kind: 'spellbook', count: 2 }],
    10: [{ kind: 'spellbook', count: 2 }],
    11: [{ kind: 'spellbook', count: 2 }],
    12: [{ kind: 'spellbook', count: 2 }],
    13: [{ kind: 'spellbook', count: 2 }],
    14: [{ kind: 'spellbook', count: 2 }],
    15: [{ kind: 'spellbook', count: 2 }],
    16: [{ kind: 'spellbook', count: 2 }],
    17: [{ kind: 'spellbook', count: 2 }],
    18: [{ kind: 'spellbook', count: 2 }],
    19: [{ kind: 'spellbook', count: 2 }],
    20: [{ kind: 'spellbook', count: 2 }],
  },
};

// ─── Oracle ───────────────────────────────────────────────────────────────
// Same shape as Bard but Divine tradition; no muse-equivalent auto-grant
// at L1 (mystery grants a focus revelation spell, separate from repertoire).
// L19 Oracular Clarity: 2 R10 spells in repertoire, 1 slot.
const oracle: ClassCastingProfile = {
  className: 'oracle',
  castingType: 'spontaneous-repertoire',
  tradition: { mode: 'fixed', value: 'divine' },
  picksByLevel: {
    ...fullCasterSpontaneousFreePicks({ l1R1Picks: 3, capPerRank: 4, r10FreePicks: 2 }),
    1: [
      { kind: 'cantrip', count: 5 },
      { kind: 'spell', rank: 1, count: 3 },
    ],
  },
};

// ─── Animist ──────────────────────────────────────────────────────────────
// Hybrid: animist spells = prepared from divine (no builder prompt — daily
// prep handles selection). Apparition spells = granted by attuned apparitions
// (player picks the apparition, not the individual spells). So the only
// character-creation prompts are: cantrips, the L1 R1 animist spell choice,
// and the apparition picks.
const animist: ClassCastingProfile = {
  className: 'animist',
  castingType: 'prepared-hybrid',
  tradition: { mode: 'fixed', value: 'divine' },
  picksByLevel: {
    1: [
      // Animist cantrips (2) — apparition cantrips come from apparitions, not picks.
      { kind: 'cantrip', count: 2 },
      { kind: 'apparition', count: 1, primary: true },
      { kind: 'apparition', count: 1 },
    ],
    2: [], 3: [], 4: [], 5: [], 6: [],
    7: [{ kind: 'apparition', count: 1 }],  // Third Apparition
    8: [], 9: [], 10: [], 11: [], 12: [], 13: [], 14: [],
    15: [{ kind: 'apparition', count: 1 }], // Fourth Apparition
    16: [], 17: [], 18: [], 19: [], 20: [],
  },
};

// ─── Magus ────────────────────────────────────────────────────────────────
// Half-caster prepared with spellbook. Starting: 8 cantrips + 4 R1 spells.
// Per-level: +2 spells. Studious Spells (L7+) auto-add specific spells —
// not a builder prompt.
const magus: ClassCastingProfile = {
  className: 'magus',
  castingType: 'prepared-spellbook',
  tradition: { mode: 'fixed', value: 'arcane' },
  picksByLevel: {
    1: [
      { kind: 'cantrip', count: 8 },
      { kind: 'spell', rank: 1, count: 4 },
    ],
    2: [{ kind: 'spellbook', count: 2 }],
    3: [{ kind: 'spellbook', count: 2 }],
    4: [{ kind: 'spellbook', count: 2 }],
    5: [{ kind: 'spellbook', count: 2 }],
    6: [{ kind: 'spellbook', count: 2 }],
    7: [{ kind: 'spellbook', count: 2 }],
    8: [{ kind: 'spellbook', count: 2 }],
    9: [{ kind: 'spellbook', count: 2 }],
    10: [{ kind: 'spellbook', count: 2 }],
    11: [{ kind: 'spellbook', count: 2 }],
    12: [{ kind: 'spellbook', count: 2 }],
    13: [{ kind: 'spellbook', count: 2 }],
    14: [{ kind: 'spellbook', count: 2 }],
    15: [{ kind: 'spellbook', count: 2 }],
    16: [{ kind: 'spellbook', count: 2 }],
    17: [{ kind: 'spellbook', count: 2 }],
    18: [{ kind: 'spellbook', count: 2 }],
    19: [{ kind: 'spellbook', count: 2 }],
    20: [{ kind: 'spellbook', count: 2 }],
  },
};

// ─── Summoner ─────────────────────────────────────────────────────────────
// Unique fixed-size repertoire (max 5 from L4 onward). Encoded as discrete
// per-level deltas — the builder shows the player exactly how many new
// spells to pick and at what rank.
//
// L1: pick 2 R1
// L2: pick 1 more R1 (total 3 R1, repertoire size 3)
// L3: pick 1 R2 (total 4 spells)
// L4: pick 1 more R2 (total 5 spells — repertoire full)
// L5+: at new-rank-unlock levels, pick 2 of the new rank AND drop 2 old
//      spells (typically the lowest-rank ones, since their slots are gone)
const summoner: ClassCastingProfile = {
  className: 'summoner',
  castingType: 'spontaneous-repertoire',
  tradition: { mode: 'by-subclass' },
  picksByLevel: {
    1: [
      { kind: 'cantrip', count: 5 },
      { kind: 'spell', rank: 1, count: 2 },
    ],
    2: [{ kind: 'spell', rank: 1, count: 1 }],
    3: [{ kind: 'spell', rank: 2, count: 1 }],
    4: [{ kind: 'spell', rank: 2, count: 1 }],
    5: [{ kind: 'spell', rank: 3, count: 2 }],
    6: [],
    7: [{ kind: 'spell', rank: 4, count: 2 }],
    8: [],
    9: [{ kind: 'spell', rank: 5, count: 2 }],
    10: [],
    11: [{ kind: 'spell', rank: 6, count: 2 }],
    12: [],
    13: [{ kind: 'spell', rank: 7, count: 2 }],
    14: [],
    15: [{ kind: 'spell', rank: 8, count: 2 }],
    16: [],
    17: [{ kind: 'spell', rank: 9, count: 2 }],
    18: [], 19: [], 20: [],
  },
};

// ─── Psychic ──────────────────────────────────────────────────────────────
// Half-caster spontaneous (3-cap repertoire per rank: 2 slot + 1 conscious
// mind bonus). Conscious mind auto-grants 1 spell at each new rank's first
// level — that's not a builder prompt. The player free-picks the remaining
// spells per rank.
//
// Cantrips: 3 base + 3 psi (1 unique + 2 chosen from psi-cantrip list). For
// the builder's "free choice" prompt: pick 3 regular cantrips at L1, pick 2
// psi-cantrips from the psi-cantrip list at L1 (the unique one is granted
// by the conscious mind).
const psychic: ClassCastingProfile = {
  className: 'psychic',
  castingType: 'spontaneous-repertoire',
  tradition: { mode: 'fixed', value: 'occult' },
  picksByLevel: {
    1: [
      { kind: 'cantrip', count: 3 },
      { kind: 'spell', rank: 1, count: 1 },
    ],
    2: [{ kind: 'spell', rank: 1, count: 1 }],
    3: [{ kind: 'spell', rank: 2, count: 1 }],
    4: [{ kind: 'spell', rank: 2, count: 1 }],
    5: [{ kind: 'spell', rank: 3, count: 1 }],
    6: [{ kind: 'spell', rank: 3, count: 1 }],
    7: [{ kind: 'spell', rank: 4, count: 1 }],
    8: [{ kind: 'spell', rank: 4, count: 1 }],
    9: [{ kind: 'spell', rank: 5, count: 1 }],
    10: [{ kind: 'spell', rank: 5, count: 1 }],
    11: [{ kind: 'spell', rank: 6, count: 1 }],
    12: [{ kind: 'spell', rank: 6, count: 1 }],
    13: [{ kind: 'spell', rank: 7, count: 1 }],
    14: [{ kind: 'spell', rank: 7, count: 1 }],
    15: [{ kind: 'spell', rank: 8, count: 1 }],
    16: [{ kind: 'spell', rank: 8, count: 1 }],
    17: [{ kind: 'spell', rank: 9, count: 1 }],
    18: [{ kind: 'spell', rank: 9, count: 1 }],
    19: [{ kind: 'spell', rank: 10, count: 2 }],
    20: [],
  },
};

// Public lookup table — keyed by lowercase class name. If a player picks a
// class whose name isn't here (e.g. homebrew), the builder skips the spell
// pick UI entirely and falls back to the existing freeform spell management.
export const CASTING_TABLES: Record<string, ClassCastingProfile> = {
  bard,
  cleric,
  druid,
  sorcerer,
  witch,
  wizard,
  oracle,
  animist,
  magus,
  summoner,
  psychic,
};

// Convenience accessor: looks up the profile for a class name (any case).
// Returns null when the class isn't a spellcaster we have rules for.
export function getCastingProfile(className: string | null | undefined): ClassCastingProfile | null {
  if (!className) return null;
  return CASTING_TABLES[className.trim().toLowerCase()] ?? null;
}

// Per-level convenience: returns the picks the builder should surface AT
// this exact level (not cumulative). Empty array if nothing to pick.
export function getSpellPicksAtLevel(className: string | null | undefined, level: number): SpellPick[] {
  const profile = getCastingProfile(className);
  if (!profile) return [];
  return profile.picksByLevel[level] ?? [];
}

// Cumulative picks: walks levels 1..currentLevel and sums every pick. The
// builder uses this to compute the TOTAL expected count and compare with
// current selections. We collapse same-kind/same-rank entries into one.
export function getCumulativePicks(className: string | null | undefined, throughLevel: number): SpellPick[] {
  const profile = getCastingProfile(className);
  if (!profile) return [];
  const out = new Map<string, SpellPick>();
  for (let lvl = 1; lvl <= throughLevel; lvl++) {
    for (const pick of profile.picksByLevel[lvl] ?? []) {
      let key: string;
      if (pick.kind === 'spell') key = `spell-${pick.rank}`;
      else if (pick.kind === 'cantrip') key = 'cantrip';
      else if (pick.kind === 'spellbook') key = 'spellbook';
      else if (pick.kind === 'curriculum-spell') key = `curriculum-${pick.rank}`;
      else if (pick.kind === 'apparition') key = `apparition${pick.primary ? '-primary' : ''}`;
      else key = 'unknown';
      const existing = out.get(key);
      if (existing) {
        out.set(key, { ...existing, count: existing.count + pick.count } as SpellPick);
      } else {
        out.set(key, { ...pick });
      }
    }
  }
  return [...out.values()];
}
