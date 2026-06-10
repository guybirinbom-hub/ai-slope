import { fetchContentAll, getContentFast, getDefaultSources } from '@content/content-store';
import { isPlayingStarfinder } from '@content/system-handler';
import { ContentPackage, ContentSource, Inventory, InventoryItem, Item, LivingEntity } from '@schemas/content';
import { Operation } from '@schemas/operations';
import { StoreID } from '@schemas/variables';
import { getTraitIdByType, hasTraitType, TraitType } from '@utils/traits';
import { getFinalAcValue, getFinalVariableValue } from '@variables/variable-helpers';
import { addVariableBonus, getAllSkillVariables, getAllSpeedVariables } from '@variables/variable-manager';
import { cloneDeep, uniq } from 'lodash-es';
import { applyMonsterPartsToItem, monsterPartsExtraOps } from './monster-parts';

/**
 * Get all items in the inventory, including items in containers, as a single array
 * @param inv - Inventory
 * @returns - Flat array of items
 */
export function getFlatInvItems(inv: Inventory) {
  const flatItems = inv.items.reduce((acc, invItem) => {
    if (isItemContainer(invItem.item)) {
      const items = acc.concat(invItem.container_contents);
      items.push({
        ...invItem,
        container_contents: [],
      });
      return items;
    }
    return acc.concat(invItem);
  }, [] as InventoryItem[]);

  return flatItems;
}

/**
 * Get the total bulk of the inventory
 * @param inv - Inventory
 * @returns - Total bulk as a number
 */
export function getInvBulk(inv: Inventory | undefined) {
  // Recursive walk. Each item contributes its own bulk; each
  // container additionally contributes (contents_total − ignored),
  // clamped to ≥0. `contents_total` is itself a recursive walk so
  // items nested 2+ containers deep are counted (the previous
  // single-level loop silently dropped them, which under-counted
  // bulk and the Encumbered check fired late or not at all).
  //
  // Spacious pouches / Bags of Holding work for free under this
  // model: their `ignored` matches their PF2e "capacity" (e.g. 4
  // bulk for Spacious Pouch Lesser, 25 for Bag of Holding I), so
  // their contents contribute zero to character bulk as long as
  // the player stays under the cap. If they overfill, the excess
  // does count toward character bulk, which matches the rule that
  // an over-stuffed spacious pouch is no longer balanced inside
  // its extra-dimensional space.
  const sumBulk = (items: InventoryItem[]): number => {
    let sum = 0;
    for (const invItem of items) {
      sum += getItemBulk(invItem);
      if (isItemContainer(invItem.item)) {
        const ignored = Number(invItem.item.meta_data?.bulk?.ignored ?? 0);
        const inside = sumBulk(invItem.container_contents);
        sum += Math.max(inside - ignored, 0);
      }
    }
    return sum;
  };
  const itemBulk = sumBulk(inv?.items ?? []);
  // Coins: 1,000 coins of any combination of denominations = 1 Bulk (PF2e).
  // Amounts below the next full thousand are negligible, so we floor.
  const c = inv?.coins;
  const coinCount = (c?.cp ?? 0) + (c?.sp ?? 0) + (c?.gp ?? 0) + (c?.pp ?? 0);
  return itemBulk + Math.floor(coinCount / 1000);
}

/**
 * Sum the bulk of every item inside a container (recursively),
 * BEFORE the container's own `ignored` reduction is applied. Used
 * by the UI to display "X / Y bulk used" on container rows so the
 * player can see how much room a spacious pouch / bag of holding
 * has left. Does NOT add the container's own bulk.
 *
 * @param container - InventoryItem that must be a container
 * @returns total bulk of contents (recursive), or 0 if not a container
 */
export function getContainerContentsBulk(container: InventoryItem): number {
  if (!isItemContainer(container.item)) return 0;
  const sumBulk = (items: InventoryItem[]): number => {
    let sum = 0;
    for (const invItem of items) {
      sum += getItemBulk(invItem);
      if (isItemContainer(invItem.item)) {
        // Inside a nested container, the inner container's own
        // ignored DOES reduce what bubbles up to its parent
        // container's display. This matches getInvBulk's recursion.
        const ignored = Number(invItem.item.meta_data?.bulk?.ignored ?? 0);
        const inside = sumBulk(invItem.container_contents);
        sum += Math.max(inside - ignored, 0);
      }
    }
    return sum;
  };
  return sumBulk(container.container_contents);
}

/**
 * Get the total bulk of an item with quantity
 * @param invItem - InventoryItem
 * @returns - Item bulk as a number
 */
export function getItemBulk(invItem: InventoryItem) {
  if (isItemFormula(invItem)) return 0;

  if (!invItem.item.bulk) return 0;

  let totalBulk = 0;

  if (invItem.item.bulk === 'L') {
    totalBulk = 0.1 * getItemQuantity(invItem.item);
  }

  // If the armor isn't being worn it counts as 1 bulk more
  const armorWornModifier = isItemArmor(invItem.item) && !invItem.is_equipped ? 1 : 0;

  const baseItemBulk = invItem.is_equipped
    ? Number(invItem.item.meta_data?.bulk?.held_or_stowed ?? (parseFloat(invItem.item.bulk ?? '0') || 0))
    : parseFloat(invItem.item.bulk ?? '0') || 0;

  totalBulk = (baseItemBulk + armorWornModifier) * getItemQuantity(invItem.item);

  // If the total bulk is less than 1 bulk, it counts as light bulk
  return totalBulk >= 0.1 && totalBulk < 1 ? 0.1 : Math.floor(totalBulk);
}

