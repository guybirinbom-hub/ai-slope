/**
 * Codex-themed spell / inventory / feats panels for the character sheet.
 *
 * Each panel renders against the codex DOM structures defined in
 * codex-spells.html / codex-inventory.html / codex-feats.html, wired
 * to the existing engine data (entity.spells, entity.inventory,
 * collectEntitySpellcasting, etc.) and to the existing drawer system
 * for row clicks.
 *
 * Replaces the previous Mantine sub-panels when rendered inside
 * CodexSheet's non-Main tabs.
 */

import { Character, ContentPackage, InventoryItem, LivingEntity, Spell } from '@schemas/content';
import { SetterOrUpdater } from '@utils/type-fixing';
import { useAtom } from 'jotai';
import { drawerState } from '@atoms/navAtoms';
import { useState, useMemo, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { collectEntitySpellcasting, collectEntityAbilityBlocks, getFocusPoints } from '@content/collect-content';
import { getVariable } from '@variables/variable-manager';
import { VariableListStr, VariableNum } from '@schemas/variables';
import { labelToVariable } from '@variables/variable-utils';
import { findActions } from '@utils/actions';
import { getFillableSpellHolder } from '@items/inv-utils';
// @items alias maps to process/items in tsconfig; explicit re-import
// path makes this unambiguous in the rare case the alias isn't set.
import { getFinalProfValue, getProfValueParts } from '@variables/variable-helpers';
import { rankNumber } from '@utils/numbers';
import {
  getInvBulk,
  getBulkLimit,
  getBulkLimitImmobile,
  getContainerContentsBulk,
  labelizeBulk,
  isItemContainer,
  isItemEquippable,
  isItemInvestable,
  isItemImplantable,
  reachedInvestedLimit,
  reachedImplantLimit,
} from '@items/inv-utils';
import { priceToString } from '@items/currency-handler';
import { isCantrip, isNormalSpell } from '@spells/spell-utils';
import { selectContent } from '@common/select/SelectContent';
import {
  applyHandwrapsToUnarmed,
  getEquippedHandwrapsRunes,
  isHandwrapsOfMightyBlows,
  isItemWeapon,
} from '@items/inv-utils';
import { ItemIcon, isConsumableItem } from '@items/item-icons';
import { cloneDeep } from 'lodash-es';
import ManageSpellsModal from '@modals/ManageSpellsModal';
import { openContextModal } from '@mantine/modals';
import { Title, Text, Stack } from '@mantine/core';
import { Item } from '@schemas/content';
import { handleAddItem, handleDeleteItem, handleMoveItem, handleUpdateItem } from '@items/inv-handlers';
import { modals } from '@mantine/modals';
import { getWeaponStats } from '@items/weapon-handler';
import { isAbilityBlockVisible } from '@content/content-hidden';
import { hasTraitType } from '@utils/traits';
import { getCachedContent } from '@content/content-store';
import { AbilityBlock } from '@schemas/content';
import { sign } from '@utils/numbers';
import { useCollapsedSections } from './useCollapsedSections';

// -----------------------------------------------------------------------
// Shared inline-SVG action-cost sprite — used by both spells + activities.
// Renders as <ActionGlyph cost="1" /> → 1-action / 2-action / 3-action /
// reaction (ar) / free (af). Matches the .ai class from codex.css.
// -----------------------------------------------------------------------

// Gold `*` indicator that appears next to a stat value whenever the
// stat has conditional bonuses applied (e.g., "+1 vs fear effects").
// Mirrors the marker shown in the info drawer via
// displayFinalProfValue. Reads from the live variable store on every
// render so it picks up mode toggles, condition changes, etc.
function ProfCondMark({ varName }: { varName: string }) {
  const has = !!getProfValueParts('CHARACTER', varName)?.hasConditionals;
  if (!has) return null;
  return (
    <span
      style={{
        color: 'var(--wg4-accent)',
        marginLeft: 2,
        fontWeight: 700,
        fontFamily: 'Cinzel, serif',
      }}
      title='This stat has conditional bonuses — open the info page for details.'
    >
      *
    </span>
  );
}

// Render the same ".stat" inner content the activity panel produces
// for an action card — MAP ladder for Attack-trait actions, movement
// distances for Stride/Step/Crawl/Leap/Sudden Charge/Fly/Climb/etc.,
// multi-success for High/Long Jump, and the character's skill bonus
// for skill actions. Exported so the codex Favorites section in
// CodexSheet can render the same stat on starred-action cards
// instead of the bare type label it used before.
//
// `character` is optional and used to derive the best Strike MAP
// ladder for Attack-trait actions from equipped weapons. Without it,
// we fall back to the +0/-5/-10 ladder (which is what an unequipped
// character would see anyway).
export function ActionStatCell(props: {
  action: AbilityBlock;
  character: Character | null;
}): React.ReactNode {
  const { action, character } = props;
  const nameKey = action.name.toLowerCase().trim();

  // Speeds — read from the live variable store, identical to the
  // activity panel so the same Stride card produces the same number
  // in both places.
  const speed = getVariable<VariableNum>('CHARACTER', 'SPEED')?.value ?? 25;
  const flySpeed = getVariable<VariableNum>('CHARACTER', 'SPEED_FLY')?.value ?? 0;
  const climbSpeed = getVariable<VariableNum>('CHARACTER', 'SPEED_CLIMB')?.value ?? 0;
  const burrowSpeed = getVariable<VariableNum>('CHARACTER', 'SPEED_BURROW')?.value ?? 0;
  const swimSpeed = getVariable<VariableNum>('CHARACTER', 'SPEED_SWIM')?.value ?? 0;

  // Attack-trait detection: look up the 'attack' trait id from the
  // cached content store. The hardcoded TraitType enum in @utils/traits
  // doesn't include 'attack', so we name-scan against the cache.
  const traits = getCachedContent<{ id: number; name?: string }>('trait');
  const attackTraitId =
    (traits?.find((t) => t?.name?.toLowerCase() === 'attack')?.id) ?? null;
  const isAttack =
    attackTraitId != null && (action.traits ?? []).includes(attackTraitId);

  // Best Strike MAP ladder from the character's equipped weapons.
  // Same logic as the activity panel uses: max of every equipped
  // weapon's [0] (no-MAP) attack bonus.
  let bestMap: [number, number, number] = [0, -5, -10];
  if (isAttack && character?.inventory) {
    // Handwraps of Mighty Blows aren't a Strike — exclude them and
    // fold their runes into the wearer's unarmed attacks instead.
    const wrapsRunes = getEquippedHandwrapsRunes(character.inventory);
    const equipped = (character.inventory.items ?? [])
      .filter((i) => i.is_equipped && isItemWeapon(i.item) && !isHandwrapsOfMightyBlows(i.item))
      .map((i) => ({ ...i, item: applyHandwrapsToUnarmed(i.item, wrapsRunes) }));
    for (const inv of equipped) {
      const stats = getWeaponStats('CHARACTER', inv.item);
      const arr = (stats.attack_bonus?.total as number[] | undefined) ?? [];
      const a0 = arr[0] ?? 0;
      const a1 = arr[1] ?? a0 - 5;
      const a2 = arr[2] ?? a0 - 10;
      if (a0 > bestMap[0]) bestMap = [a0, a1, a2];
    }
  }

  const SINGLE_MOVE: Record<string, string> = {
    stride: `${speed} ft`,
    step: '5 ft',
    crawl: '5 ft',
    leap: speed >= 30 ? '10 ft' : '5 ft',
    'sudden charge': `${speed * 2} ft`,
    fly: flySpeed > 0 ? `${flySpeed} ft` : '—',
    climb: climbSpeed > 0 ? `${climbSpeed} ft` : '5 ft',
    burrow: burrowSpeed > 0 ? `${burrowSpeed} ft` : '—',
    swim: swimSpeed > 0 ? `${swimSpeed} ft` : '—',
  };
  const MULTI_MOVE: Record<string, { s: string; cs: string }> = {
    'high jump': { s: '3 ft', cs: '5 ft' },
    'long jump': { s: `${Math.max(0, speed - 5)} ft`, cs: `${speed} ft` },
  };

  if (isAttack) {
    return (
      <span className='map'>
        {sign(bestMap[0])}<i>/</i>{sign(bestMap[1])}<i>/</i>{sign(bestMap[2])}
      </span>
    );
  }
  if (nameKey in MULTI_MOVE) {
    const m = MULTI_MOVE[nameKey];
    return (
      <span className='move'>
        {m.s}<i>/</i>{m.cs}
      </span>
    );
  }
  if (nameKey in SINGLE_MOVE && SINGLE_MOVE[nameKey] !== '—') {
    return <span className='move'>{SINGLE_MOVE[nameKey]}</span>;
  }
  if (action.meta_data?.skill) {
    const skillsRaw = Array.isArray(action.meta_data.skill)
      ? action.meta_data.skill
      : [action.meta_data.skill];
    const skillNames = skillsRaw.map((s) => String(s));
    let best: { name: string; varName: string; n: number; str: string } | null = null;
    for (const sk of skillNames) {
      if (!sk) continue;
      const lv = labelToVariable(sk);
      if (lv === 'LORE') continue;
      const varName = `SKILL_${lv}`;
      const str = getFinalProfValue('CHARACTER', varName);
      const n = parseInt(str.replace(/[^\-0-9]/g, ''), 10) || 0;
      if (best === null || n > best.n) best = { name: sk, varName, n, str };
    }
    if (best) {
      return (
        <span className='skill'>
          {best.str}
          <ProfCondMark varName={best.varName} />
          <small> {best.name}</small>
        </span>
      );
    }
  }
  return null;
}

export function ActionGlyph(props: { cost: 1 | 2 | 3 | 'r' | 'f' | string }) {
  // Use the bundled Pathfinder2eActions.ttf font (loaded via index.css
  // as font-family: ActionIcons). The font maps:
  //   '1' → 1-action diamond
  //   '2' → 2-action chevron
  //   '3' → 3-action triple chevron
  //   '4' → free-action outline diamond
  //   '5' → reaction curved arrow
  // These are the canonical PF2e icons used everywhere on Archives of
  // Nethys + the Foundry / Pathbuilder ecosystem.
  const c = props.cost;
  const ch =
    c === 1
      ? '1'
      : c === 2
        ? '2'
        : c === 3
          ? '3'
          : c === 'f'
            ? '4'
            : c === 'r'
              ? '5'
              : null;
  if (ch === null) {
    return <span style={{ color: 'var(--ink-muted)', fontSize: 12 }}>—</span>;
  }
  const color =
    c === 'r' ? 'var(--crimson)' : c === 'f' ? 'var(--wg4-accent)' : 'var(--wg4-accent)';
  return (
    <span
      className='ai'
      style={{
        fontFamily: 'ActionIcons, sans-serif',
        fontSize: 18,
        color,
        lineHeight: 1,
        filter:
          c === 'r'
            ? 'drop-shadow(0 0 3px rgba(168,58,37,.45))'
            : c === 'f'
              ? 'none'
              : 'drop-shadow(0 0 3px color-mix(in srgb, var(--wg4-accent) 35%, transparent))',
      }}
    >
      {ch}
    </span>
  );
}

// Map a textual action cost from data to a glyph identifier.
// Exported so the codex Favorites section in CodexSheet can render
// the same cost glyphs on starred-action cards that the activity
// panel uses on the regular cards.
export function actionCostToGlyph(
  cost: string | null | undefined
): 1 | 2 | 3 | 'r' | 'f' | null {
  if (!cost) return null;
  const c = cost.toUpperCase();
  if (c.includes('ONE-ACTION') || c.includes('ACTION-1') || c === '1') return 1;
  if (c.includes('TWO-ACTIONS') || c.includes('ACTION-2') || c === '2') return 2;
  if (c.includes('THREE-ACTIONS') || c.includes('ACTION-3') || c === '3') return 3;
  if (c.includes('REACTION')) return 'r';
  if (c.includes('FREE')) return 'f';
  return null;
}

// =======================================================================
// CodexSpellsPanel
// =======================================================================

// ─── wg4 spell-section icons ────────────────────────────────────────
// Inlined from wg4/spells.jsx — small mark used to the left of each
// section heading (Compositions / Cantrips / 1st Rank / ...).
function SpComposeIcon() {
  return (
    <svg viewBox='0 0 16 16' width='11' height='11' fill='currentColor'>
      <path d='M8 2 C5 2 3 4 3 7 c0 2 1 4 3 5 l2 2 2-2 c2-1 3-3 3-5 0-3-2-5-5-5z' />
    </svg>
  );
}
function SpStarIcon() {
  return (
    <svg viewBox='0 0 16 16' width='10' height='10' fill='currentColor'>
      <path d='M8 1.2 L9.6 6.4 L14.8 8 L9.6 9.6 L8 14.8 L6.4 9.6 L1.2 8 L6.4 6.4 Z' />
    </svg>
  );
}
function SpDiaIcon() {
  return (
    <svg viewBox='0 0 16 16' width='10' height='10' fill='currentColor'>
      <path d='M8 1 L15 8 L8 15 L1 8 Z' />
    </svg>
  );
}
function SpSearchIcon() {
  return (
    <svg viewBox='0 0 16 16' fill='none' stroke='currentColor' strokeWidth='1.5' strokeLinecap='round'>
      <circle cx='7' cy='7' r='4.5' />
      <line x1='10.3' y1='10.3' x2='13.5' y2='13.5' />
    </svg>
  );
}

// ─── wg4 SpSectionHead ──────────────────────────────────────────────
// Header strip above each grid of spell cards. Left side is an icon +
// label (Compositions / Cantrips / 1st Rank / ...); right side is a
// slot indicator (SLOTS + diamond pips), focus indicator (FOCUS n / m
// + pips), or a free-form count string ("ALWAYS AVAILABLE · N").
//
// Optionally wired up as a collapsible toggle: pass `onToggle` and the
// whole header becomes clickable (caller is expected to wrap children
// in `<div className="sp-sec [+ collapsed]">` so the CSS hides the
// matching sp-grid / sp-empty-line). The chevron rotates via CSS.
function SpSectionHead(props: {
  icon?: React.ReactNode;
  label: string;
  right?: React.ReactNode;
  onToggle?: () => void;
}) {
  return (
    <div className='sp-section-head' onClick={props.onToggle}>
      <div className='label'>
        {props.icon && <span className='ico'>{props.icon}</span>}
        <span>{props.label}</span>
        {props.onToggle && <span className='sec-chevron'>▾</span>}
      </div>
      <div className='meta' onClick={(e) => e.stopPropagation()}>{props.right}</div>
    </div>
  );
}

// ─── wg4 SlotIndicator / FocusIndicator ─────────────────────────────
// Two flavors of the diamond-pip cluster on the right of section
// headings.  Slot pips fill left-to-right with used slots; focus pips
// fill with the player's current focus points.
function SpSlotIndicator(props: {
  total: number;
  used: number;
  muted?: boolean;
  onSetAvailable?: (n: number) => void;
}) {
  if (props.total <= 0) return null;
  // A filled pip = an AVAILABLE (unspent) slot — matching the focus
  // indicator below, so after a Rest (used=0) every slot reads as full.
  // (Previously filled meant "used", which made a freshly-rested caster's
  // full slots look empty.) Pips are clickable to spend/restore slots.
  const available = Math.max(0, props.total - props.used);
  return (
    <>
      <span className='nums'>SLOTS</span>
      <span className='pips'>
        {Array.from({ length: props.total }, (_, i) => (
          <span
            key={i}
            className={`dia-pip${props.muted ? ' muted' : ''}${i < available ? ' on' : ''}`}
            style={props.onSetAvailable ? { cursor: 'pointer' } : undefined}
            title={
              props.onSetAvailable ? (i < available ? 'Spend this slot' : 'Restore this slot') : undefined
            }
            onClick={
              props.onSetAvailable
                ? (e) => {
                    e.stopPropagation();
                    // Click pip i → make (i+1) slots available; click the
                    // last filled one again to drop to i (toggle off).
                    props.onSetAvailable!(i + 1 === available ? i : i + 1);
                  }
                : undefined
            }
          />
        ))}
      </span>
    </>
  );
}
function SpFocusIndicator(props: {
  current: number;
  max: number;
  onAdjust: (n: number) => void;
}) {
  if (props.max <= 0) return null;
  return (
    <>
      <span className='nums'>
        FOCUS <b>{props.current}</b> / {props.max}
      </span>
      <span className='pips'>
        {Array.from({ length: props.max }, (_, i) => (
          <span
            key={i}
            className={`dia-pip${i < props.current ? ' on' : ''}`}
            onClick={(e) => {
              e.stopPropagation();
              props.onAdjust(i + 1 === props.current ? i : i + 1);
            }}
          />
        ))}
      </span>
    </>
  );
}

// ─── wg4 SpellCard ──────────────────────────────────────────────────
// One spell row in the .sp-grid. Action-glyph cell on the left,
// name/sub stack in the middle, area/save meta on the right. The
// `exhausted` modifier strikes through the name + greys the row.
// Right-click options (signature / replace) are wired to the
// optional callbacks; pure-vanilla rows do nothing on right click.
function SpellCard(props: {
  spell: Spell;
  exhausted?: boolean;
  signature?: boolean;
  metaOverride?: string | null;
  onClick: () => void;
  onToggleSignature?: () => void;
  onReplace?: () => void;
  onCast?: (cast: boolean) => void;
}) {
  const { spell, exhausted } = props;
  const castStr =
    typeof spell.cast === 'string' ? spell.cast : (spell.cast as unknown as string | null) ?? null;
  const glyph = actionCostToGlyph(castStr);

  // Right-click context menu (signature toggle / replace spell).
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null);
  const ctxRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!ctxMenu) return;
    const onDown = (e: MouseEvent) => {
      if (ctxRef.current && !ctxRef.current.contains(e.target as Node)) setCtxMenu(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setCtxMenu(null);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [ctxMenu]);
  const hasCtxMenu = !!(props.onToggleSignature || props.onReplace);

  // Subtitle: trait names joined by " · ". Falls back to rank +
  // duration if the spell has no traits (some homebrew + ritual data).
  const traitCache = getCachedContent<{ id: number; name?: string }>('trait') ?? [];
  const traitMap = new Map(traitCache.map((t) => [t.id, t.name?.toLowerCase() ?? '']));
  const traitNames = (spell.traits ?? [])
    .map((id) => traitMap.get(id))
    .filter((n): n is string => !!n);
  let sub: string;
  if (traitNames.length > 0) sub = traitNames.join(' · ');
  else {
    const parts: string[] = [];
    if (spell.rank > 0) parts.push(`rank ${spell.rank}`);
    if (spell.duration) parts.push(spell.duration);
    sub = parts.join(' · ');
  }

  // Meta: caller-supplied override (e.g. "2/3 CASTS" for innate) wins;
  // otherwise area or range from the spell data.
  const meta = props.metaOverride ?? spell.area ?? spell.range ?? '';
  return (
    <>
      <div
        className={`sp-card${props.signature ? ' fav' : ''}${exhausted ? ' exhausted' : ''}`}
        onClick={props.onClick}
        onContextMenu={(e) => {
          if (!hasCtxMenu) return;
          e.preventDefault();
          e.stopPropagation();
          setCtxMenu({ x: e.clientX, y: e.clientY });
        }}
        title={hasCtxMenu ? 'Right-click for spell options' : undefined}
      >
        <span className='ag-cell'>
          {glyph != null ? <ActionGlyph cost={glyph} /> : <span className='dash'>—</span>}
        </span>
        <div className='info'>
          <div className='name'>
            {props.signature && <span className='star'>★</span>}
            {spell.name}
          </div>
          {sub && <div className='sub'>{sub}</div>}
        </div>
        <div className='meta'>
          {meta ? (meta === '—' ? <span className='dash'>—</span> : <span>{meta}</span>) : null}
          {spell.defense && <span className='save'>{spell.defense}</span>}
          {/* Optional inline cast/restore for prepared casters.  Stops
              propagation so the click doesn't also open the drawer. */}
          {props.onCast && (
            <button
              type='button'
              className={`sp-act${exhausted ? ' restore' : ''}`}
              onClick={(e) => {
                e.stopPropagation();
                props.onCast!(!exhausted);
              }}
              title={exhausted ? 'Mark this slot as available again' : 'Mark this slot as cast (use)'}
              style={{
                marginLeft: 8,
                padding: '2px 8px',
                border: '1px solid var(--border)',
                borderRadius: 'var(--r-1)',
                background: 'var(--surface)',
                color: 'var(--ink-2)',
                fontSize: '10px',
                letterSpacing: '0.12em',
                textTransform: 'uppercase',
                cursor: 'pointer',
              }}
            >
              {exhausted ? 'Restore' : 'Use'}
            </button>
          )}
        </div>
      </div>

      {ctxMenu &&
        createPortal(
          <div
            ref={ctxRef}
            role='menu'
            onClick={(e) => e.stopPropagation()}
            onContextMenu={(e) => e.preventDefault()}
            style={{
              position: 'fixed',
              left: ctxMenu.x,
              top: ctxMenu.y,
              minWidth: 200,
              background: 'var(--bg-card)',
              border: '1px solid var(--rule-soft)',
              boxShadow: '0 8px 24px rgba(0,0,0,.35)',
              padding: '4px 0',
              zIndex: 10000,
              color: 'var(--ink)',
            }}
          >
            {props.onToggleSignature && (
              <button
                type='button'
                onClick={() => {
                  props.onToggleSignature!();
                  setCtxMenu(null);
                }}
                style={ctxSpellItemStyle}
              >
                {props.signature ? 'Remove signature' : 'Make signature spell'}
              </button>
            )}
            {props.onReplace && (
              <button
                type='button'
                onClick={() => {
                  props.onReplace!();
                  setCtxMenu(null);
                }}
                style={ctxSpellItemStyle}
              >
                Replace spell
              </button>
            )}
          </div>,
          document.body
        )}
    </>
  );
}

