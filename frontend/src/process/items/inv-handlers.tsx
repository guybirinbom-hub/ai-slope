import { ItemIcon } from '@common/ItemIcon';
import { getConditionByName } from '@conditions/condition-handler';
import { showNotification } from '@mantine/notifications';
import { InventoryItem, Item, LivingEntity } from '@schemas/content';
import { StoreID, VariableListStr } from '@schemas/variables';
import { isCharacter } from '@utils/type-fixing';
import { getVariable } from '@variables/variable-manager';
import { labelToVariable } from '@variables/variable-utils';
import { cloneDeep, uniq, uniqBy } from 'lodash-es';
import { SetterOrUpdater } from '@utils/type-fixing';
import {
  getBulkLimit,
  getDefaultContainerContents,
  getInvBulk,
  isItemContainer,
  isItemEquippable,
  isItemImplantable,
  isItemInvestable,
} from './inv-utils';

/**
 * Utility function to handle adding an item to the inventory
 * @param setEntity - LivingEntity state setter
 * @param item - Item to add
 * @param is_formula - Whether the item is a formula
 */
export const handleAddItem = async (
  setEntity: SetterOrUpdater<LivingEntity | null>,
  item: Item,
  is_formula: boolean
) => {
  const container_contents = await getDefaultContainerContents(item);
  setEntity((prev) => {
    if (!prev) return prev;

    const itemData = cloneDeep(item);
    if (itemData.meta_data) {
      itemData.meta_data.hp = itemData.meta_data.hp_max;
    }
    const newItems = [
      ...cloneDeep(prev.inventory?.items ?? []),
      {
        id: crypto.randomUUID(),
        item: itemData,
        is_formula: is_formula,
        is_equipped: false,
        is_invested: false,
        is_implanted: false,
        container_contents,
      },
    ].sort((a, b) => a.item.name.localeCompare(b.item.name));

    return {
      ...prev,
      inventory: {
        ...(prev?.inventory ?? {
          coins: {
            cp: 0,
            sp: 0,
            gp: 0,
            pp: 0,
          },
          items: [],
        }),
        items: newItems,
      },
    };
  });
  showNotification({
    title: 'Added to Inventory',
    message: `Added ${item.name}.`,
    icon: <ItemIcon item={item} size='1.0rem' color='#f8f9fa' useDefaultIcon />,
    autoClose: 1000,
  });
};

/**
 * Recursively strip an item by id from a list AND from every nested
 * container_contents under it. Returns a new array — does not mutate
 * the input. Used by both delete and the delete-half of move so an
 * item that lives 2+ containers deep still disappears from its
 * original home.
 *
 * The previous one-level-deep filter assumed all containers were
 * top-level, which broke as soon as the new codex inventory panel
 * exposed nested containers (a belt-pouch inside a backpack) — moving
 * an item out of a nested pouch left a phantom copy behind.
 */
const deepRemoveById = (items: InventoryItem[], id: string): InventoryItem[] =>
  items
    .filter((i) => i.id !== id)
    .map((i) =>
      isItemContainer(i.item)
        ? { ...i, container_contents: deepRemoveById(i.container_contents, id) }
        : i
    );

/**
 * Recursively replace an item by id with a fresh clone, anywhere in
 * the inventory tree. Mirrors deepRemoveById — used by handleUpdateItem
 * so edits to a deeply-nested item land in the right place.
 */
const deepReplaceById = (items: InventoryItem[], replacement: InventoryItem): InventoryItem[] =>
  items.map((i) => {
    if (i.id === replacement.id) return cloneDeep(replacement);
    if (isItemContainer(i.item)) {
      return { ...i, container_contents: deepReplaceById(i.container_contents, replacement) };
    }
    return i;
  });

/**
 * Utility function to handle deleting an item from the inventory
 * @param setEntity - LivingEntity state setter
 * @param invItem - Inventory item to delete
 */
export const handleDeleteItem = (setEntity: SetterOrUpdater<LivingEntity | null>, invItem: InventoryItem) => {
  setEntity((prev) => {
    if (!prev) return prev;

    const newItems = deepRemoveById(cloneDeep(prev.inventory?.items ?? []), invItem.id);

    return {
      ...prev,
      inventory: {
        ...(prev?.inventory ?? {
          coins: {
            cp: 0,
            sp: 0,
            gp: 0,
            pp: 0,
          },
          items: [],
        }),
        items: newItems,
      },
    };
  });
};

/**
 * Utility function to handle updating an item in the inventory
 * @param setEntity - LivingEntity state setter
 * @param invItem - Inventory item to update
 */
