/**
 * Custom user-created modes.
 *
 * A "custom mode" is a user-defined toggleable buff/debuff for their
 * character — Rage, Sneak Attack stance, "Bless" group buff, anything.
 * Each mode owns a name, a description, and a list of effects. When
 * the user toggles the mode on, each effect adds a bonus/penalty to
 * the named variable via the engine's addVariableBonus pipeline.
 *
 * Two scopes:
 *   - `'global'`  — stored in localStorage, available on every
 *                   character. Use for buffs you want everywhere
 *                   ("Heroism", "Bless", a generic party stance).
 *   - `'character'` — stored on the character itself via
 *                     meta_data.custom_modes; only that character
 *                     sees it. Use for class- or build-specific
 *                     stances like a Barbarian's Rage with their
 *                     specific damage instinct numbers.
 *
 * Active state lives in `character.meta_data.active_modes` — same
 * list as the built-in modes. Names get labelToVariable-d so a mode
 * called "Furious Rage" toggles as "FURIOUS_RAGE" alongside engine
 * modes.
 */

import { labelToVariable } from '@variables/variable-utils';

/** A single bonus/penalty that fires when the mode is active. */
export interface CustomModeEffect {
  /** Engine variable name, e.g. 'SKILL_ATHLETICS', 'AC_BONUS'. */
  variable: string;
  /** Signed integer, e.g. +2 for a +2 status bonus, -1 for a penalty. */
  value: number;
  /** PF2e bonus type. 'status'/'circumstance'/'item' stack with
   *  themselves only the highest of their type — `undefined` means
   *  untyped (always stacks). */
  type?: 'status' | 'circumstance' | 'item' | 'untyped';
  /** Optional note shown in the variable's history tooltip. */
  text?: string;
}

export interface CustomMode {
  id: string;
  name: string;
  description: string;
  effects: CustomModeEffect[];
  /** Which storage this lives in — used by the editor to know where
   *  to persist edits. Not serialized into storage itself; we derive
   *  it from which store the mode came from. */
  scope?: 'global' | 'character';
}

const GLOBAL_STORAGE_KEY = 'wg-custom-modes';

/** Read user-level global modes from localStorage. Empty array on
 *  first run or if the value is corrupt. */
export function getGlobalCustomModes(): CustomMode[] {
  try {
    const raw = localStorage.getItem(GLOBAL_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((m) => ({ ...m, scope: 'global' as const }));
  } catch {
    return [];
  }
}

/** Replace the saved global modes with the given list. */
export function setGlobalCustomModes(modes: CustomMode[]): void {
  try {
    // Strip `scope` before saving so we don't bake the runtime hint
    // into storage (we set it back on read).
    const stripped = modes.map(({ scope: _scope, ...rest }) => rest);
    localStorage.setItem(GLOBAL_STORAGE_KEY, JSON.stringify(stripped));
  } catch {
    // Storage quotas / private mode — fail silently; the in-memory
    // list still works for the current session.
  }
}

/** Stable mode id for active-mode toggle bookkeeping. We label-var
 *  the name so a custom mode named "Battle Rage" toggles under the
 *  same key shape as built-in modes ("BATTLE_RAGE"). */
export function getModeToggleKey(mode: { name: string }): string {
  return labelToVariable(mode.name);
}

/** Merge global + character-scoped modes into a single list with
 *  scope tags. Character modes win on id collision (an unlikely
 *  manual edit case). */
export function getAllCustomModes(
  characterModes: CustomMode[] | undefined
): CustomMode[] {
  const globals = getGlobalCustomModes();
  const chars = (characterModes ?? []).map((m) => ({ ...m, scope: 'character' as const }));
  const byId = new Map<string, CustomMode>();
  for (const m of globals) byId.set(m.id, m);
  for (const m of chars) byId.set(m.id, m); // character overrides global on id collision
  return Array.from(byId.values());
}

/** A curated, grouped pick-list of variables a mode can target.
 *  Hand-picked to cover the 95% of PF2e house-buff use cases without
 *  burying the user in 200 engine variable names. Free-form input
 *  in the form still accepts any variable name for the power users. */
export const MODE_TARGET_GROUPS: { label: string; targets: { variable: string; label: string }[] }[] = [
  {
    label: 'Defense',
    targets: [
      { variable: 'AC_BONUS', label: 'AC' },
      { variable: 'SAVE_FORT', label: 'Fortitude' },
      { variable: 'SAVE_REFLEX', label: 'Reflex' },
      { variable: 'SAVE_WILL', label: 'Will' },
      { variable: 'MAX_HEALTH_BONUS', label: 'Max HP' },
    ],
  },
  {
    label: 'Offense',
    targets: [
      { variable: 'ATTACK_ROLLS_BONUS', label: 'Attack rolls' },
      { variable: 'ATTACK_DAMAGE_BONUS', label: 'Attack damage' },
      { variable: 'STR_ATTACK_ROLLS_BONUS', label: 'Str attack rolls' },
      { variable: 'STR_ATTACK_DAMAGE_BONUS', label: 'Str attack damage' },
      { variable: 'DEX_ATTACK_ROLLS_BONUS', label: 'Dex attack rolls' },
      { variable: 'DEX_ATTACK_DAMAGE_BONUS', label: 'Dex attack damage' },
      { variable: 'RANGED_ATTACK_ROLLS_BONUS', label: 'Ranged attack rolls' },
      { variable: 'SPELL_ATTACK', label: 'Spell attack' },
      { variable: 'SPELL_DC', label: 'Spell DC' },
      { variable: 'CLASS_DC', label: 'Class DC' },
    ],
  },
  {
    label: 'Movement & Senses',
    targets: [
      { variable: 'SPEED', label: 'Speed' },
      { variable: 'SPEED_FLY', label: 'Fly speed' },
      { variable: 'SPEED_CLIMB', label: 'Climb speed' },
      { variable: 'SPEED_BURROW', label: 'Burrow speed' },
      { variable: 'SPEED_SWIM', label: 'Swim speed' },
      { variable: 'PERCEPTION', label: 'Perception' },
    ],
  },
  {
    label: 'Skills',
    targets: [
      { variable: 'SKILL_ACROBATICS', label: 'Acrobatics' },
      { variable: 'SKILL_ARCANA', label: 'Arcana' },
      { variable: 'SKILL_ATHLETICS', label: 'Athletics' },
      { variable: 'SKILL_CRAFTING', label: 'Crafting' },
      { variable: 'SKILL_DECEPTION', label: 'Deception' },
      { variable: 'SKILL_DIPLOMACY', label: 'Diplomacy' },
      { variable: 'SKILL_INTIMIDATION', label: 'Intimidation' },
      { variable: 'SKILL_MEDICINE', label: 'Medicine' },
      { variable: 'SKILL_NATURE', label: 'Nature' },
      { variable: 'SKILL_OCCULTISM', label: 'Occultism' },
      { variable: 'SKILL_PERFORMANCE', label: 'Performance' },
      { variable: 'SKILL_RELIGION', label: 'Religion' },
      { variable: 'SKILL_SOCIETY', label: 'Society' },
      { variable: 'SKILL_STEALTH', label: 'Stealth' },
      { variable: 'SKILL_SURVIVAL', label: 'Survival' },
      { variable: 'SKILL_THIEVERY', label: 'Thievery' },
    ],
  },
];

/** Reverse lookup — given a variable name, find its friendly label. */
export function targetLabelForVariable(variable: string): string {
  for (const g of MODE_TARGET_GROUPS) {
    const hit = g.targets.find((t) => t.variable === variable);
    if (hit) return hit.label;
  }
  return variable;
}
