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
import { collectEntitySpellcasting, collectEntityAbilityBlocks } from '@content/collect-content';
import { getVariable } from '@variables/variable-manager';
import { VariableProf, VariableListStr, VariableNum } from '@schemas/variables';
import { labelToVariable } from '@variables/variable-utils';
import { findActions } from '@utils/actions';
import { getFillableSpellHolder } from '@items/inv-utils';
// @items alias maps to process/items in tsconfig; explicit re-import
// path makes this unambiguous in the rare case the alias isn't set.
import { getFinalProfValue } from '@variables/variable-helpers';
import { rankNumber } from '@utils/numbers';
import {
  getInvBulk,
  getBulkLimit,
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
import { isItemWeapon } from '@items/inv-utils';
import { cloneDeep } from 'lodash-es';
import ManageSpellsModal from '@modals/ManageSpellsModal';
import { openContextModal } from '@mantine/modals';
import { Title } from '@mantine/core';
import { Item } from '@schemas/content';
import { handleAddItem, handleDeleteItem, handleMoveItem, handleUpdateItem } from '@items/inv-handlers';
import { modals } from '@mantine/modals';
import { getWeaponStats } from '@items/weapon-handler';
import { isAbilityBlockVisible } from '@content/content-hidden';
import { hasTraitType } from '@utils/traits';
import { getContentFast } from '@content/content-store';
import type { Trait } from '@schemas/content';
import { AbilityBlock } from '@schemas/content';
import { sign } from '@utils/numbers';

// -----------------------------------------------------------------------
// Shared inline-SVG action-cost sprite — used by both spells + activities.
// Renders as <ActionGlyph cost="1" /> → 1-action / 2-action / 3-action /
// reaction (ar) / free (af). Matches the .ai class from codex.css.
// -----------------------------------------------------------------------

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
    c === 'r' ? 'var(--crimson)' : c === 'f' ? 'var(--gold-bright)' : 'var(--gold)';
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
              : 'drop-shadow(0 0 3px rgba(201,161,59,.35))',
      }}
    >
      {ch}
    </span>
  );
}

