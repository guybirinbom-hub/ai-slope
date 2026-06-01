import { drawerState } from '@atoms/navAtoms';
import { selectContent } from '@common/select/SelectContent';
import { collectEntitySpellcasting } from '@content/collect-content';
import { isSpellVisible } from '@content/content-hidden';
import { fetchContentAll, getCachedContent, getDefaultSources } from '@content/content-store';
import { Button, LoadingOverlay, Menu, Modal, Title } from '@mantine/core';
import { isCantrip, isNormalSpell, isRitual } from '@spells/spell-utils';
import { useQuery } from '@tanstack/react-query';
import { LivingEntity, Spell, Trait } from '@schemas/content';
import { StoreID } from '@schemas/variables';
import { rankNumber } from '@utils/numbers';
import { toLabel } from '@utils/strings';
import { isTruthy } from '@utils/type-fixing';
import * as JsSearch from 'js-search';
import { groupBy } from 'lodash-es';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useAtom } from 'jotai';
import { SetterOrUpdater } from '@utils/type-fixing';

export default function ManageSpellsModal(props: {
  id: StoreID;
  entity: LivingEntity | null;
  setEntity: SetterOrUpdater<LivingEntity | null>;
  //
  opened: boolean;
  onClose: () => void;
  source: string;
  type: 'SLOTS-ONLY' | 'SLOTS-AND-LIST' | 'LIST-ONLY';
  filter?: {
    traditions?: string[];
    rank_min?: number;
    rank_max?: number;
  };
  zIndex?: number;
}) {
  const isRituals = props.source === 'RITUALS';
  const [searchQuery, setSearchQuery] = useState('');
  const [_drawer, openDrawer] = useAtom(drawerState);
  const [rankSelectSpell, setRankSelectSpell] = useState<Spell | null>(null);

  const { data: allRawSpells, isFetching } = useQuery({
    queryKey: [`find-spells-in-manage-spells-modal`, { entityId: props.entity?.id, source: props.source }],
    queryFn: async () => {
      return (await fetchContentAll<Spell>('spell', getDefaultSources('PAGE'))).filter((spell) =>
        isSpellVisible(props.id, spell)
      );
    },
  });

  // Filter options based on search query
  const search = useRef(new JsSearch.Search('id'));
  useEffect(() => {
    if (!allRawSpells) return;
    search.current.addIndex('name');
    search.current.addIndex('description');
    search.current.addIndex('duration');
    search.current.addIndex('targets');
    search.current.addIndex('area');
    search.current.addIndex('range');
    search.current.addIndex('requirements');
    search.current.addIndex('trigger');
    search.current.addIndex('cost');
    search.current.addIndex('defense');
    search.current.addDocuments(allRawSpells);
  }, [allRawSpells]);

  const charData = useMemo(() => {
    if (!props.entity) return null;
    return collectEntitySpellcasting(props.id, props.entity);
  }, [props.entity]);

  const allFilteredSpells =
    (searchQuery.trim() ? (search.current?.search(searchQuery.trim()) as Spell[] | undefined) : (allRawSpells ?? [])) ??
    [];

  // Match repertoire entries to their full Spell record. We carry along the
  // repertoire-side signature flag so the rank-grouped UI can render the
  // signature star without re-querying the entity.
  const spells = useMemo(() => {
    const filteredSpells = (charData?.list ?? [])
      .map((entry) => {
        const foundSpell = allFilteredSpells.find(
          (spell) => spell.id === entry.spell_id && entry.source === props.source
        );
        if (!foundSpell) return null;
        return {
          ...foundSpell,
          rank: entry.rank,
          signature: !!entry.signature,
        } as Spell & { signature?: boolean };
      })
      .filter(isTruthy)
      .filter((spell) => (isRituals ? isRitual(spell!) : isNormalSpell(spell!)))
      .sort((a, b) => {
        if (a!.rank === b!.rank) return a!.name.localeCompare(b!.name);
        return a!.rank - b!.rank;
      });
    return filteredSpells;
  }, [charData, allFilteredSpells, props.source, isRituals]);

  // Source / tradition / casting-type meta strip. Falls back gracefully
  // when we can't resolve the casting source (e.g. innate-only sources
  // or rituals without a configured source row).
  const metaStripText = useMemo(() => {
    if (isRituals) return 'Ritual list';
    const sourceRow = charData?.sources.find((s) => s.name === props.source);
    if (!sourceRow) return `${toLabel(props.source)} · Spell list`;
    const parts = [toLabel(sourceRow.name)];
    if (sourceRow.tradition) parts.push(`${toLabel(sourceRow.tradition)} tradition`);
    if (sourceRow.type) {
      const t = sourceRow.type.toLowerCase();
      if (t === 'spontaneous') parts.push('Spontaneous repertoire');
      else if (t === 'prepared') parts.push('Prepared list');
      else parts.push(`${toLabel(sourceRow.type)} list`);
    }
    return parts.join(' · ');
  }, [charData, props.source, isRituals]);

  // Highest rank slot the caster can heighten to. Defaults to 10 if we
  // can't infer (e.g. innate-only). The list renders rank 0 through this
  // cap so empty ranks still get a "+ Add N-Rank Spell" row.
  const maxRank = useMemo(() => {
    const ranks = (charData?.slots ?? []).map((s) => s.rank);
    const fromSlots = ranks.length > 0 ? Math.max(...ranks) : 0;
    const fromKnown = spells && spells.length > 0 ? Math.max(...spells.map((s) => s!.rank)) : 0;
    const top = Math.max(fromSlots, fromKnown);
    if (top <= 0) return 4; // sensible default — show cantrips + 4 ranks
    return Math.min(Math.max(top, 1), 10);
  }, [charData, spells]);

  // Group repertoire spells by rank for section rendering.
  const spellsByRank = useMemo(() => groupBy(spells ?? [], 'rank'), [spells]);

  // Resolved trait names cache — we only need names so we use the
  // already-loaded content store cache. Newly seen IDs are surfaced via
  // the fetchContentAll('trait',…) call below; for the common case where
  // the cache is populated (every spell has been queried once), this is
  // synchronous.
  const traitCache = useMemo(() => {
    const cache = getCachedContent<Trait>('trait') ?? [];
    const map = new Map<number, string>();
    for (const t of cache) map.set(t.id, t.name);
    return map;
  }, [allRawSpells]);

  // Open the Add Spell picker. When the caster needs to choose a rank
  // (selectRank case), the picker hands off to the rank-select modal;
  // otherwise the spell goes into the repertoire at its natural rank.
  // The optional preselectRank arg lets the per-rank "+ Add N-Rank Spell"
  // buttons skip the rank picker entirely.
  const openAddSpellPicker = (preselectRank?: number) => {
    selectContent<Spell>(
      'spell',
      (option) => {
        if (preselectRank !== undefined) {
          addSpell(option, preselectRank);
        } else if (option.rank === 0 || option.rank === 10 || isRitual(option)) {
          addSpell(option, option.rank);
        } else {
          // Spontaneous repertoires support choosing the entry rank
          // independently of the spell's natural rank. LIST-ONLY mode
          // exposes the picker because it's what the spontaneous flow
          // uses; the other modes just add at natural rank.
          if (props.type === 'LIST-ONLY') {
            setRankSelectSpell(option);
          } else {
            addSpell(option, option.rank);
          }
        }
      },
      {
        showButton: true,
        overrideLabel: `Add ${isRituals ? 'Ritual' : 'Spell'}`,
        // The ManageSpells parent opens at zIndex 500 (set by its caller
        // in CodexPanels). The picker must stack ABOVE the Manage
        // Spells modal (1100) AND the description drawers (1000), so
        // bump to 1200.
        zIndex: 1200,
        filterFn: (spellRec: Record<string, any>) => {
          const s = spellRec as Spell;
          return isRituals ? isRitual(s) : isNormalSpell(s);
        },
        advancedPresetFilters: {
          type: 'spell',
          spell_type: isRituals ? 'RITUAL' : 'NORMAL',
          traditions: props.filter?.traditions,
          rank_min: preselectRank ?? props.filter?.rank_min,
          rank_max: preselectRank ?? props.filter?.rank_max,
          content_sources: getDefaultSources('PAGE'),
        },
      }
    );
  };

  const addSpell = (option: Spell, rank: number) => {
    props.setEntity((c) => {
      if (!c) return c;
      const existing = c.spells?.list ?? [];
      // Idempotent add — see ManageSpellsModal history: protects against
      // double-fire and accidental duplicate picks at the same rank/source.
      const alreadyPresent = existing.some(
        (e) => e.spell_id === option.id && e.rank === rank && e.source === props.source
      );
      if (alreadyPresent) return c;
      return {
        ...c,
        spells: {
          ...(c.spells ?? {
            slots: [],
            list: [],
            focus_point_current: 0,
            innate_casts: [],
          }),
          list: [
            ...existing,
            { spell_id: option.id, rank, source: props.source },
          ],
        },
      };
    });
  };

  const deleteSpell = (spellId: number, rank: number) => {
    props.setEntity((c) => {
      if (!c) return c;
      const list = (c.spells?.list ?? []).filter((entry) => {
        return !(entry.spell_id === spellId && entry.rank === rank && entry.source === props.source);
      });
      // Cascade: any prepared slot at this source that referenced the
      // deleted spell is now stranded — clear it so the slot becomes
      // available-to-fill again. Spontaneous slots carry no spell_id, so
      // this is a no-op for them.
      const slots = (c.spells?.slots ?? []).map((s) =>
        s.source === props.source && s.spell_id === spellId
          ? { ...s, spell_id: undefined, exhausted: false }
          : s
      );
      return {
        ...c,
        spells: {
          ...(c.spells ?? {
            slots: [],
            list: [],
            focus_point_current: 0,
            innate_casts: [],
          }),
          list,
          slots,
        },
      };
    });
  };

  // Format the area / range / defense column. Prefers area; falls back
  // to range, then defense, then em-dash. Concatenates basic-save info
  // when both an area and a defense are present (e.g. "10-FT BURST · BASIC REFLEX").
  const formatArea = (spell: Spell): string => {
    const area = spell.area?.trim();
    const range = spell.range?.trim();
    const defense = spell.defense?.trim();
    const parts: string[] = [];
    if (area) parts.push(area);
    else if (range) parts.push(range);
    if (defense) parts.push(defense);
    if (parts.length === 0) return '—';
    return parts.join(' · ');
  };

  const formatTraits = (spell: Spell): string => {
    const ids = spell.traits ?? [];
    if (ids.length === 0) return '';
    const names = ids.map((id) => traitCache.get(id)).filter(isTruthy);
    return names.join(' · ').toLowerCase();
  };

  return (
    <Modal
      opened={props.opened}
      onClose={props.onClose}
      withCloseButton={false}
      title={null}
      classNames={{
        content: 'codex-manage-spells-content',
        body: 'codex-manage-spells-body',
      }}
      size={1500}
      padding={0}
      keepMounted={false}
      zIndex={props.zIndex}
      // Near-opaque overlay + slight blur — the underlying Spells page
      // was bleeding through and made the modal look old/transparent.
      // 85% dark + 3px blur matches the dimming used on AddItems.
      overlayProps={{ backgroundOpacity: 0.85, blur: 3 }}
    >
      <SelectSpellRankModal
        spell={rankSelectSpell}
        onConfirm={(spell, rank) => {
          if (spell && rank !== null) {
            addSpell(spell, rank);
          }
          setRankSelectSpell(null);
        }}
      />

      <div className='codex-manage-spells'>
        {isFetching && <LoadingOverlay visible />}

        {/* Header — Newsreader italic title + meta strip, custom close X. */}
        <div className='cms-head'>
          <div className='cms-title'>
            <span className='cms-flourish'>✦</span> Manage{' '}
            {isRituals ? 'Rituals' : `Spells - ${toLabel(props.source)}`}
            <span className='cms-meta'>{metaStripText}</span>
          </div>
          <button type='button' className='cms-close' onClick={props.onClose} aria-label='Close'>
            ✕
          </button>
        </div>

        {/* Search row — plain input + accent Add button. */}
        <div className='cms-search-row'>
          <div className='cms-search'>
            <span className='cms-search-icon' aria-hidden='true' />
            <input
              type='text'
              placeholder={`Search ${isRituals ? 'ritual' : 'spell'} list…`}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          <button type='button' className='cms-add-btn' onClick={() => openAddSpellPicker()}>
            <span className='cms-plus'>+</span> Add {isRituals ? 'Ritual' : 'Spell'}
          </button>
        </div>

        {/* Body — rank-grouped sections. */}
        <div className='cms-body'>
          {Array.from({ length: maxRank + 1 }, (_, i) => i).map((rank) => {
            const inRank = (spellsByRank[String(rank)] ?? []) as Array<Spell & { signature?: boolean }>;
            const label = rank === 0 ? 'Cantrips' : `${rankNumber(rank)} Rank`;
            const emptyLabel =
              rank === 0
                ? 'No cantrips in repertoire'
                : `No ${rankNumber(rank).toLowerCase()}-rank ${isRituals ? 'rituals' : 'spells'} in repertoire`;
            const addLabel = rank === 0 ? 'Add Cantrip' : `Add ${rankNumber(rank)}-Rank ${isRituals ? 'Ritual' : 'Spell'}`;

            return (
              <div key={rank} className='cms-rank-group'>
                <div className='cms-rank-head'>
                  {label} <span className='cms-rank-count'>{inRank.length}</span>
                </div>
                {inRank.length === 0 ? (
                  <div className='cms-empty-line'>{emptyLabel}</div>
                ) : (
                  inRank.map((spell, idx) => {
                    const traitLabel = formatTraits(spell);
                    const areaLabel = formatArea(spell);
                    const isSig = !!spell.signature;
                    return (
                      <SpellRow
                        key={`${spell.id}-${idx}`}
                        spell={spell}
                        rank={rank}
                        isSignature={isSig}
                        traitLabel={traitLabel}
                        areaLabel={areaLabel}
                        onOpen={() =>
                          openDrawer({
                            type: 'spell',
                            data: { id: spell.id },
                            extra: { addToHistory: true },
                          })
                        }
                        onDelete={() => deleteSpell(spell.id, rank)}
                      />
                    );
                  })
                )}
                <button type='button' className='cms-add-rank' onClick={() => openAddSpellPicker(rank)}>
                  <span className='cms-plus'>+</span> {addLabel}
                </button>
              </div>
            );
          })}
        </div>

        {/* Footer — hint strip + Close/Done. */}
        <div className='cms-footer'>
          <div className='cms-foot-hint'>
            <b>Click</b> a spell to view details <i>·</i> <b>⋯</b> opens its menu <i>·</i> <b>Add</b> opens the picker
          </div>
          <div className='cms-foot-actions'>
            <button type='button' className='cms-btn' onClick={props.onClose}>
              Close
            </button>
            <button type='button' className='cms-btn cms-primary' onClick={props.onClose}>
              Done
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

/**
 * Single spell row in the rank-grouped list. The dots button hosts a
 * Mantine Menu so the existing delete affordance stays available; the
 * row's body opens the spell drawer.
 */
function SpellRow(props: {
  spell: Spell;
  rank: number;
  isSignature: boolean;
  traitLabel: string;
  areaLabel: string;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const { spell, rank, isSignature, traitLabel, areaLabel } = props;
  return (
    <div className='cms-row' onClick={props.onOpen}>
      <div className='cms-row-lvl'>{rank === 0 ? 'C' : rank}</div>
      <div className='cms-row-name-wrap'>
        <span className='cms-row-name'>
          {spell.name}
          {isSignature && <span className='cms-row-star'>★ signature</span>}
        </span>
        {traitLabel && <span className='cms-row-traits'>{traitLabel}</span>}
      </div>
      <div className='cms-row-area'>{areaLabel}</div>
      <Menu shadow='md' width={200} zIndex={1000}>
        <Menu.Target>
          <button
            type='button'
            className='cms-row-dots'
            onClick={(e) => {
              e.stopPropagation();
            }}
            aria-label='Row actions'
          >
            ⋯
          </button>
        </Menu.Target>
        <Menu.Dropdown>
          <Menu.Label>Options</Menu.Label>
          <Menu.Item
            color='red'
            onClick={(e) => {
              e.stopPropagation();
              props.onDelete();
            }}
          >
            Delete
          </Menu.Item>
        </Menu.Dropdown>
      </Menu>
    </div>
  );
}

const SelectSpellRankModal = (props: {
  spell: Spell | null;
  onConfirm: (spell: Spell | null, rank: number | null) => void;
}) => {
  const getRankOptions = (X: number): number[] => Array.from({ length: 11 - X }, (_, i) => X + i);

  return (
    <Modal
      opened={!!props.spell}
      onClose={() => props.onConfirm(null, null)}
      title={<Title order={3}>Select {props.spell?.name}'s Rank</Title>}
      zIndex={1000}
    >
      {props.spell &&
        getRankOptions(props.spell.rank).map((rank) => (
          <Button
            key={rank}
            onClick={() => {
              props.onConfirm(props.spell, rank);
            }}
            variant='light'
            fullWidth
            mb={6}
          >
            {rankNumber(rank)}
          </Button>
        ))}
    </Modal>
  );
};