export async function getDefaultContainerContents(item: Item, allItems?: Item[], count = 1): Promise<InventoryItem[]> {
  if (count > 10) return [];
  if ((item.meta_data?.container_default_items ?? []).length === 0) return [];
  const items = allItems ? allItems : await fetchContentAll<Item>('item', getDefaultSources('PAGE'));

  const invItems: InventoryItem[] = [];
  for (const record of item.meta_data?.container_default_items ?? []) {
    const containerItem = cloneDeep(items.find((i) => i.id === record.id));
    if (!containerItem) continue;
    if (containerItem.meta_data) {
      containerItem.meta_data.quantity = record.quantity;
    }
    invItems.push({
      id: crypto.randomUUID(),
      item: containerItem,
      is_formula: false,
      is_equipped: false,
      is_invested: false,
      is_implanted: false,
      container_contents: await getDefaultContainerContents(containerItem, items, count++),
    });
  }

  return invItems;
}

export function applyEquipmentPenalties(storeId: StoreID, entity: LivingEntity) {
  const STORE_ID = storeId;

  if (!entity.inventory) return;

  const applyPenalties = (item: InventoryItem) => {
    if (item.item.meta_data) {
      const strMod = getFinalVariableValue(STORE_ID, 'ATTRIBUTE_STR').total;
      // If strength requirement exists and the character's str mod is >= to it, reduce/not include it
      if (
        item.item.meta_data.strength !== null &&
        item.item.meta_data.strength !== undefined &&
        strMod >= item.item.meta_data.strength
      ) {
        // Take speed penalty, reduced by 5, to all Speeds
        const speedPenalty = Math.abs(Number(item.item.meta_data.speed_penalty ?? 0)) - 5;
        if (speedPenalty > 0) {
          for (const speed of getAllSpeedVariables(STORE_ID)) {
            addVariableBonus(STORE_ID, speed.name, -1 * speedPenalty, undefined, '', `${item.item.name}`);
          }
        }

        // If armor is noisy, apply to Stealth checks even if you meet the required Strength score
        const isNoisy = hasTraitType('NOISY', item.item.traits ?? undefined);
        if (isNoisy) {
          const checkPenalty = Math.abs(Number(item.item.meta_data.check_penalty ?? 0));
          if (checkPenalty > 0) {
            const stealthSkill = getAllSkillVariables(STORE_ID).find((skill) => skill.name === 'SKILL_STEALTH');
            if (stealthSkill) {
              addVariableBonus(
                STORE_ID,
                stealthSkill.name,
                -1 * checkPenalty,
                undefined,
                '', // Could include: (unless it has the attack trait)
                `${item.item.name}`
              );
            }
          }
        }
      } else {
        // If the strength requirement doesn't exist, always include penalty.
        //
        // Take check penalty to Strength- and Dexterity-based skill checks (except for those that have the attack trait)
        const checkPenalty = Math.abs(Number(item.item.meta_data.check_penalty ?? 0));
        if (checkPenalty > 0) {
          const attrs = ['ATTRIBUTE_STR', 'ATTRIBUTE_DEX'];
          let skills = getAllSkillVariables(STORE_ID).filter((skill) => attrs.includes(skill.value.attribute ?? ''));

          // If armor is flexible, don't apply to Acrobatics or Athletics
          const isFlexible = hasTraitType('FLEXIBLE', item.item.traits ?? undefined);
          if (isFlexible) {
            skills = skills.filter((skill) => skill.name !== 'SKILL_ACROBATICS' && skill.name !== 'SKILL_ATHLETICS');
          }

          for (const skill of skills) {
            addVariableBonus(
              STORE_ID,
              skill.name,
              -1 * checkPenalty,
              undefined,
              '', // Could include: (unless it has the attack trait)
              `${item.item.name}`
            );
          }
        }

        // Take full speed penalty to all Speeds
        const speedPenalty = Math.abs(Number(item.item.meta_data.speed_penalty ?? 0));
        if (speedPenalty > 0) {
          for (const speed of getAllSpeedVariables(STORE_ID)) {
            addVariableBonus(STORE_ID, speed.name, -1 * speedPenalty, undefined, '', `${item.item.name}`);
          }
        }
      }
    }
  };

  // Use the "best" armor/shield because that's the one we're assumed to be wearing
  const bestArmor = getBestArmor(STORE_ID, entity.inventory);
  const bestShield = getBestShield(STORE_ID, entity.inventory);
  if (bestArmor) applyPenalties(bestArmor);
  if (bestShield) applyPenalties(bestShield);
}

/**
 * Determines the "best" equipped armor in an inventory, based on total resulting AC
 * @param id - Variable Store ID
 * @param inv - Inventory
 * @returns - The best armor inventory item
 */
export function getBestArmor(id: StoreID, inv?: Inventory | null) {
  if (!inv) {
    return null;
  }
  let bestAc = 0;
  let bestArmor: InventoryItem | null = null;
  for (const invItem of inv.items) {
    if (invItem.is_equipped && isItemArmor(invItem.item)) {
      const acValue = getFinalAcValue(id, invItem.item);
      if (acValue > bestAc) {
        bestAc = acValue;
        bestArmor = invItem;
      }
    }
  }
  return bestArmor;
}

/**
 * Determines the "best" equipped shield in an inventory, based on AC bonus
 * @param id - Variable Store ID
 * @param inv - Inventory
 * @returns - The best shield inventory item
 */
export function getBestShield(id: StoreID, inv?: Inventory) {
  if (!inv) {
    return null;
  }
  let bestBonus = 0;
  let bestShield: InventoryItem | null = null;
  for (const invItem of inv.items) {
    if (invItem.is_equipped && isItemShield(invItem.item)) {
      const shieldBonus = invItem.item.meta_data?.ac_bonus ?? 0;
      if (shieldBonus > bestBonus) {
        bestBonus = shieldBonus;
        bestShield = invItem;
      }
    }
  }
  return bestShield;
}