// Native-button styling for the spell-card right-click menu.
const ctxSpellItemStyle = {
  display: 'block',
  width: '100%',
  textAlign: 'left',
  padding: '8px 14px',
  background: 'transparent',
  border: 'none',
  color: 'inherit',
  font: 'inherit',
  cursor: 'pointer',
} as const;

// ─── wg4 AddCard ────────────────────────────────────────────────────
// Dashed-border placeholder card sized to match a .sp-card. Used as
// the trailing "+ Add 1st-Rank Spell" tile in spontaneous repertoires
// and the per-slot "+ Prepare 1st-Rank Spell" tile in prepared lists.
function SpellAddCard(props: { label: string; onClick: () => void }) {
  return (
    <button
      type='button'
      className='sp-card add'
      onClick={(e) => {
        e.stopPropagation();
        props.onClick();
      }}
    >
      <span className='plus'>+</span>
      <span>{props.label}</span>
    </button>
  );
}

export function CodexSpellsPanel(props: {
  characterId: number;
  character: Character | null;
  setCharacter: SetterOrUpdater<Character | null>;
  content: ContentPackage;
}) {
  const { character, content } = props;
  const [_drawer, openDrawer] = useAtom(drawerState);
  const [searchQuery, setSearchQuery] = useState('');
  // Collapsible spell-rank section state — every SpSectionHead below is
  // toggled via this hook, keyed by a stable per-rank / per-source ID.
  const { isCollapsed, toggle: toggleCollapsed } = useCollapsedSections();
  // Action-cost filter pill state (mirrors wg4/spells.jsx).
  // null = "all", '1'/'2'/'3' = N-action, 'f' = free, 'r' = reaction.
  const [actionFilter, setActionFilter] = useState<null | '1' | '2' | '3' | 'f' | 'r'>(null);
  // ManageSpellsModal state — opens when the user clicks the codex
  // "Manage" button on a tradition. Mirrors what the legacy
  // SpellsPanel does internally via setManageSpells().
  const [manageSpells, setManageSpells] = useState<
    | undefined
    | {
        source: string;
        type: 'SLOTS-ONLY' | 'SLOTS-AND-LIST' | 'LIST-ONLY';
        filter?: { traditions?: string[]; rank_min?: number; rank_max?: number };
      }
  >(undefined);

  const charData = useMemo(
    () => (character ? collectEntitySpellcasting('CHARACTER', character) : null),
    [character]
  );

  // Sources represent the casting "books" the character has — bard's
  // occult spontaneous, sorcerer bloodline, etc. Each has its own
  // tradition / attribute / rank slots. The codex design shows them
  // sequentially, one section per rank within each source.
  const sources = charData?.sources ?? [];

  // Look up a spell by ID from the content package (the global lookup).
  const findSpell = (id: number): Spell | undefined =>
    content.spells?.find((s) => s.id === id);

  // Filter spells against the search query (case-insensitive name match).
  const matchesSearch = (spell: Spell | undefined) => {
    // When no search is active, INCLUDE empty cells so the prepared
    // caster's "Prepare X-Rank Spell" buttons render. Earlier this
    // returned `false` for empty cells unconditionally, which silently
    // hid every empty slot — the user saw only filled prepared
    // spells and no add-spell buttons at all. When the user IS
    // searching, hide empties (they can't match a query anyway).
    if (!searchQuery.trim()) return true;
    if (!spell) return false;
    return spell.name?.toLowerCase().includes(searchQuery.trim().toLowerCase());
  };

  // Focus pool (focus spells / compositions) — current vs max.
  // Use the REAL accessible focus pool — the same calc Rest uses
  // (getFocusPoints): focus cantrips don't count, FOCUS_POINT_BONUS feats add
  // extra, capped at 3. This shows the pool the character actually has (1/2/3)
  // instead of a raw focus-spell count, and keeps the tracker consistent with
  // what a Rest refills to.
  const focusMax =
    character && charData ? getFocusPoints('CHARACTER', character, charData.focus).max : 0;
  // Clamp the saved current to the real max so an older save that stored a
  // higher value (e.g. 3 when the pool is really 2) never shows "3 / 2".
  const focusCurrent = Math.min(focusMax, character?.spells?.focus_point_current ?? 0);

  const setFocusPoints = (next: number) => {
    const clamped = Math.max(0, Math.min(focusMax, next));
    props.setCharacter((c) =>
      c
        ? {
            ...c,
            spells: {
              ...(c.spells ?? {
                slots: [],
                list: [],
                focus_point_current: 0,
                innate_casts: [],
              }),
              focus_point_current: clamped,
            },
          }
        : c
    );
  };

  // Apply the signature toggle directly — no confirmation, no
  // questions. Called from the confirmation handler below; do NOT
  // call this directly from a right-click menu item, since the user
  // has explicitly asked for a confirm step before signature spells
  // toggle on/off (it's too easy to fat-finger on a small spell row).
  const applySignatureToggle = (spellId: number, sourceName: string) => {
    props.setCharacter((c) => {
      if (!c) return c;
      const list = c.spells?.list ?? [];
      const entryIdx = list.findIndex(
        (e) => e.spell_id === spellId && e.source === sourceName
      );
      if (entryIdx === -1) return c;
      const isCurrentlySignature = !!list[entryIdx].signature;
      const rank = list[entryIdx].rank;
      const turningOn = !isCurrentlySignature;
      const newList = list.map((e, i) => {
        if (i === entryIdx) return { ...e, signature: turningOn };
        // 1-per-rank enforcement.
        if (turningOn && e.source === sourceName && e.rank === rank && e.signature) {
          return { ...e, signature: false };
        }
        return e;
      });
      return {
        ...c,
        spells: {
          ...(c.spells ?? { slots: [], list: [], focus_point_current: 0, innate_casts: [] }),
          list: newList,
        },
      };
    });
  };

  // Confirmed signature toggle. Opens a Mantine confirm modal that
  // names the spell + explains the consequence (clearing any other
  // signature at the same rank). User has to click Confirm before
  // the toggle applies. Both ON and OFF directions are confirmed so
  // accidental right-clicks can't strip a signature either.
  const toggleSignature = (spell: Spell, sourceName: string) => {
    const list = props.character?.spells?.list ?? [];
    const entry = list.find((e) => e.spell_id === spell.id && e.source === sourceName);
    if (!entry) return;
    const turningOn = !entry.signature;
    const otherAtSameRank = turningOn
      ? list.find(
          (e) =>
            e.source === sourceName &&
            e.rank === entry.rank &&
            e.signature &&
            e.spell_id !== spell.id
        )
      : undefined;
    const otherName = otherAtSameRank
      ? props.content.spells?.find((s) => s.id === otherAtSameRank.spell_id)?.name ?? null
      : null;
    modals.openConfirmModal({
      title: (
        <Title order={4}>
          {turningOn ? 'Make Signature Spell?' : 'Remove Signature Status?'}
        </Title>
      ),
      children: turningOn ? (
        <Stack gap={6}>
          <Text size='sm'>
            Mark <b>{spell.name}</b> as your signature spell at rank {entry.rank}? Signature spells automatically
            heighten to any rank-{entry.rank}-or-higher slot you cast them from.
          </Text>
          {otherName && (
            <Text size='xs' c='dimmed'>
              This will replace your current rank-{entry.rank} signature spell, <b>{otherName}</b>.
            </Text>
          )}
        </Stack>
      ) : (
        <Text size='sm'>
          Remove <b>{spell.name}</b> as your signature spell? It will no longer auto-heighten in higher slots.
        </Text>
      ),
      labels: {
        confirm: turningOn ? 'Make signature' : 'Remove signature',
        cancel: 'Cancel',
      },
      onConfirm: () => applySignatureToggle(spell.id, sourceName),
    });
  };

  // Assign a specific spell to a specific prepared slot. The picker
  // is opened inline via selectContent (no manage-modal round trip)
  // and constrained to the relevant tradition / rank cap so the
  // player only sees spells that can actually go in this slot.
  //
  // PREPARED-LIST (wizard) — picker shows only spells already in the
  // character's spellbook (`c.spells.list` entries with rank ≤ slot).
  // PREPARED-TRADITION (cleric/druid) — picker shows the full
  // tradition at rank ≤ slot. PF2e allows heightening lower-rank
  // spells up into higher slots, but never lower → so rank_max is
  // the slot rank and rank_min is 0.
  const pickSpellForSlot = (
    sourceObj: { name: string; type?: string; tradition?: string },
    slotId: string,
    slotRank: number
  ) => {
    const tradition = sourceObj.tradition?.toLowerCase();
    const isSpellbookCaster = sourceObj.type === 'PREPARED-LIST';
    const knownSpellIds = new Set(
      (character?.spells?.list ?? [])
        .filter((e) => e.source === sourceObj.name)
        .map((e) => e.spell_id)
    );
    // Cantrip-dedupe set — spell ids already prepared in another
    // cantrip slot at this source. PF2e: there's no value in
    // preparing the same cantrip twice (cantrips are at-will), so
    // we hide already-picked cantrips from the picker. Only applies
    // to rank-0 slots; higher ranks can legitimately have the same
    // spell prepared in multiple slots (Magic Missile, Heal, etc.).
    const alreadyPreparedCantripIds = new Set(
      (character?.spells?.slots ?? [])
        .filter(
          (s) =>
            s.source === sourceObj.name &&
            s.rank === 0 &&
            s.spell_id != null
        )
        .map((s) => s.spell_id as number)
    );
    selectContent<Spell>(
      'spell',
      (option) => {
        // Assign the picked spell into this exact slot. We rebuild
        // the slot list via collectEntitySpellcasting (matching
        // SlotsSection's pattern) so the runtime slot ids align —
        // they're derived, not stored, and the character schema
        // doesn't carry them between renders.
        props.setCharacter((c) => {
          if (!c) return c;
          const slots = collectEntitySpellcasting('CHARACTER', c as LivingEntity).slots.map((s) =>
            s.id === slotId ? { ...s, spell_id: option.id, exhausted: false } : s
          );
          return {
            ...c,
            spells: {
              ...(c.spells ?? { slots: [], list: [], focus_point_current: 0, innate_casts: [] }),
              slots,
            },
          };
        });
      },
      {
        overrideLabel: 'Prepare Spell',
        zIndex: 1100,
        // Cantrips only for rank-0 slots; rank ≤ slotRank for the
        // rest (heighten-up allowed, heighten-down implicitly blocked
        // because cantrips and rank ≥ 1 are mutually exclusive
        // checks).
        filterFn: (sRec: Record<string, unknown>) => {
          const s = sRec as Spell;
          if (!isNormalSpell(s)) return false;
          if (slotRank === 0) {
            // Cantrip slot: must be a cantrip, AND must not be
            // already prepared in another cantrip slot at this
            // source (no duplicates).
            if (!isCantrip(s)) return false;
            if (alreadyPreparedCantripIds.has(s.id)) return false;
            // Wizards: also restrict to known cantrips (spellbook).
            if (isSpellbookCaster && !knownSpellIds.has(s.id)) return false;
            return true;
          }
          if (isCantrip(s)) return false;
          if (s.rank > slotRank) return false;
          // Wizard-style casters: restrict to spells already in
          // their spellbook for this source.
          if (isSpellbookCaster && !knownSpellIds.has(s.id)) return false;
          return true;
        },
        advancedPresetFilters: isSpellbookCaster
          ? undefined
          : {
              type: 'spell',
              spell_type: 'NORMAL',
              traditions: tradition ? [tradition] : undefined,
              rank_min: 0,
              rank_max: slotRank,
            },
      }
    );
  };

  // Add a spell to a spontaneous caster's repertoire (known-spells
  // list). Mirrors pickSpellForSlot but writes to `c.spells.list`
  // instead of slot.spell_id — spontaneous casters don't prepare
  // specific slots, they learn N spells per rank and any can be
  // cast into any unexhausted slot at that rank.
  const pickSpellForRepertoire = (
    sourceObj: { name: string; type?: string; tradition?: string },
    rank: number
  ) => {
    const knownIdsAtRank = new Set(
      (character?.spells?.list ?? [])
        .filter((e) => e.source === sourceObj.name && e.rank === rank)
        .map((e) => e.spell_id)
    );
    // Per user request — the "+ Add Cantrip" / "+ Add N-th-Rank Spell"
    // buttons should only show spells already added to the character
    // via the Manage Spells modal (i.e. anything currently in
    // character.spells.list, regardless of source/rank). We resolve
    // each list entry to its full Spell object from the content cache
    // and pass the curated set via `overrideOptions`, which bypasses
    // SelectContent's full-library query. Dedupe by spell_id so a
    // spell present at multiple ranks/sources only appears once.
    const managerSpellIds = Array.from(
      new Set((character?.spells?.list ?? []).map((e) => e.spell_id))
    );
    const allSpells = getCachedContent<Spell>('spell');
    const byId = new Map(allSpells.map((s) => [s.id, s]));
    const managerSpells = managerSpellIds
      .map((id) => byId.get(id))
      .filter((s): s is Spell => Boolean(s));

    selectContent<Spell>(
      'spell',
      (option) => {
        props.setCharacter((c) => {
          if (!c) return c;
          // Already in repertoire at this rank? No-op (the picker
          // shouldn't have shown it, but defensive).
          if (
            (c.spells?.list ?? []).some(
              (e) => e.spell_id === option.id && e.source === sourceObj.name && e.rank === rank
            )
          )
            return c;
          return {
            ...c,
            spells: {
              ...(c.spells ?? { slots: [], list: [], focus_point_current: 0, innate_casts: [] }),
              list: [
                ...(c.spells?.list ?? []),
                { spell_id: option.id, rank, source: sourceObj.name },
              ],
            },
          };
        });
      },
      {
        overrideLabel: rank === 0 ? 'Add Cantrip' : 'Add to Repertoire',
        zIndex: 1100,
        overrideOptions: managerSpells as unknown as Record<string, any>[],
        filterFn: (sRec: Record<string, unknown>) => {
          const s = sRec as Spell;
          if (!isNormalSpell(s)) return false;
          if (rank === 0) return isCantrip(s);
          if (isCantrip(s)) return false;
          if (s.rank > rank) return false;
          // Don't show spells already in the repertoire at this rank.
          if (knownIdsAtRank.has(s.id)) return false;
          return true;
        },
      }
    );
  };

  // Exhaust / refill a spell slot. Used as the onCastSpell callback
  // for spell-row clicks. For spontaneous casters we find the first
  // unexhausted slot at the spell's rank (or refill the first
  // exhausted one). For prepared casters we match by spell_id.
  const castSpell = (cast: boolean, sourceName: string, spellRank: number, spellId: number, isPreparedSrc: boolean) => {
    props.setCharacter((c) => {
      if (!c) return c;
      const allSlots = (c.spells?.slots ?? []).map((s) => ({ ...s }));
      if (isPreparedSrc) {
        const target = allSlots.find(
          (s) => s.source === sourceName && s.spell_id === spellId && !!s.exhausted !== cast
        );
        if (target) target.exhausted = cast;
      } else {
        const target = allSlots.find(
          (s) => s.source === sourceName && s.rank === spellRank && !!s.exhausted !== cast
        );
        if (target) target.exhausted = cast;
      }
      return {
        ...c,
        spells: {
          ...(c.spells ?? { slots: [], list: [], focus_point_current: 0, innate_casts: [] }),
          slots: allSlots,
        },
      };
    });
  };

  // Action-cost filter (A/1/2/3/F/R pills in the toolbar).  Same shape
  // as wg4/spells.jsx — `null` = "all", '1'/'2'/'3' = N-action,
  // 'f' = free, 'r' = reaction.
  const matchAction = (spell: Spell | undefined): boolean => {
    if (!actionFilter) return true;
    if (!spell) return false;
    const glyph = actionCostToGlyph(
      typeof spell.cast === 'string' ? spell.cast : (spell.cast as unknown as string | null)
    );
    if (actionFilter === 'r') return glyph === 'r';
    if (actionFilter === 'f') return glyph === 'f';
    return glyph === parseInt(actionFilter, 10);
  };
  const passesFilters = (spell: Spell | undefined) => matchesSearch(spell) && matchAction(spell);

  // ─── Innate spells (one block at the bottom) ───────────────────────
  const innate = (charData?.innate ?? []).filter(Boolean);
  const innateByTrad = new Map<string, typeof innate>();
  for (const i of innate) {
    if (!innateByTrad.has(i.tradition)) innateByTrad.set(i.tradition, []);
    innateByTrad.get(i.tradition)!.push(i);
  }

  return (
    <div className='codex-tab-body spells-stack'>
      {sources.length === 0 && innate.length === 0 && (
        <div
          style={{
            padding: 40,
            color: 'var(--ink-muted)',
            fontStyle: 'italic',
            textAlign: 'center',
            fontFamily: "'Cormorant Garamond', serif",
          }}
        >
          This character has no spellcasting.
        </div>
      )}

      {sources.map((source) => {
        const tradition = source.tradition || '—';
        const castTypeRaw = source.type?.replace(/-/g, ' ').toLowerCase() ?? '—';
        const castType = castTypeRaw.replace(/\b\w/g, (c) => c.toUpperCase());
        const attrName = source.attribute?.replace('ATTRIBUTE_', '') ?? '';
        const attrV = source.attribute
          ? getVariable<{ value: { value: number } }>('CHARACTER', source.attribute)?.value?.value ?? 0
          : 0;
        const spellAttack = source.name
          ? getFinalProfValue('CHARACTER', `SPELL_ATTACK_${source.name.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`)
          : null;
        const spellDc = source.name
          ? getFinalProfValue('CHARACTER', `SPELL_DC_${source.name.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`, true)
          : null;

        // Slots for this source, grouped by rank.
        const slots = (charData?.slots ?? []).filter((s) => s.source === source.name);
        const slotsByRank = new Map<number, typeof slots>();
        for (const slot of slots) {
          if (!slotsByRank.has(slot.rank)) slotsByRank.set(slot.rank, []);
          slotsByRank.get(slot.rank)!.push(slot);
        }

        // Spell list for this source, grouped by rank.
        const repList = (charData?.list ?? []).filter((e) => e.source === source.name);
        const listByRank = new Map<number, typeof repList>();
        for (const entry of repList) {
          if (!listByRank.has(entry.rank)) listByRank.set(entry.rank, []);
          listByRank.get(entry.rank)!.push(entry);
        }

        // Compositions / focus spells.
        const focusSpells = (charData?.focus ?? [])
          .filter((f) => f.source === source.name)
          .map((f) => findSpell(f.spell_id))
          .filter((s): s is Spell => !!s);

        // Cantrips (rank 0).
        const isPreparedSrc = source.type?.startsWith('PREPARED');
        const isSpontaneousSrc = source.type === 'SPONTANEOUS-REPERTOIRE';

        // For cantrips on prepared casters, slots-with-spell-id is the
        // canonical list. For spontaneous, repertoire entries at rank 0.
        const cantripCells: {
          spell: Spell | undefined;
          slotIdx: number | null;
          exhausted: boolean;
          signature: boolean;
        }[] = [];
        if (isPreparedSrc) {
          (slotsByRank.get(0) ?? []).forEach((slot, i) => {
            cantripCells.push({
              spell: slot.spell_id ? findSpell(slot.spell_id) : undefined,
              slotIdx: i,
              exhausted: !!slot.exhausted,
              signature: false,
            });
          });
        } else {
          (listByRank.get(0) ?? []).forEach((entry) => {
            cantripCells.push({
              spell: findSpell(entry.spell_id),
              slotIdx: null,
              exhausted: false,
              signature: !!entry.signature,
            });
          });
        }

        // Per-rank sections — show every rank 1..maxRank discovered
        // across slots + list. Empty ranks still render so the slot
        // ladder reads complete (wg4 design).
        const slotRanks = Array.from(slotsByRank.keys()).filter((r) => r > 0);
        const listRanks = Array.from(listByRank.keys()).filter((r) => r > 0);
        const maxRank = Math.max(0, ...slotRanks, ...listRanks);
        const rankRange: number[] = [];
        for (let r = 1; r <= maxRank; r++) rankRange.push(r);

        return (
          <div key={source.name} className='spells-stack' style={{ gap: 14 }}>
            {/* Tradition banner — OCCULT TRADITION · Spontaneous · CHA +0 · Atk +12 · DC 22 */}
            <div className='sp-tradition'>
              <span className='name'>
                <em>{tradition.toUpperCase()}</em> Tradition
              </span>
              <span className='sep'>·</span>
              <span className='type'>{castType}</span>
              {attrName && (
                <>
                  <span className='sep'>·</span>
                  <span className='stat'>
                    {attrName} <b>{attrV >= 0 ? '+' : ''}{attrV}</b>
                  </span>
                </>
              )}
              {spellAttack && (
                <>
                  <span className='sep'>·</span>
                  <span className='stat'>
                    Atk <b>
                      {spellAttack}
                      <ProfCondMark
                        varName={`SPELL_ATTACK_${source.name!.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`}
                      />
                    </b>
                  </span>
                </>
              )}
              {spellDc && (
                <>
                  <span className='sep'>·</span>
                  <span className='stat'>
                    DC <b>
                      {spellDc}
                      <ProfCondMark
                        varName={`SPELL_DC_${source.name!.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`}
                      />
                    </b>
                  </span>
                </>
              )}
            </div>

            {/* Toolbar — search + action-cost filter pills + Manage */}
            <div className='sp-toolbar'>
              <div className='search-strip'>
                <span className='icon'><SpSearchIcon /></span>
                <input
                  type='text'
                  placeholder='Search spells…'
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
                {/* Action-cost filter pills. No explicit "All" button —
                    clicking the currently-active filter clears it
                    (toggles back to "show everything"). */}
                <div className='filter-pills'>
                  <button
                    type='button'
                    className={`filter-pill${actionFilter === '1' ? ' on' : ''}`}
                    title='1-action'
                    onClick={() => setActionFilter(actionFilter === '1' ? null : '1')}
                  >
                    <ActionGlyph cost={1} />
                  </button>
                  <button
                    type='button'
                    className={`filter-pill${actionFilter === '2' ? ' on' : ''}`}
                    title='2-action'
                    onClick={() => setActionFilter(actionFilter === '2' ? null : '2')}
                  >
                    <ActionGlyph cost={2} />
                  </button>
                  <button
                    type='button'
                    className={`filter-pill${actionFilter === '3' ? ' on' : ''}`}
                    title='3-action'
                    onClick={() => setActionFilter(actionFilter === '3' ? null : '3')}
                  >
                    <ActionGlyph cost={3} />
                  </button>
                  <button
                    type='button'
                    className={`filter-pill${actionFilter === 'f' ? ' on' : ''}`}
                    title='Free action'
                    onClick={() => setActionFilter(actionFilter === 'f' ? null : 'f')}
                  >
                    <ActionGlyph cost={'f'} />
                  </button>
                  <button
                    type='button'
                    className={`filter-pill${actionFilter === 'r' ? ' on' : ''}`}
                    title='Reaction'
                    onClick={() => setActionFilter(actionFilter === 'r' ? null : 'r')}
                  >
                    <ActionGlyph cost={'r'} />
                  </button>
                </div>
              </div>
              <button
                type='button'
                className='manage-big'
                onClick={() => {
                  const t =
                    source.type === 'PREPARED-LIST'
                      ? 'SLOTS-AND-LIST'
                      : source.type === 'PREPARED-TRADITION'
                        ? 'SLOTS-ONLY'
                        : 'LIST-ONLY';
                  setManageSpells({
                    source: source.name,
                    type: t,
                    filter: { traditions: [source.tradition?.toLowerCase()].filter(Boolean) as string[] },
                  });
                }}
              >
                Manage
              </button>
            </div>

            {/* Compositions / focus spells */}
            {focusSpells.length > 0 && (() => {
              const compId = `spells-${source.name}-compositions`;
              return (
              <div className={`sp-sec${isCollapsed(compId) ? ' collapsed' : ''}`}>
                <SpSectionHead
                  icon={<SpComposeIcon />}
                  label='Compositions'
                  right={
                    <SpFocusIndicator
                      current={focusCurrent}
                      max={focusMax}
                      onAdjust={setFocusPoints}
                    />
                  }
                  onToggle={() => toggleCollapsed(compId)}
                />
                {(() => {
                  const filtered = focusSpells.filter(passesFilters);
                  if (filtered.length === 0)
                    return <div className='sp-empty-line'>No compositions match the filter.</div>;
                  return (
                    <div className='sp-grid'>
                      {filtered.map((spell) => (
                        <SpellCard
                          key={spell.id}
                          spell={spell}
                          exhausted={focusCurrent <= 0}
                          onClick={() =>
                            openDrawer({
                              type: 'cast-spell',
                              data: {
                                id: spell.id,
                                spell,
                                exhausted: false,
                                tradition: source.tradition,
                                attribute: source.attribute,
                                storeId: 'CHARACTER',
                                entity: character,
                                // Focus spells burn a focus point.
                                onCastSpell: (cast: boolean) =>
                                  setFocusPoints(focusCurrent + (cast ? -1 : 1)),
                              },
                              extra: { addToHistory: true },
                            })
                          }
                        />
                      ))}
                    </div>
                  );
                })()}
              </div>
              );
            })()}

            {/* Cantrips — always render */}
            {(() => {
              const cantripId = `spells-${source.name}-cantrips`;
              return (
              <div className={`sp-sec${isCollapsed(cantripId) ? ' collapsed' : ''}`}>
                <SpSectionHead
                  icon={<SpStarIcon />}
                  label='Cantrips'
                  right={
                    <span className='nums'>
                      ALWAYS AVAILABLE · <b>{cantripCells.filter((c) => !!c.spell).length}</b>
                    </span>
                  }
                  onToggle={() => toggleCollapsed(cantripId)}
                />
              {(() => {
                const filtered = cantripCells.filter((c) => passesFilters(c.spell));
                if (cantripCells.length === 0)
                  return <div className='sp-empty-line'>No cantrips known.</div>;
                if (filtered.length === 0)
                  return <div className='sp-empty-line'>No cantrips match the filter.</div>;
                return (
                  <div className='sp-grid'>
                    {filtered.map((cell, i) => {
                      if (!cell.spell) {
                        return (
                          <SpellAddCard
                            key={`empty-${i}`}
                            label='Prepare Cantrip'
                            onClick={() => {
                              if (!isPreparedSrc || cell.slotIdx === null) return;
                              const slot = (slotsByRank.get(0) ?? [])[cell.slotIdx];
                              if (slot)
                                pickSpellForSlot(
                                  { name: source.name, type: source.type, tradition: source.tradition },
                                  slot.id,
                                  0
                                );
                            }}
                          />
                        );
                      }
                      const spellId = cell.spell.id;
                      return (
                        <SpellCard
                          key={`c-${i}`}
                          spell={cell.spell}
                          exhausted={cell.exhausted}
                          signature={cell.signature}
                          onReplace={
                            isPreparedSrc && cell.slotIdx !== null
                              ? () => {
                                  const slot = (slotsByRank.get(0) ?? [])[cell.slotIdx!];
                                  if (slot)
                                    pickSpellForSlot(
                                      { name: source.name, type: source.type, tradition: source.tradition },
                                      slot.id,
                                      0
                                    );
                                }
                              : undefined
                          }
                          onClick={() =>
                            openDrawer({
                              type: 'cast-spell',
                              data: {
                                id: spellId,
                                spell: cell.spell,
                                exhausted: cell.exhausted,
                                tradition: source.tradition,
                                attribute: source.attribute,
                                storeId: 'CHARACTER',
                                entity: character,
                                onCastSpell: (cast: boolean) =>
                                  castSpell(cast, source.name, 0, spellId, !!isPreparedSrc),
                              },
                              extra: { addToHistory: true },
                            })
                          }
                        />
                      );
                    })}
                    {/* Spontaneous casters: trailing "+ Add Cantrip" tile. */}
                    {isSpontaneousSrc && (
                      <SpellAddCard
                        label='Add Cantrip'
                        onClick={() =>
                          pickSpellForRepertoire(
                            { name: source.name, type: source.type, tradition: source.tradition },
                            0
                          )
                        }
                      />
                    )}
                  </div>
                );
              })()}
              </div>
              );
            })()}

            {/* Per-rank sections — 1 through maxRank, always rendered. */}
            {rankRange.map((rank) => {
              const rankSlots = slotsByRank.get(rank) ?? [];
              const rankList = listByRank.get(rank) ?? [];
              const cells: {
                spell: Spell | undefined;
                slotIdx: number | null;
                exhausted: boolean;
                signature: boolean;
              }[] = [];
              if (isPreparedSrc) {
                rankSlots.forEach((slot, i) => {
                  cells.push({
                    spell: slot.spell_id ? findSpell(slot.spell_id) : undefined,
                    slotIdx: i,
                    exhausted: !!slot.exhausted,
                    signature: false,
                  });
                });
              } else {
                rankList.forEach((entry) => {
                  cells.push({
                    spell: findSpell(entry.spell_id),
                    slotIdx: null,
                    exhausted: false,
                    signature: !!entry.signature,
                  });
                });
              }

              const totalSlots = rankSlots.length;
              const usedSlots = rankSlots.filter((s) => !!s.exhausted).length;
              const remaining = totalSlots - usedSlots;
              const isEmpty = cells.length === 0;
              const filtered = cells.filter((c) => passesFilters(c.spell));

              const ordinal = `${rank}${rank === 1 ? 'st' : rank === 2 ? 'nd' : rank === 3 ? 'rd' : 'th'}-Rank Spell`;
              const rankId = `spells-${source.name}-rank-${rank}`;

              return (
                <div key={rank} className={`sp-sec${isCollapsed(rankId) ? ' collapsed' : ''}`}>
                  <SpSectionHead
                    icon={<SpDiaIcon />}
                    label={`${rankNumber(rank)} Rank`}
                    right={
                      <SpSlotIndicator
                        total={totalSlots}
                        used={usedSlots}
                        muted={isEmpty}
                        onSetAvailable={(n) => {
                          props.setCharacter((c) => {
                            if (!c) return c;
                            // Set the first `n` of this rank's slots available
                            // (exhausted=false) and the rest spent — so the
                            // pips behave like the focus dots. Recompute slots
                            // the same way the prepare/cast handlers do.
                            let avail = n;
                            const slots = collectEntitySpellcasting('CHARACTER', c as LivingEntity).slots.map((s) => {
                              if (s.source !== source.name || s.rank !== rank) return s;
                              const makeAvail = avail > 0;
                              if (makeAvail) avail--;
                              return { ...s, exhausted: !makeAvail };
                            });
                            return {
                              ...c,
                              spells: {
                                ...(c.spells ?? { slots: [], list: [], focus_point_current: 0, innate_casts: [] }),
                                slots,
                              },
                            };
                          });
                        }}
                      />
                    }
                    onToggle={() => toggleCollapsed(rankId)}
                  />
                  {isEmpty ? (
                    <div className='sp-empty-line'>No spells.</div>
                  ) : filtered.length === 0 ? (
                    <div className='sp-empty-line'>No spells match the filter.</div>
                  ) : (
                    <div className='sp-grid'>
                      {filtered.map((cell, i) => {
                        if (!cell.spell) {
                          return (
                            <SpellAddCard
                              key={`empty-${i}`}
                              label={`Prepare ${ordinal}`}
                              onClick={() => {
                                if (!isPreparedSrc || cell.slotIdx === null) return;
                                const slot = rankSlots[cell.slotIdx];
                                if (slot)
                                  pickSpellForSlot(
                                    { name: source.name, type: source.type, tradition: source.tradition },
                                    slot.id,
                                    rank
                                  );
                              }}
                            />
                          );
                        }
                        const spell = cell.spell;
                        const canSig = isSpontaneousSrc;
                        // Spontaneous casters: the row is "exhausted"
                        // only when ALL slots at this rank are used.
                        const cardExhausted = isSpontaneousSrc
                          ? remaining <= 0
                          : cell.exhausted;
                        return (
                          <SpellCard
                            key={`r-${i}`}
                            spell={spell}
                            exhausted={cardExhausted}
                            signature={cell.signature}
                            onToggleSignature={
                              canSig
                                ? () => toggleSignature(spell, source.name)
                                : undefined
                            }
                            onCast={
                              isPreparedSrc
                                ? (cast: boolean) =>
                                    castSpell(cast, source.name, rank, spell.id, true)
                                : undefined
                            }
                            onReplace={
                              isPreparedSrc && cell.slotIdx !== null
                                ? () => {
                                    const slot = rankSlots[cell.slotIdx!];
                                    if (slot)
                                      pickSpellForSlot(
                                        { name: source.name, type: source.type, tradition: source.tradition },
                                        slot.id,
                                        rank
                                      );
                                  }
                                : undefined
                            }
                            onClick={() =>
                              openDrawer({
                                type: 'cast-spell',
                                data: {
                                  id: spell.id,
                                  spell,
                                  exhausted: cell.exhausted,
                                  tradition: source.tradition,
                                  attribute: source.attribute,
                                  storeId: 'CHARACTER',
                                  entity: character,
                                  onCastSpell: (cast: boolean) =>
                                    castSpell(cast, source.name, rank, spell.id, !!isPreparedSrc),
                                },
                                extra: { addToHistory: true },
                              })
                            }
                          />
                        );
                      })}
                      {/* Spontaneous casters: trailing "+ Add Nth-Rank Spell" tile. */}
                      {isSpontaneousSrc && (
                        <SpellAddCard
                          label={`Add ${ordinal}`}
                          onClick={() =>
                            pickSpellForRepertoire(
                              { name: source.name, type: source.type, tradition: source.tradition },
                              rank
                            )
                          }
                        />
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        );
      })}

      {/* ─── Innate spells ────────────────────────────────────────── */}
      {Array.from(innateByTrad.entries()).map(([tradition, entries]) => {
        const cards = entries
          .map((e) => ({ entry: e, spell: findSpell(e.spell_id) }))
          .filter((c): c is { entry: typeof entries[number]; spell: Spell } => !!c.spell);
        const filtered = cards.filter((c) => passesFilters(c.spell));
        const innateId = `spells-innate-${tradition}`;
        return (
          <div key={`innate-${tradition}`} className={`sp-sec${isCollapsed(innateId) ? ' collapsed' : ''}`}>
            <SpSectionHead
              icon={<SpStarIcon />}
              label={`Innate · ${tradition}`}
              right={
                <span className='nums'>
                  {cards.length} {cards.length === 1 ? 'SPELL' : 'SPELLS'}
                </span>
              }
              onToggle={() => toggleCollapsed(innateId)}
            />
            {cards.length === 0 ? (
              <div className='sp-empty-line'>No innate spells.</div>
            ) : filtered.length === 0 ? (
              <div className='sp-empty-line'>No innate spells match the filter.</div>
            ) : (
              <div className='sp-grid'>
                {filtered.map(({ entry, spell }, i) => {
                  const used = entry.casts_max > 0 && (entry.casts_current ?? 0) >= entry.casts_max;
                  const meta = entry.casts_max > 0
                    ? `${Math.max(0, entry.casts_max - (entry.casts_current ?? 0))}/${entry.casts_max} CASTS`
                    : null;
                  return (
                    <SpellCard
                      key={`innate-${i}`}
                      spell={spell}
                      exhausted={used}
                      metaOverride={meta ?? undefined as unknown as string | null}
                      onClick={() =>
                        openDrawer({
                          type: 'cast-spell',
                          data: {
                            id: spell.id,
                            spell,
                            exhausted: used,
                            tradition,
                            attribute: undefined,
                            storeId: 'CHARACTER',
                            entity: character,
                          },
                          extra: { addToHistory: true },
                        })
                      }
                    />
                  );
                })}
              </div>
            )}
          </div>
        );
      })}

      {/* ManageSpellsModal — same Mantine modal the legacy panel uses. */}
      {manageSpells && (
        <ManageSpellsModal
          id='CHARACTER'
          entity={character}
          setEntity={props.setCharacter as unknown as SetterOrUpdater<LivingEntity | null>}
          opened={true}
          onClose={() => setManageSpells(undefined)}
          source={manageSpells.source}
          type={manageSpells.type}
          filter={manageSpells.filter}
          zIndex={500}
        />
      )}
    </div>
  );
}


// =======================================================================
// CodexInventoryPanel
// =======================================================================

export function CodexInventoryPanel(props: {
  characterId?: number;
  character?: Character | null;
  setCharacter?: SetterOrUpdater<Character | null>;
  // Optional overrides so this exact wg4 inventory UI can also drive a
  // companion's inventory (any LivingEntity + its own variable store).
  // They default to the character, so the player's Inventory tab is
  // completely unchanged.
  storeId?: string;
  entity?: LivingEntity | null;
  setEntity?: SetterOrUpdater<LivingEntity | null>;
}) {
  const storeId = props.storeId ?? 'CHARACTER';
  const entity = (props.entity ?? props.character ?? null) as LivingEntity | null;
  const setEntity =
    props.setEntity ?? (props.setCharacter as unknown as SetterOrUpdater<LivingEntity | null>);
  const [_drawer, openDrawer] = useAtom(drawerState);
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<'all' | 'equipped'>('all');
  // Collapsible inventory-section state — Equipped / Consumables / Carried
  // and every container header is toggled via this hook.
  const { isCollapsed, toggle: toggleCollapsed } = useCollapsedSections();

  const inv = entity?.inventory ?? null;
  // Filter out "meta" inventory items — these are unarmed strikes (Fist),
  // unarmed defenses, and other engine-only synthetic items that get
  // injected into inventory.items by operations like `addAttackItem`.
  // They're flagged with `meta_data.unselectable` because the engine
  // doesn't want users to delete / equip / move them, and they're not
  // real possessions the character "owns". Hiding them from the
  // inventory page matches what the user expects to see — only items
  // they could actually misplace.
  const items = (inv?.items ?? []).filter(
    (i) => !i.item?.meta_data?.unselectable
  );
  const coins = inv?.coins ?? { pp: 0, gp: 0, sp: 0, cp: 0 };

  const totalBulk = getInvBulk(inv ?? undefined);
  // In PF2e a character is encumbered above 5 + Str mod bulk and
  // can carry at most 10 + Str mod. getBulkLimit returns 5 + Str
  // (encumbered threshold); getBulkLimitImmobile returns 10 + Str
  // (the max — can't carry beyond this).
  const encumberedAt = getBulkLimit(storeId);
  const maxBulk = getBulkLimitImmobile(storeId);
  const isEncumbered = totalBulk > encumberedAt;

  // Classify an item — drives the left-border color. We don't have
  // a clean worn/held/consumable enum on items in this fork; equipped
  // is the only flag we can be sure about — but we also fork to
  // 'consumable' (sage rail) for items carrying the Consumable trait
  // or sitting in the Consumables group. Consumable beats nothing
  // here because the .it.equipped + .it.consumable combination is
  // rare (most consumables aren't equipped) and even when both
  // apply, the consumable signal is the more useful "you'll lose
  // this if you trigger it" warning.
  const classify = (i: InventoryItem): string => {
    if (isConsumableItem(i.item)) return 'consumable';
    if (i.is_equipped) return 'equipped';
    return '';
  };

  const matchesSearch = (i: InventoryItem) => {
    if (!searchQuery.trim()) return true;
    return i.item?.name?.toLowerCase().includes(searchQuery.trim().toLowerCase());
  };
  const matchesFilter = (i: InventoryItem) => {
    if (categoryFilter === 'all') return true;
    // Test the equipped flag directly — NOT classify(), which returns
    // 'consumable' before 'equipped', so an equipped consumable (a worn
    // talisman, invested wand, readied bomb…) would otherwise be hidden
    // by the Equipped filter.
    if (categoryFilter === 'equipped') return !!i.is_equipped;
    return classify(i) === categoryFilter;
  };

  // Top-level (non-nested) items, filtered. Containers stay here —
  // their *contents* go into the per-container sections below, but
  // the container itself is still a row in Equipped or Carried so the
  // player can see/equip/edit the container as a single item.
  const filteredTopLevel = items.filter((i) => matchesSearch(i) && matchesFilter(i));
  const equipped = filteredTopLevel.filter((i) => i.is_equipped);
  const other = filteredTopLevel.filter((i) => !i.is_equipped);
  const consumables: typeof other = []; // reserved — needs consumable trait lookup

  // Walk the whole inventory tree to collect every container (at any
  // depth). Each container will render its own section below — even
  // nested ones, so a belt-pouch inside a backpack still gets its own
  // header. We memoize because the recursive walk is wasted work on
  // every keystroke; the inventory object changes rarely.
  const allContainers = useMemo(() => {
    const out: InventoryItem[] = [];
    const walk = (list: InventoryItem[]) => {
      for (const i of list) {
        if (isItemContainer(i.item)) {
          out.push(i);
          walk(i.container_contents);
        }
      }
    };
    walk(items);
    return out;
  }, [items]);

  // For each container, compute the visible subset of its contents
  // under the current search + filter. When a search is active and a
  // container has zero matches we hide its section entirely (otherwise
  // the page is just a wall of empty headers); when no search/filter
  // is active we show every container header even if empty, so the
  // player has a clear roster of all their containers.
  const isFilterActive = !!searchQuery.trim() || categoryFilter !== 'all';
  const containerSections = allContainers
    .map((c) => ({
      container: c,
      children: c.container_contents.filter((i) => matchesSearch(i) && matchesFilter(i)),
    }))
    .filter(({ children }) => !isFilterActive || children.length > 0);

  // Open the item drawer with all the callbacks wired up. Previously
  // each <InvRow onClick> opened the drawer with just `{invItem,
  // storeID}` — no update/delete/move handlers — so the drawer's
  // favorite star, delete, edit, and Move-To picker all silently
  // failed. Routing through this single helper guarantees the codex
  // panel uses the same data flow the legacy InventoryPanel did.
  const openItemDrawer = (invItem: InventoryItem) => {
    openDrawer({
      type: 'inv-item',
      data: {
        storeID: storeId,
        invItem,
        onItemUpdate: (next: InventoryItem) => handleUpdateItem(setEntity, next),
        onItemDelete: (next: InventoryItem) => handleDeleteItem(setEntity, next),
        onItemMove: (item: InventoryItem, container: InventoryItem | null) =>
          handleMoveItem(setEntity, item, container),
      },
      extra: { addToHistory: true },
    });
  };

  // Drag-and-drop state. `dragId` is the currently-being-dragged
  // inventory item id; `dropTargetId` is the id of the section header
  // currently hovered over (a container id, or the literal 'TOPLEVEL'
  // sentinel for the Carried section). Stored separately so we can
  // light up the right header without re-rendering every row.
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);

  // Find an inventory item by id anywhere in the tree. Drop handlers
  // know which id was dragged but not where it currently lives — this
  // walks both top-level and nested container contents to surface the
  // canonical InventoryItem so handleMoveItem can do its job.
  const findInvItem = (id: string, list = items): InventoryItem | null => {
    for (const i of list) {
      if (i.id === id) return i;
      if (isItemContainer(i.item)) {
        const hit = findInvItem(id, i.container_contents);
        if (hit) return hit;
      }
    }
    return null;
  };

  // Common onDrop wiring. Called from both the per-container section
  // headers and the Carried header. `target` is the destination
  // container (or null for top-level / unstored). We look up the
  // dragged item by id, no-op when dragging onto its existing home,
  // and otherwise delegate to handleMoveItem.
  const performDrop = (target: InventoryItem | null) => {
    const draggedId = dragId;
    setDragId(null);
    setDropTargetId(null);
    if (!draggedId) return;
    const dragged = findInvItem(draggedId);
    if (!dragged) return;
    // Don't move onto self.
    if (target && target.id === dragged.id) return;
    handleMoveItem(setEntity, dragged, target);
  };

  // Row-level equip/invest toggles. Mirror the legacy InventoryPanel
  // pattern: clone the InventoryItem, flip the flag, and push via
  // handleUpdateItem (which now walks the whole tree, so items
  // inside containers update correctly too).
  const toggleEquip = (i: InventoryItem) => {
    const next = cloneDeep(i);
    next.is_equipped = !next.is_equipped;
    handleUpdateItem(setEntity, next);
  };
  const toggleInvestOrImplant = (i: InventoryItem) => {
    const next = cloneDeep(i);
    if (isItemInvestable(next.item)) next.is_invested = !next.is_invested;
    if (isItemImplantable(next.item)) next.is_implanted = !next.is_implanted;
    handleUpdateItem(setEntity, next);
  };
  // Whether the invest / implant cap has been reached. Used to grey
  // out the buttons on items that AREN'T already invested/implanted —
  // already-toggled-on items can still toggle off regardless.
  const investCapped = reachedInvestedLimit(storeId, inv ?? undefined);
  const implantCapped = reachedImplantLimit(storeId, inv ?? undefined);

  // Open the Add Item modal — extracted so the toolbar button and any
  // future entry point share the same wiring. Re-fetches the inventory
  // automatically via setEntity update.
  const openAddItemModal = () => {
    openContextModal({
      modal: 'addItems',
      title: <Title order={3}>Add Items</Title>,
      size: 1500,
      // Near-opaque overlay so the inventory page behind doesn't bleed
      // through. Matches the Manage Spells modal for cross-popup
      // consistency.
      overlayProps: { backgroundOpacity: 0.85, blur: 3 },
      innerProps: {
        onAddItem: async (item: Item, type: 'GIVE' | 'BUY' | 'FORMULA') => {
          if (!entity) return;
          if (type === 'BUY') {
            openContextModal({
              modal: 'buyItem',
              title: <Title order={3}>Buy {item.name}</Title>,
              innerProps: {
                inventory: entity.inventory,
                item,
                onConfirm: async (coins: { cp: number; sp: number; gp: number; pp: number }) => {
                  await handleAddItem(setEntity, item, false);
                  setEntity((prev) =>
                    prev
                      ? {
                          ...prev,
                          inventory: {
                            ...(prev.inventory ?? {
                              coins: { cp: 0, sp: 0, gp: 0, pp: 0 },
                              items: [],
                            }),
                            coins,
                          },
                        }
                      : prev
                  );
                  setTimeout(() => modals.closeAll(), 100);
                },
              },
              zIndex: 1000,
            });
          } else {
            await handleAddItem(setEntity, item, type === 'FORMULA');
            setTimeout(() => modals.closeAll(), 100);
          }
        },
      },
      zIndex: 1100,
    });
  };

  // Inline coin editing — click a denomination's number and type the new
  // amount. No drawer; updates the live store directly. Works for both the
  // player and a companion (entity/setEntity resolve to whichever store drives
  // this panel).
  const setCoin = (denom: 'cp' | 'sp' | 'gp' | 'pp', raw: string) => {
    const n = Math.max(0, parseInt(raw.replace(/[^0-9]/g, ''), 10) || 0);
    setEntity((prev) =>
      prev
        ? {
            ...prev,
            inventory: {
              ...(prev.inventory ?? { coins: { cp: 0, sp: 0, gp: 0, pp: 0 }, items: [] }),
              coins: {
                ...(prev.inventory?.coins ?? { cp: 0, sp: 0, gp: 0, pp: 0 }),
                [denom]: n,
              },
            },
          }
        : prev
    );
  };

  return (
    <div className='codex-tab-body inv-stack'>
      {/* ─── 1. Top strip ──────────────────────────────────────────
          Wealth (coins) + bulk indicator. A single horizontal strip
          on a light parchment surface. Coins-row is inline-flex with
          4 coin pills; bulk-indicator is column-aligned to the right.
            .wealth-strip.inv-top
            ├─ .coins-row > 4× .coin > .pic.disk + .v + .k
            └─ .bulk-indicator > .eyebrow + .line + .rule + .caption */}
      <div className='wealth-strip inv-top'>
        <div className='coins-row' title='Click a number to edit your coins'>
          {(
            [
              ['pp', 'P', 'Platinum'],
              ['gp', 'G', 'Gold'],
              ['sp', 'S', 'Silver'],
              ['cp', 'C', 'Copper'],
            ] as const
          ).map(([denom, glyph, label]) => {
            const val = coins[denom] ?? 0;
            return (
              <div className={`coin ${denom}`} key={denom} title={`${label} pieces`}>
                <span className='pic disk'>{glyph}</span>
                <input
                  className='v'
                  type='text'
                  inputMode='numeric'
                  aria-label={`${label} pieces`}
                  size={Math.max(2, String(val).length)}
                  value={val}
                  onFocus={(e) => e.currentTarget.select()}
                  onChange={(e) => setCoin(denom, e.target.value)}
                  style={{
                    border: 0,
                    background: 'transparent',
                    outline: 'none',
                    padding: 0,
                    textAlign: 'center',
                  }}
                />
                <span className='k'>{label}</span>
              </div>
            );
          })}
        </div>
        <div
          className={`bulk-indicator${isEncumbered ? ' over' : ''}`}
          title={`Encumbered above ${encumberedAt} bulk · Max carry ${maxBulk}`}
        >
          <div className='eyebrow'>Bulk Carried</div>
          <div className='line'>
            <span className='cur'>{labelizeBulk(totalBulk, true)}</span>
            <span className='sep'>/</span>
            <span className='max'>{encumberedAt}</span>
            <span className='hint'>(max {maxBulk})</span>
          </div>
          {/* Progress bar — fill = bulk / max-carry; the marker line is
              the encumbered threshold (the divide between un-encumbered
              and encumbered). Turns red once over the threshold. */}
          <div className='bulk-bar' aria-hidden='true'>
            <div
              className='bulk-bar-fill'
              style={{ width: `${maxBulk > 0 ? Math.max(0, Math.min(100, (totalBulk / maxBulk) * 100)) : 0}%` }}
            />
            <div
              className='bulk-bar-mark'
              title={`Encumbered above ${encumberedAt}`}
              style={{ left: `${maxBulk > 0 ? Math.max(0, Math.min(100, (encumberedAt / maxBulk) * 100)) : 0}%` }}
            />
          </div>
          <div className='caption'>
            Encumbered &gt; <b>{encumberedAt}</b> · Max <b>{maxBulk}</b>
          </div>
        </div>
      </div>

      {/* ─── 2. Toolbar ─────────────────────────────────────────────
          Search input (flex-grow) + ALL/EQUIPPED filter pills group
          + rust-filled "+ Add Item" pill on the far right. */}
      <div className='inv-toolbar'>
        <div className='search-strip search'>
          <span className='icon' aria-hidden='true'>
            <svg
              viewBox='0 0 16 16'
              width='14'
              height='14'
              fill='none'
              stroke='currentColor'
              strokeWidth='1.5'
              strokeLinecap='round'
            >
              <circle cx='7' cy='7' r='4.5' />
              <line x1='10.3' y1='10.3' x2='13.5' y2='13.5' />
            </svg>
          </span>
          <input
            type='text'
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder='Search inventory…'
          />
        </div>
        {/* Inventory category filter. No "All" pill — when not toggled
            the inventory shows everything by default. Clicking
            "Equipped" again clears the filter (back to showing all). */}
        <div className='inv-filter-pills'>
          <button
            type='button'
            className={`filter ${categoryFilter === 'equipped' ? 'on' : ''}`}
            onClick={() =>
              setCategoryFilter(categoryFilter === 'equipped' ? 'all' : 'equipped')
            }
          >
            Equipped
          </button>
        </div>
        <button type='button' className='inv-add-btn add' onClick={openAddItemModal}>
          <span className='plus'>+</span>
          Add Item
        </button>
      </div>

      {/* ─── 3. Section blocks ─────────────────────────────────────
          One header + item grid per group:
            EQUIPPED  (X glyph icon, italic count right)
            CARRIED   (backpack icon, italic count right)
            CONTAINER (backpack icon per container, bulk/cap on right)
          Item cards are .inv-card in a 4-column grid (.inv-grid). */}

      {/* Equipped */}
      {equipped.length > 0 && (
        <div className={`inv-sec${isCollapsed('inv-equipped') ? ' collapsed' : ''}`}>
          <InvSectionHead
            icon={<EquippedIcon />}
            label='Equipped'
            count={equipped.length}
            onToggle={() => toggleCollapsed('inv-equipped')}
          />
          <div className='inv-grid'>
            {equipped.map((i) => (
              <InvRow
                key={i.id}
                item={i}
                classification={classify(i)}
                onClick={() => openItemDrawer(i)}
                draggable
                isDragging={dragId === i.id}
                onDragStart={() => setDragId(i.id)}
                onDragEnd={() => {
                  setDragId(null);
                  setDropTargetId(null);
                }}
                onToggleEquip={toggleEquip}
                onToggleInvest={toggleInvestOrImplant}
                investDisabled={investCapped}
                implantDisabled={implantCapped}
              />
            ))}
          </div>
        </div>
      )}

      {/* Consumables */}
      {consumables.length > 0 && (
        <div className={`inv-sec${isCollapsed('inv-consumables') ? ' collapsed' : ''}`}>
          <InvSectionHead
            icon={<BackpackIcon />}
            label='Consumables'
            count={consumables.length}
            onToggle={() => toggleCollapsed('inv-consumables')}
          />
          <div className='inv-grid'>
            {consumables.map((i) => (
              <InvRow
                key={i.id}
                item={i}
                classification={classify(i)}
                onClick={() => openItemDrawer(i)}
                draggable
                isDragging={dragId === i.id}
                onDragStart={() => setDragId(i.id)}
                onDragEnd={() => {
                  setDragId(null);
                  setDropTargetId(null);
                }}
                onToggleEquip={toggleEquip}
                onToggleInvest={toggleInvestOrImplant}
                investDisabled={investCapped}
                implantDisabled={implantCapped}
              />
            ))}
          </div>
        </div>
      )}

      {/* Carried (top-level, non-equipped). Also a drop target — drop
          anything onto its header to send it back to the top-level
          unstored pile. The TOPLEVEL sentinel keeps it distinct from
          any real container id. */}
      {(other.length > 0 || dragId) && (
        <div
          className={`inv-sec${dropTargetId === 'TOPLEVEL' ? ' drop-target' : ''}${isCollapsed('inv-carried') ? ' collapsed' : ''}`}
          onDragOver={(e) => {
            if (!dragId) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            if (dropTargetId !== 'TOPLEVEL') setDropTargetId('TOPLEVEL');
          }}
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node)) {
              if (dropTargetId === 'TOPLEVEL') setDropTargetId(null);
            }
          }}
          onDrop={(e) => {
            e.preventDefault();
            performDrop(null);
          }}
        >
          <InvSectionHead
            icon={<BackpackIcon />}
            label='Carried'
            count={other.length}
            onToggle={() => toggleCollapsed('inv-carried')}
          />
          <div className='inv-grid'>
            {other.map((i) => (
              <InvRow
                key={i.id}
                item={i}
                classification={classify(i)}
                onClick={() => openItemDrawer(i)}
                draggable
                isDragging={dragId === i.id}
                onDragStart={() => setDragId(i.id)}
                onDragEnd={() => {
                  setDragId(null);
                  setDropTargetId(null);
                }}
                onToggleEquip={toggleEquip}
                onToggleInvest={toggleInvestOrImplant}
                investDisabled={investCapped}
                implantDisabled={implantCapped}
              />
            ))}
          </div>
        </div>
      )}

      {/* Per-container sections. One block per container in the
          inventory, named after the container, listing its current
          contents. Nested containers get their own section too —
          flat ordering. Empty containers show only the header (no
          grid) per the wg4 reference design. */}
      {containerSections.map(({ container, children }) => {
        const capRaw = container.item.meta_data?.bulk?.capacity;
        const ignored = Number(container.item.meta_data?.bulk?.ignored ?? 0);
        const cap = Number(capRaw ?? 0);
        const used = getContainerContentsBulk(container);
        const isMagical = cap > 0 && ignored >= cap;
        const over = cap > 0 && used > cap;
        const containerId = `inv-container-${container.id}`;
        return (
          <div
            className={`inv-sec${dropTargetId === container.id ? ' drop-target' : ''}${isCollapsed(containerId) ? ' collapsed' : ''}`}
            key={container.id}
            onDragOver={(e) => {
              if (!dragId || dragId === container.id) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = 'move';
              if (dropTargetId !== container.id) setDropTargetId(container.id);
            }}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                if (dropTargetId === container.id) setDropTargetId(null);
              }
            }}
            onDrop={(e) => {
              e.preventDefault();
              performDrop(container);
            }}
          >
            <InvSectionHead
              icon={<BackpackIcon />}
              label={container.item.name}
              count={children.length}
              bulk={
                cap > 0
                  ? {
                      used: labelizeBulk(used, true),
                      cap: labelizeBulk(String(cap), true),
                      over,
                      magical: isMagical,
                      hint: isMagical
                        ? `Contents do not count toward your character bulk (up to ${cap} bulk).`
                        : `First ${ignored} bulk of contents is ignored from your character bulk. Beyond that adds to your bulk normally.`,
                    }
                  : undefined
              }
              onToggle={() => toggleCollapsed(containerId)}
            />
            {children.length > 0 && (
              <div className='inv-grid'>
                {children.map((i) => (
                  <InvRow
                    key={i.id}
                    item={i}
                    classification={classify(i)}
                    onClick={() => openItemDrawer(i)}
                    draggable
                    isDragging={dragId === i.id}
                    onDragStart={() => setDragId(i.id)}
                    onDragEnd={() => {
                      setDragId(null);
                      setDropTargetId(null);
                    }}
                    onToggleEquip={toggleEquip}
                    onToggleInvest={toggleInvestOrImplant}
                    investDisabled={investCapped}
                    implantDisabled={implantCapped}
                  />
                ))}
              </div>
            )}
          </div>
        );
      })}

      {filteredTopLevel.length === 0 && containerSections.every((s) => s.children.length === 0) && (
        <div className='inv-empty inv-empty-page'>
          {searchQuery.trim() ? `No items match "${searchQuery.trim()}"` : 'Nothing in this pocket.'}
        </div>
      )}
    </div>
  );
}

