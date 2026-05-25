// Codex item-category icons — 37 SVGs + priority resolver.
//
// Each item is shown in inventory rows with a small icon picked from
// its highest-priority category (see PRIORITY_ORDER below). A bag of
// holding wand of healing is both a Wand and a Consumable; the Wand
// icon wins because Wand is higher in the priority list. The full
// list mirrors design-mockups/mockup-4-item-icons.html — that file is
// the visual reference and is the source of truth for the SVG shapes.
//
// The matching itself is delegated to matchesItemCategory() in
// @common/select/filter-helpers, which already knows how each label
// resolves against the live data (group-enum equality vs. trait id
// lookup vs. usage prefix match).
//
// Consumable colouring is separate: a consumable item still gets the
// most-specific icon (Wand of Healing → wand icon), but its inventory
// row gets the .it.consumable sage rail, so the player can scan a
// list and spot single-use items even though their icon agrees with
// the wand-shaped neighbours.

import type { Item } from '@schemas/content';
import { matchesItemCategory } from '@common/select/filter-helpers';
import React from 'react';

// ─── Priority order ─────────────────────────────────────────────────
//
// Top of the list wins — first label whose criteria match the item
// becomes its icon. The "Consumable" label is intentionally LATE so
// the more-specific magical-medium / equipment / source labels can
// claim items first. "Other" is the final catch-all, and we keep it
// AFTER the generic fallbacks so it only fires when nothing else does.
//
// IMPORTANT: every label here must exist in ITEM_GROUP_CRITERIA in
// filter-helpers.ts (matchesItemCategory returns false for unknown
// labels). The chip filter and the icon resolver share the same map.
export const ICON_PRIORITY_ORDER: string[] = [
  'Cursed Items',
  'Artifacts',
  'Relics',
  'Apex Items',
  'Intelligent Items',
  'Grimoires',
  'Spellhearts',
  'Wands',
  'Staves',
  'Tattoos',
  'Grafts',
  'Runes',
  'Censer',
  'Banners',
  'Figurehead',
  'Snares',
  'Weapons',
  'Shields',
  'Armor',
  'Siege Weapons',
  'Vehicles',
  'Structures',
  'Animals and Gear',
  'High-tech',
  'Alchemical Items',
  'Contracts',
  'Blighted Boons',
  'Materials',
  'Trade Goods',
  'Services',
  'Customizations',
  'Adjustments',
  'Assistive Items',
  'Consumables',
  'Worn Items',
  'Held Items',
  'Adventuring Gear',
  'Other',
];

// ─── SVG components ─────────────────────────────────────────────────
//
// Each component renders a 24×24 SVG that inherits its colour from
// `currentColor` (so the row decides gold / sage / crimson). All
// shapes copy verbatim from mockup-4-item-icons.html so the visual
// match is exact. Stroke width 1.5, line-cap round, line-join round
// is the codex convention; deviations from that are deliberate (e.g.
// the sword blade is filled, the wand star is filled, etc.) so the
// shapes read at the small 18-px target size.

const baseProps = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