export function getItemOperations(item: Item, content: ContentPackage) {
  // Battlezoo Monster Parts: when an item is flipped into monster-parts
  // mode (meta_data.battlezoo.enabled === true), the fundamental-rune
  // fields are auto-derived from `refinement_value`. Run that
  // translation first so the rune-handling branches below pick up the
  // derived potency/striking/resilient as if they were normal runes.
  // For perception / skill items (which don't use runes) the bonus is
  // emitted as an explicit addBonusToValue operation via
  // monsterPartsExtraOps.
  // See process/items/monster-parts.ts for the lookup tables.
  let mpExtraOps: Operation[] = [];
  if (item.meta_data?.battlezoo?.enabled) {
    item = applyMonsterPartsToItem(item);
    mpExtraOps = monsterPartsExtraOps(item);
  }

  const baseOps = cloneDeep(item.operations) ?? [];
  baseOps.push(...mpExtraOps);

  if (isItemWithRunes(item)) {
    if (isItemArmor(item)) {
      // Armor potency
      const potency = Math.min(item.meta_data?.runes?.potency ?? 0, 4);
      if (potency > 0) {
        const ops: Operation[] = [
          {
            id: 'a914f920-3bb4-49f0-aae7-92f423a7f4a4',
            type: 'addBonusToValue',
            data: {
              variable: 'AC_BONUS',
              value: potency,
              type: 'item',
              text: '',
            },
          },
        ];
        baseOps.push(...ops);
      }

      // Armor resilient
      const resilient = Math.min(item.meta_data?.runes?.resilient ?? 0, 4);
      if (resilient > 0) {
        const ops: Operation[] = [
          {
            id: '4819a316-736a-4c7f-937a-6710003b431a',
            type: 'addBonusToValue',
            data: {
              variable: 'SAVE_FORT',
              value: resilient,
              type: 'item',
              text: '',
            },
          },
          {
            id: '3f008891-b39f-440b-92ff-722d5cbe3ac7',
            type: 'addBonusToValue',
            data: {
              variable: 'SAVE_REFLEX',
              value: resilient,
              type: 'item',
              text: '',
            },
          },
          {
            id: '52kbafaa-e7db-4fa0-a845-1b727b123f8e',
            type: 'addBonusToValue',
            data: {
              variable: 'SAVE_WILL',
              value: resilient,
              type: 'item',
              text: '',
            },
          },
        ];
        baseOps.push(...ops);
      }
    }

    if (item.meta_data?.runes?.property) {
      for (const property of item.meta_data.runes.property) {
        const propertyRune = content.items.find((i) => i.id === property.id);
        if (propertyRune) {
          baseOps.push(...getItemOperations(propertyRune, content));
        }
      }
    }
  }

  if (isItemWithGradeImprovement(item)) {
    if (isItemArmor(item)) {
      const improvements = getGradeImprovements(item);
      if (improvements.ac_bonus > 0) {
        const ops: Operation[] = [
          {
            id: 'a914f220-3bb4-49f0-aae7-92f423a7f4a4',
            type: 'addBonusToValue',
            data: {
              variable: 'AC_BONUS',
              value: improvements.ac_bonus,
              type: 'item',
              text: '',
            },
          },
        ];
        baseOps.push(...ops);
      }
    }

    if (isItemWithUpgrades(item)) {
      for (const slot of item.meta_data?.starfinder?.slots ?? []) {
        const upgrade = content.items.find((i) => i.id === slot.id);
        if (upgrade) {
          baseOps.push(...getItemOperations(upgrade, content));
        }
      }
    }
  }

  if (isItemArmor(item)) {
    let value = 0;
    if (hasTraitType('RESILIENT-4', compileTraits(item))) {
      value = 4;
    } else if (hasTraitType('RESILIENT-3', compileTraits(item))) {
      value = 3;
    } else if (hasTraitType('RESILIENT-2', compileTraits(item))) {
      value = 2;
    } else if (hasTraitType('RESILIENT-1', compileTraits(item))) {
      value = 1;
    }

    if (value > 0) {
      const ops: Operation[] = [
        {
          id: '4829a316-736a-4c7f-937a-6710003b431a',
          type: 'addBonusToValue',
          data: {
            variable: 'SAVE_FORT',
            value: value,
            type: 'item',
            text: '',
          },
        },
        {
          id: '3f708891-b39f-440b-92ff-722d5cbe3ac7',
          type: 'addBonusToValue',
          data: {
            variable: 'SAVE_REFLEX',
            value: value,
            type: 'item',
            text: '',
          },
        },
        {
          id: '522bafaa-e7db-4fa0-a845-1b727b123f8e',
          type: 'addBonusToValue',
          data: {
            variable: 'SAVE_WILL',
            value: value,
            type: 'item',
            text: '',
          },
        },
      ];
      baseOps.push(...ops);
    }
  }

  return baseOps;
}

/**
 * Utility function to get the quantity of an item
 * @param item - Item
 * @returns - Quantity as a number
 */
export function getItemQuantity(item: Item) {
  return item.meta_data?.quantity ?? 1;
}

/**
 * Infer how many uses / charges this item supports per refill.
 *
 * Three-tier inference, in priority order:
 *
 *   1. `meta_data.charges.max` — explicit charge count baked into
 *      the item template (multi-charge wands, staves, etc.).
 *   2. A "Frequency once/twice/N times per day" phrase parsed out
 *      of the description (most daily-use magic items spell their
 *      cap in prose rather than in a structured field).
 *   3. CONSUMABLE trait — one-shot (still refillable in the UI in
 *      case the player tapped one by mistake).
 *
 * Returns 0 when none apply, which the drawer treats as "hide the
 * charges UI for this item entirely".
 */
