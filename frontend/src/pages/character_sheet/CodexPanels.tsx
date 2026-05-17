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
import { useState, useMemo } from 'react';
import { collectEntitySpellcasting, collectEntityAbilityBlocks } from '@content/collect-content';
import { getVariable } from '@variables/variable-manager';
import { VariableProf } from '@schemas/variables';
import { getFinalProfValue } from '@variables/variable-helpers';
import { rankNumber } from '@utils/numbers';
import { getInvBulk, getBulkLimit, labelizeBulk } from '@items/inv-utils';
import { priceToString } from '@items/currency-handler';
import { isCantrip } from '@spells/spell-utils';
import { isItemWeapon } from '@items/inv-utils';
import ManageSpellsModal from '@modals/ManageSpellsModal';
import { openContextModal } from '@mantine/modals';
import { Title } from '@mantine/core';
import { Item } from '@schemas/content';
import { handleAddItem } from '@items/inv-handlers';
import { modals } from '@mantine/modals';
import { getWeaponStats } from '@items/weapon-handler';
import { isAbilityBlockVisible } from '@content/content-hidden';
import { hasTraitType } from '@utils/traits';
import { AbilityBlock } from '@schemas/content';
import { sign } from '@utils/numbers';

// -----------------------------------------------------------------------
// Shared inline-SVG action-cost sprite — used by both spells + activities.
// Renders as <ActionGlyph cost="1" /> → 1-action / 2-action / 3-action /
// reaction (ar) / free (af). Matches the .ai class from codex.css.
// -----------------------------------------------------------------------