export const handleUpdateItem = (setEntity: SetterOrUpdater<LivingEntity | null>, invItem: InventoryItem) => {
  setEntity((prev) => {
    if (!prev) return prev;

    const newItems = deepReplaceById(cloneDeep(prev.inventory?.items ?? []), invItem);

    return {
      ...prev,
      inventory: {
        ...(prev?.inventory ?? {
          coins: {
            cp: 0,
            sp: 0,
            gp: 0,
            pp: 0,
          },
          items: [],
        }),
        items: newItems,
      },
    };
  });
};

/**
 * Recursively push `item` into the container with the given id,
 * anywhere in the tree. No-op if no container with that id exists.
 * Returns a new array — does not mutate input.
 */
const deepPushIntoContainer = (
  items: InventoryItem[],
  containerId: string,
  item: InventoryItem
): InventoryItem[] =>
  items.map((i) => {
    if (i.id === containerId && isItemContainer(i.item)) {
      return { ...i, container_contents: [...i.container_contents, item] };
    }
    if (isItemContainer(i.item)) {
      return { ...i, container_contents: deepPushIntoContainer(i.container_contents, containerId, item) };
    }
    return i;
  });

/**
 * Utility function to handle moving an item in the inventory.
 *
 * Two cases:
 *   containerItem === null  → unstored (back to the top-level list)
 *   containerItem !== null  → into that container's container_contents
 *
 * Works regardless of where the source item currently lives (top-level
 * or nested any number of containers deep) — we use the deep-walk
 * helpers to find and remove it. A single setEntity callback handles
 * both the remove and re-insert atomically so the UI never observes
 * the "in-between" state where the item exists nowhere.
 *
 * Cycle guard: if the user tries to move a container into one of its
 * own descendants we silently no-op. Without this you could orphan a
 * whole sub-tree (move Backpack into Belt-Pouch where Belt-Pouch is
 * inside Backpack → the tree forms a loop and disappears).
 */
export const handleMoveItem = (
  setEntity: SetterOrUpdater<LivingEntity | null>,
  invItem: InventoryItem,
  containerItem: InventoryItem | null
) => {
  setEntity((prev) => {
    if (!prev) return prev;

    // Cycle guard. If the item being moved is itself a container,
    // collect its descendant ids and refuse to drop into any of them
    // (or into itself). This walks the source-tree view, not the
    // post-removal view, which is fine — we only care about identity.
    if (containerItem && isItemContainer(invItem.item)) {
      const forbidden = new Set<string>([invItem.id]);
      const walk = (list: InventoryItem[]) => {
        for (const i of list) {
          forbidden.add(i.id);
          if (isItemContainer(i.item)) walk(i.container_contents);
        }
      };
      walk(invItem.container_contents);
      if (forbidden.has(containerItem.id)) return prev;
    }

    // Remove from wherever it currently is.
    let working = deepRemoveById(cloneDeep(prev.inventory?.items ?? []), invItem.id);

    // Insert into the new home.
    const moving = cloneDeep(invItem);
    if (containerItem) {
      moving.is_equipped = false;
      working = deepPushIntoContainer(working, containerItem.id, moving);
    } else {
      working = [...working, moving];
    }

    return {
      ...prev,
      inventory: {
        ...(prev?.inventory ?? {
          coins: {
            cp: 0,
            sp: 0,
            gp: 0,
            pp: 0,
          },
          items: [],
        }),
        items: working,
      },
    };
  });
};

/**
 * Utility function to update the charges for an item
 * @param setEntity - LivingEntity state setter
 * @param invItem - Inventory item to update
 * @param charges - Charges to set
 */
export const handleUpdateItemCharges = (
  setEntity: React.Dispatch<React.SetStateAction<LivingEntity | null>>,
  invItem: InventoryItem,
  charges: { current?: number; max?: number }
) => {
  setEntity((char) => {
    if (!char || !char.inventory) return null;

    return {
      ...char,
      inventory: {
        ...char.inventory,
        items: char.inventory.items.map((i) => {
          if (i.id !== invItem.id) return i;

          // If it's the item, update the charges
          return {
            ...i,
            item: {
              ...i.item,
              meta_data: {
                ...i.item.meta_data!,
                charges: {
                  ...i.item.meta_data?.charges,
                  current: charges.current ?? i.item.meta_data?.charges?.current,
                  max: charges.max ?? i.item.meta_data?.charges?.max,
                },
              },
            },
          };
        }),
      },
    };
  });
};