export function getMaxUses(item: Item): number {
  if (!item) return 0;

  // (1) Explicit charge count baked into the item.
  const baked = item.meta_data?.charges?.max;
  if (typeof baked === 'number' && baked > 0) return baked;

  // (2) Frequency-text parse. The dataset is fairly consistent:
  //     "Frequency once per day" / "Frequency** twice per day" /
  //     "Frequency: 3 times per day". 0-4 trailing asterisks, optional
  //     colon, word-form (once / twice / three / … / ten) or numeric.
  //     Required "per <unit>" suffix disambiguates from other prose
  //     that happens to start with "Frequency".
  const desc = item.description ?? '';
  const wordMap: Record<string, number> = {
    once: 1,
    twice: 2,
    three: 3,
    four: 4,
    five: 5,
    six: 6,
    seven: 7,
    eight: 8,
    nine: 9,
    ten: 10,
  };
  const re =
    /Frequency\*{0,4}[: ]+(once|twice|three|four|five|six|seven|eight|nine|ten|\d+)\s+(?:times\s+)?per\s+(?:day|hour|minute|round|encounter|\d+\s*minutes?)/i;
  const m = desc.match(re);
  if (m) {
    const phrase = m[1].toLowerCase();
    if (phrase in wordMap) return wordMap[phrase];
    const n = parseInt(phrase, 10);
    if (!isNaN(n) && n > 0) return n;
  }

  // (3) Consumable trait → single use.
  if (hasTraitType('CONSUMABLE', item.traits ?? undefined)) return 1;

  return 0;
}

/**
 * Wands and staves store `meta_data.charges.current` as casts SPENT
 * (0 = full, max = empty) because their casting / overcharge logic
 * (WandSpellsList / StaffSpellsList) counts `current` UP as you cast.
 * EVERY other use-tracked item stores it as uses REMAINING (max = full,
 * 0 = empty). This helper flags the spent-convention items so the
 * generic use UI can normalise both into a single "remaining" meaning.
 */
export function usesSpentChargeConvention(item: Item): boolean {
  if (!item) return false;
  return hasTraitType('WAND', item.traits ?? undefined) || hasTraitType('STAFF', item.traits ?? undefined);
}

/**
 * Current uses REMAINING on an item instance (max = full, 0 = empty),
 * normalised across BOTH charge conventions so every generic caller
 * (the drawer's use tracker, the exhausted-dimming) sees one consistent
 * meaning: a full item reads `max`, an empty one reads `0`. Defaults to
 * the max when no `current` has been persisted, so a freshly-picked-up
 * consumable starts "full" instead of looking already-spent.
 */
export function getCurrentUses(item: Item): number {
  if (!item) return 0;
  const max = getMaxUses(item);
  if (max <= 0) return 0;
  const cur = item.meta_data?.charges?.current;
  if (typeof cur !== 'number') return max; // unset = full
  // Wands/staves persist SPENT; flip to remaining so callers can treat
  // every item the same way (full = max, empty = 0).
  return usesSpentChargeConvention(item) ? Math.max(0, max - cur) : cur;
}

/**
 * True when the item has a use cap AND is fully spent (0 remaining).
 * Used to dim the drawer title + inventory row so the player can
 * see "out of uses" at a glance.
 */
export function isItemExhausted(item: Item): boolean {
  const max = getMaxUses(item);
  if (max <= 0) return false;
  return getCurrentUses(item) <= 0;
}

/**
 * Utility function to determine if an item is broken
 * @param item - Item
 * @returns - Whether the item is broken
 */
export function isItemBroken(item: Item) {
  const bt = Number(item.meta_data?.broken_threshold ?? 0);
  const hp = item.meta_data?.hp;

  if (hp === undefined || hp === null) return false;
  if (bt > 0 && Number(hp) <= bt) {
    return true;
  }
  return false;
}

/**
 * Utility function to determine if an item is a container
 * @param item - Item
 * @returns - Whether the item is a container
 */
export function isItemContainer(item: Item) {
  return item.meta_data?.bulk?.capacity !== undefined;
}

/**
 * Utility function to determine if an inventory item is a formula
 * @param item - Inventory item
 * @returns - Whether the item is a formula
 */
export function isItemFormula(invItem: InventoryItem) {
  return invItem.is_formula;
}

/**
 * Utility function to determine if an item is investable
 * @param item - Item
 * @returns - Whether the item is investable
 */
export function isItemInvestable(item: Item) {
  return hasTraitType('INVESTED', item.traits ?? undefined);
}

/**
 * Utility function to determine if an item is implantable
 * @param item - Item
 * @returns - Whether the item is implantable
 */
export function isItemImplantable(item: Item) {
  return hasTraitType('AUGMENTATION', item.traits ?? undefined);
}

/**
 * Utility function to determine if an item is equippable
 * @param item - Item
 * @returns - Whether the item is equippable
 */
export function isItemEquippable(item: Item) {
  return isItemWeapon(item) || isItemArmor(item) || isItemShield(item) || isItemStave(item);
}

/**
 * Utility function to determine if an item has runes
 * @param item - Item
 * @returns - Whether the item has runes
 */
export function isItemWithRunes(item: Item) {
  if (!item.meta_data?.runes) return false;

  return !!(item.meta_data.runes.potency || item.meta_data.runes.striking || item.meta_data.runes.resilient);
}

/**
 * Utility function to determine if an item has property runes
 * @param item - Item
 * @returns - Whether the item has property runes
 */
export function isItemWithPropertyRunes(item: Item) {
  if (!item.meta_data?.runes) return false;

  return (
    item.meta_data.runes.property &&
    item.meta_data.runes.property.length > 0 &&
    item.meta_data.runes.property.every((r) => r.id && r.name)
  );
}

export function isItemWithMaterial(item: Item) {
  if (!item.meta_data?.material) return false;
  return !!(item.meta_data.material.type || item.meta_data.material.grade);
}