const Adjustments = () => (
  <svg {...baseProps}>
    <circle cx={12} cy={12} r={8} />
    <path d="M12 6 L12 18" />
    <path d="M9 9 L12 6 L15 9" />
    <path d="M9 15 L12 18 L15 15" />
  </svg>
);
const AdventuringGear = () => (
  <svg {...baseProps}>
    <path d="M10 4 C 10 2.5, 14 2.5, 14 4 L14 6" />
    <path d="M10 6 L10 4" />
    <path d="M6 6 L18 6 L19 21 L5 21 Z" />
    <path d="M6 6 L6 11 L18 11 L18 6" />
    <rect x={11} y={8.5} width={2} height={4} fill="currentColor" stroke="none" />
    <path d="M9 14 L15 14 L15 19 L9 19 Z" />
    <circle cx={12} cy={16.5} r={0.5} fill="currentColor" />
  </svg>
);
const Alchemical = () => (
  <svg {...baseProps}>
    <path d="M10 3 L14 3" />
    <path d="M11 3 L11 9 L7 18 C6 20 7 21 9 21 L15 21 C17 21 18 20 17 18 L13 9 L13 3" />
    <path d="M9 14 L15 14" />
    <circle cx={10.5} cy={17} r={0.7} fill="currentColor" />
    <circle cx={13} cy={18.5} r={0.5} fill="currentColor" />
  </svg>
);
const Animals = () => (
  <svg {...baseProps}>
    <ellipse cx={12} cy={16} rx={4} ry={3} fill="currentColor" stroke="none" />
    <ellipse cx={7} cy={11} rx={1.5} ry={2} fill="currentColor" stroke="none" />
    <ellipse cx={10} cy={8} rx={1.5} ry={2} fill="currentColor" stroke="none" />
    <ellipse cx={14} cy={8} rx={1.5} ry={2} fill="currentColor" stroke="none" />
    <ellipse cx={17} cy={11} rx={1.5} ry={2} fill="currentColor" stroke="none" />
  </svg>
);
const Apex = () => (
  <svg {...baseProps}>
    <path d="M4 18 L6 9 L9 14 L12 6 L15 14 L18 9 L20 18 Z" />
    <path d="M4 18 L20 18" />
    <circle cx={6} cy={8} r={0.8} fill="currentColor" />
    <circle cx={12} cy={5} r={0.8} fill="currentColor" />
    <circle cx={18} cy={8} r={0.8} fill="currentColor" />
  </svg>
);
const Armor = () => (
  <svg {...baseProps}>
    <path d="M5 8 C 5 5, 7 4, 9 6" />
    <path d="M19 8 C 19 5, 17 4, 15 6" />
    <path d="M5 8 L7 9 L7 19 L17 19 L17 9 L19 8" />
    <path d="M9 6 L12 8 L15 6" />
    <path d="M7 9 L9 6 M17 9 L15 6" />
    <path d="M10 9 L12 11 L14 9" />
    <path d="M8 13 L16 13" />
    <path d="M8 16 L16 16" />
    <path d="M12 11 L12 19" />
    <rect x={11} y={14.5} width={2} height={1.2} fill="currentColor" stroke="none" />
  </svg>
);
const Artifacts = () => (
  <svg {...baseProps}>
    <circle cx={12} cy={11} r={6} />
    <circle cx={12} cy={11} r={2.5} fill="currentColor" stroke="none" />
    <path d="M12 3 L12 5 M21 11 L19 11 M12 19 L12 17 M3 11 L5 11 M18 5 L17 6 M6 5 L7 6 M6 17 L7 16 M18 17 L17 16" />
  </svg>
);
const Assistive = () => (
  <svg {...baseProps}>
    <path d="M9 4 C 9 4, 14 4, 14 7 L14 18" />
    <path d="M12 21 L16 21" />
    <path d="M14 18 L14 21" />
  </svg>
);
const Banners = () => (
  <svg {...baseProps}>
    <path d="M7 3 L7 21" />
    <path d="M7 4 L17 4 L15 8 L17 12 L7 12" />
    <circle cx={7} cy={3} r={0.9} fill="currentColor" />
  </svg>
);
const BlightedBoons = () => (
  <svg {...baseProps}>
    <path d="M5 19 L11 13 L9 11 L13 7 L11 5 L15 3" />
    <path d="M11 13 L13 15" />
    <path d="M9 11 L7 13" />
    <path d="M13 7 L15 9" />
    <path d="M14 4 L16 4 L16 6" />
  </svg>
);
const Censer = () => (
  <svg {...baseProps}>
    <path d="M12 3 L12 6" />
    <path d="M7 6 L17 6" />
    <path d="M8 6 L7 9 L17 9 L16 6" />
    <path d="M7 9 L9 14 L15 14 L17 9" />
    <path d="M10 17 C 10 16, 11 16, 11 15 C 11 14, 10 14, 10 13" />
    <path d="M14 17 C 14 16, 13 16, 13 15 C 13 14, 14 14, 14 13" />
    <path d="M12 18 C 12 17, 13 17, 13 16 C 13 15, 12 15, 12 14" />
  </svg>
);
const Consumables = () => (
  <svg {...baseProps}>
    <path d="M10 3 L14 3" />
    <path d="M10 3 L10 7" />
    <path d="M14 3 L14 7" />
    <path d="M9 7 L15 7 C 18 11, 18 18, 12 21 C 6 18, 6 11, 9 7 Z" />
    <circle cx={11} cy={13} r={0.9} fill="currentColor" />
    <circle cx={13} cy={15} r={0.7} fill="currentColor" />
  </svg>
);
const Contracts = () => (
  <svg {...baseProps}>
    <path d="M5 3 L17 3 L19 5 L19 21 L5 21 Z" />
    <path d="M17 3 L17 5 L19 5" />
    <path d="M8 9 L16 9" />
    <path d="M8 12 L16 12" />
    <path d="M8 15 L13 15" />
    <path d="M8 18 L9.5 17 L10 19 L11.5 17 L12 19 L13.5 17 L14 18" />
  </svg>
);
const CursedItems = () => (
  <svg {...baseProps}>
    <path d="M6 11 C 6 6.5, 8.5 4, 12 4 C 15.5 4, 18 6.5, 18 11 L18 14 L16 16 L16 19 L14 19 L14 17 L10 17 L10 19 L8 19 L8 16 L6 14 Z" />
    <circle cx={10} cy={11} r={1.4} fill="currentColor" />
    <circle cx={14} cy={11} r={1.4} fill="currentColor" />
    <path d="M11 14 L11 16 M13 14 L13 16" />
  </svg>
);
const Customizations = () => (
  <svg {...baseProps}>
    <path d="M12 3 L17 8 L12 21 L7 8 Z" />
    <path d="M7 8 L17 8" />
    <path d="M9.5 8 L12 21 M14.5 8 L12 21" />
  </svg>
);
const Figurehead = () => (
  <svg {...baseProps}>
    <path
      d="M14 5 C 10 7, 7 10, 6 14 C 7 17, 11 19, 14 19 L14 17 L11 16 L10 14 L11 12 L14 11 L14 9 L13 8 L14 5 Z"
      fill="currentColor"
      stroke="none"
    />
    <path d="M14 5 C 10 7, 7 10, 6 14 C 7 17, 11 19, 14 19" />
    <path d="M14 5 L18 5 L20 9 L18 13 L14 13" />
    <circle cx={10} cy={13} r={0.8} fill="var(--bg-2)" stroke="none" />
  </svg>
);
const Grafts = () => (
  <svg {...baseProps}>
    <path d="M7 4 C 7 4, 6 7, 7 11 C 8 15, 11 18, 13 20" />
    <path d="M7 4 C 9 5, 11 6, 13 9 C 15 12, 16 16, 17 20" />
    <path d="M9 8 C 11 7, 13 7, 15 8 M10 12 C 12 11, 14 11, 16 12" />
  </svg>
);
const Grimoires = () => (
  <svg {...baseProps}>
    <path d="M4 6 L12 8 L20 6 L20 18 L12 20 L4 18 Z" />
    <path d="M12 8 L12 20" />
    <path
      d="M12 13 L10.5 14 L11 12.5 L9.5 11.5 L11.5 11.5 L12 10 L12.5 11.5 L14.5 11.5 L13 12.5 L13.5 14 Z"
      fill="currentColor"
    />
  </svg>
);
const HeldItems = () => (
  <svg {...baseProps}>
    <path d="M8 12 L8 5 C 8 4, 9 3.5, 10 3.5 C 11 3.5, 11.5 4, 11.5 5 L11.5 11" />
    <path d="M11.5 6 C 11.5 5, 12 4.5, 13 4.5 C 14 4.5, 14.5 5, 14.5 6 L14.5 11" />
    <path d="M14.5 7 C 14.5 6, 15 5.5, 16 5.5 C 17 5.5, 17.5 6, 17.5 7 L17.5 14 C 17.5 18, 14 20, 11 20 C 8 20, 6 18, 6 14 L6 11 C 6 10, 6.5 9.5, 7.5 9.5 C 8.5 9.5, 9 10, 9 11" />
  </svg>
);
const HighTech = () => (
  <svg {...baseProps}>
    <circle cx={12} cy={12} r={5} />
    <circle cx={12} cy={12} r={1.4} fill="currentColor" />
    <path d="M12 3 L12 5 M12 19 L12 21 M3 12 L5 12 M19 12 L21 12 M5.6 5.6 L7 7 M17 17 L18.4 18.4 M5.6 18.4 L7 17 M17 7 L18.4 5.6" />
  </svg>
);
const IntelligentItems = () => (
  <svg {...baseProps}>
    <path d="M3 12 C 6 7, 9 5, 12 5 C 15 5, 18 7, 21 12 C 18 17, 15 19, 12 19 C 9 19, 6 17, 3 12 Z" />
    <circle cx={12} cy={12} r={3} />
    <circle cx={12} cy={12} r={1.2} fill="currentColor" />
  </svg>
);
const Materials = () => (
  <svg {...baseProps}>
    <path d="M4 19 L9 11 L13 16 L16 13 L20 19 Z" />
    <path d="M9 11 L9 5 L13 5 L13 8" />
    <circle cx={7} cy={7} r={1.2} fill="currentColor" />
  </svg>
);
const Other = () => (
  <svg {...baseProps}>
    <circle cx={6} cy={12} r={1.4} fill="currentColor" />
    <circle cx={12} cy={12} r={1.4} fill="currentColor" />
    <circle cx={18} cy={12} r={1.4} fill="currentColor" />
  </svg>
);
const Relics = () => (
  <svg {...baseProps}>
    <circle cx={12} cy={12} r={3.5} />
    <path d="M12 3 L12 6 M12 18 L12 21 M3 12 L6 12 M18 12 L21 12" />
    <path d="M5.6 5.6 L7.7 7.7 M16.3 16.3 L18.4 18.4 M5.6 18.4 L7.7 16.3 M16.3 7.7 L18.4 5.6" />
    <circle cx={12} cy={12} r={1.3} fill="currentColor" />
  </svg>
);
const Runes = () => (
  <svg {...baseProps}>
    <path d="M7 4 L7 20" />
    <path d="M17 4 L17 20" />
    <path d="M7 9 L17 4 M7 14 L17 9 M7 20 L17 15" />
  </svg>
);
const Services = () => (
  <svg {...baseProps}>
    <path d="M12 4 L12 6" />
    <path d="M6 16 C 6 12, 8 8, 12 8 C 16 8, 18 12, 18 16 Z" />
    <circle cx={12} cy={18.5} r={1.2} fill="currentColor" />
  </svg>
);
const Shields = () => (
  <svg {...baseProps}>
    <path d="M5 5 L12 3 L19 5 L19 12 C 19 17, 15 20, 12 21 C 9 20, 5 17, 5 12 Z" />
    <path d="M9 11 L15 11" />
  </svg>
);
const SiegeWeapons = () => (
  <svg {...baseProps}>
    <path d="M3 18 L21 18" />
    <path d="M5 18 L7 14 L17 18" />
    <path d="M14 14 L7 7" />
    <circle cx={7} cy={7} r={1.8} fill="currentColor" />
    <circle cx={6} cy={20} r={1} fill="currentColor" />
    <circle cx={11} cy={20} r={1} fill="currentColor" />
    <circle cx={16} cy={20} r={1} fill="currentColor" />
  </svg>
);
const Snares = () => (
  <svg {...baseProps}>
    <path d="M4 13 C 4 7, 20 7, 20 13" />
    <path d="M4 13 C 4 19, 20 19, 20 13" />
    <path d="M5.5 11.5 L7 13 L8.5 11 L10 13 L11.5 10.8 L13 13 L14.5 11 L16 13 L17.5 11.5 L19 13" />
    <path d="M5.5 14.5 L7 13 L8.5 15 L10 13 L11.5 15.2 L13 13 L14.5 15 L16 13 L17.5 14.5 L19 13" />
    <circle cx={3} cy={13} r={1.4} fill="currentColor" />
    <circle cx={21} cy={13} r={1.4} fill="currentColor" />
    <path d="M12 19 L12 22" />
  </svg>
);
const Spellhearts = () => (
  <svg {...baseProps}>
    <path d="M12 21 C 5 16, 4 11, 6 7 C 8 4, 11 5, 12 8 C 13 5, 16 4, 18 7 C 20 11, 19 16, 12 21 Z" />
    <path d="M9 11 L15 11 M10 14 L14 14" />
    <path d="M12 8 L12 17" />
  </svg>
);
const Staves = () => (
  <svg {...baseProps}>
    <circle cx={12} cy={6} r={3} />
    <path d="M12 9 L12 21" />
    <path d="M10 6 L14 6 M12 4 L12 8" strokeWidth={1} />
  </svg>
);
const Structures = () => (
  <svg {...baseProps}>
    <path d="M3 21 L3 9 L4.5 9 L4.5 7 L6 7 L6 9 L7.5 9 L7.5 6 L9 6 L9 9 L10.5 9 L10.5 7 L13.5 7 L13.5 9 L15 9 L15 6 L16.5 6 L16.5 9 L18 9 L18 7 L19.5 7 L19.5 9 L21 9 L21 21 Z" />
    <path d="M10.5 21 L10.5 16 C 10.5 14.5, 13.5 14.5, 13.5 16 L13.5 21" />
    <rect x={5} y={12} width={1.8} height={2} fill="currentColor" stroke="none" />
    <rect x={17.2} y={12} width={1.8} height={2} fill="currentColor" stroke="none" />
  </svg>
);
const Tattoos = () => (
  <svg {...baseProps}>
    <path d="M12 4 C 9 8, 8 12, 9 15 C 10 18, 13 19, 15 17 C 17 15, 17 11, 15 8 C 13 5, 11 7, 12 10 C 13 13, 11 14, 10 13" />
  </svg>
);
const TradeGoods = () => (
  <svg {...baseProps}>
    <path d="M10 5 L14 5" />
    <path d="M9 6 L9 5 L15 5 L15 6" />
    <path d="M9 6 C 5 8, 4 13, 6 17 C 8 20, 16 20, 18 17 C 20 13, 19 8, 15 6 Z" />
    <path d="M11 14 L13 12 M11 12 L13 14" />
  </svg>
);
const Vehicles = () => (
  <svg {...baseProps}>
    <path d="M3 16 L21 16 L20 12 L4 12 Z" />
    <path d="M4 12 C 4 6, 20 6, 20 12" />
    <path d="M7 7 L7 12 M11 6.4 L11 12 M13 6.4 L13 12 M17 7 L17 12" />
    <circle cx={7} cy={19} r={2.5} />
    <circle cx={17} cy={19} r={2.5} />
    <path d="M7 16.5 L7 21.5 M4.5 19 L9.5 19" />
    <path d="M17 16.5 L17 21.5 M14.5 19 L19.5 19" />
  </svg>
);
const Wands = () => (
  <svg {...baseProps}>
    <path d="M4 20 L16 8" strokeWidth={2} />
    <circle cx={3.5} cy={20.5} r={1.5} fill="currentColor" />
    <path
      d="M17 3 L18.4 6.6 L22 7 L19.3 9.4 L20.2 13 L17 11 L13.8 13 L14.7 9.4 L12 7 L15.6 6.6 Z"
      fill="currentColor"
      stroke="currentColor"
      strokeWidth={0.5}
    />
    <circle cx={22} cy={3} r={0.5} fill="currentColor" />
    <circle cx={13} cy={14} r={0.5} fill="currentColor" />
    <circle cx={9} cy={6} r={0.4} fill="currentColor" />
  </svg>
);
const Weapons = () => (
  <svg {...baseProps}>
    <path d="M12 3 L10 5 L10 14 L14 14 L14 5 Z" fill="currentColor" />
    <path d="M6 14 L18 14" />
    <path d="M6 13.5 L6 15 M18 13.5 L18 15" />
    <path d="M11 14 L11 19 L13 19 L13 14" />
    <path d="M11 16 L13 16 M11 17.5 L13 17.5" />
    <circle cx={12} cy={20.5} r={1.5} />
  </svg>
);
const WornItems = () => (
  <svg {...baseProps}>
    <path d="M5 5 C 7 9, 9 11, 12 11 C 15 11, 17 9, 19 5" />
    <circle cx={12} cy={15} r={3.5} />
    <circle cx={12} cy={15} r={1.2} fill="currentColor" />
  </svg>
);

