// Battlezoo Bestiary "Monster Parts" subsystem helpers.
//
// Refinement and imbuing both work by accumulating gp-value of monster
// parts on an item; when the total crosses a threshold the item levels
// up (refinement) or the imbued property levels up (imbuing). The
// thresholds come from Tables 3A/3B (refinement) and 5A/5B (imbuing) in
// the source book. This module encodes those tables once and offers
// look-up helpers; everything that touches refinement/imbuing in the UI
// or the character compute funnels through here so there's one source
// of truth.
//
// Mapping refinement level → fundamental rune bonuses (Tables 4A/4B/4C/
// 4D/4E) lives in `refinementBonuses` below. We project those bonuses
// onto the existing fundamental-rune fields on `Item.meta_data.runes`
// (potency / striking / resilient) so the rest of the character compute
// — weapon attack, AC, save bonus, etc. — picks them up unchanged.

import type { Item } from '@schemas/content';
import type { Operation } from '@schemas/operations';
import type { StoreID, VariableNum } from '@schemas/variables';
import { getVariable } from '@variables/variable-manager';

// ─── Refinement: total cost (gp of monster parts) to reach a given item level ─

// Table 3A: weapons and armor.
const REFINEMENT_COST_WEAPON_ARMOR = [
  null,    20,    35,    60,   100,   160,   250,   360,   500,   700,  1000, // 0..10
  1400,  2000,  3000,  4500,  6500, 10000, 15000, 24000, 40000, 70000,        // 11..20
] as const;

// Table 3B: shields, perception items, skill items.
const REFINEMENT_COST_SHIELD_PERC_SKILL = [
  null,    10,    20,    35,    60,   100,   160,   240,   340,   470,   670, // 0..10
   950,  1350,  2000,  3000,  4300,  6500, 10000, 16000, 25000, 45000,        // 11..20
] as const;

// Table 5A and 5B mirror the refinement-cost tables for imbuing — same
// totals at each item level. Re-exported under the imbuing names so call
// sites read clearly.
export const IMBUING_COST_WEAPON_ARMOR = REFINEMENT_COST_WEAPON_ARMOR;
export const IMBUING_COST_SHIELD_PERC_SKILL = REFINEMENT_COST_SHIELD_PERC_SKILL;

// Magic Item DCs by item level — used to display imbued-property DCs
// (per the rule: "The item's DC for any effects is based on its item
// level"). Identical table to the GameMastery Guide entry.
export const MAGIC_ITEM_DCS: Record<number, number> = {
  1: 15, 2: 16, 3: 18, 4: 19, 5: 20, 6: 22, 7: 23, 8: 24, 9: 26, 10: 27,
  11: 28, 12: 30, 13: 31, 14: 32, 15: 34, 16: 35, 17: 36, 18: 38, 19: 39, 20: 40,
};

// Categories influence which refinement / imbuing cost table applies.
export type MonsterPartsCategory = 'weapon' | 'armor' | 'shield' | 'perception' | 'skill';

// Map an item's category for refinement / imbuing purposes. Prefers an
// explicit override on `meta_data.battlezoo.category` (set by the player
// in the UI), then falls back to inferring from `item.group`. Perception
// and skill items have group=GENERAL in PF2e, so without an explicit
// override the player must choose in the panel.
export function monsterPartsCategoryFor(item: Pick<Item, 'group' | 'traits' | 'meta_data'>): MonsterPartsCategory {
  const override = item.meta_data?.battlezoo?.category;
  if (override) return override;
  const g = item.group;
  if (g === 'WEAPON') return 'weapon';
  if (g === 'ARMOR') return 'armor';
  if (g === 'SHIELD') return 'shield';
  // Default for GENERAL / other groups; the panel asks the user to
  // pick 'perception' or 'skill' explicitly when applicable.
  return 'weapon';
}

function tableFor(category: MonsterPartsCategory) {
  if (category === 'shield' || category === 'perception' || category === 'skill') {
    return REFINEMENT_COST_SHIELD_PERC_SKILL;
  }
  return REFINEMENT_COST_WEAPON_ARMOR;
}