// Fundamental Rune IDs Map
export const FUNDAMENTAL_RUNES: Record<string, number> = {
  potency_weapon_1: 7950, // Weapon Potency I
  potency_weapon_2: 7951, // Weapon Potency II
  potency_weapon_3: 7952, // Weapon Potency III
  potency_weapon_4: 19854, // Weapon Potency IV
  potency_weapon_10: 16927, // Weapon Potency (Mythic)
  potency_armor_1: 6719, // Armor Potency I
  potency_armor_2: 6720, // Armor Potency II
  potency_armor_3: 6721, // Armor Potency III
  potency_armor_10: 16924, // Armor Potency (Mythic)
  striking_1: 7862, // Striking
  striking_2: 7860, // Striking (Greater)
  striking_3: 7861, // Striking (Major)
  striking_10: 16926, // Striking (Mythic)
  resilient_1: 7703, // Resilient
  resilient_2: 7701, // Resilient (Greater)
  resilient_3: 7702, // Resilient (Major)
  resilient_10: 16925, // Resilient (Mythic)
} as const;

/**
 * Utility function to detect if an item IS a fundamental rune
 * @param item - Item
 * @returns - Whether the item is a fundamental rune
 */
export function isItemFundamentalRune(item: Item) {
  return Object.values(FUNDAMENTAL_RUNES).includes(item.id);
}

/**
 * Utility function to determine if an item has improved its grade
 * @param item - Item
 * @returns - Whether the item has improved its grade
 */
export function isItemWithGradeImprovement(item: Item) {
  return item.meta_data?.starfinder?.grade && item.meta_data.starfinder.grade !== 'COMMERCIAL';
}

/**
 * Utility function to determine if an item has upgrades
 * @param item - Item
 * @returns - Whether the item has upgrades
 */
export function isItemWithUpgrades(item: Item) {
  if (!isItemWithGradeImprovement(item) || !item.meta_data?.starfinder?.slots) return false;

  return item.meta_data.starfinder.slots.length > 0;
}

/**
 * Utility function to determine if an item should indicate quantity
 * @param item - Item
 * @returns - Whether the item is consumable
 */
export function isItemWithQuantity(item: Item) {
  const nonConsumableItemFns = [isItemWeapon, isItemArmor, isItemShield, isItemContainer, isItemInvestable];
  for (const nonConsumableFn of nonConsumableItemFns) {
    if (nonConsumableFn(item)) {
      return false;
    }
  }
  return (
    hasTraitType('CONSUMABLE', item.traits ?? undefined) || (item.meta_data?.quantity && item.meta_data.quantity > 0)
  );
}

/**
 * Utility function to determine if an item has health to show
 * @param item - Item
 * @returns - Whether the item has health to show
 */
export function isItemWithHealth(item: Item) {
  const health = getItemHealth(item);

  // If item has health and it's not a weapon,
  // or if it is a weapon but also is armor or a shield
  const hasHealth =
    !!health.hp_max && (!isItemWeapon(item) || (isItemWeapon(item) && (isItemArmor(item) || isItemShield(item))));

  return hasHealth;
}

/**
 * Utility function to determine if an item is a weapon
 * @param item - Item
 * @returns - Whether the item is a weapon
 */
export function isItemWeapon(item: Item) {
  return !!item.meta_data?.damage?.damageType && item.group === 'WEAPON';
}

/**
 * Utility function to determine if an item is a ranged weapon
 * @param item - Item
 * @returns - Whether the item is a ranged weapon
 */
export function isItemRangedWeapon(item: Item) {
  return !!item.meta_data?.range;
}

// The runes blob stored on an item. `meta_data` is nullable and
// `runes` is optional, so we strip both layers to get the inner shape
// the helpers below pass around.
type ItemRunes = NonNullable<NonNullable<Item['meta_data']>['runes']>;

/**
 * Handwraps of Mighty Blows — a worn rune-holder whose etched runes
 * (potency / striking / property) apply to ALL of the wearer's unarmed
 * attacks. In PF2e it is NOT itself a Strike. Detected by name: the
 * canonical PF2e item is the only thing called "Handwraps of Mighty
 * Blows", and reskins/legacy copies keep the name, so a name match is
 * both sufficient and robust.
 * @param item - Item
 * @returns - Whether the item is Handwraps of Mighty Blows
 */
export function isHandwrapsOfMightyBlows(item: Item): boolean {
  const name = item.name?.toLowerCase() ?? '';
  return name.includes('handwraps of mighty blows');
}

/**
 * Find the equipped Handwraps of Mighty Blows in an inventory (if any)
 * and return its runes. Returns null when none is worn.
 * @param inv - Inventory
 * @returns - The handwraps' runes, or null
 */
export function getEquippedHandwrapsRunes(inv?: Inventory | null): ItemRunes | null {
  if (!inv) return null;
  const flat = getFlatInvItems(inv);
  const wraps = flat.find((i) => i.is_equipped && isHandwrapsOfMightyBlows(i.item));
  return wraps?.item.meta_data?.runes ?? null;
}

/**
 * Given an unarmed-attack item and a set of handwraps runes, return a
 * shallow clone of the item with the handwraps' fundamental + property
 * runes merged in. The unarmed attack keeps the BETTER of its own vs
 * the handwraps' potency/striking (per PF2e you use the higher), and
 * unions the property runes. Non-unarmed items and null runes are
 * returned untouched (so normal weapons, shields, ranged weapons are
 * never affected).
 * @param item - Item to merge into (only `unarmed_attack` items change)
 * @param wrapsRunes - Runes from the equipped handwraps (or null)
 * @returns - The (possibly) rune-merged item
 */