// ─── Lookup map ─────────────────────────────────────────────────────
// Maps the priority-order label EXACTLY (case-sensitive) to its
// SVG component. Adding a new icon means adding it here AND in
// ICON_PRIORITY_ORDER above.
const ICON_BY_LABEL: Record<string, React.FC> = {
  'Adjustments': Adjustments,
  'Adventuring Gear': AdventuringGear,
  'Alchemical Items': Alchemical,
  'Animals and Gear': Animals,
  'Apex Items': Apex,
  'Armor': Armor,
  'Artifacts': Artifacts,
  'Assistive Items': Assistive,
  'Banners': Banners,
  'Blighted Boons': BlightedBoons,
  'Censer': Censer,
  'Consumables': Consumables,
  'Contracts': Contracts,
  'Cursed Items': CursedItems,
  'Customizations': Customizations,
  'Figurehead': Figurehead,
  'Grafts': Grafts,
  'Grimoires': Grimoires,
  'Held Items': HeldItems,
  'High-tech': HighTech,
  'Intelligent Items': IntelligentItems,
  'Materials': Materials,
  'Other': Other,
  'Relics': Relics,
  'Runes': Runes,
  'Services': Services,
  'Shields': Shields,
  'Siege Weapons': SiegeWeapons,
  'Snares': Snares,
  'Spellhearts': Spellhearts,
  'Staves': Staves,
  'Structures': Structures,
  'Tattoos': Tattoos,
  'Trade Goods': TradeGoods,
  'Vehicles': Vehicles,
  'Wands': Wands,
  'Weapons': Weapons,
  'Worn Items': WornItems,
};