export function checkBulkLimit(
  storeId: StoreID,
  entity: LivingEntity,
  setEntity: SetterOrUpdater<LivingEntity | null>,
  addEncumbered: boolean
) {
  setTimeout(() => {
    if (!entity.inventory) return;
    if (addEncumbered && Math.floor(getInvBulk(entity.inventory)) > getBulkLimit(storeId)) {
      // Add encumbered condition
      const newConditions = cloneDeep(entity.details?.conditions ?? []);
      const encumbered = newConditions.find((c) => c.name === 'Encumbered');
      if (!encumbered) {
        newConditions.push(getConditionByName('Encumbered', 'Over Bulk Limit')!);

        // if (Math.floor(getInvBulk(character.inventory)) > getBulkLimitImmobile(storeId)) {
        //   const immobilized = newConditions.find((c) => c.name === 'Immobilized');
        //   if (!immobilized) {
        //     newConditions.push(getConditionByName('Immobilized', 'Way Over Bulk Limit')!);
        //   }
        // }

        setEntity((c) => {
          if (!c) return c;
          return {
            ...c,
            details: {
              ...c.details,
              conditions: newConditions,
            },
          };
        });
      }
    } else {
      // Remove encumbered condition
      const newConditions = cloneDeep(entity.details?.conditions ?? []);
      const encumbered = newConditions.find((c) => c.name === 'Encumbered' && c.source === 'Over Bulk Limit');
      if (encumbered) {
        newConditions.splice(newConditions.indexOf(encumbered), 1);
        setEntity((c) => {
          if (!c) return c;
          return {
            ...c,
            details: {
              ...c.details,
              conditions: newConditions,
            },
          };
        });
      }
    }
  }, 200);
}

export function addExtraItems(
  storeId: StoreID,
  items: Item[],
  entity: LivingEntity,
  setEntity: SetterOrUpdater<LivingEntity | null>
) {
  // Add extra items
  setTimeout(async () => {
    const extraItems: InventoryItem[] = [];

    let extraItemIds = getVariable<VariableListStr>(storeId, 'EXTRA_ITEM_IDS')?.value ?? [];
    if (isCharacter(entity)) {
      extraItemIds = [...extraItemIds, '9252']; // Hardcoded Fist ID
    }

    for (const itemId of extraItemIds) {
      const item = items.find((item) => `${item.id}` === itemId);
      const hasItemAdded = entity.meta_data?.given_item_ids?.includes(parseInt(itemId));
      if (item && !hasItemAdded) {
        const baseItem = item.meta_data?.base_item
          ? items.find((i) => labelToVariable(i.name) === labelToVariable(item.meta_data!.base_item!))
          : undefined;

        extraItems.push({
          id: 'extra-item-' + itemId,
          item: {
            ...item,
            meta_data: item.meta_data
              ? {
                  ...item.meta_data,
                  base_item_content: baseItem,
                }
              : null,
          },
          is_formula: false,
          is_equipped: isItemEquippable(item),
          is_invested: isItemInvestable(item),
          is_implanted: isItemImplantable(item),
          container_contents: await getDefaultContainerContents(item, items),
        });
      }
    }

    if (extraItems.length === 0) return;

    setEntity((c) => {
      if (!c) return c;
      return {
        ...c,
        inventory: {
          ...(c.inventory ?? {
            coins: {
              cp: 0,
              sp: 0,
              gp: 0,
              pp: 0,
            },
            items: [],
          }),
          items: uniqBy([...(c.inventory?.items ?? []), ...extraItems], 'id'),
        },
        meta_data: {
          ...c.meta_data,
          given_item_ids: uniq([...(c.meta_data?.given_item_ids ?? []), ...extraItems.map((item) => item.item.id)]),
        },
      };
    });
  }, 100);

  // Remove extra items that are no longer in the list
  setTimeout(() => {
    if (!entity.inventory) return;

    const givenItemIds = entity.meta_data?.given_item_ids ?? [];
    let extraItemIds = getVariable<VariableListStr>(storeId, 'EXTRA_ITEM_IDS')?.value ?? [];
    if (isCharacter(entity)) {
      extraItemIds = [...extraItemIds, '9252']; // Hardcoded Fist ID
    }

    const itemsToRemove = givenItemIds.filter((id) => !extraItemIds.includes(`${id}`));
    if (itemsToRemove.length === 0) return;

    setEntity((c) => {
      if (!c) return c;
      return {
        ...c,
        inventory: {
          ...c.inventory!,
          items: c.inventory!.items.filter((item) => !itemsToRemove.includes(item.item.id)),
        },
        meta_data: {
          ...c.meta_data,
          given_item_ids: c.meta_data?.given_item_ids?.filter((id) => !itemsToRemove.includes(id)),
        },
      };
    });
  }, 200);
}