export function applyHandwrapsToUnarmed(item: Item, wrapsRunes: ItemRunes | null): Item {
  if (!wrapsRunes) return item;
  if (item.meta_data?.category !== 'unarmed_attack') return item;
  const own: ItemRunes = item.meta_data?.runes ?? {};
  return {
    ...item,
    meta_data: {
      ...item.meta_data,
      runes: {
        ...own,
        potency: Math.max(Number(own.potency ?? 0), Number(wrapsRunes.potency ?? 0)) || undefined,
        striking: Math.max(Number(own.striking ?? 0), Number(wrapsRunes.striking ?? 0)) || undefined,
        property: [...(own.property ?? []), ...(wrapsRunes.property ?? [])],
      },
    },
  };
}

/**
 * Utility function to determine if an item is armor
 * @param item - Item
 * @returns - Whether the item is armor
 */
export function isItemArmor(item: Item) {
  return !!(item.meta_data?.dex_cap || item.meta_data?.dex_cap === 0);
}

/**
 * Utility function to determine if an item is a shield
 * @param item - Item
 * @returns - Whether the item is a shield
 */
export function isItemShield(item: Item) {
  return item.meta_data?.ac_bonus !== undefined && !isItemArmor(item);
}

/**
 * Utility function to determine if an item is a stave
 * @param item - Item
 * @returns - Whether the item is a stave
 */
export function isItemStave(item: Item) {
  return hasTraitType('STAFF', item.traits ?? undefined);
}

/**
 * Detect a "fillable" generic scroll or wand — an item whose name
 * encodes the spell rank but not the spell. Pattern:
 *   "Magic Wand (3rd-Rank Spell)"   → { kind: 'wand', maxRank: 3 }
 *   "Magic Scroll (5th-rank Spell)" → { kind: 'scroll', maxRank: 5 }
 * Specific pre-baked items like "Wand of Shardstorm (7th-Rank Spell)"
 * return null — the regex anchors on the literal word "Magic " at
 * the start of the name, which only the generic versions have.
 *
 * The rank cap in the name is the spell rank the holder can cast.
 * Lower-rank spells are valid picks too (PF2e auto-heightens them
 * up to the holder's rank). Cantrips, focus spells, and rituals
 * are never valid — that's enforced separately by the picker's
 * filterFn, not here.
 */
export function getFillableSpellHolder(item: Item): { kind: 'scroll' | 'wand'; maxRank: number } | null {
  if (!item?.name) return null;
  // Case-insensitive on "Rank" — the dataset uses both casings.
  // Optional dash before "rank" handles both "3rd-Rank" and "3rd rank".
  const m = /^Magic\s+(Wand|Scroll)\s*\(\s*(\d+)\s*[a-z]*-?rank\s*spell\s*\)/i.exec(item.name);
  if (!m) return null;
  const kind = m[1].toLowerCase() === 'wand' ? 'wand' : 'scroll';
  const rank = Math.min(10, Math.max(1, parseInt(m[2], 10)));
  return { kind, maxRank: rank };
}

/**
 * True iff the item is a generic fillable scroll/wand (regardless
 * of whether a spell has been picked yet).
 */
export function isFillableScrollOrWand(item: Item): boolean {
  return getFillableSpellHolder(item) !== null;
}

/**
 * Display name for a scroll/wand item, baking the chosen spell into
 * the name. Falls back to the raw item name when the item isn't a
 * fillable scroll/wand OR when no spell has been picked.
 *
 *   "Magic Wand (3rd-Rank Spell)"   + Magic Missile  → "Magic Wand of Magic Missile (3rd-Rank)"
 *   "Magic Scroll (5th-rank Spell)" + Heal           → "Scroll of Heal (5th-Rank)"
 */
export function getScrollWandDisplayName(item: Item): string {
  if (!item) return '';
  const holder = getFillableSpellHolder(item);
  const chosen = item.meta_data?.scroll_wand;
  if (!holder || !chosen?.spell_name) return item.name;
  const rankLabel = `${chosen.spell_rank}${ordinalSuffix(chosen.spell_rank)}-Rank`;
  if (holder.kind === 'scroll') return `Scroll of ${chosen.spell_name} (${rankLabel})`;
  return `Magic Wand of ${chosen.spell_name} (${rankLabel})`;
}

/**
 * Ordinal suffix helper (1→"st", 2→"nd", 3→"rd", 4→"th", 11/12/13→"th").
 * Local to this module — only used to format scroll/wand display names
 * and the upcast arrow in the drawer prelude.
 */
function ordinalSuffix(n: number): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return 'st';
  if (m10 === 2 && m100 !== 12) return 'nd';
  if (m10 === 3 && m100 !== 13) return 'rd';
  return 'th';
}

/**
 * Utility function to determine if an item is an unarmed attack / meta-attack
 * @param item - Item
 * @returns - Whether the item is a meta attack
 */
export function isItemMetaAttack(item: Item) {
  return !!item.meta_data?.unselectable && isItemWeapon(item);
}

/**
 * Utility function to determine if an item is an unarmed defense / meta-defense
 * @param item - Item
 * @returns - Whether the item is a meta defense
 */
export function isItemMetaDefense(item: Item) {
  return !!item.meta_data?.unselectable && (isItemArmor(item) || isItemShield(item));
}

/**
 * Utility function to determine the main label for the item
 * @param item - Item
 * @param includeLevel - Whether to include the item level in the label
 * @returns - Item type label
 */
export function determineItemMetaType(item: Item, includeLevel?: boolean): string {
  let type = `Item ${includeLevel ? item.level : ''}`.trim();
  if (isItemMetaAttack(item)) {
    type = `Attack`;
  } else if (isItemMetaDefense(item)) {
    type = `Defense`;
  }
  return type;
}

/**
 * Utility function to determine if an item is archaic (old weapon from Pathfinder)
 * @param item - Item
 * @returns - Whether the item is archaic
 */
