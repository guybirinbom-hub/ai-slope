// Per-character "favorites" list helpers.
//
// The player can star any drawer entry (a feat, action, item, spell,
// inventory item, class feature, etc.) from the drawer's bottom-left
// corner. The starred entries appear in a "Favorites" accordion at the
// top of the Actions panel for quick re-opening.
//
// Storage shape (see schemas/content.ts on LivingEntity.meta_data):
//   favorites: Array<{ type: string; id: number | string; name: string }>
//
// `type` is the DrawerType the entry should reopen as.
// `id`   is the content-row id for content (number) OR the inventory
//        item id for in-inventory items (string from InventoryItem.id).
// `name` is captured at star-time so the favorites bar can render
//        without round-tripping content fetches.

import type { AbilityBlock, Character, ContentType, InventoryItem, Item, LivingEntity, Spell } from '@schemas/content';
import type { DrawerType } from '@schemas/index';
import { getCachedContent } from '@content/content-store';

export type Favorite = { type: string; id: number | string; name: string };

// Pull the favorites list off a character / living entity. Returns an
// empty array if there's no meta_data or no favorites yet.
export function getFavorites(entity: LivingEntity | null | undefined): Favorite[] {
  return entity?.meta_data?.favorites ?? [];
}

// Match an existing favorite entry. We treat (type, id) as the unique
// key — duplicate names from different sources are fine.
export function isFavorited(
  entity: LivingEntity | null | undefined,
  type: string,
  id: number | string | undefined
): boolean {
  if (id === undefined) return false;
  const favs = getFavorites(entity);
  return favs.some((f) => f.type === type && f.id === id);
}

// Append a favorite. No-op if the (type, id) pair is already starred.
// Returns the new favorites array; callers spread it back onto the
// entity meta_data.
export function addFavorite(
  entity: LivingEntity | null | undefined,
  fav: Favorite
): Favorite[] {
  const favs = getFavorites(entity);
  if (favs.some((f) => f.type === fav.type && f.id === fav.id)) return favs;
  return [...favs, fav];
}

export function removeFavorite(
  entity: LivingEntity | null | undefined,
  type: string,
  id: number | string
): Favorite[] {
  return getFavorites(entity).filter((f) => !(f.type === type && f.id === id));
}

// Convenience: toggle a favorite by (type, id, name). Returns the new
// favorites array.
export function toggleFavorite(
  entity: LivingEntity | null | undefined,
  fav: Favorite
): Favorite[] {
  return isFavorited(entity, fav.type, fav.id)
    ? removeFavorite(entity, fav.type, fav.id)
    : addFavorite(entity, fav);
}

// Resolve a stored favorite back into the drawer payload that the
// drawer system expects. For inventory items, we look up the live
// invItem (callbacks injected by the caller) and pass it via
// drawerData.invItem. For everything else, the drawer just needs
// `{ id }` — we pass it through directly.
//
// The caller (the Favorites accordion in SkillsActionsPanel) supplies
// the `inventoryItemCallbacks` so inv-items can be edited from the
// drawer with the same edit/delete/move handlers the rest of the
// inventory uses.
export function resolveFavoriteToDrawer(
  fav: Favorite,
  ctx: {
    character: Character | LivingEntity | null;
    storeId: string;
    inventoryItemCallbacks: {
      onItemUpdate: (i: InventoryItem) => void;
      onItemDelete: (i: InventoryItem) => void;
      onItemMove: (i: InventoryItem, container: InventoryItem | null) => void;
    };
  }
): { type: DrawerType; data: any } | null {
  if (fav.type === 'inv-item') {
    const invId = String(fav.id);
    const allItems: InventoryItem[] = (ctx.character?.inventory?.items ?? []) as InventoryItem[];
    // Container items may hold their contents inside container_contents.
    const flat: InventoryItem[] = [];
    for (const it of allItems) {
      flat.push(it);
      const contents = (it as any).container_contents as InventoryItem[] | undefined;
      if (contents) flat.push(...contents);
    }
    const invItem = flat.find((i) => String(i.id) === invId);
    if (!invItem) return null;
    return {
      type: 'inv-item' as DrawerType,
      data: {
        storeId: ctx.storeId,
        zIndex: 100,
        invItem,
        onItemUpdate: ctx.inventoryItemCallbacks.onItemUpdate,
        onItemDelete: ctx.inventoryItemCallbacks.onItemDelete,
        onItemMove: ctx.inventoryItemCallbacks.onItemMove,
      },
    };
  }
  // Generic case — most drawers just take `{ id }`.
  return {
    type: fav.type as DrawerType,
    data: { id: fav.id },
  };
}