// Given a gp value spent on refinement / imbuing, return the level the
// item / property has reached. The rules cap level at character level,
// but that's the caller's job — this function only looks at the table.
export function levelFromValue(value: number, category: MonsterPartsCategory): number {
  const table = tableFor(category);
  let level = 0;
  for (let i = 1; i < table.length; i++) {
    const threshold = table[i];
    if (threshold == null) continue;
    if (value >= threshold) level = i;
    else break;
  }
  return level;
}

// Inverse: the cumulative cost in gp of monster parts needed to reach
// `level` for the given category. Useful for "how much more do I need?"
// displays.
export function valueForLevel(level: number, category: MonsterPartsCategory): number {
  const table = tableFor(category);
  if (level < 1) return 0;
  if (level >= table.length) return table[table.length - 1]!;
  return table[level]!;
}

// ─── Refinement bonuses by item level (Tables 4A / 4B / 4C / 4D / 4E) ────────

export interface RefinementBonuses {
  // Weapon: maps onto runes.potency, runes.striking
  weaponItemBonus: 0 | 1 | 2 | 3;       // Table 4A
  weaponDamageDice: 1 | 2 | 3 | 4;      // 1 = no striking, 2 = striking, 3 = greater, 4 = major
  weaponImbuing: 0 | 1 | 2 | 3;          // Table 4A: 1@2, 2@10, 3@16
  // Armor: maps onto AC bonus + resilient
  armorItemBonus: 0 | 1 | 2 | 3;        // Table 4B (AC)
  armorSaveBonus: 0 | 1 | 2 | 3;        // resilient
  armorImbuing: 0 | 1 | 2 | 3;           // Table 4B: 1@5, 2@11, 3@18
  // Shield (Table 4C): Hardness / HP / BT
  shieldHardness: number;
  shieldHP: number;
  shieldBT: number;
  shieldImbuing: 0 | 1;                 // 1 slot from level 4 onward
  // Perception / Skill items (Tables 4D / 4E): scalar bonus
  perceptionBonus: 0 | 1 | 2 | 3;       // Table 4D
  skillBonus: 0 | 1 | 2 | 3;            // Table 4E
  // Both 4D and 4E unlock 1 imbuing slot at level 3.
  percSkillImbuing: 0 | 1;
  // Helper that returns the right imbuing slot count for a given
  // category — callers pick this instead of guessing from the fields
  // above. Used by the UI panel to label "N / M imbuing slots".
  imbuingSlotsFor: (category: MonsterPartsCategory) => number;
}

// Pure look-up. Pass the refined item level; pick the field that
// matches your item's category.
export function refinementBonuses(level: number): RefinementBonuses {
  // Weapon (Table 4A): attack +1 at 2 / +2 at 10 / +3 at 16; dice 1
  // base, 2 (striking) at 4, 3 (greater striking) at 12, 4 (major
  // striking) at 19. Imbuing slots 1@2, 2@10, 3@16.
  const wItem = level >= 16 ? 3 : level >= 10 ? 2 : level >= 2 ? 1 : 0;
  const wDice = level >= 19 ? 4 : level >= 12 ? 3 : level >= 4 ? 2 : 1;
  const wImb  = level >= 16 ? 3 : level >= 10 ? 2 : level >= 2 ? 1 : 0;

  // Armor (Table 4B): AC +1@5, +2@11, +3@18; save +1@8, +2@14, +3@20.
  // Imbuing 1@5, 2@11, 3@18.
  const aItem = level >= 18 ? 3 : level >= 11 ? 2 : level >= 5 ? 1 : 0;
  const aSave = level >= 20 ? 3 : level >= 14 ? 2 : level >= 8 ? 1 : 0;
  const aImb  = level >= 18 ? 3 : level >= 11 ? 2 : level >= 5 ? 1 : 0;

  // Shield (Table 4C): Hardness isn't a clean linear function of
  // item level — the table has flat steps at multiple points (e.g.
  // 5→5, 6→6, 10→10, 12→12). Look up directly from the table values
  // listed in the source book. HP = 6 × Hardness, BT = 3 × Hardness.
  // Imbuing unlocks 1 slot at level 4.
  const SHIELD_HARDNESS_BY_LEVEL = [
    0, 0, 0, 5, 5, 6, 6, 7, 8, 9, 10,
   //0  1  2  3  4  5  6  7  8  9  10
    10, 11, 12, 12, 13, 14, 15, 16, 17, 18,
   //11  12  13  14  15  16  17  18  19  20
  ];
  const shHard = SHIELD_HARDNESS_BY_LEVEL[Math.max(0, Math.min(level, 20))] ?? 0;
  const shHP   = shHard * 6;
  const shBT   = shHard * 3;
  const shImb  = (level >= 4 ? 1 : 0) as 0 | 1;

  // Perception (Table 4D): +1@3, +2@9, +3@17. Imbuing 1@3+.
  const percItem = level >= 17 ? 3 : level >= 9 ? 2 : level >= 3 ? 1 : 0;
  const percImb  = (level >= 3 ? 1 : 0) as 0 | 1;

  // Skill (Table 4E): identical to Perception.
  const skItem = percItem;
  // Choose the imbuing slot count once — Perception and Skill share the
  // same single-slot unlock at level 3.
  const psImb = percImb;

  return {
    weaponItemBonus: wItem as 0 | 1 | 2 | 3,
    weaponDamageDice: wDice as 1 | 2 | 3 | 4,
    weaponImbuing: wImb as 0 | 1 | 2 | 3,
    armorItemBonus: aItem as 0 | 1 | 2 | 3,
    armorSaveBonus: aSave as 0 | 1 | 2 | 3,
    armorImbuing: aImb as 0 | 1 | 2 | 3,
    shieldHardness: shHard,
    shieldHP: shHP,
    shieldBT: shBT,
    shieldImbuing: shImb,
    perceptionBonus: percItem as 0 | 1 | 2 | 3,
    skillBonus: skItem as 0 | 1 | 2 | 3,
    percSkillImbuing: psImb,
    imbuingSlotsFor: (category) => {
      switch (category) {
        case 'weapon': return wImb;
        case 'armor': return aImb;
        case 'shield': return shImb;
        case 'perception':
        case 'skill': return psImb;
        default: return 0;
      }
    },
  };
}