export function ActionGlyph(props: { cost: 1 | 2 | 3 | 'r' | 'f' | string }) {
  // The codex mockup embeds an SVG <defs> block at body root with
  // symbol IDs. We inline the relevant <symbol> per glyph instead so
  // this works without needing the sprite at the page level.
  const c = props.cost;
  if (c === 1) {
    return (
      <svg className='ai' viewBox='0 0 24 24'>
        <path
          d='M12,2 C13.4,7.2 16.8,10.6 22,12 C16.8,13.4 13.4,16.8 12,22 C10.6,16.8 7.2,13.4 2,12 C7.2,10.6 10.6,7.2 12,2 Z'
          fill='currentColor'
        />
      </svg>
    );
  }
  if (c === 2) {
    return (
      <svg className='ai' viewBox='0 0 44 24' style={{ width: 26 }}>
        <path
          d='M10,2 C11.4,7.2 14.8,10.6 20,12 C14.8,13.4 11.4,16.8 10,22 C8.6,16.8 5.2,13.4 0,12 C5.2,10.6 8.6,7.2 10,2 Z'
          fill='currentColor'
        />
        <path
          d='M34,2 C35.4,7.2 38.8,10.6 44,12 C38.8,13.4 35.4,16.8 34,22 C32.6,16.8 29.2,13.4 24,12 C29.2,10.6 32.6,7.2 34,2 Z'
          fill='currentColor'
        />
      </svg>
    );
  }
  if (c === 3) {
    return (
      <svg className='ai' viewBox='0 0 64 24' style={{ width: 40 }}>
        <path
          d='M10,2 C11.4,7.2 14.8,10.6 20,12 C14.8,13.4 11.4,16.8 10,22 C8.6,16.8 5.2,13.4 0,12 C5.2,10.6 8.6,7.2 10,2 Z'
          fill='currentColor'
        />
        <path
          d='M32,2 C33.4,7.2 36.8,10.6 42,12 C36.8,13.4 33.4,16.8 32,22 C30.6,16.8 27.2,13.4 22,12 C27.2,10.6 30.6,7.2 32,2 Z'
          fill='currentColor'
        />
        <path
          d='M54,2 C55.4,7.2 58.8,10.6 64,12 C58.8,13.4 55.4,16.8 54,22 C52.6,16.8 49.2,13.4 44,12 C49.2,10.6 52.6,7.2 54,2 Z'
          fill='currentColor'
        />
      </svg>
    );
  }
  if (c === 'r') {
    return (
      <svg className='ai ar' viewBox='0 0 24 24'>
        <path
          d='M20,12 A8,8 0 1,0 12,20'
          fill='none'
          stroke='currentColor'
          strokeWidth={2.6}
          strokeLinecap='round'
        />
        <path
          d='M9,18 L12,20 L13.5,17'
          fill='none'
          stroke='currentColor'
          strokeWidth={2.6}
          strokeLinecap='round'
          strokeLinejoin='round'
        />
        <circle cx={20} cy={12} r={1.6} fill='currentColor' />
      </svg>
    );
  }
  if (c === 'f') {
    return (
      <svg className='ai af' viewBox='0 0 24 24'>
        <path
          d='M12,2 C13.4,7.2 16.8,10.6 22,12 C16.8,13.4 13.4,16.8 12,22 C10.6,16.8 7.2,13.4 2,12 C7.2,10.6 10.6,7.2 12,2 Z'
          fill='none'
          stroke='currentColor'
          strokeWidth={2.2}
        />
      </svg>
    );
  }
  // Unknown / no-cost (passive abilities, etc.) — render an em-dash.
  return <span style={{ color: 'var(--ink-muted)', fontSize: 12 }}>—</span>;
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
    if (!spell) return false;
    if (!searchQuery.trim()) return true;
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
              // just available-cast counters.
              const isPrepared = source.type?.startsWith('PREPARED');
              const cells: { spell: Spell | undefined; slotIdx: number | null; exhausted: boolean }[] = [];
              if (isPrepared) {
                rankSlots.forEach((slot, i) => {
                  const spell = slot.spell_id ? findSpell(slot.spell_id) : undefined;
                  cells.push({ spell, slotIdx: i, exhausted: !!slot.exhausted });
                });
              } else {
                rankList.forEach((entry) => {
                  cells.push({ spell: findSpell(entry.spell_id), slotIdx: null, exhausted: false });
                });
              }

              const filledSlots = rankSlots.filter((s) => !s.exhausted).length;
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
                          .map((cell, i) => (
                            <SpellRow
                              key={i}
                              spell={cell.spell}
                              variant={isCantripRank ? 'cantrip' : 'heightened'}
                              exhausted={cell.exhausted}
                              onClick={() => {
                                if (!cell.spell) return;
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
                          ))}
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
}) {
  const { spell, variant, exhausted } = props;
  if (!spell) {
    return (
      <div className='sp' style={{ opacity: 0.4 }}>
        <div className='cost'>—</div>
        <div className='nm'>
          <span style={{ color: 'var(--ink-muted)', fontStyle: 'italic' }}>Empty slot</span>
        </div>
        <div className='stat dim'>—</div>
      </div>
    );
  }
  // spell.cast is either an ActionCost enum or a free string. The glyph
  // helper accepts both.
  const castStr =
    typeof spell.cast === 'string' ? spell.cast : (spell.cast as unknown as string | null) ?? null;
  const glyph = actionCostToGlyph(castStr);
  // Subtitle: rank + duration if present, e.g. "Rank 3 · 1 minute".
  // We use real spell fields rather than trait IDs (which would render
  // as opaque numbers without a trait-lookup roundtrip).
  const subParts: string[] = [];
  if (spell.rank > 0) subParts.push(`rank ${spell.rank}`);
  if (spell.duration) subParts.push(spell.duration);
  const subtitle = subParts.join(' · ');
  return (
    <div
      className={`sp ${variant ?? ''}`}
      onClick={props.onClick}
      style={exhausted ? { opacity: 0.45 } : undefined}
    >
      <div className='cost'>{glyph ? <ActionGlyph cost={glyph} /> : '—'}</div>
      <div className='nm'>
        {spell.name}
        {subtitle && <small>{subtitle}</small>}
      </div>
      <div className='stat'>
        {spell.range || (spell.area ? spell.area : '—')}
        {spell.defense ? <small>{spell.defense}</small> : null}
      </div>
    </div>
  );
}

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
  const items = inv?.items ?? [];
  const coins = inv?.coins ?? { pp: 0, gp: 0, sp: 0, cp: 0 };

  const totalBulk = getInvBulk(inv ?? undefined);
  const bulkLimit = getBulkLimit('CHARACTER');
  const bulkPct = bulkLimit > 0 ? Math.min(100, (totalBulk / bulkLimit) * 100) : 0;

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
  const filtered = items.filter((i) => matchesSearch(i) && matchesFilter(i));

  // Group by category for display.
  const equipped = filtered.filter((i) => i.is_equipped);
  const other = filtered.filter((i) => !i.is_equipped);
  const consumables: typeof other = []; // reserved — needs consumable trait lookup

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
          <div className='k'>Bulk</div>
          <div className='v'>
            {labelizeBulk(totalBulk, true)} <small>/ {bulkLimit}</small>
          </div>
          <div className='bulk-bar'>
            <div className='fill' style={{ right: `${100 - bulkPct}%` }}></div>
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
                  onClick={() =>
                    openDrawer({
                      type: 'inv-item',
                      data: { invItem: i, storeID: 'CHARACTER' },
                      extra: { addToHistory: true },
                    })
                  }
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
                  onClick={() =>
                    openDrawer({
                      type: 'inv-item',
                      data: { invItem: i, storeID: 'CHARACTER' },
                      extra: { addToHistory: true },
                    })
                  }
                />
              ))}
            </div>
          </div>
        </section>
      )}

      {/* Other */}
      {other.length > 0 && (
        <section className='sec'>
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
                  onClick={() =>
                    openDrawer({
                      type: 'inv-item',
                      data: { invItem: i, storeID: 'CHARACTER' },
                      extra: { addToHistory: true },
                    })
                  }
                />
              ))}
            </div>
          </div>
        </section>
      )}

      {filtered.length === 0 && (
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

function InvRow(props: { item: InventoryItem; classification: string; onClick: () => void }) {
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
  return (
    <div className={`it ${classification}`} onClick={props.onClick}>
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
                  const actionGlyph = actionCostToGlyph(b.actions ?? null);
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
                      <div className='lvl'>
                        {actionGlyph ? <ActionGlyph cost={actionGlyph} /> : b.level ?? 1}
                      </div>
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
  const [mode, setMode] = useState<'encounter' | 'exploration' | 'downtime'>('encounter');
  // Action-cost filter — click a cost glyph (1/2/3/reaction/free) to
  // show only actions of that cost. Mirrors the AoN filter strip in
  // the updated codex main mockup.
  const [costFilter, setCostFilter] = useState<1 | 2 | 3 | 'r' | 'f' | null>(null);

  // Equipped weapons → strikes. Each gets attack bonus + damage from
  // the weapon-handler engine.
  const strikes = useMemo(() => {
    const equipped =
      character?.inventory?.items?.filter(
        (i) => i.is_equipped && isItemWeapon(i.item)
      ) ?? [];
    return equipped.map((i) => {
      const stats = getWeaponStats('CHARACTER', i.item);
      const attack = stats.attack_bonus?.total?.[0] ?? 0;
      const dmg = stats.damage;
      const dmgString = `${dmg?.dice ?? 1}${dmg?.die ?? 'd6'}${
        dmg?.bonus?.total ? `+${dmg.bonus.total}` : ''
      } ${dmg?.damageType ?? ''}`.trim();
      return {
        invItem: i,
        attack,
        damage: dmgString,
        name: i.item.name,
      };
    });
  }, [character?.inventory?.items]);

  // All actions from the content package, visible to the character.
  // Bucketed by mode (encounter / exploration / downtime).
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

  // Encounter actions: not exploration, not downtime, no skill metadata,
  // no requirements — the "every character can do this" list (Stride,
  // Step, Demoralize, Trip, etc.).
  const encounterActions = useMemo(
    () =>
      allActions.filter(
        (a) =>
          !a.meta_data?.skill &&
          (!a.requirements || a.requirements.trim().length === 0) &&
          !hasTraitType('EXPLORATION', a.traits ?? undefined) &&
          !hasTraitType('DOWNTIME', a.traits ?? undefined)
      ),
    [allActions]
  );
  const explorationActions = useMemo(
    () => allActions.filter((a) => hasTraitType('EXPLORATION', a.traits ?? undefined)),
    [allActions]
  );
  const downtimeActions = useMemo(
    () => allActions.filter((a) => hasTraitType('DOWNTIME', a.traits ?? undefined)),
    [allActions]
  );

  const activeActions =
    mode === 'encounter'
      ? encounterActions
      : mode === 'exploration'
        ? explorationActions
        : downtimeActions;
  const filteredActions = activeActions.filter(matchesSearch).filter(matchesCost);
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
      {/* Single-row toolbar: search field + A keycap + 5 action-cost
          glyph filters + 3 mode tabs. Matches the reference image
          the user shipped — everything in one horizontal strip, no
          stacking. */}
      <div className='activities-bar'>
        <div className='field'>
          <input
            type='text'
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder='Search activities…'
          />
          <span className='kbd'>A</span>
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

      {/* Strikes — only show in encounter mode (the only mode where they matter) */}
      {mode === 'encounter' && filteredStrikes.length > 0 && (
        <>
          <div className='act-group-label'>
            ⚔ Strikes <b>·</b> One action each
          </div>
          <div className='act-grid'>
            {filteredStrikes.map(({ invItem, attack, damage }) => (
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
                  {sign(attack)}
                  <small>
                    <span className='dmg'>{damage}</span>
                  </small>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Activities for the active mode */}
      {filteredActions.length > 0 && (
        <>
          <div className='act-group-label'>
            {mode === 'encounter'
              ? 'Universal'
              : mode === 'exploration'
                ? 'Exploration'
                : 'Downtime'}{' '}
            <b>·</b> {filteredActions.length} action{filteredActions.length === 1 ? '' : 's'}
          </div>
          <div className='act-grid'>
            {filteredActions.slice(0, 60).map((action) => {
              const glyph = actionCostToGlyph(action.actions ?? null);
              return (
                <div key={action.id} className='act' onClick={() => openAction(action)}>
                  <div className='cost'>{glyph ? <ActionGlyph cost={glyph} /> : <ActionGlyph cost={1} />}</div>
                  <div className='nm'>{action.name}</div>
                  <div className='stat dim'>—</div>
                </div>
              );
            })}
          </div>
          {filteredActions.length > 60 && (
            <div
              style={{
                color: 'var(--ink-muted)',
                fontStyle: 'italic',
                fontSize: 12,
                textAlign: 'center',
                padding: '6px 0',
              }}
            >
              … {filteredActions.length - 60} more (refine search)
            </div>
          )}
        </>
      )}

      {filteredActions.length === 0 && filteredStrikes.length === 0 && (
        <div
          style={{
            color: 'var(--ink-muted)',
            fontStyle: 'italic',
            fontSize: 13,
            padding: '10px 0',
            textAlign: 'center',
          }}
        >
          {searchQuery.trim() ? `No matches for "${searchQuery.trim()}"` : 'No actions in this mode.'}
        </div>
      )}
    </div>
  );
}