// ─── Priority resolver ──────────────────────────────────────────────
/**
 * Pick the icon-label for an item by walking ICON_PRIORITY_ORDER and
 * returning the first label whose matchesItemCategory() check passes.
 * Falls through to "Other" when nothing matches (e.g. an item with no
 * group / traits / usage info — should be rare but possible for
 * homebrew rows that omit those fields).
 *
 * Pure / side-effect-free; safe to call on every render.
 */
export function getItemIconKey(item: Item | null | undefined): string {
  if (!item) return 'Other';
  for (const label of ICON_PRIORITY_ORDER) {
    if (matchesItemCategory(item as unknown as Record<string, unknown>, label)) {
      return label;
    }
  }
  return 'Other';
}

/**
 * True when the item carries the Consumable trait (or sits in the
 * Consumables group). Used for the row-level sage colouring — note
 * this is *independent* of which icon the item gets, so a Wand of
 * Healing keeps the Wand icon AND gets the sage rail because both
 * facts about it are true.
 */
export function isConsumableItem(item: Item | null | undefined): boolean {
  if (!item) return false;
  return matchesItemCategory(
    item as unknown as Record<string, unknown>,
    'Consumables'
  );
}

/**
 * Render the SVG icon for an item. Inherits its colour from the
 * parent (gold for default rows, sage for consumables, crimson for
 * cursed) via `currentColor`. Sizing comes from CSS (.it .icon svg);
 * we don't set width/height here so callers can drop it into any
 * sized cell.
 */
export function ItemIcon(props: { item: Item | null | undefined }): React.ReactElement {
  const key = getItemIconKey(props.item);
  const Comp = ICON_BY_LABEL[key] ?? Other;
  return <Comp />;
}