export function isItemArchaic(item: Item) {
  if (hasTraitType('ARCHAIC', item.traits ?? undefined)) {
    return true;
  }
  if (!isPlayingStarfinder()) {
    return false;
  }

  const source = getContentFast<ContentSource>('content-source', [item.content_source_id])[0];
  if (!source) {
    return false;
  }

  return (isItemWeapon(item) || isItemArmor(item)) && (source.group ?? '').startsWith('pathfinder');
}

/**
 * Gets all traits that the item should have from its base item, main traits, runes, etc
 * @param item
 */
export function compileTraits(item: Item) {
  const traits = cloneDeep(item.traits ?? []);
  if (item.meta_data?.base_item_content) {
    traits.push(...(item.meta_data.base_item_content.traits ?? []));
  }

  if (isItemWithRunes(item)) {
    traits.push(getTraitIdByType('MAGICAL'));

    // Add traits from the property runes
    for (const rune of item.meta_data?.runes?.property ?? []) {
      // TODO, Could run compileTraits() on the rune, but that -could- result in endless loops
      traits.push(...(rune.rune?.traits ?? []));
    }
  }

  if (isItemWithGradeImprovement(item)) {
    const improvements = getGradeImprovements(item);
    traits.push(...improvements.trait_ids);

    // Add traits from the upgrades
    for (const slot of item.meta_data?.starfinder?.slots ?? []) {
      // TODO, Could run compileTraits() on the upgrade, but that -could- result in endless loops
      traits.push(...(slot.upgrade?.traits ?? []));
    }
  }

  return uniq(traits);
}

/**
 * Converts a bulk value to a string label
 * @param bulk - Bulk value
 * @param displayZero - Whether to display 0 bulk as 0
 * @returns - Bulk label
 */
export function labelizeBulk(bulk?: number | string, displayZero = false) {
  if (bulk === undefined || bulk === null || bulk === '') {
    if (displayZero) {
      return '0';
    } else {
      return '—';
    }
  }
  bulk = parseFloat(bulk as string);
  if (bulk === 0) {
    if (displayZero) {
      return '0';
    } else {
      return '—';
    }
  }
  if (bulk === 0.1) {
    return 'L';
  }
  const bulkFloat = parseFloat(bulk.toFixed(1));

  const _bulk = Math.floor(bulkFloat);
  const _light = Math.round((bulkFloat - _bulk) * 10);

  if (_light === 0) {
    return `${_bulk}`;
  } else {
    if (_bulk === 0) {
      return `0.${_light}`;
    } else {
      return `${_bulk}.${_light}`;
    }
  }
}

export function getBulkLimit(id: StoreID) {
  const strMod = getFinalVariableValue(id, 'ATTRIBUTE_STR').total;
  const bonus = getFinalVariableValue(id, 'BULK_LIMIT_BONUS').total;
  return 5 + strMod + bonus;
}

export function getBulkLimitImmobile(id: StoreID) {
  return getBulkLimit(id) + 5;
}

export function reachedInvestedLimit(id: StoreID, inv?: Inventory) {
  if (!inv) {
    return false;
  }
  const invItems = getFlatInvItems(inv);
  const investedItems = invItems.filter((item) => item.is_invested);
  return investedItems.length >= getInvestedLimit(id);
}

export function getInvestedLimit(id: StoreID) {
  return 10 + getFinalVariableValue(id, 'INVEST_LIMIT_BONUS').total;
}

export function reachedImplantLimit(id: StoreID, inv?: Inventory) {
  if (!inv) {
    return false;
  }
  const invItems = getFlatInvItems(inv);
  const implantedItems = invItems.filter((item) => item.is_implanted);
  return implantedItems.length >= getImplantLimit(id);
}

export function getImplantLimit(id: StoreID) {
  const conMod = getFinalVariableValue(id, 'ATTRIBUTE_CON').total;
  return 1 + conMod + getFinalVariableValue(id, 'IMPLANT_LIMIT_BONUS').total;
}

/**
 * Utility function to get the health values of an item
 * @param item - Item
 * @returns - Health values
 */
export function getItemHealth(item: Item) {
  const bt = Number(item.meta_data?.broken_threshold ?? 0);
  const hardness = Number(item.meta_data?.hardness ?? 0);
  const hp_max = Number(item.meta_data?.hp_max ?? 0);
  const hp = Number(item.meta_data?.hp ?? 0);

  const improvements = getGradeImprovements(item);

  return {
    hardness: hardness + improvements.hardness_bonus,
    hp_max: hp_max + improvements.hp_bonus,
    bt: bt + improvements.bt_bonus,
    hp_current: hp,
  };
}

export function filterByTraitType(invItems: InventoryItem[], traitType: TraitType) {
  return invItems.filter((invItem) => hasTraitType(traitType, compileTraits(invItem.item)));
}

/**
 * Utility function to get all the Starfinder improvements for based on its grade
 * @param item - Item to get grade improvements for
 * @returns - Grade improvements
 */