// Section header for an inventory section. Small rust icon on the
// left, uppercase bold label, optional count + bulk meta on the right.
// Matches the wg4 reference design:
//   EQUIPPED                              4 items
//   BACKPACK                       0.2 / 4 BULK · 3 items
//   SPACIOUS POUCH (I)             0 / 25 BULK ◆ · 7 items
function InvSectionHead(props: {
  icon: React.ReactNode;
  label: string;
  count: number;
  bulk?: {
    used: string;
    cap: string;
    over?: boolean;
    magical?: boolean;
    hint?: string;
  };
  onToggle?: () => void;
}) {
  return (
    <div className='inv-section-head' onClick={props.onToggle}>
      <div className='label'>
        <span className='ico'>{props.icon}</span>
        <span>{props.label}</span>
        {props.onToggle && <span className='sec-chevron'>▾</span>}
      </div>
      <div className='meta' onClick={(e) => e.stopPropagation()}>
        {props.bulk && (
          <span
            className={`bulk-meta${props.bulk.over ? ' over' : ''}`}
            title={props.bulk.hint}
          >
            <b>{props.bulk.used}</b> / {props.bulk.cap} BULK
            {props.bulk.magical && (
              <span className='magic-mark' title='Magical / extradimensional container'>
                ✦
              </span>
            )}
          </span>
        )}
        <span className='items'>
          <i>
            {props.count} {props.count === 1 ? 'item' : 'items'}
          </i>
        </span>
      </div>
    </div>
  );
}

