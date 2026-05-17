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
import { collectEntitySpellcasting } from '@content/collect-content';
import { getVariable } from '@variables/variable-manager';
import { VariableProf } from '@schemas/variables';
import { getFinalProfValue } from '@variables/variable-helpers';
import { rankNumber } from '@utils/numbers';
import { getInvBulk, getBulkLimit, labelizeBulk } from '@items/inv-utils';
import { priceToString } from '@items/currency-handler';
import { isCantrip } from '@spells/spell-utils';

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
                  // The manage-spells modal is opened from the existing
                  // SpellsPanel via setManageSpells; we don't have that
                  // hook here. Navigate to the builder where the user
                  // can manage their full spell list as a fallback.
                  window.location.href = `/builder/${props.characterId}`;
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
                            data: { id: spell.id, spell, exhausted: false, tradition: source.tradition, attribute: source.attribute, storeId: 'CHARACTER', entity: character },
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
                                openDrawer({
                                  type: 'cast-spell',
                                  data: {
                                    id: cell.spell.id,
                                    spell: cell.spell,
                                    exhausted: cell.exhausted,
                                    tradition: source.tradition,
                                    attribute: source.attribute,
                                    storeId: 'CHARACTER',
                                    entity: character,
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
  const glyph = actionCostToGlyph(
    (spell as Spell & { cast?: string }).cast ?? null
  );
  const traits = spell.traits?.slice(0, 2).map((t) => (typeof t === 'object' ? (t as { name?: string }).name : t)).filter(Boolean).join(' · ') || '';
  return (
    <div
      className={`sp ${variant ?? ''}`}
      onClick={props.onClick}
      style={exhausted ? { opacity: 0.45 } : undefined}
    >
      <div className='cost'>{glyph ? <ActionGlyph cost={glyph} /> : '—'}</div>
      <div className='nm'>
        {spell.name}
        {traits && <small>{traits.toLowerCase()}</small>}
      </div>
      <div className='stat'>
        {spell.range || '—'}
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
            // No standalone "add item" drawer exists in this fork —
            // adding items goes through the existing InventoryPanel's
            // internal flow. Send the user to the builder for now.
            window.location.href = `/builder/${props.characterId}`;
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

  // The selections store on the character maps choice IDs to picked
  // content. We pull feat selections and resolve to AbilityBlock
  // entries from the content package.
  const selections = character?.operation_data?.selections ?? {};
  const allBlocks = content.abilityBlocks ?? [];

  // Collect every selection whose value points at a feat / class feature.
  const pickedIds = new Set<number>();
  Object.values(selections).forEach((sel) => {
    if (typeof sel === 'number') pickedIds.add(sel);
    else if (sel && typeof sel === 'object' && 'value' in sel) {
      const v = (sel as { value: unknown }).value;
      if (typeof v === 'number') pickedIds.add(v);
    }
  });

  const featBlocks = allBlocks.filter(
    (b) =>
      pickedIds.has(b.id) &&
      (b.type === 'feat' || b.type === 'class-feature' || b.type === 'heritage' || b.type === 'physical-feature')
  );

  // Classify a block into a feat-row color category. Trait names need
  // resolution because the block's `traits` field is an array of trait
  // *ids*; we cross-reference against content.traits to get names.
  const traitNameById = new Map<number, string>();
  (content.traits ?? []).forEach((t) => {
    if (t && typeof t.id === 'number' && t.name) {
      traitNameById.set(t.id, t.name.toLowerCase());
    }
  });
  const classify = (block: { type: string; traits?: number[] | null }) => {
    if (block.type === 'class-feature' || block.type === 'physical-feature') return 'feature';
    const traitNames = (block.traits ?? []).map((id) => traitNameById.get(id) ?? '');
    if (traitNames.includes('class')) return 'class';
    if (traitNames.includes('ancestry') || block.type === 'heritage') return 'ancestry';
    if (traitNames.includes('skill')) return 'skill';
    if (traitNames.includes('general')) return 'general';
    return '';
  };

  const matchesSearch = (b: { name?: string }) =>
    !searchQuery.trim() ||
    (b.name ?? '').toLowerCase().includes(searchQuery.trim().toLowerCase());
  const matchesFilter = (b: { type: string; traits?: number[] | null }) =>
    groupFilter === 'all' || classify(b) === groupFilter;

  const filtered = featBlocks
    .filter((b) => matchesSearch(b) && matchesFilter(b))
    .sort((a, b) => (a.level ?? 0) - (b.level ?? 0));

  const summary = {
    class: featBlocks.filter((b) => classify(b) === 'class').length,
    ancestry: featBlocks.filter((b) => classify(b) === 'ancestry').length,
    skill: featBlocks.filter((b) => classify(b) === 'skill').length,
    general: featBlocks.filter((b) => classify(b) === 'general').length,
    feature: featBlocks.filter((b) => classify(b) === 'feature').length,
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

      <section className='sec'>
        <div className='sec-title'>
          <span className='lozenge'>✦</span>
          <span className='label'>All</span>
          <span className='sub'>
            <b>{filtered.length}</b>
          </span>
        </div>
        <div className='sec-body'>
          {filtered.length === 0 ? (
            <div
              style={{
                color: 'var(--ink-muted)',
                fontStyle: 'italic',
                fontSize: 13,
                padding: '6px 0',
                fontFamily: "'Cormorant Garamond', serif",
              }}
            >
              No feats or features match this filter.
            </div>
          ) : (
            <div className='feat-grid'>
              {filtered.map((b) => {
                const cls = classify(b);
                const actionGlyph = actionCostToGlyph(b.actions ?? null);
                return (
                  <div
                    key={b.id}
                    className={`feat ${cls}`}
                    onClick={() =>
                      openDrawer({
                        type: b.type === 'class-feature' || b.type === 'physical-feature' ? 'class-feature' : b.type === 'heritage' ? 'heritage' : 'feat',
                        data: { id: b.id },
                        extra: { addToHistory: true },
                      })
                    }
                  >
                    <div className='lvl'>{actionGlyph ? <ActionGlyph cost={actionGlyph} /> : b.level ?? 1}</div>
                    <div className='nm'>
                      {b.name}
                      <small>{b.type.replace('-', ' ')}</small>
                    </div>
                    <div className='meta'>
                      {cls && cls !== 'feature' ? cls.toUpperCase() : 'FEATURE'}
                      <b>Lv {b.level ?? 1}</b>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