export function getGradeImprovements(item: Item) {
  const improvements = {
    grade: 'COMMERCIAL',
    level: 0,
    upgrade_price: 0, // in credits
    total_price: 0, // in credits
    upgrade_slots: 0,
    ac_bonus: 0,
    damage_dice: 1,
    hardness_bonus: 0,
    hp_bonus: 0,
    bt_bonus: 0,
    trait_ids: [] as number[],
  };

  if (!isItemWithGradeImprovement(item)) {
    return improvements;
  }

  improvements.grade = item.meta_data?.starfinder?.grade ?? 'COMMERCIAL';
  if (isItemArmor(item)) {
    if (item.meta_data?.starfinder?.grade === 'TACTICAL') {
      improvements.level = 5;
      improvements.upgrade_price = 1600;
      improvements.total_price = 1600;
      improvements.upgrade_slots = 0;
      improvements.ac_bonus = 1;
      improvements.trait_ids.push(getTraitIdByType('RESILIENT-1'));
    } else if (item.meta_data?.starfinder?.grade === 'ADVANCED') {
      improvements.level = 8;
      improvements.upgrade_price = 3400;
      improvements.total_price = 5000;
      improvements.upgrade_slots = 1;
      improvements.ac_bonus = 1;
      improvements.trait_ids.push(getTraitIdByType('RESILIENT-1'));
    } else if (item.meta_data?.starfinder?.grade === 'SUPERIOR') {
      improvements.level = 11;
      improvements.upgrade_price = 9000;
      improvements.total_price = 14000;
      improvements.upgrade_slots = 1;
      improvements.ac_bonus = 2;
      improvements.trait_ids.push(getTraitIdByType('RESILIENT-2'));
    } else if (item.meta_data?.starfinder?.grade === 'ELITE') {
      improvements.level = 14;
      improvements.upgrade_price = 31000;
      improvements.total_price = 45000;
      improvements.upgrade_slots = 2;
      improvements.ac_bonus = 2;
      improvements.trait_ids.push(getTraitIdByType('RESILIENT-2'));
    } else if (item.meta_data?.starfinder?.grade === 'ULTIMATE') {
      improvements.level = 18;
      improvements.upgrade_price = 195000;
      improvements.total_price = 240000;
      improvements.upgrade_slots = 3;
      improvements.ac_bonus = 3;
      improvements.trait_ids.push(getTraitIdByType('RESILIENT-3'));
    } else if (item.meta_data?.starfinder?.grade === 'PARAGON') {
      improvements.level = 20;
      improvements.upgrade_price = 460000;
      improvements.total_price = 700000;
      improvements.upgrade_slots = 3;
      improvements.ac_bonus = 3;
      improvements.trait_ids.push(getTraitIdByType('RESILIENT-3'));
    }
  } else if (isItemShield(item)) {
    if (item.meta_data?.starfinder?.grade === 'TACTICAL') {
      improvements.level = 5;
      improvements.upgrade_price = 750;
      improvements.total_price = 750;
      improvements.hardness_bonus = 3;
      improvements.hp_bonus = 46;
      improvements.bt_bonus = 23;
    } else if (item.meta_data?.starfinder?.grade === 'ADVANCED') {
      improvements.level = 8;
      improvements.upgrade_price = 2250;
      improvements.total_price = 3000;
      improvements.hardness_bonus = 3;
      improvements.hp_bonus = 56;
      improvements.bt_bonus = 28;
    } else if (item.meta_data?.starfinder?.grade === 'SUPERIOR') {
      improvements.level = 11;
      improvements.upgrade_price = 6000;
      improvements.total_price = 9000;
      improvements.hardness_bonus = 3;
      improvements.hp_bonus = 68;
      improvements.bt_bonus = 34;
    } else if (item.meta_data?.starfinder?.grade === 'ELITE') {
      improvements.level = 14;
      improvements.upgrade_price = 16000;
      improvements.total_price = 25000;
      improvements.hardness_bonus = 5;
      improvements.hp_bonus = 80;
      improvements.bt_bonus = 40;
    } else if (item.meta_data?.starfinder?.grade === 'ULTIMATE') {
      improvements.level = 18;
      improvements.upgrade_price = 55000;
      improvements.total_price = 80000;
      improvements.hardness_bonus = 6;
      improvements.hp_bonus = 100;
      improvements.bt_bonus = 50;
    } else if (item.meta_data?.starfinder?.grade === 'PARAGON') {
      improvements.level = 20;
      improvements.upgrade_price = 240000;
      improvements.total_price = 320000;
      improvements.hardness_bonus = 7;
      improvements.hp_bonus = 120;
      improvements.bt_bonus = 60;
    }
  } else if (isItemWeapon(item)) {
    if (item.meta_data?.starfinder?.grade === 'TACTICAL') {
      improvements.level = 2;
      improvements.upgrade_price = 350;
      improvements.total_price = 350;
      improvements.upgrade_slots = 0;
      improvements.damage_dice = 1;
      improvements.trait_ids.push(getTraitIdByType('TRACKING-1'));
    } else if (item.meta_data?.starfinder?.grade === 'ADVANCED') {
      improvements.level = 4;
      improvements.upgrade_price = 650;
      improvements.total_price = 1000;
      improvements.upgrade_slots = 1;
      improvements.damage_dice = 2;
      improvements.trait_ids.push(getTraitIdByType('TRACKING-1'));
    } else if (item.meta_data?.starfinder?.grade === 'SUPERIOR') {
      improvements.level = 10;
      improvements.upgrade_price = 9000;
      improvements.total_price = 10000;
      improvements.upgrade_slots = 1;
      improvements.damage_dice = 2;
      improvements.trait_ids.push(getTraitIdByType('TRACKING-2'));
    } else if (item.meta_data?.starfinder?.grade === 'ELITE') {
      improvements.level = 12;
      improvements.upgrade_price = 10000;
      improvements.total_price = 20000;
      improvements.upgrade_slots = 2;
      improvements.damage_dice = 3;
      improvements.trait_ids.push(getTraitIdByType('TRACKING-2'));
    } else if (item.meta_data?.starfinder?.grade === 'ULTIMATE') {
      improvements.level = 16;
      improvements.upgrade_price = 80000;
      improvements.total_price = 100000;
      improvements.upgrade_slots = 2;
      improvements.damage_dice = 3;
      improvements.trait_ids.push(getTraitIdByType('TRACKING-3'));
    } else if (item.meta_data?.starfinder?.grade === 'PARAGON') {
      improvements.level = 19;
      improvements.upgrade_price = 300000;
      improvements.total_price = 400000;
      improvements.upgrade_slots = 3;
      improvements.damage_dice = 4;
      improvements.trait_ids.push(getTraitIdByType('TRACKING-3'));
    }
  }

  return improvements;
}