// Compute the effective refined item level — capped by both the value
// invested (Tables 3A/3B) AND the character's level (per the rule
// "You can't refine an item to a level above your character's level").
// Pass `null` for storeId to skip the character-level cap (useful in
// preview / UI contexts where the cap is enforced separately).
export function effectiveRefinedLevel(
  refinementValue: number,
  category: MonsterPartsCategory,
  storeId: StoreID | null = 'CHARACTER',
): number {
  const tableLevel = levelFromValue(refinementValue, category);
  if (storeId === null) return tableLevel;
  const lvlVar = getVariable<VariableNum>(storeId, 'LEVEL');
  const charLevel = lvlVar?.value ?? 20;
  return Math.min(tableLevel, charLevel);
}

// Stamp the derived rune fields onto an item's meta_data when it's in
// monster-parts mode. Mutates a shallow clone of meta_data and returns
// the patched item; the caller decides whether to commit it back. This
// is the single hook that translates Battlezoo state into the existing
// fundamental-rune compute pipeline — once the fields here are set, the
// weapon attack / AC / save handlers all read them like normal runes.
//
// For shields, the refinement bonuses come from a different field
// (meta_data.hardness / hp_max / broken_threshold) since shields don't
// use potency runes. For perception / skill items, the refinement is
// projected as additional operations returned by `monsterPartsExtraOps`
// — those operations get appended to the item's compute-time op list
// by getItemOperations.
export function applyMonsterPartsToItem<T extends Item>(item: T, storeId: StoreID | null = 'CHARACTER'): T {
  const bz = item.meta_data?.battlezoo;
  if (!bz || !bz.enabled) return item;

  const category = monsterPartsCategoryFor(item);
  const level = effectiveRefinedLevel(bz.refinement_value ?? 0, category, storeId);
  const b = refinementBonuses(level);

  // Decide what runes / metadata to project based on category.
  let potency = 0;
  let striking = 0;
  let resilient = 0;
  if (category === 'weapon') {
    potency = b.weaponItemBonus;
    striking = Math.max(0, b.weaponDamageDice - 1); // 1 die = no striking, 2 dice = striking (1), etc.
  } else if (category === 'armor') {
    potency = b.armorItemBonus;
    resilient = b.armorSaveBonus;
  }

  const md = { ...(item.meta_data ?? {}) };
  md.runes = {
    ...(md.runes ?? {}),
    potency,
    striking: striking || undefined,
    resilient: resilient || undefined,
    // Property runes are preserved as-is: imbued-property items get
    // applied through the same mechanism as normal property runes.
    property: md.runes?.property ?? [],
  };

  // Shield refinement: write Hardness / HP / BT directly onto the
  // item's meta_data so the Shield Block / shield-display logic picks
  // them up from the existing fields.
  if (category === 'shield' && b.shieldHardness > 0) {
    md.hardness = b.shieldHardness;
    md.hp = b.shieldHP;
    md.hp_max = b.shieldHP;
    md.broken_threshold = b.shieldBT;
  }

  return { ...item, meta_data: md as T['meta_data'] };
}