// Map a textual action cost from data to a glyph identifier.
function actionCostToGlyph(
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

export function CodexSpellsPanel(props: {
  characterId: number;
  character: Character | null;
  setCharacter: SetterOrUpdater<Character | null>;
  content: ContentPackage;
}) {
  const { character, content } = props;
  const [_drawer, openDrawer] = useAtom(drawerState);
  const [searchQuery, setSearchQuery] = useState('');
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
  const focusCurrent = character?.spells?.focus_point_current ?? 0;
  const focusMax = charData?.focus?.length
    ? Math.min(3, charData.focus.length)
    : 0;

  const setFocusPoints = (next: number) => {
    const clamped = Math.max(0, Math.min(focusMax || 3, next));
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

  // Toggle the signature flag on a spell in a spontaneous repertoire.
  // PF2e rule: one signature spell per spell rank per source. When
  // turning a spell into a signature we clear any other entry with the
  // same (source, rank) flag — silently swapping is friendlier than
  // erroring out. Mirrors the legacy SpontaneousSpellsList logic.
  const toggleSignature = (spellId: number, sourceName: string) => {
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
        zIndex: 600,
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
    const tradition = sourceObj.tradition?.toLowerCase();
    const knownIdsAtRank = new Set(
      (character?.spells?.list ?? [])
        .filter((e) => e.source === sourceObj.name && e.rank === rank)
        .map((e) => e.spell_id)
    );
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
        zIndex: 600,
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
        advancedPresetFilters: {
          type: 'spell',
          spell_type: 'NORMAL',
          traditions: tradition ? [tradition] : undefined,
          rank_min: 0,
          rank_max: rank,
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

  return (
    <div className='codex-tab-body'>
      {sources.length === 0 && (
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
        const castType = source.type?.replace(/-/g, ' ').toLowerCase() ?? '—';
        const attrName = source.attribute?.replace('ATTRIBUTE_', '') ?? '';
        const attrV = source.attribute
          ? getVariable<{ value: { value: number } }>('CHARACTER', source.attribute)?.value?.value ?? 0
          : 0;
        const spellAttack = source.name ? getFinalProfValue('CHARACTER', `SPELL_ATTACK_${source.name.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`) : null;
        const spellDc = source.name ? getFinalProfValue('CHARACTER', `SPELL_DC_${source.name.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`, true) : null;

        // Slots for this source, grouped by rank.
        const slots = (charData?.slots ?? []).filter((s) => s.source === source.name);
        const slotsByRank = new Map<number, typeof slots>();
        for (const slot of slots) {
          if (!slotsByRank.has(slot.rank)) slotsByRank.set(slot.rank, []);
          slotsByRank.get(slot.rank)!.push(slot);
        }

        // Spell list for this source, grouped by rank (the spells the
        // caster knows, separate from slots).
        const repList = (charData?.list ?? []).filter((e) => e.source === source.name);
        const listByRank = new Map<number, typeof repList>();
        for (const entry of repList) {
          if (!listByRank.has(entry.rank)) listByRank.set(entry.rank, []);
          listByRank.get(entry.rank)!.push(entry);
        }

        // Compositions / focus spells — separate group, shown above ranks.
        const focusSpells = (charData?.focus ?? [])
          .filter((f) => f.source === source.name)
          .map((f) => findSpell(f.spell_id))
          .filter((s): s is Spell => !!s);

        // Discover all ranks the caster has — union of slot ranks + list ranks.
        const allRanks = new Set<number>([
          ...Array.from(slotsByRank.keys()),
          ...Array.from(listByRank.keys()),
        ]);
        const sortedRanks = Array.from(allRanks).sort((a, b) => a - b);

        return (
          <div key={source.name} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {/* Tradition line */}
            <div className='tradition-line'>
              <span className='t-name'>{tradition} Tradition</span>
              <span className='t-sep'>·</span>
              <span style={{ textTransform: 'capitalize' }}>{castType}</span>
              {attrName && (
                <>
                  <span className='t-sep'>·</span>
                  <span>
                    <b>{attrName} {attrV >= 0 ? '+' : ''}{attrV}</b>
                  </span>
                </>
              )}
              {spellAttack && (
                <>
                  <span className='t-sep'>·</span>
                  <span>Atk <b>{spellAttack}</b></span>
                </>
              )}
              {spellDc && (
                <>
                  <span className='t-sep'>·</span>
                  <span>DC <b>{spellDc}</b></span>
                </>
              )}
            </div>

            {/* Search */}
            <div className='spell-search'>
              <div className='field'>
                <input
                  type='text'
                  placeholder='Search spells…'
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
              <span className='filter on'>Known</span>
              <span
                className='add'
                onClick={() => {
                  // Open the proper ManageSpellsModal — same one the
                  // legacy SpellsPanel uses. Type depends on caster:
                  // prepared-list = SLOTS-AND-LIST (manage spellbook
                  // and prepare into slots), prepared-tradition =
                  // SLOTS-ONLY, spontaneous = LIST-ONLY.
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
              </span>
            </div>

            {/* Compositions / focus spells */}
            {focusSpells.length > 0 && (
              <section className='sec'>
                <div className='sec-title'>
                  <span className='lozenge' style={{ color: 'var(--crimson)' }}>❦</span>
                  <span className='label'>Compositions</span>
                  <span className='sub'>
                    Focus <b>{focusCurrent}</b> / {focusMax || 3}
                    <span className='focus-pips inline'>
                      {[0, 1, 2].slice(0, focusMax || 3).map((i) => (
                        <span
                          key={i}
                          className={i < focusCurrent ? 'fp full' : 'fp'}
                          onClick={(e) => {
                            e.stopPropagation();
                            setFocusPoints(i < focusCurrent ? i : i + 1);
                          }}
                        ></span>
                      ))}
                    </span>
                  </span>
                </div>
                <div className='sec-body'>
                  <div className='sp-grid'>
                    {focusSpells.filter(matchesSearch).map((spell) => (
                      <SpellRow
                        key={spell.id}
                        spell={spell}
                        variant='focus'
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
                              // Focus spells burn a focus point, not a slot.
                              onCastSpell: (cast: boolean) => setFocusPoints(focusCurrent + (cast ? -1 : 1)),
                            },
                            extra: { addToHistory: true },
                          })
                        }
                      />
                    ))}
                  </div>
                </div>
              </section>
            )}

            {/* Per-rank sections */}
            {sortedRanks.map((rank) => {
              const rankSlots = slotsByRank.get(rank) ?? [];
              const rankList = listByRank.get(rank) ?? [];
              const isCantripRank = rank === 0;

              // For prepared casters, slots have spell_id assigned; for
              // spontaneous, the list IS the repertoire and slots are
              // just available-cast counters. Signature flag only
              // matters for spontaneous (PF2e doesn't let prepared
              // casters mark signatures; cantrips and rituals are
              // also excluded by the canMarkSignature gate below).
              const isPrepared = source.type?.startsWith('PREPARED');
              const isSpontaneous = source.type === 'SPONTANEOUS-REPERTOIRE';
              const cells: {
                spell: Spell | undefined;
                slotIdx: number | null;
                exhausted: boolean;
                signature: boolean;
              }[] = [];
              if (isPrepared) {
                rankSlots.forEach((slot, i) => {
                  const spell = slot.spell_id ? findSpell(slot.spell_id) : undefined;
                  cells.push({ spell, slotIdx: i, exhausted: !!slot.exhausted, signature: false });
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

              // "Filled" pip semantics depend on caster type:
              //   prepared    — slots that are both prepared (have a
              //                 spell_id assigned) AND not yet cast.
              //                 An empty slot is NOT filled.
              //   spontaneous — just "not yet cast" (slots are
              //                 generic available-cast counters).
              const filledSlots = rankSlots.filter((s) =>
                source.type?.startsWith('PREPARED')
                  ? !s.exhausted && s.spell_id != null
                  : !s.exhausted
              ).length;
              const totalSlots = rankSlots.length;

              return (
                <section key={rank} className='sec'>
                  <div className='sec-title'>
                    <span className='lozenge'>{isCantripRank ? '✦' : '❖'}</span>
                    <span className='label'>{isCantripRank ? 'Cantrips' : `${rankNumber(rank)} Rank`}</span>
                    {!isCantripRank && totalSlots > 0 && (
                      <span className='sub'>
                        Slots
                        <span className='rank-pips'>
                          {Array.from({ length: totalSlots }).map((_, i) => (
                            <span
                              key={i}
                              className={i < filledSlots ? 'dot-pip filled' : 'dot-pip'}
                            ></span>
                          ))}
                        </span>
                      </span>
                    )}
                    {isCantripRank && (
                      <span className='sub'>always available</span>
                    )}
                  </div>
                  <div className='sec-body'>
                    {cells.length === 0 ? (
                      <div
                        style={{
                          color: 'var(--ink-muted)',
                          fontStyle: 'italic',
                          fontSize: 12,
                          padding: '6px 0',
                        }}
                      >
                        No spells.
                      </div>
                    ) : (
                      <div className='sp-grid'>
                        {cells
                          .filter((c) => matchesSearch(c.spell))
                          .map((cell, i) => {
                            // Signature toggle only applies to non-
                            // cantrip, non-ritual spells in a
                            // spontaneous repertoire. Cantrips auto-
                            // heighten (signature is meaningless);
                            // rituals don't heighten at all.
                            const canSig = isSpontaneous && !isCantripRank;
                            // Label for the gold "Prepare X-Rank
                            // Spell" button (empty-slot affordance).
                            // PF2e ranks: 1st/2nd/3rd/4th-10th.
                            const ordinal =
                              rank === 0
                                ? 'Cantrip'
                                : `${rank}${rank === 1 ? 'st' : rank === 2 ? 'nd' : rank === 3 ? 'rd' : 'th'}-Rank Spell`;
                            const emptyLabel = `Prepare ${ordinal}`;
                            return (
                              <SpellRow
                                key={i}
                                spell={cell.spell}
                                variant={isCantripRank ? 'cantrip' : 'heightened'}
                                exhausted={cell.exhausted}
                                emptySlotLabel={emptyLabel}
                                isSignature={cell.signature}
                                onToggleSignature={
                                  canSig && cell.spell
                                    ? () => toggleSignature(cell.spell!.id, source.name)
                                    : undefined
                                }
                                onCast={
                                  // Inline use/restore for prepared
                                  // casters' filled slots (and cantrips
                                  // — though cantrips never exhaust, so
                                  // the button just no-ops). Skip for
                                  // spontaneous since clicking the
                                  // spell uses an unspecific slot at
                                  // the rank via the cast-spell
                                  // drawer.
                                  cell.spell && isPrepared && !isCantripRank
                                    ? (cast: boolean) =>
                                        castSpell(cast, source.name, rank, cell.spell!.id, true)
                                    : undefined
                                }
                                onReplace={
                                  // Replace-spell on prepared slots
                                  // including cantrips. (We used to
                                  // gate this on !isCantripRank, but
                                  // the player still needs a way to
                                  // swap a prepared cantrip without
                                  // first clearing the slot — the
                                  // picker filter already excludes
                                  // already-prepared cantrips so
                                  // duplicates are prevented at the
                                  // pick site instead.)
                                  cell.spell && isPrepared && cell.slotIdx !== null
                                    ? () => {
                                        const slot = rankSlots[cell.slotIdx!];
                                        if (slot) {
                                          pickSpellForSlot(
                                            { name: source.name, type: source.type, tradition: source.tradition },
                                            slot.id,
                                            rank
                                          );
                                        }
                                      }
                                    : undefined
                                }
                                onClick={() => {
                                  // Empty prepared slot — open the
                                  // manage modal at this rank so the
                                  // user can pick a spell to fill it.
                                  // (Spontaneous casters don't have
                                  // "empty" slots — slots only exist
                                  // as available-cast counters.)
                                  if (!cell.spell) {
                                    // Empty prepared slot. Open the
                                    // inline spell picker directly —
                                    // no manage-modal middleman. The
                                    // pickSpellForSlot helper filters
                                    // to spells legal in this slot
                                    // (tradition + rank cap, or
                                    // spellbook for wizard) and on
                                    // confirm writes the chosen spell
                                    // into THIS specific slot id.
                                    if (isPrepared && cell.slotIdx !== null) {
                                      const slot = rankSlots[cell.slotIdx];
                                      if (slot) {
                                        pickSpellForSlot(
                                          { name: source.name, type: source.type, tradition: source.tradition },
                                          slot.id,
                                          rank
                                        );
                                      }
                                    }
                                    return;
                                  }
                                  const spellId = cell.spell.id;
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
                                        castSpell(cast, source.name, rank, spellId, !!isPrepared),
                                    },
                                    extra: { addToHistory: true },
                                  });
                                }}
                              />
                            );
                          })}
                        {/* Spontaneous casters: trailing gold
                            "Add X-Rank Spell" button so the user can
                            add to the repertoire directly from the
                            spell page. Prepared casters already get
                            per-slot buttons via the empty cells
                            above, so they don't need a trailing one. */}
                        {isSpontaneous && (
                          <button
                            type='button'
                            className='sp-add'
                            onClick={() =>
                              pickSpellForRepertoire(
                                { name: source.name, type: source.type, tradition: source.tradition },
                                rank
                              )
                            }
                          >
                            <span className='plus'>+</span>
                            {rank === 0
                              ? 'Add Cantrip'
                              : `Add ${rank}${rank === 1 ? 'st' : rank === 2 ? 'nd' : rank === 3 ? 'rd' : 'th'}-Rank Spell`}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </section>
              );
            })}
          </div>
        );
      })}

      {/* ManageSpellsModal — the same Mantine modal the legacy
          SpellsPanel uses. The codex-bridge re-themes its internals
          so it looks parchment-and-gold; the functionality (add to
          spellbook, prepare into slots, rank picker) is unchanged. */}
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

function SpellRow(props: {
  spell?: Spell;
  variant?: 'cantrip' | 'heightened' | 'focus';
  exhausted?: boolean;
  onClick: () => void;
  // Signature-spell wiring. `isSignature` shows the gold star in
  // front of the name; `onToggleSignature` (when provided) hooks up
  // a right-click context menu. Spontaneous bard / sorcerer / oracle
  // casters get this; everyone else passes neither and right-click
  // does nothing.
  isSignature?: boolean;
  onToggleSignature?: () => void;
  // Inline cast/restore. When provided the row renders a small
  // "Cast"/"Restore" button on the right edge that flips the slot's
  // exhausted state without opening the cast-spell drawer.
  onCast?: (cast: boolean) => void;
  // Inline "Replace spell" — added to the right-click menu for
  // prepared casters.
  onReplace?: () => void;
  // Label used by the empty-slot button. Reads e.g. "Prepare Cantrip"
  // or "Prepare 1st-Rank Spell". Falls back to a generic label when
  // omitted.
  emptySlotLabel?: string;
}) {
  const { spell, variant, exhausted } = props;
  // Right-click context menu state. Stores viewport coords for the
  // floating menu. Same pattern as the character-card context menu —
  // portaled to document.body with a click-outside dismiss.
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

  if (!spell) {
    // Empty prepared slot. Renders as a full-width gold parchment
    // button matching the "SELECT SPELL" buttons in the legacy
    // manage modal — clicking opens the spell picker filtered to
    // this slot's rank cap, with the chosen spell going straight
    // into THIS slot id. No manage-modal middleman.
    return (
      <button
        type='button'
        className='sp-add'
        onClick={(e) => {
          e.stopPropagation();
          props.onClick();
        }}
      >
        <span className='plus'>+</span>
        {props.emptySlotLabel ?? 'Prepare Spell'}
      </button>
    );
  }
  // spell.cast is either an ActionCost enum or a free string. The glyph
  // helper accepts both.
  const castStr =
    typeof spell.cast === 'string' ? spell.cast : (spell.cast as unknown as string | null) ?? null;
  const glyph = actionCostToGlyph(castStr);
  // Subtitle: rank + duration if present, e.g. "Rank 3 · 1 minute".
  const subParts: string[] = [];
  if (spell.rank > 0) subParts.push(`rank ${spell.rank}`);
  if (spell.duration) subParts.push(spell.duration);
  const subtitle = subParts.join(' · ');
  // Trait chips — looked up from the content cache by id. Cap to the
  // first 5 to keep the row readable; the drawer shows all of them
  // anyway. Cached lookup so the row doesn't pay an async cost.
  const traitNames =
    (spell.traits ?? []).length > 0
      ? getContentFast<Trait>('trait', spell.traits ?? [])
          .map((t) => t.name)
          .filter(Boolean)
          .slice(0, 5)
      : [];
  // Right-click context menu is offered whenever there's at least one
  // option to surface — signature toggle (spontaneous) OR replace
  // (prepared). For pure-vanilla rows the right-click does nothing.
  const hasCtxMenu = !!(props.onToggleSignature || props.onReplace);
  return (
    <>
      <div
        className={`sp ${variant ?? ''}${props.isSignature ? ' signature' : ''}${exhausted ? ' exhausted' : ''}`}
        onClick={props.onClick}
        onContextMenu={(e) => {
          if (!hasCtxMenu) return;
          e.preventDefault();
          e.stopPropagation();
          setCtxMenu({ x: e.clientX, y: e.clientY });
        }}
        title={hasCtxMenu ? 'Right-click for spell options' : undefined}
      >
        <div className='cost'>{glyph ? <ActionGlyph cost={glyph} /> : '—'}</div>
        <div className='nm'>
          {/* Gold star prefix for signature spells. */}
          {props.isSignature && <span className='sig-star'>★ </span>}
          {spell.name}
          {traitNames.length > 0 && (
            <span className='sp-tags'>
              {traitNames.map((t) => (
                <span key={t} className='sp-tag'>{t}</span>
              ))}
            </span>
          )}
          {subtitle && <small>{subtitle}</small>}
        </div>
        <div className='stat'>
          {spell.range || (spell.area ? spell.area : '—')}
          {spell.defense ? <small>{spell.defense}</small> : null}
        </div>
        {/* Inline Cast / Restore button. Renders only when `onCast`
            is wired (prepared casters + spontaneous-rank slots where
            it makes sense). Stops propagation so clicking the button
            doesn't also open the cast-spell drawer behind it. */}
        {props.onCast && (
          <button
            type='button'
            className={`sp-act${exhausted ? ' restore' : ''}`}
            onClick={(e) => {
              e.stopPropagation();
              props.onCast!(!exhausted);
            }}
            title={exhausted ? 'Mark this slot as available again' : 'Mark this slot as cast (use)'}
          >
            {exhausted ? 'Restore' : 'Use'}
          </button>
        )}
      </div>

      {/* Right-click context menu. Up to two items: signature toggle
          (spontaneous only) and replace-spell (prepared only). */}
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
                {props.isSignature ? 'Remove signature' : 'Make signature spell'}
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

// Native-button styling for the spell-row right-click menu. Mirrors
// the character-card context menu style so the visual language is
// consistent across the codex.
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

// =======================================================================
// CodexInventoryPanel
// =======================================================================

export function CodexInventoryPanel(props: {
  characterId: number;
  character: Character | null;
  setCharacter: SetterOrUpdater<Character | null>;
}) {
  const { character } = props;
  const [_drawer, openDrawer] = useAtom(drawerState);
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<'all' | 'equipped'>('all');

  const inv = character?.inventory ?? null;
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
  const bulkLimit = getBulkLimit('CHARACTER');
  // In PF2e a character is encumbered above 5 + Str mod bulk and
  // can carry at most 10 + Str mod. bulkLimit already accounts for
  // Str + bonuses; encumbered is 5 less (the standard delta).
  const encumberedAt = Math.max(1, bulkLimit - 5);
  const bulkPct = bulkLimit > 0 ? Math.min(100, (totalBulk / bulkLimit) * 100) : 0;
  const encumberedMarkerPct = bulkLimit > 0 ? Math.min(100, (encumberedAt / bulkLimit) * 100) : 0;
  const isEncumbered = totalBulk > encumberedAt;

  // Classify an item — drives the left-border color. We don't have
  // a clean worn/held/consumable enum on items in this fork; equipped
  // is the only flag we can be sure about, so the rest get the
  // default (no left border).
  const classify = (i: InventoryItem): string => {
    if (i.is_equipped) return 'equipped';
    return '';
  };

  const matchesSearch = (i: InventoryItem) => {
    if (!searchQuery.trim()) return true;
    return i.item?.name?.toLowerCase().includes(searchQuery.trim().toLowerCase());
  };
  const matchesFilter = (i: InventoryItem) => {
    if (categoryFilter === 'all') return true;
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
  const setEntity = props.setCharacter as unknown as SetterOrUpdater<LivingEntity | null>;
  const openItemDrawer = (invItem: InventoryItem) => {
    openDrawer({
      type: 'inv-item',
      data: {
        storeID: 'CHARACTER',
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
  const investCapped = reachedInvestedLimit('CHARACTER', inv ?? undefined);
  const implantCapped = reachedImplantLimit('CHARACTER', inv ?? undefined);

  return (
    <div className='codex-tab-body'>
      {/* Wealth + bulk strip */}
      <div className='wealth-strip'>
        <div className='coins'>
          <div className='coin pp'>
            <div className='disk'>P</div>
            <div className='col-r'>
              <div className='v'>{coins.pp ?? 0}</div>
              <div className='k'>Platinum</div>
            </div>
          </div>
          <div className='coin gp'>
            <div className='disk'>G</div>
            <div className='col-r'>
              <div className='v'>{coins.gp ?? 0}</div>
              <div className='k'>Gold</div>
            </div>
          </div>
          <div className='coin sp'>
            <div className='disk'>S</div>
            <div className='col-r'>
              <div className='v'>{coins.sp ?? 0}</div>
              <div className='k'>Silver</div>
            </div>
          </div>
          <div className='coin cp'>
            <div className='disk'>C</div>
            <div className='col-r'>
              <div className='v'>{coins.cp ?? 0}</div>
              <div className='k'>Copper</div>
            </div>
          </div>
        </div>
        <div className='bulk-block'>
          <div className='k'>Bulk Carried</div>
          <div className='v' style={{ color: isEncumbered ? 'var(--crimson)' : undefined }}>
            {labelizeBulk(totalBulk, true)} <small>/ {bulkLimit} (max {bulkLimit})</small>
          </div>
          <div className='bulk-bar'>
            <div className='fill' style={{ right: `${100 - bulkPct}%` }}></div>
            {/* Red tick marking the encumbered threshold so the user can
                see how much more they can carry before the bulk penalty
                kicks in. Position is percent-of-max-bulk, not absolute. */}
            <div
              className='marker'
              style={{ left: `${encumberedMarkerPct}%` }}
              title={`Encumbered when bulk exceeds ${encumberedAt}`}
            ></div>
          </div>
          <div
            style={{
              fontFamily: "'Cinzel', serif",
              fontSize: 9,
              letterSpacing: '.22em',
              color: 'var(--ink-muted)',
              textTransform: 'uppercase',
              marginTop: 4,
              whiteSpace: 'nowrap',
            }}
          >
            Encumbered &gt; {encumberedAt} · Max {bulkLimit}
          </div>
        </div>
      </div>

      {/* Toolbar */}
      <div className='inv-toolbar'>
        <div className='field'>
          <input
            type='text'
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder='Search inventory…'
          />
        </div>
        {(['all', 'equipped'] as const).map((f) => (
          <span
            key={f}
            className={`filter ${categoryFilter === f ? 'on' : ''}`}
            onClick={() => setCategoryFilter(f)}
          >
            {f === 'all' ? 'All' : f.charAt(0).toUpperCase() + f.slice(1)}
          </span>
        ))}
        <span
          className='add'
          onClick={() => {
            // Same flow the legacy InventoryPanel uses: open the
            // addItems context modal, on pick → handleAddItem (or
            // open the buy modal for purchased items). Re-fetches
            // the inventory automatically via the setEntity update.
            openContextModal({
              modal: 'addItems',
              title: <Title order={3}>Add Items</Title>,
              // Match the codex-popups design footprint — wide modal
              // with room for the table + filters + pagination. The
              // body sets its own min-height: 85vh.
              size: 1500,
              innerProps: {
                onAddItem: async (
                  item: Item,
                  type: 'GIVE' | 'BUY' | 'FORMULA'
                ) => {
                  if (!character) return;
                  if (type === 'BUY') {
                    // Purchase path — open the buyItem modal which
                    // deducts coins on confirm.
                    openContextModal({
                      modal: 'buyItem',
                      title: <Title order={3}>Buy {item.name}</Title>,
                      innerProps: {
                        inventory: character.inventory,
                        item,
                        onConfirm: async (coins: { cp: number; sp: number; gp: number; pp: number }) => {
                          await handleAddItem(props.setCharacter as unknown as SetterOrUpdater<LivingEntity | null>, item, false);
                          props.setCharacter((prev) =>
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
                    await handleAddItem(
                      props.setCharacter as unknown as SetterOrUpdater<LivingEntity | null>,
                      item,
                      type === 'FORMULA'
                    );
                    setTimeout(() => modals.closeAll(), 100);
                  }
                },
              },
              zIndex: 499,
            });
          }}
        >
          Add Item
        </span>
      </div>

      {/* Equipped */}
      {equipped.length > 0 && (
        <section className='sec'>
          <div className='sec-title'>
            <span className='lozenge'>⚔</span>
            <span className='label'>Equipped</span>
            <span className='sub'>
              <b>{equipped.length}</b>
            </span>
          </div>
          <div className='sec-body'>
            <div className='it-grid'>
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
        </section>
      )}

      {/* Consumables */}
      {consumables.length > 0 && (
        <section className='sec'>
          <div className='sec-title'>
            <span className='lozenge'>⚱</span>
            <span className='label'>Consumables</span>
            <span className='sub'>
              <b>{consumables.length}</b>
            </span>
          </div>
          <div className='sec-body'>
            <div className='it-grid'>
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
        </section>
      )}

      {/* Carried (top-level, non-equipped). Also a drop target — drop
          anything onto its header to send it back to the top-level
          unstored pile. The TOPLEVEL sentinel keeps it distinct from
          any real container id. */}
      {(other.length > 0 || dragId) && (
        <section
          className={`sec${dropTargetId === 'TOPLEVEL' ? ' drop-target' : ''}`}
          onDragOver={(e) => {
            if (!dragId) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            if (dropTargetId !== 'TOPLEVEL') setDropTargetId('TOPLEVEL');
          }}
          onDragLeave={(e) => {
            // Only clear the highlight if the mouse left the section
            // entirely (relatedTarget is outside) — otherwise we'd
            // flicker on every child boundary.
            if (!e.currentTarget.contains(e.relatedTarget as Node)) {
              if (dropTargetId === 'TOPLEVEL') setDropTargetId(null);
            }
          }}
          onDrop={(e) => {
            e.preventDefault();
            performDrop(null);
          }}
        >
          <div className='sec-title'>
            <span className='lozenge'>❖</span>
            <span className='label'>Carried</span>
            <span className='sub'>
              <b>{other.length}</b>
            </span>
          </div>
          <div className='sec-body'>
            <div className='it-grid'>
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
        </section>
      )}

      {/* Per-container sections. One section per container in the
          inventory, named after the container, listing its current
          contents. Nested containers (a pouch inside a backpack) get
          their own section too — flat ordering, but every container
          surfaces its inventory at the same level so the player can
          see what's where without opening drawers. */}
      {containerSections.map(({ container, children }) => (
        <section
          className={`sec${dropTargetId === container.id ? ' drop-target' : ''}`}
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
          <div className='sec-title'>
            <span className='lozenge'>◫</span>
            <span className='label'>{container.item.name}</span>
            <span className='sub'>
              <b>{children.length}</b>
              {(() => {
                // Show capacity in the subtitle so the player knows
                // how much room they have left. `bulk.capacity` is the
                // total bulk the container holds; `bulk.ignored` is
                // how much of that doesn't count toward the carrier's
                // bulk limit (the "ignored" magic-bag effect). Surface
                // capacity since that's the meaningful cap.
                const cap = container.item.meta_data?.bulk?.capacity;
                return cap ? <> · cap {labelizeBulk(String(cap), true)}</> : null;
              })()}
            </span>
          </div>
          <div className='sec-body'>
            {children.length === 0 ? (
              <div
                style={{
                  padding: '12px 4px',
                  color: 'var(--ink-muted)',
                  fontStyle: 'italic',
                  fontFamily: "'Cormorant Garamond', serif",
                }}
              >
                Empty.
              </div>
            ) : (
              <div className='it-grid'>
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
                  />
                ))}
              </div>
            )}
          </div>
        </section>
      ))}

      {filteredTopLevel.length === 0 && containerSections.every((s) => s.children.length === 0) && (
        <div
          style={{
            padding: 40,
            color: 'var(--ink-muted)',
            fontStyle: 'italic',
            textAlign: 'center',
            fontFamily: "'Cormorant Garamond', serif",
          }}
        >
          {searchQuery.trim() ? `No items match "${searchQuery.trim()}"` : 'Nothing in this pocket.'}
        </div>
      )}
    </div>
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
  // First letter of the item name as a placeholder glyph (the codex
  // mockup uses real item-type SVGs; we don't have those mapped).
  const glyph = (item.item?.name ?? '?').trim().charAt(0).toUpperCase();
  // Eligibility for the action buttons. Equipped items can't be
  // dragged — the user has to Unequip first — so we also disable
  // drag at the row level here (parent passes `draggable` but we
  // gate it on equip state). This is the "must unequip first" rule
  // the user asked for.
  const canEquip = isItemEquippable(item.item);
  const canInvest = isItemInvestable(item.item);
  const canImplant = isItemImplantable(item.item);
  const dragLocked = item.is_equipped;
  return (
    <div
      className={`it ${classification}${props.isDragging ? ' dragging' : ''}`}
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
      <div
        className='icon'
        style={{
          fontFamily: "'Cinzel', serif",
          fontWeight: 700,
          fontSize: 16,
        }}
      >
        {glyph}
      </div>
      <div className='nm'>
        {item.item?.name ?? '(unknown)'}
        {item.item?.level != null && <small>level {item.item.level}{price ? ` · ${price}` : ''}</small>}
      </div>
      <div className='qty'>
        {quantity > 1 ? `×${quantity}` : ''}
        {quantity > 1 ? <small>qty</small> : null}
      </div>
      <div className='bulk'>
        {bulk}
        <small>bulk</small>
      </div>
      {/* Action buttons. Only the buttons that apply to this item
          render — a potion gets nothing, a sword gets Equip, a magic
          ring gets both Equip + Invest. We stop propagation so
          clicking a button doesn't also open the drawer behind it. */}
      {(canEquip || canInvest || canImplant) && (
        <div className='it-actions'>
          {canInvest && props.onToggleInvest && (
            <button
              type='button'
              className={`row-act${item.is_invested ? ' on' : ''}`}
              disabled={!item.is_invested && !!props.investDisabled}
              onClick={(e) => {
                e.stopPropagation();
                props.onToggleInvest!(item);
              }}
            >
              {item.is_invested ? 'Divest' : 'Invest'}
            </button>
          )}
          {canImplant && props.onToggleInvest && (
            <button
              type='button'
              className={`row-act${item.is_implanted ? ' on' : ''}`}
              disabled={!item.is_implanted && !!props.implantDisabled}
              onClick={(e) => {
                e.stopPropagation();
                props.onToggleInvest!(item);
              }}
            >
              {item.is_implanted ? 'Extract' : 'Implant'}
            </button>
          )}
          {canEquip && props.onToggleEquip && (
            <button
              type='button'
              className={`row-act${item.is_equipped ? ' on' : ''}`}
              onClick={(e) => {
                e.stopPropagation();
                props.onToggleEquip!(item);
              }}
            >
              {item.is_equipped ? 'Unequip' : 'Equip'}
            </button>
          )}
        </div>
      )}
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
  type TaggedBlock = AbilityBlock & { _group: 'class' | 'ancestry' | 'skill' | 'general' | 'feature' };
  const featBlocks: TaggedBlock[] = useMemo(() => {
    if (!collected) return [];
    const tag = (g: TaggedBlock['_group']) => (b: AbilityBlock): TaggedBlock => ({ ...b, _group: g });
    return [
      ...(collected.classFeats ?? []).map(tag('class')),
      ...(collected.ancestryFeats ?? []).map(tag('ancestry')),
      ...(collected.generalAndSkillFeats ?? []).map((f) => {
        const isSkill = (f.traits ?? []).some((id) => traitNameById.get(id) === 'skill');
        return { ...f, _group: (isSkill ? 'skill' : 'general') as TaggedBlock['_group'] };
      }),
      ...(collected.otherFeats ?? []).map(tag('general')),
      ...(collected.classFeatures ?? []).map(tag('feature')),
      ...(collected.heritages ?? []).map(tag('ancestry')),
      ...(collected.physicalFeatures ?? []).map(tag('feature')),
    ];
  }, [collected, traitNameById]);

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
        <div className='field'>
          <input
            type='text'
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder='Search feats &amp; features…'
          />
        </div>
        {(['all', 'feature', 'class', 'ancestry', 'skill', 'general'] as const).map((f) => (
          <span
            key={f}
            className={`filter ${groupFilter === f ? 'on' : ''}`}
            onClick={() => setGroupFilter(f)}
          >
            {f === 'all' ? 'All' : f.charAt(0).toUpperCase() + f.slice(1)}
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
        return (
          <section key={section.id} className='sec'>
            <div className='sec-title'>
              <span className='lozenge'>{section.lozenge}</span>
              <span className='label'>{section.label}</span>
              <span className='sub'>
                <b>{rows.length}</b>
                {section.sub ? ` · ${section.sub}` : ''}
              </span>
              <span className='chev'></span>
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
  const strikes = useMemo(() => {
    const equipped =
      character?.inventory?.items?.filter(
        (i) => i.is_equipped && isItemWeapon(i.item)
      ) ?? [];
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
  }, [character?.inventory?.items]);

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
          no stacking. The "A" kbd hint from the mockup was removed
          — it wasn't wired to any actual keyboard shortcut and was
          rendering as a stray badge next to the search icon. */}
      <div className='activities-bar'>
        <div className='field'>
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
            <small>combat</small>
          </div>
          <div
            className={`mode-tab ${mode === 'exploration' ? 'on' : ''}`}
            onClick={() => setMode('exploration')}
          >
            Exploration
            <small>travel</small>
          </div>
          <div
            className={`mode-tab ${mode === 'downtime' ? 'on' : ''}`}
            onClick={() => setMode('downtime')}
          >
            Downtime
            <small>rest</small>
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
            let best: { name: string; n: number; str: string } | null = null;
            for (const sk of skillNames) {
              if (!sk) continue;
              const lv = labelToVariable(sk);
              // Skip the generic 'LORE' — without a specific Lore
              // sub-skill, getFinalProfValue returns +0 which is
              // misleading.
              if (lv === 'LORE') continue;
              const str = getFinalProfValue('CHARACTER', `SKILL_${lv}`);
              const n = parseInt(str.replace(/[^\-0-9]/g, ''), 10) || 0;
              if (best === null || n > best.n) best = { name: sk, n, str };
            }
            if (best) {
              statClass = '';
              statContent = (
                <span className='skill'>
                  {best.str}
                  <small> {best.name}</small>
                </span>
              );
            }
          }

          return (
            <div key={action.id} className='act' onClick={() => openAction(action)}>
              <div className='cost'>{glyph ? <ActionGlyph cost={glyph} /> : null}</div>
              <div className='nm'>{action.name}</div>
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
                {title} <b>·</b> {rows.length} action{rows.length === 1 ? '' : 's'}
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
                ⚔ Weapon Attacks <b>·</b> {filteredStrikes.length} strike{filteredStrikes.length === 1 ? '' : 's'}
              </div>
              {!collapsedGroups['strikes'] && (
                <div className='act-grid'>
                  {filteredStrikes.map(({ invItem, attacks, damage }) => (
                    <div
                      key={invItem.id}
                      className='act strike'
                      onClick={() => openStrike(invItem)}
                    >
                      <div className='cost'>
                        <ActionGlyph cost={1} />
                      </div>
                      <div className='nm'>{invItem.item.name}</div>
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
                  ))}
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
          const featSection = renderActionSection('feats', 'Feats (with Actions)', featsWithActions);
          if (featSection) sections['feats'] = featSection;

          const itemsSection = renderItemsSection();
          if (itemsSection) sections['items'] = itemsSection;

          const basicSection = renderActionSection('basic', 'Basic Actions', basicActions);
          if (basicSection) sections['basic'] = basicSection;

          const skillSection = renderActionSection('skill', 'Skill Actions', skillActions);
          if (skillSection) sections['skill'] = skillSection;

          const specialitySection = renderActionSection(
            'speciality',
            'Speciality Basics',
            specialityBasics
          );
          if (specialitySection) sections['speciality'] = specialitySection;
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