// Small line-art icons for inventory section headers. Drawn in
// `currentColor` so they pick up the rust accent applied by the
// .inv-section-head .ico rule in the CSS overrides.
function EquippedIcon() {
  // Crossed-swords X (matches wg4 inventory-icons "Weapons").
  return (
    <svg
      viewBox='0 0 16 16'
      width='13'
      height='13'
      fill='none'
      stroke='currentColor'
      strokeWidth='1.4'
      strokeLinecap='round'
      strokeLinejoin='round'
    >
      <line x1='4' y1='12' x2='13' y2='3' />
      <line x1='2.5' y1='11' x2='5' y2='13.5' />
      <circle cx='2.8' cy='13.2' r='0.9' fill='currentColor' stroke='none' />
      <line x1='12' y1='12' x2='3' y2='3' />
      <line x1='13.5' y1='11' x2='11' y2='13.5' />
      <circle cx='13.2' cy='13.2' r='0.9' fill='currentColor' stroke='none' />
    </svg>
  );
}
function BackpackIcon() {
  // Backpack glyph (matches wg4 inventory-icons "AdventuringGear").
  return (
    <svg
      viewBox='0 0 16 16'
      width='13'
      height='13'
      fill='none'
      stroke='currentColor'
      strokeWidth='1.4'
      strokeLinecap='round'
      strokeLinejoin='round'
    >
      <path d='M5 4 Q5 2.5 6 2.5 Q7 2.5 7 4' />
      <path d='M9 4 Q9 2.5 10 2.5 Q11 2.5 11 4' />
      <path d='M3.5 7.5 H12.5 V5 a1 1 0 0 0 -1 -1 H4.5 a1 1 0 0 0 -1 1 Z' />
      <rect x='7' y='6' width='2' height='2' />
      <path d='M3 7.5 H13 V13 a1 1 0 0 1 -1 1 H4 a1 1 0 0 1 -1 -1 Z' />
      <rect x='5.5' y='9.5' width='5' height='3' rx='0.4' />
    </svg>
  );
}