// Additional compute-time operations from refining a perception or
// skill item — return an `addBonusToValue` operation against the
// appropriate variable (PERCEPTION or SKILL_X). Weapons / armor get
// their bonuses through the rune projection above; this covers the
// other two refinement categories that don't have a rune-equivalent.
export function monsterPartsExtraOps(
  item: Pick<Item, 'meta_data' | 'group' | 'traits' | 'id' | 'name'>,
  storeId: StoreID | null = 'CHARACTER',
): Operation[] {
  const bz = item.meta_data?.battlezoo;
  if (!bz || !bz.enabled) return [];

  const category = monsterPartsCategoryFor(item);
  const level = effectiveRefinedLevel(bz.refinement_value ?? 0, category, storeId);
  const b = refinementBonuses(level);

  const ops: Operation[] = [];

  if (category === 'perception' && b.perceptionBonus > 0) {
    ops.push({
      id: `bz-refine-perc-${item.id}`,
      type: 'addBonusToValue',
      data: {
        variable: 'PERCEPTION',
        value: b.perceptionBonus,
        type: 'item',
        text: `Battlezoo refinement (Lvl ${level})`,
      },
    });
  }

  if (category === 'skill' && b.skillBonus > 0) {
    const skillVar = bz.skill_variable;
    if (skillVar && skillVar.startsWith('SKILL_')) {
      ops.push({
        id: `bz-refine-skill-${item.id}`,
        type: 'addBonusToValue',
        data: {
          variable: skillVar,
          value: b.skillBonus,
          type: 'item',
          text: `Battlezoo refinement (Lvl ${level})`,
        },
      });
    }
  }

  return ops;
}

// Helper for the UI: format a refined item level summary like
// "Refined to lvl 6 — +1 attack, 2 dice (striking), 1 imbuing slot".
export function summariseRefinement(item: Pick<Item, 'group' | 'meta_data' | 'traits'>): string | null {
  const bz = item.meta_data?.battlezoo;
  if (!bz || !bz.enabled) return null;
  const category = monsterPartsCategoryFor(item);
  const level = levelFromValue(bz.refinement_value ?? 0, category);
  if (level < 1) return `Refined: 0 gp invested (no bonuses yet)`;
  const b = refinementBonuses(level);
  const parts: string[] = [`Refined to lvl ${level}`];
  if (category === 'weapon') {
    if (b.weaponItemBonus) parts.push(`+${b.weaponItemBonus} attack`);
    if (b.weaponDamageDice > 1) parts.push(`${b.weaponDamageDice} dice`);
    if (b.weaponImbuing) parts.push(`${b.weaponImbuing} imbuing slot${b.weaponImbuing === 1 ? '' : 's'}`);
  } else if (category === 'armor') {
    if (b.armorItemBonus) parts.push(`+${b.armorItemBonus} AC`);
    if (b.armorSaveBonus) parts.push(`+${b.armorSaveBonus} saves`);
    if (b.armorImbuing) parts.push(`${b.armorImbuing} imbuing slot${b.armorImbuing === 1 ? '' : 's'}`);
  } else if (category === 'shield') {
    if (b.shieldHardness) parts.push(`Hardness ${b.shieldHardness} / ${b.shieldHP} HP / BT ${b.shieldBT}`);
    if (b.shieldImbuing) parts.push(`1 imbuing slot`);
  } else if (category === 'perception') {
    if (b.perceptionBonus) parts.push(`+${b.perceptionBonus} Perception`);
    if (b.percSkillImbuing) parts.push(`1 imbuing slot`);
  } else if (category === 'skill') {
    if (b.skillBonus) parts.push(`+${b.skillBonus} skill`);
    if (b.percSkillImbuing) parts.push(`1 imbuing slot`);
  }
  return parts.join(' · ');
}