// Map a drawer type to the content type it resolves against in the
// content cache. Used to look up a stable display name when the drawer
// payload is just `{id}` (which is the common case at star-click time
// — most drawers fetch the content async after they mount, so the
// payload doesn't carry the name yet).
function contentTypeForDrawer(drawerType: string): ContentType | null {
  switch (drawerType) {
    // ability_block sub-types — all stored as ability_block rows
    case 'feat':
    case 'action':
    case 'class-feature':
    case 'heritage':
    case 'sense':
    case 'physical-feature':
      return 'ability-block';
    case 'spell':
      return 'spell';
    case 'item':
      return 'item';
    case 'class':
      return 'class';
    case 'ancestry':
      return 'ancestry';
    case 'background':
      return 'background';
    case 'archetype':
      return 'archetype';
    case 'versatile-heritage':
      return 'versatile-heritage';
    case 'class-archetype':
      return 'class-archetype';
    case 'creature':
      return 'creature';
    case 'language':
      return 'language';
    case 'trait':
      return 'trait';
    default:
      return null;
  }
}

// Look up an item / feat / spell / etc.'s display name from the cached
// content store using only a (drawer type, id). Used both at
// star-click time and to backfill the favorites bar when stored names
// are stale (e.g. a row that was favorited before the content cache
// warmed up).
export function lookupFavoriteName(drawerType: string, id: number | string): string | null {
  const ctype = contentTypeForDrawer(drawerType);
  if (!ctype) return null;
  const numericId = typeof id === 'number' ? id : parseInt(String(id));
  if (Number.isNaN(numericId)) return null;
  const all = getCachedContent<AbilityBlock | Spell | Item | { id: number; name: string }>(ctype) ?? [];
  const hit = all.find((c) => (c as { id?: number }).id === numericId);
  return hit ? (hit as { name?: string }).name ?? null : null;
}

// Pull a (type, id, name) triple out of an open drawer's state so the
// star button can decide what to save. Some drawer payloads keep the
// id at `data.id`; the inventory-item drawer keeps it at `data.invItem.id`.
// Returns null if the drawer type isn't favoritable or we can't extract
// a stable id.
export function favoriteFromDrawer(
  drawerType: string,
  drawerData: any
): Favorite | null {
  if (!drawerData) return null;
  // Non-favoritable drawers — stat pop-overs / managers / generic
  // dialogs, none of which the player would want to "favorite".
  // Note: 'cast-spell' is intentionally NOT here — even though it's
  // technically a cast-trigger overlay, it's the only spell drawer the
  // codex sheet opens, and we want spells to be favoritable. We save
  // its favorite as the plain 'spell' type below so reopening it later
  // pulls up the standard spell description drawer.
  // 'condition' is also intentionally NOT here — players want to pin
  // commonly-referenced conditions (Frightened, Stupefied, Sickened,
  // etc.) for quick combat lookup. Condition drawer payloads use the
  // condition NAME as the id (see openDrawer({type:'condition', data:{id: name}})
  // in TraitsDisplay.tsx and other call sites), so the favorite saves
  // the name as the id and the lookupFavoriteName fallback is
  // unnecessary for this type.
  const NON_FAVORITABLE = new Set([
    'generic', 'character', 'manage-coins',
    'stat-prof', 'stat-attr', 'stat-hp', 'stat-ac',
    'stat-speed', 'stat-perception', 'stat-resist-weak',
    'stat-weapon', 'add-spell',
  ]);
  if (NON_FAVORITABLE.has(drawerType)) return null;

  // Condition drawer: payload is `{ id: conditionName }`. The
  // condition name doubles as a display label since it's already
  // human-readable ("Frightened", "Stupefied", etc.).
  if (drawerType === 'condition') {
    const id = drawerData.id;
    if (typeof id !== 'string' || !id) return null;
    return { type: 'condition', id, name: id };
  }

  // cast-spell payload carries the full spell. We favorite it as a
  // generic 'spell' so the saved entry can later reopen via the plain
  // spell drawer (which doesn't need the source/tradition/exhaustion
  // wiring cast-spell expects).
  if (drawerType === 'cast-spell') {
    const spell = drawerData.spell;
    const id = drawerData.id ?? spell?.id;
    if (id == null || !spell?.name) return null;
    return { type: 'spell', id, name: spell.name };
  }

  if (drawerType === 'inv-item') {
    const inv = drawerData.invItem;
    if (!inv) return null;
    return { type: 'inv-item', id: String(inv.id), name: inv.item?.name ?? '' };
  }
  // The other drawers all use `{ id }` for the content-row id. We
  // first check the payload itself (some drawers pre-load the content
  // and stash it on data.spell / data.feat / etc.). When that's
  // missing, fall back to a cache lookup keyed on drawer type — the
  // cache is populated as soon as content loads, so by the time the
  // user can SEE the drawer's name, the cache has the row.
  const id = drawerData.id;
  if (typeof id !== 'number' && typeof id !== 'string') return null;
  const payloadName =
    drawerData.name ??
    drawerData.title ??
    drawerData.spell?.name ??
    drawerData.feat?.name ??
    drawerData.item?.name ??
    drawerData.action?.name ??
    drawerData.classFeature?.name ??
    drawerData.ability?.name;
  const name = payloadName ?? lookupFavoriteName(drawerType, id) ?? String(id);
  return { type: drawerType, id, name };
}