function InvRow(props: {
  item: InventoryItem;
  classification: string;
  onClick: () => void;
  // Drag-and-drop wiring. The parent panel owns the drag state and
  // chooses what to do on drop; the row just forwards events. All
  // four props are optional so existing callers (the dragless drawer
  // contexts elsewhere) don't have to change.
  draggable?: boolean;
  onDragStart?: () => void;
  onDragEnd?: () => void;
  isDragging?: boolean;
  // Equip / Invest / Implant action callbacks. The row checks the
  // item's eligibility (weapon/armor for equip, INVESTED trait for
  // invest, AUGMENTATION trait for implant) and shows the matching
  // button only when applicable. Clicking flips the boolean and
  // calls back to the panel which routes through handleUpdateItem.
  onToggleEquip?: (item: InventoryItem) => void;
  onToggleInvest?: (item: InventoryItem) => void;
  // True when the parent has already reached its invest / implant
  // limit and the row should disable the toggle. Computed by the
  // panel because the limit depends on the whole inventory.
  investDisabled?: boolean;
  implantDisabled?: boolean;
}) {
  const { item, classification } = props;
  const quantity =
    (item.item?.meta_data as { quantity?: number } | undefined)?.quantity ?? 1;
  // Coerce string→number for the price object; the schema allows
  // either but priceToString only takes numbers.
  const rawPrice = item.item?.price;
  const numericPrice = rawPrice
    ? {
        cp: typeof rawPrice.cp === 'string' ? Number(rawPrice.cp) || 0 : rawPrice.cp,
        sp: typeof rawPrice.sp === 'string' ? Number(rawPrice.sp) || 0 : rawPrice.sp,
        gp: typeof rawPrice.gp === 'string' ? Number(rawPrice.gp) || 0 : rawPrice.gp,
        pp: typeof rawPrice.pp === 'string' ? Number(rawPrice.pp) || 0 : rawPrice.pp,
      }
    : null;
  const price = numericPrice ? priceToString(numericPrice) : null;
  const bulk = labelizeBulk(item.item?.bulk ?? undefined, false);
  // Eligibility for the action buttons. Equipped items can't be
  // dragged — the user has to Unequip first — so we also disable
  // drag at the row level here (parent passes `draggable` but we
  // gate it on equip state). This is the "must unequip first" rule
  // the user asked for.
  const canEquip = isItemEquippable(item.item);
  const canInvest = isItemInvestable(item.item);
  const canImplant = isItemImplantable(item.item);
  const dragLocked = item.is_equipped;
  // Special-highlight items get the rust left-border treatment per the
  // wg4 reference (e.g. Burial Oil in the screenshot). Currently keyed
  // off invested / implanted — items that have an active magical bond
  // with the character.
  const isHighlighted = !!item.is_invested || !!item.is_implanted;
  // Equipped state controls the rust-outlined circle on the icon cell.
  const equippedClass = item.is_equipped ? ' equipped' : ' unworn';
  return (
    <div
      className={`inv-card it ${classification}${equippedClass}${isHighlighted ? ' invested' : ''}${props.isDragging ? ' dragging' : ''}`}
      onClick={props.onClick}
      draggable={!!props.draggable && !dragLocked}
      onDragStart={(e) => {
        if (!props.draggable || dragLocked) {
          e.preventDefault();
          return;
        }
        e.dataTransfer.effectAllowed = 'move';
        try { e.dataTransfer.setData('text/plain', props.item.id); } catch {}
        props.onDragStart?.();
      }}
      onDragEnd={() => props.onDragEnd?.()}
      title={dragLocked ? 'Unequip this item before moving it.' : undefined}
    >
      <span className='icon-cell icon'>
        <ItemIcon item={item.item} />
      </span>
      <div className='info'>
        <div className='name'>
          <span>{item.item?.name ?? '(unknown)'}</span>
          {quantity > 1 && <span className='qty'>×{quantity}</span>}
        </div>
        {(item.item?.level != null || price) && (
          <div className='sub'>
            {item.item?.level != null ? `level ${item.item.level}` : ''}
            {item.item?.level != null && price ? ' · ' : ''}
            {price ?? ''}
          </div>
        )}
      </div>
      <div className='meta'>
        <span className='bulk-pill'>
          <b>{bulk}</b>
          <span className='lbl'>Bulk</span>
        </span>
        {canInvest && props.onToggleInvest && (
          <button
            type='button'
            className={`badge ${item.is_invested ? 'invested' : 'invest'} pill-btn row-act${item.is_invested ? ' on' : ''}`}
            disabled={!item.is_invested && !!props.investDisabled}
            onClick={(e) => {
              e.stopPropagation();
              props.onToggleInvest!(item);
            }}
          >
            {item.is_invested ? 'Invested' : 'Invest'}
          </button>
        )}
        {canImplant && props.onToggleInvest && (
          <button
            type='button'
            className={`badge ${item.is_implanted ? 'invested' : 'invest'} pill-btn row-act${item.is_implanted ? ' on' : ''}`}
            disabled={!item.is_implanted && !!props.implantDisabled}
            onClick={(e) => {
              e.stopPropagation();
              props.onToggleInvest!(item);
            }}
          >
            {item.is_implanted ? 'Implanted' : 'Implant'}
          </button>
        )}
        {canEquip && props.onToggleEquip && (
          <button
            type='button'
            className={`badge ${item.is_equipped ? 'equipped' : 'equip'} pill-btn row-act${item.is_equipped ? ' on' : ''}`}
            onClick={(e) => {
              e.stopPropagation();
              props.onToggleEquip!(item);
            }}
          >
            {item.is_equipped ? 'Equipped' : 'Equip'}
          </button>
        )}
      </div>
    </div>
  );
}

// =======================================================================
// CodexFeatsPanel
// =======================================================================

export function CodexFeatsPanel(props: {
  characterId: number;
  character: Character | null;
  content: ContentPackage;
}) {
  const { character, content } = props;
  const [_drawer, openDrawer] = useAtom(drawerState);
  const [searchQuery, setSearchQuery] = useState('');
  const [groupFilter, setGroupFilter] = useState<'all' | 'class' | 'ancestry' | 'skill' | 'general' | 'feature'>('all');
  // Collapsible Class / Ancestry / Skill / General feat sections — each
  // <section className='sec'> below toggles via this hook.
  const { isCollapsed, toggle: toggleCollapsed } = useCollapsedSections();

  // collectEntityAbilityBlocks is the engine helper the legacy
  // FeatsFeaturesPanel uses — it cross-references the character's
  // selections + class/ancestry/heritage choices against the content
  // pool and returns categorized lists. Much more reliable than
  // walking operation_data.selections by hand.
  const collected = useMemo(() => {
    if (!character) return null;
    return collectEntityAbilityBlocks(
      'CHARACTER',
      character,
      content.abilityBlocks ?? [],
      { filterBasicClassFeatures: true }
    );
  }, [character, content.abilityBlocks]);

  // Trait-id → name lookup, used to bucket general vs skill feats.
  const traitNameById = useMemo(() => {
    const m = new Map<number, string>();
    (content.traits ?? []).forEach((t) => {
      if (t && typeof t.id === 'number' && t.name) m.set(t.id, t.name.toLowerCase());
    });
    return m;
  }, [content.traits]);

  // Tag each block with its source group so we can filter / color-code.
  //
  // collectEntityAbilityBlocks returns OVERLAPPING lists — a feat with
  // both the class trait (bard) and the ancestry trait (elf) lands in
  // BOTH classFeats and ancestryFeats. Mapping each list to a tag
  // naively produced two duplicate rows: one in the Class section,
  // one in the Ancestry section. That's why the user kept seeing
  // ancestry feats inside the Bard section.
  //
  // Walk feats once with a priority order so each id lands in exactly
  // one bucket:
  //   1. SKILL trait     → skill           (skill feats are taken in
  //                                         skill slots regardless of
  //                                         other traits)
  //   2. GENERAL trait   → general         (general slots, same logic)
  //   3. ancestry trait  → ancestry        (ancestry-trait feats are
  //                                         taken in ancestry slots,
  //                                         even when they also carry
  //                                         the class trait)
  //   4. class trait     → class
  //   5. otherwise       → general         (orphan / archetype /
  //                                         multiclass feats fall here)
  //
  // Heritages always count as ancestry; class-features and physical-
  // features as feature. Those don't overlap with the feat lists.
  type TaggedBlock = AbilityBlock & { _group: 'class' | 'ancestry' | 'skill' | 'general' | 'feature' };
  const featBlocks: TaggedBlock[] = useMemo(() => {
    if (!collected) return [];

    // De-dupe across all sources by id. Feature/heritage ids never
    // collide with feat ids (different ability_block.type) but we keep
    // the set anyway for defensive equality.
    const seen = new Set<number>();
    const out: TaggedBlock[] = [];

    const allFeats: AbilityBlock[] = [
      ...(collected.classFeats ?? []),
      ...(collected.ancestryFeats ?? []),
      ...(collected.generalAndSkillFeats ?? []),
      ...(collected.otherFeats ?? []),
    ];
    // Same id can be in multiple lists — collapse to unique set of
    // AbilityBlocks first.
    const uniqueFeats = new Map<number, AbilityBlock>();
    for (const f of allFeats) {
      if (!uniqueFeats.has(f.id)) uniqueFeats.set(f.id, f);
    }

    const classTraitId = character?.details?.class?.trait_id ?? -1;
    const ancestryTraitId = character?.details?.ancestry?.trait_id ?? -1;

    for (const f of uniqueFeats.values()) {
      const traits = (f.traits ?? []) as number[];
      let group: TaggedBlock['_group'];
      // PF2e: feats carry trait IDs; SKILL/GENERAL traits live in the
      // content.traits table under those literal names.
      const hasSkill = traits.some((id) => traitNameById.get(id) === 'skill');
      const hasGeneral = traits.some((id) => traitNameById.get(id) === 'general');
      if (hasSkill) group = 'skill';
      else if (hasGeneral) group = 'general';
      else if (ancestryTraitId > 0 && traits.includes(ancestryTraitId)) group = 'ancestry';
      else if (classTraitId > 0 && traits.includes(classTraitId)) group = 'class';
      else group = 'general';

      if (!seen.has(f.id)) {
        seen.add(f.id);
        out.push({ ...f, _group: group });
      }
    }

    // Class-features + physical-features → 'feature'. Heritages →
    // 'ancestry'. These ability-block types never collide with feats.
    for (const cf of collected.classFeatures ?? []) {
      if (seen.has(cf.id)) continue;
      seen.add(cf.id);
      out.push({ ...cf, _group: 'feature' });
    }
    for (const h of collected.heritages ?? []) {
      if (seen.has(h.id)) continue;
      seen.add(h.id);
      out.push({ ...h, _group: 'ancestry' });
    }
    for (const pf of collected.physicalFeatures ?? []) {
      if (seen.has(pf.id)) continue;
      seen.add(pf.id);
      out.push({ ...pf, _group: 'feature' });
    }

    return out;
  }, [collected, traitNameById, character]);

  const matchesSearch = (b: { name?: string }) =>
    !searchQuery.trim() || (b.name ?? '').toLowerCase().includes(searchQuery.trim().toLowerCase());
  const matchesFilter = (b: TaggedBlock) => groupFilter === 'all' || b._group === groupFilter;

  const filtered = featBlocks
    .filter((b) => matchesSearch(b) && matchesFilter(b))
    .sort((a, b) => (a.level ?? 0) - (b.level ?? 0));

  const summary = {
    class: featBlocks.filter((b) => b._group === 'class').length,
    ancestry: featBlocks.filter((b) => b._group === 'ancestry').length,
    skill: featBlocks.filter((b) => b._group === 'skill').length,
    general: featBlocks.filter((b) => b._group === 'general').length,
    feature: featBlocks.filter((b) => b._group === 'feature').length,
  };

  return (
    <div className='codex-tab-body'>
      {/* Summary line */}
      <div className='feat-summary'>
        <span className='t-name'>Feats &amp; Features</span>
        <span className='t-sep'>·</span>
        <span>
          <b>{summary.feature}</b> features
        </span>
        <span className='t-sep'>·</span>
        <span>
          <b>{summary.class}</b> class
        </span>
        <span className='t-sep'>·</span>
        <span>
          <b>{summary.ancestry}</b> ancestry
        </span>
        <span className='t-sep'>·</span>
        <span>
          <b>{summary.skill}</b> skill
        </span>
        <span className='t-sep'>·</span>
        <span>
          <b>{summary.general}</b> general
        </span>
      </div>

      {/* Toolbar */}
      <div className='feat-search'>
        <div className='search-strip'>
          <span className='icon'>
            <SpSearchIcon />
          </span>
          <input
            type='text'
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder='Search feats &amp; features…'
          />
        </div>
        {/* Feat-group filter pills. No explicit "All" — clicking the
            active filter again clears it (back to showing everything). */}
        {(['feature', 'class', 'ancestry', 'skill', 'general'] as const).map((f) => (
          <span
            key={f}
            className={`filter ${groupFilter === f ? 'on' : ''}`}
            onClick={() => setGroupFilter(groupFilter === f ? 'all' : f)}
          >
            {f.charAt(0).toUpperCase() + f.slice(1)}
          </span>
        ))}
      </div>

      {/* Per-section feat rendering — matches the reference image:
          a CLASS section (with features inline), an ANCESTRY &
          HERITAGE section, SKILL FEATS, and GENERAL FEATS. Sections
          with zero entries hide entirely so a non-spellcaster doesn't
          see an empty "General Feats" block. */}
      {(
        [
          { id: 'class', label: 'Class', lozenge: '✦', groups: ['class', 'feature'] as const, sub: getClassName(character) || 'Bard' },
          { id: 'ancestry', label: 'Ancestry & Heritage', lozenge: '✤', groups: ['ancestry'] as const, sub: getAncestryName(character) || 'Elf' },
          { id: 'skill', label: 'Skill Feats', lozenge: '❖', groups: ['skill'] as const, sub: null },
          { id: 'general', label: 'General Feats', lozenge: '❡', groups: ['general'] as const, sub: null },
        ] as const
      ).map((section) => {
        const rows = filtered.filter((b) => (section.groups as readonly string[]).includes(b._group));
        if (rows.length === 0) return null;
        const feSecId = `feats-${section.id}`;
        const feCollapsed = isCollapsed(feSecId);
        return (
          <section key={section.id} className={`sec${feCollapsed ? ' collapsed' : ''}`}>
            <div className='sec-title' onClick={() => toggleCollapsed(feSecId)}>
              <span className='lozenge'>{section.lozenge}</span>
              <span className='label'>{section.label}</span>
              <span className='sub' onClick={(e) => e.stopPropagation()}>
                <b>{rows.length}</b>
                {section.sub ? ` · ${section.sub}` : ''}
              </span>
              <span className='sec-chevron'>▾</span>
            </div>
            <div className='sec-body'>
              <div className='feat-grid'>
                {rows.map((b) => {
                  const cls = b._group;
                  // The gold-circle .lvl badge (showing either the
                  // action cost glyph or the feat's level) was removed
                  // at the user's request — it duplicated the Lv
                  // chip in .meta on the right edge and made the row
                  // feel busy. Card now has just .nm + .meta.
                  return (
                    <div
                      key={`${cls}-${b.id}`}
                      className={`feat ${cls}`}
                      onClick={() =>
                        openDrawer({
                          type:
                            b.type === 'class-feature' || b.type === 'physical-feature'
                              ? 'class-feature'
                              : b.type === 'heritage'
                                ? 'heritage'
                                : 'feat',
                          data: { id: b.id },
                          extra: { addToHistory: true },
                        })
                      }
                    >
                      <div className='nm'>
                        {b.name}
                        <small>{b.type.replace('-', ' ')}</small>
                      </div>
                      <div className='meta'>
                        {cls === 'feature' ? 'FEATURE' : cls.toUpperCase()}
                        <b>Lv {b.level ?? 1}</b>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </section>
        );
      })}

      {filtered.length === 0 && (
        <div
          style={{
            color: 'var(--ink-muted)',
            fontStyle: 'italic',
            fontSize: 13,
            padding: '40px 0',
            textAlign: 'center',
            fontFamily: "'Cormorant Garamond', serif",
          }}
        >
          No feats or features match this filter.
        </div>
      )}
    </div>
  );
}

// Helpers to read class / ancestry name without crashing if details
// hasn't been wired up yet.
function getClassName(character: Character | null): string {
  return character?.details?.class?.name ?? '';
}
function getAncestryName(character: Character | null): string {
  return character?.details?.ancestry?.name ?? '';
}

// =======================================================================
// CodexActivitiesPanel
// =======================================================================
// Replaces the embedded SkillsActionsPanel inside the Main tab of the
// codex sheet. Renders strikes (equipped weapons), universal actions,
// and class actions as codex .act-grid rows. Click a strike → cast/strike
// drawer; click an action → action drawer.

export function CodexActivitiesPanel(props: {
  character: Character | null;
  content: ContentPackage;
}) {
  const { character, content } = props;
  const [_drawer, openDrawer] = useAtom(drawerState);
  const [searchQuery, setSearchQuery] = useState('');
  // Encounter / Exploration / Downtime mode tabs. Encounter mode shows
  // the codex-style 5-section breakdown (Strikes / Feats(w/Actions) /
  // Items(w/Actions) / Basic / Skill / Speciality Basics); Exploration
  // and Downtime modes scope to actions carrying the matching trait
  // (Subsist, Craft, Avoid Notice, etc.) so users can find them by mode
  // rather than scrolling past everything.
  const [mode, setMode] = useState<'encounter' | 'exploration' | 'downtime'>('encounter');
  // Action-cost filter — click a cost glyph (1/2/3/reaction/free) to
  // show only actions of that cost. Mirrors the AoN filter strip in
  // the updated codex main mockup.
  const [costFilter, setCostFilter] = useState<1 | 2 | 3 | 'r' | 'f' | null>(null);
  // Collapsed state for each activity sub-header. Key is the group
  // id ('strikes', 'encounter', 'exploration', 'downtime'); value
  // true = collapsed. Persists in localStorage so toggling sticks
  // across renders / character switches.
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>(() => {
    try {
      const raw = localStorage.getItem('wg-activities-collapsed');
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  });
  const toggleGroup = (key: string) => {
    setCollapsedGroups((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      try {
        localStorage.setItem('wg-activities-collapsed', JSON.stringify(next));
      } catch {}
      return next;
    });
  };

  // Drag-reorderable section order. Defaults to ['strikes',
  // 'actions']. Persists in localStorage so the user's order sticks.
  // 'actions' is the catch-all for whichever mode-tab is active —
  // we don't reorder mode tabs themselves, just the strikes-vs-
  // actions stacking within a mode.
  const [sectionOrder, setSectionOrder] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem('wg-activities-order');
      const parsed = raw ? JSON.parse(raw) : null;
      if (Array.isArray(parsed) && parsed.every((s) => typeof s === 'string')) {
        return parsed;
      }
    } catch {}
    // Canonical order matches the user's video reference. Old
    // saved orders that still contain 'actions' (the legacy single
    // Universal section) are upgraded transparently — the action
    // sections defined below append themselves at the end.
    return ['strikes', 'feats', 'items', 'basic', 'skill', 'speciality', 'exploration', 'downtime'];
  });
  const [dragSection, setDragSection] = useState<string | null>(null);
  const moveSection = (from: string, to: string) => {
    if (from === to) return;
    setSectionOrder((prev) => {
      const cur = prev.includes(from) ? prev : [...prev, from];
      const next = cur.filter((x) => x !== from);
      const idx = next.indexOf(to);
      if (idx < 0) next.push(from);
      else next.splice(idx, 0, from);
      try {
        localStorage.setItem('wg-activities-order', JSON.stringify(next));
      } catch {}
      return next;
    });
  };

  // Equipped weapons → strikes. Each gets the full Multiple Attack
  // Penalty (MAP) ladder: total[0] is the first attack (no penalty),
  // [1] is -5, [2] is -10. We show all three so the player can read
  // their iterative attacks without doing the subtraction in their
  // head. getWeaponStats already picks the best of STR/DEX for the
  // weapon (finesse rules, ranged uses DEX, etc.).
  // NOTE: deliberately NOT useMemo'd. `getWeaponStats` reads from
  // the LIVE variable store (mode bonuses, condition penalties,
  // equipment effects, level changes — all the things ops feed
  // into the variable store). A `useMemo([character?.inventory?.items])`
  // would only invalidate when the inventory array reference changes;
  // when the user toggles a mode that grants +1 attack, inventory
  // doesn't change, so the memo would return stale attack bonuses on
  // the displayed strike cards while the description popovers (which
  // recompute from the store on click) show the correct values. Same
  // pattern bit AC, spell-attack, etc. — those were fine because they
  // call getFinalAcValue / getFinalProfValue directly without a memo.
  // The map below is cheap (≤6 equipped weapons typically) so running
  // it every render is fine.
  const strikes = (() => {
    // Handwraps of Mighty Blows are a rune-holder, not a Strike. We
    // drop them from the strike list (the `!isHandwrapsOfMightyBlows`
    // filter) and instead merge their potency/striking/property runes
    // into every unarmed attack via applyHandwrapsToUnarmed.
    // NOTE: if a character somehow has handwraps equipped but NO
    // unarmed attack in their equipped list, the runes apply to
    // nothing and the handwraps simply don't appear as a strike. In
    // practice every character gets an auto-added "Fist" unarmed
    // strike (Fist item id 9252, see process/items/inv-handlers.tsx),
    // so there is always an unarmed attack to receive the runes.
    const wrapsRunes = getEquippedHandwrapsRunes(character?.inventory);
    const equipped =
      character?.inventory?.items
        ?.filter((i) => i.is_equipped && isItemWeapon(i.item) && !isHandwrapsOfMightyBlows(i.item))
        .map((i) => ({ ...i, item: applyHandwrapsToUnarmed(i.item, wrapsRunes) })) ?? [];
    return equipped.map((i) => {
      const stats = getWeaponStats('CHARACTER', i.item);
      const totalArr = (stats.attack_bonus?.total as number[] | undefined) ?? [];
      const a0 = totalArr[0] ?? 0;
      const a1 = totalArr[1] ?? a0 - 5;
      const a2 = totalArr[2] ?? a0 - 10;
      const dmg = stats.damage;
      const dmgString = `${dmg?.dice ?? 1}${dmg?.die ?? 'd6'}${
        dmg?.bonus?.total ? `+${dmg.bonus.total}` : ''
      } ${dmg?.damageType ?? ''}`.trim();
      return {
        invItem: i,
        attacks: [a0, a1, a2] as [number, number, number],
        damage: dmgString,
        name: i.item.name,
      };
    });
  })();

  // Best attack iteratives across all equipped weapons — used to
  // annotate generic Attack-trait action cards (Reactive Strike,
  // Power Attack, Sudden Charge, etc.) with the player's likely
  // attack ladder. We pick the row whose [0] (no-penalty) bonus is
  // highest, so the displayed numbers reflect the user's best
  // option. Falls back to [0,-5,-10] when the character has no
  // equipped weapons at all.
  const bestStrikeMAP = useMemo<[number, number, number]>(() => {
    if (strikes.length === 0) return [0, -5, -10];
    let best = strikes[0].attacks;
    for (const s of strikes) {
      if (s.attacks[0] > best[0]) best = s.attacks;
    }
    return best;
  }, [strikes]);

  // Look up the "Attack" trait id from the content package. The
  // hardcoded TraitType enum in @utils/traits doesn't include it,
  // so we fall back to a name-based scan against the trait list.
  // Cached so we don't rescan on every render.
  const attackTraitId = useMemo<number | null>(() => {
    const traits = (content.traits ?? []) as { id: number; name: string }[];
    const hit = traits.find((t) => t.name?.toLowerCase() === 'attack');
    return hit?.id ?? null;
  }, [content.traits]);

  // All actions from the content package, visible to the character.
  // Bucketed into 5 named sections (Basic / Skill / Speciality Basics /
  // Exploration / Downtime) plus character-derived feats-with-actions
  // and items-with-actions. Sections aren't mutually exclusive — an
  // action can appear in multiple (e.g. Affix a Talisman is a
  // Speciality Basic AND an Exploration Activity).
  const allActions = useMemo(() => {
    return (content.abilityBlocks ?? [])
      .filter((ab) => ab.type === 'action')
      .filter((ab) => isAbilityBlockVisible('CHARACTER', ab))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [content.abilityBlocks]);

  const matchesSearch = (a: { name: string }) =>
    !searchQuery.trim() ||
    a.name.toLowerCase().includes(searchQuery.trim().toLowerCase());
  const matchesCost = (a: { actions?: string | null }) => {
    if (costFilter === null) return true;
    const glyph = actionCostToGlyph(a.actions ?? null);
    return glyph === costFilter;
  };

  // Explicit name lists for the two "basic" buckets — these are the
  // PF2e Player Core's Basic Actions and the niche / situational
  // "Speciality Basics" the user grouped separately. Matched
  // case-insensitively against `action.name`.
  const BASIC_ACTION_NAMES = useMemo(
    () =>
      new Set(
        [
          'Avert Gaze',
          'Cast a Spell',
          'Counteract',
          'Delay',
          'Dismiss',
          'Drop Prone',
          'Escape',
          'Interact',
          'Invest an Item',
          'Leap',
          'Ready',
          'Release',
          'Seek',
          'Sense Motive',
          'Stand',
          'Stride',
          'Strike',
          'Sustain',
        ].map((s) => s.toLowerCase())
      ),
    []
  );
  const SPECIALITY_BASIC_NAMES = useMemo(
    () =>
      new Set(
        [
          'Affix a Talisman',
          'Arrest a Fall',
          'Burrow',
          'Crawl',
          'Fly',
          'Grab an Edge',
          'Mount',
          'Point Out',
          'Raise a Shield',
          'Refocus',
          'Run Over',
          'Step',
          'Take Cover',
        ].map((s) => s.toLowerCase())
      ),
    []
  );

  // Character's known feats that have an action cost. Drives the
  // "Feats (with Actions)" section.
  const featsWithActions = useMemo(() => {
    if (!character) return [] as AbilityBlock[];
    const featIds = getVariable<VariableListStr>('CHARACTER', 'FEAT_IDS')?.value ?? [];
    const ids = new Set(featIds.map((v) => parseInt(v)));
    return (content.abilityBlocks ?? [])
      .filter((ab) => ab.type === 'feat' && ids.has(ab.id))
      .filter((ab) => ab.actions != null)
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [character, content.abilityBlocks]);

  // Character's inventory items that carry an action — magic items
  // with built-in activations, scrolls/wands with a loaded spell,
  // talismans, etc. Mirrors the detection used by the legacy
  // SkillsActionsPanel so the two views agree.
  const itemsWithActions = useMemo(() => {
    const items = character?.inventory?.items ?? [];
    return items.filter((invItem) => {
      if (
        getFillableSpellHolder(invItem.item) &&
        invItem.item.meta_data?.scroll_wand?.spell_id
      ) {
        return true;
      }
      return findActions(invItem.item.description ?? '').length > 0;
    });
  }, [character?.inventory?.items]);

  // Categorise `allActions` into the 5 named buckets. Buckets aren't
  // mutually exclusive — a row can appear in more than one if it
  // matches multiple criteria (e.g. Refocus is both a Speciality
  // Basic and an Exploration Activity). The list ordering inside
  // each bucket is the alphabetical order inherited from
  // `allActions`.
  // Helper: "encounter mode" excludes things that primarily live under
  // an Exploration- or Downtime-trait header. Without this, an action
  // like Subsist (Survival, Downtime, Skill) would appear in both
  // Skill Actions and Downtime Activities — and the user explicitly
  // wants downtime-tagged things to live ONLY under the Downtime tab.
  const isEncounterEligible = (a: AbilityBlock) =>
    !hasTraitType('EXPLORATION', a.traits ?? undefined) &&
    !hasTraitType('DOWNTIME', a.traits ?? undefined);

  const basicActions = useMemo(
    () =>
      allActions
        .filter(isEncounterEligible)
        .filter((a) => BASIC_ACTION_NAMES.has(a.name.toLowerCase())),
    [allActions, BASIC_ACTION_NAMES]
  );
  const skillActions = useMemo(
    () =>
      allActions
        .filter(isEncounterEligible)
        .filter((a) => hasTraitType('SKILL', a.traits ?? undefined)),
    [allActions]
  );
  const specialityBasics = useMemo(
    () =>
      allActions
        .filter(isEncounterEligible)
        .filter((a) => SPECIALITY_BASIC_NAMES.has(a.name.toLowerCase())),
    [allActions, SPECIALITY_BASIC_NAMES]
  );
  const explorationActions = useMemo(
    () => allActions.filter((a) => hasTraitType('EXPLORATION', a.traits ?? undefined)),
    [allActions]
  );
  const downtimeActions = useMemo(
    () => allActions.filter((a) => hasTraitType('DOWNTIME', a.traits ?? undefined)),
    [allActions]
  );

  // Strikes are always 1-action; only show them if the cost filter
  // is null or 1.
  const filteredStrikes = strikes
    .filter(matchesSearch)
    .filter(() => costFilter === null || costFilter === 1);

  const openStrike = (invItem: InventoryItem) => {
    // stat-weapon drawer expects `item` (the bare Item), not the
    // InventoryItem wrapper. Passing invItem caused the drawer to
    // crash with "Cannot read properties of undefined (reading 'name')"
    // when trying to render the title.
    openDrawer({
      type: 'stat-weapon',
      data: { id: 'CHARACTER', item: invItem.item },
      extra: { addToHistory: true },
    });
  };
  const openAction = (action: AbilityBlock) => {
    openDrawer({ type: 'action', data: { id: action.id }, extra: { addToHistory: true } });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {/* Single-row toolbar: search field + 5 action-cost glyph
          filters + 3 mode tabs. Everything in one horizontal strip,
          no stacking. Search input gets a leading magnifying-glass
          SVG matching the wg4 reference. */}
      <div className='activities-bar'>
        <div className='field act-search-field'>
          <span className='act-search-icon' aria-hidden='true'>
            <svg viewBox='0 0 16 16' fill='none' stroke='currentColor' strokeWidth='1.5' strokeLinecap='round'>
              <circle cx='7' cy='7' r='4.5' />
              <line x1='10.3' y1='10.3' x2='13.5' y2='13.5' />
            </svg>
          </span>
          <input
            type='text'
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder='Search activities…'
          />
        </div>
        <div className='cost-filters'>
          {(
            [
              { v: 1 as const, label: '1 action' },
              { v: 2 as const, label: '2 actions' },
              { v: 3 as const, label: '3 actions' },
              { v: 'r' as const, label: 'Reaction' },
              { v: 'f' as const, label: 'Free' },
            ]
          ).map(({ v, label }) => (
            <div
              key={String(v)}
              title={label}
              onClick={() => setCostFilter(costFilter === v ? null : v)}
              className={`cost-filter ${costFilter === v ? 'on' : ''}`}
            >
              <ActionGlyph cost={v} />
            </div>
          ))}
        </div>
        <div className='mode-tabs'>
          <div
            className={`mode-tab ${mode === 'encounter' ? 'on' : ''}`}
            onClick={() => setMode('encounter')}
          >
            Encounter
          </div>
          <div
            className={`mode-tab ${mode === 'exploration' ? 'on' : ''}`}
            onClick={() => setMode('exploration')}
          >
            Exploration
          </div>
          <div
            className={`mode-tab ${mode === 'downtime' ? 'on' : ''}`}
            onClick={() => setMode('downtime')}
          >
            Downtime
          </div>
        </div>
      </div>

      {/* Render strikes + activities in the user-chosen order. Each
          section header is draggable; dropping one onto another
          swaps positions. Order persists in localStorage so the
          arrangement sticks across reloads. */}
      {(() => {
        // Common drag-event helpers, applied to every section header.
        const dragProps = (id: string) => ({
          draggable: true,
          onDragStart: (e: React.DragEvent) => {
            e.dataTransfer.effectAllowed = 'move';
            try { e.dataTransfer.setData('text/plain', id); } catch {}
            setDragSection(id);
          },
          onDragOver: (e: React.DragEvent) => {
            if (dragSection && dragSection !== id) {
              e.preventDefault();
              e.dataTransfer.dropEffect = 'move';
            }
          },
          onDrop: (e: React.DragEvent) => {
            e.preventDefault();
            if (dragSection) moveSection(dragSection, id);
            setDragSection(null);
          },
          onDragEnd: () => setDragSection(null),
        });

        // Helper: render an action card. Used by every action section
        // (basic / skill / speciality / exploration / downtime / feats).
        //
        // The right-hand .stat column shows whichever of these the
        // action calls for, in priority order:
        //   1. Strikes / Attack-trait actions → MAP iterative ladder
        //   2. Movement actions (Stride, Step, Crawl, Leap, …) →
        //      distance pulled from SPEED / hardcoded per the SRD
        //   3. Multi-success movement (High Jump, Long Jump) →
        //      multiple distances per success level (Success / Crit)
        //   4. Skill actions (meta_data.skill set) → character's bonus
        //      using the highest of the listed skills when multiple
        //   5. Fallback → em-dash
        const actionCard = (action: AbilityBlock) => {
          const glyph = actionCostToGlyph(action.actions ?? null);
          const isAttack =
            attackTraitId != null && (action.traits ?? []).includes(attackTraitId);

          // Movement & multi-success distance lookups. These are
          // hardcoded against the PF2e Player Core rules — there's no
          // MOVE trait in the content package, and even if there were
          // the per-action distance isn't carried as data.
          const nameKey = action.name.toLowerCase().trim();
          const speed = getVariable<VariableNum>('CHARACTER', 'SPEED')?.value ?? 25;
          const flySpeed = getVariable<VariableNum>('CHARACTER', 'SPEED_FLY')?.value ?? 0;
          const climbSpeed = getVariable<VariableNum>('CHARACTER', 'SPEED_CLIMB')?.value ?? 0;
          const burrowSpeed = getVariable<VariableNum>('CHARACTER', 'SPEED_BURROW')?.value ?? 0;
          const swimSpeed = getVariable<VariableNum>('CHARACTER', 'SPEED_SWIM')?.value ?? 0;

          // Single-distance movement actions. Each maps to either a
          // fixed value or a derived value from the character's
          // movement speeds. Step is always 5 ft per the rules even
          // when the character has a faster Speed.
          const SINGLE_MOVE: Record<string, string> = {
            stride: `${speed} ft`,
            step: '5 ft',
            crawl: '5 ft',
            leap: speed >= 30 ? '10 ft' : '5 ft',
            'sudden charge': `${speed * 2} ft`,
            fly: flySpeed > 0 ? `${flySpeed} ft` : '—',
            climb: climbSpeed > 0 ? `${climbSpeed} ft` : '5 ft',
            burrow: burrowSpeed > 0 ? `${burrowSpeed} ft` : '—',
            swim: swimSpeed > 0 ? `${swimSpeed} ft` : '—',
          };

          // Multi-success movement actions. Each shows two ranges
          // (Success / Crit Success) so the player doesn't have to
          // look up Athletics rules during play. Long Jump distance
          // scales with Speed; High Jump is fixed by the rulebook.
          const MULTI_MOVE: Record<string, { s: string; cs: string }> = {
            'high jump': { s: '3 ft', cs: '5 ft' },
            'long jump': { s: `${Math.max(0, speed - 5)} ft`, cs: `${speed} ft` },
          };

          let statContent: React.ReactNode = '—';
          let statClass = ' dim';
          if (isAttack) {
            statClass = '';
            statContent = (
              <span className='map'>
                {sign(bestStrikeMAP[0])}
                <i>/</i>
                {sign(bestStrikeMAP[1])}
                <i>/</i>
                {sign(bestStrikeMAP[2])}
              </span>
            );
          } else if (nameKey in MULTI_MOVE) {
            statClass = '';
            const m = MULTI_MOVE[nameKey];
            statContent = (
              <span className='move'>
                {m.s}
                <i>/</i>
                {m.cs}
              </span>
            );
          } else if (nameKey in SINGLE_MOVE && SINGLE_MOVE[nameKey] !== '—') {
            statClass = '';
            statContent = <span className='move'>{SINGLE_MOVE[nameKey]}</span>;
          } else if (action.meta_data?.skill) {
            // Skill action — show character's bonus using the highest
            // of the listed skills. meta_data.skill may be a string
            // (e.g. "Athletics") or an array of strings (e.g.
            // ["Athletics", "Acrobatics"]) when the action lets you
            // pick. We resolve each to its SKILL_X variable and pick
            // the larger numeric bonus. Lore skills are wildcarded —
            // when meta_data.skill is 'Lore' we fall back to '+0'
            // since we can't know which Lore subskill to display.
            const skillsRaw = Array.isArray(action.meta_data.skill)
              ? action.meta_data.skill
              : [action.meta_data.skill];
            const skillNames = skillsRaw.map((s) => String(s));
            let best: { name: string; varName: string; n: number; str: string } | null = null;
            for (const sk of skillNames) {
              if (!sk) continue;
              const lv = labelToVariable(sk);
              // Skip the generic 'LORE' — without a specific Lore
              // sub-skill, getFinalProfValue returns +0 which is
              // misleading.
              if (lv === 'LORE') continue;
              const varName = `SKILL_${lv}`;
              const str = getFinalProfValue('CHARACTER', varName);
              const n = parseInt(str.replace(/[^\-0-9]/g, ''), 10) || 0;
              if (best === null || n > best.n) best = { name: sk, varName, n, str };
            }
            if (best) {
              statClass = '';
              statContent = (
                <span className='skill'>
                  {best.str}
                  <ProfCondMark varName={best.varName} />
                  <small> {best.name}</small>
                </span>
              );
            }
          }

          // Build a short descriptive subtitle from the action's traits or
          // the trigger/requirement field. Matches the wg4 reference's
          // `.desc` line beneath each activity name (e.g. "Intim. vs Will
          // · frightened", "move up to your Speed").
          const actionTraits: string[] = (
            (action as { traits?: unknown[] }).traits ?? []
          ).map((t) =>
            typeof t === 'string' ? t : (t as { name?: string })?.name ?? ''
          ).filter((s): s is string => !!s);
          const skipActTraits = new Set([
            'common', 'uncommon', 'rare', 'unique', 'action', 'general',
          ]);
          const actDescParts = actionTraits
            .map((t) => t.toLowerCase().replace(/_/g, ' '))
            .filter((t) => !skipActTraits.has(t))
            .slice(0, 3);
          // Fallback: use the first short clause of the description.
          const desc = action.description ?? '';
          const firstClause = desc
            .replace(/<[^>]+>/g, '')
            .split(/[.!?]/)[0]
            ?.trim()
            ?.slice(0, 60);
          const actSub = actDescParts.length > 0
            ? actDescParts.join(' · ')
            : (firstClause && firstClause.length < 60 ? firstClause : '');

          return (
            <div key={action.id} className='act' onClick={() => openAction(action)}>
              <div className='cost'>{glyph ? <ActionGlyph cost={glyph} /> : null}</div>
              <div className='nm'>
                {action.name}
                {actSub && <small className='desc'>{actSub}</small>}
              </div>
              <div className={`stat${statClass}`}>{statContent}</div>
            </div>
          );
        };

        // Helper: render a complete action-style section with header +
        // grid. Each section has its own collapsed-state key in
        // localStorage and is draggable/reorderable. Sections with
        // zero post-filter rows return null and don't render at all.
        const renderActionSection = (
          id: string,
          title: string,
          actions: AbilityBlock[]
        ): React.ReactNode | null => {
          const rows = actions.filter(matchesSearch).filter(matchesCost);
          if (rows.length === 0) return null;
          const collapsed = !!collapsedGroups[id];
          return (
            <div key={id}>
              <div
                className={`act-group-label collapsible draggable${collapsed ? ' collapsed' : ''}${dragSection === id ? ' dragging' : ''}`}
                onClick={() => toggleGroup(id)}
                role='button'
                tabIndex={0}
                {...dragProps(id)}
                title='Drag to reorder · click to collapse'
              >
                <span className='drag-grip'>⋮⋮</span>
                <span className='collapse-chev'>▾</span>
                {title}
              </div>
              {!collapsed && (
                <div className='act-grid'>
                  {rows.slice(0, 200).map(actionCard)}
                </div>
              )}
              {!collapsed && rows.length > 200 && (
                <div
                  style={{
                    color: 'var(--ink-muted)',
                    fontStyle: 'italic',
                    fontSize: 12,
                    textAlign: 'center',
                    padding: '6px 0',
                  }}
                >
                  … {rows.length - 200} more (refine search)
                </div>
              )}
            </div>
          );
        };

        // Items-with-actions section. Items don't carry a top-level
        // `actions` enum like ability-blocks do — we infer the cost
        // from `findActions(item.description)` (or default to
        // 2-actions for scroll/wand activations). Renders only when
        // there's something to show.
        const renderItemsSection = (): React.ReactNode | null => {
          const rows = itemsWithActions.filter((invItem) =>
            matchesSearch(invItem.item)
          );
          if (rows.length === 0) return null;
          const collapsed = !!collapsedGroups['items'];
          return (
            <div key='items'>
              <div
                className={`act-group-label collapsible draggable${collapsed ? ' collapsed' : ''}${dragSection === 'items' ? ' dragging' : ''}`}
                onClick={() => toggleGroup('items')}
                role='button'
                tabIndex={0}
                {...dragProps('items')}
                title='Drag to reorder · click to collapse'
              >
                <span className='drag-grip'>⋮⋮</span>
                <span className='collapse-chev'>▾</span>
                Items (with Actions) <b>·</b> {rows.length} item{rows.length === 1 ? '' : 's'}
              </div>
              {!collapsed && (
                <div className='act-grid'>
                  {rows.slice(0, 200).map((invItem) => {
                    const acts = findActions(invItem.item.description ?? '');
                    const scrollWandHolder = getFillableSpellHolder(invItem.item);
                    const scrollWandFilled =
                      scrollWandHolder && invItem.item.meta_data?.scroll_wand?.spell_id;
                    const rawCost =
                      acts.length > 0 ? acts[0] : scrollWandFilled ? 'TWO-ACTIONS' : 'ONE-ACTION';
                    const glyph = actionCostToGlyph(rawCost);
                    return (
                      <div
                        key={invItem.id}
                        className='act'
                        onClick={() =>
                          openDrawer({
                            type: 'inv-item',
                            data: { invItem, id: 'CHARACTER' },
                            extra: { addToHistory: true },
                          })
                        }
                      >
                        <div className='cost'>{glyph ? <ActionGlyph cost={glyph} /> : null}</div>
                        <div className='nm'>{invItem.item.name}</div>
                        <div className='stat dim'>—</div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        };

        // Build a map of section id → JSX in the canonical order.
        // sectionOrder (from localStorage drag-state) reorders them
        // at the bottom; extras (any sections we emit that aren't in
        // sectionOrder yet) get appended in this declaration order.
        const sections: Record<string, React.ReactNode> = {};

        if (mode === 'encounter' && filteredStrikes.length > 0) {
          sections['strikes'] = (
            <div key='strikes'>
              <div
                className={`act-group-label collapsible draggable${collapsedGroups['strikes'] ? ' collapsed' : ''}${dragSection === 'strikes' ? ' dragging' : ''}`}
                onClick={() => toggleGroup('strikes')}
                role='button'
                tabIndex={0}
                {...dragProps('strikes')}
                title='Drag to reorder · click to collapse'
              >
                <span className='drag-grip'>⋮⋮</span>
                <span className='collapse-chev'>▾</span>
                × Strikes <b>·</b> one action each
              </div>
              {!collapsedGroups['strikes'] && (
                <div className='act-grid'>
                  {filteredStrikes.map(({ invItem, attacks, damage }) => {
                    // Build wg4-style subtitle ("melee · finesse · deadly d8")
                    // from the weapon's traits + category. Mirrors the
                    // reference design's `.desc` line beneath each strike.
                    // Build from weapon group (melee/ranged) + traits only;
                    // skip raw .meta_data.category since it surfaces ugly
                    // strings like 'unarmed_attack'.
                    const item: any = invItem.item;
                    const group: string | undefined = item?.meta_data?.group
                      || item?.meta_data?.weapon?.group
                      || item?.meta_data?.weapon_data?.group;
                    // melee vs ranged inferred from item.meta_data.range
                    const rawRange: number | string | undefined =
                      item?.meta_data?.range
                      ?? item?.meta_data?.weapon?.range
                      ?? item?.meta_data?.weapon_data?.range;
                    const weaponKind: string | undefined =
                      typeof rawRange === 'number' && rawRange > 5 ? 'ranged'
                        : typeof rawRange === 'string' && rawRange && rawRange !== '0' ? 'ranged'
                          : 'melee';
                    const traitsArr: string[] = (
                      (item?.traits as unknown[] | undefined)?.map?.((t: unknown) =>
                        typeof t === 'string' ? t : (t as { name?: string })?.name
                      ).filter((s): s is string => !!s) ?? []
                    );
                    // Filter out boring/internal traits so the subtitle reads cleanly.
                    const skipTraits = new Set([
                      'unarmed_attack', 'unarmed', 'attack', 'common',
                      'uncommon', 'rare', 'unique',
                    ]);
                    const cleanTraits = traitsArr
                      .map((t) => t.toLowerCase().replace(/_/g, ' '))
                      .filter((t) => !skipTraits.has(t));
                    const subParts: string[] = [];
                    subParts.push(weaponKind);
                    if (weaponKind === 'ranged' && rawRange) {
                      subParts[subParts.length - 1] = `ranged ${rawRange}`;
                    }
                    if (group) subParts.push(String(group).toLowerCase());
                    cleanTraits.slice(0, 3).forEach((t) => subParts.push(t));
                    const sub = subParts.join(' · ');
                    return (
                    <div
                      key={invItem.id}
                      className='act strike'
                      onClick={() => openStrike(invItem)}
                    >
                      <div className='cost'>
                        <ActionGlyph cost={1} />
                      </div>
                      <div className='nm'>
                        {invItem.item.name}
                        {sub && <small className='desc'>{sub}</small>}
                      </div>
                      <div className='stat'>
                        <span className='map'>
                          {sign(attacks[0])}
                          <i>/</i>
                          {sign(attacks[1])}
                          <i>/</i>
                          {sign(attacks[2])}
                        </span>
                        <small>
                          <span className='dmg'>{damage}</span>
                        </small>
                      </div>
                    </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        }

        // Encounter mode owns the 5-section codex breakdown plus
        // feats/items derived from the character. Exploration and
        // Downtime modes each render only the single matching section,
        // which keeps the mode tabs feeling distinct from the codex
        // sub-sections beneath.
        if (mode === 'encounter') {
          const className = props.character?.details?.class?.name ?? 'Class';
          const featSection = renderActionSection('feats', `Class · ${className}`, featsWithActions);
          if (featSection) sections['feats'] = featSection;

          const itemsSection = renderItemsSection();
          if (itemsSection) sections['items'] = itemsSection;

          // Merge speciality basics into the universal section — the wg4
          // reference shows ONE combined "Universal · Encounter" with all
          // basic combat actions (Stride/Step/Demoralize/etc.) plus the
          // speciality movement basics (Arrest a Fall/Burrow/etc.). The
          // old layout split them into two sections which doesn't match.
          const universalAll = [...basicActions, ...specialityBasics];
          const basicSection = renderActionSection('basic', 'Universal · encounter', universalAll);
          if (basicSection) sections['basic'] = basicSection;

          const skillSection = renderActionSection('skill', 'Skill actions', skillActions);
          if (skillSection) sections['skill'] = skillSection;
        } else if (mode === 'exploration') {
          const explorationSection = renderActionSection(
            'exploration',
            'Exploration Activities',
            explorationActions
          );
          if (explorationSection) sections['exploration'] = explorationSection;
        } else if (mode === 'downtime') {
          const downtimeSection = renderActionSection(
            'downtime',
            'Downtime Activities',
            downtimeActions
          );
          if (downtimeSection) sections['downtime'] = downtimeSection;
        }

        // Iterate the user-chosen order; fall back to insertion order
        // for any new keys not yet recorded.
        const known = new Set(sectionOrder);
        const extras = Object.keys(sections).filter((k) => !known.has(k));
        return [...sectionOrder, ...extras]
          .map((id) => sections[id])
          .filter((n) => n != null);
      })()}

      {(() => {
        // Mode-aware empty state — only fires if NO section in the
        // active mode has rows. Mirrors the section-emission logic
        // above so encounter / exploration / downtime each get the
        // appropriate "nothing here" copy.
        const inMode =
          mode === 'encounter'
            ? basicActions.filter(matchesSearch).filter(matchesCost).length +
              skillActions.filter(matchesSearch).filter(matchesCost).length +
              specialityBasics.filter(matchesSearch).filter(matchesCost).length +
              featsWithActions.filter(matchesSearch).filter(matchesCost).length +
              itemsWithActions.filter((i) => matchesSearch(i.item)).length +
              filteredStrikes.length
            : mode === 'exploration'
              ? explorationActions.filter(matchesSearch).filter(matchesCost).length
              : downtimeActions.filter(matchesSearch).filter(matchesCost).length;
        if (inMode > 0) return null;
        return (
          <div
            style={{
              color: 'var(--ink-muted)',
              fontStyle: 'italic',
              fontSize: 13,
              padding: '10px 0',
              textAlign: 'center',
            }}
          >
            {searchQuery.trim()
              ? `No matches for "${searchQuery.trim()}"`
              : mode === 'exploration'
                ? 'No exploration activities available.'
                : mode === 'downtime'
                  ? 'No downtime activities available.'
                  : 'No actions in this mode.'}
          </div>
        );
      })()}
    </div>
  );
}
