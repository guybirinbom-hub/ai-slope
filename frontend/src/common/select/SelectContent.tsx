/* eslint-disable react-refresh/only-export-components */
import { characterState } from '@atoms/characterAtoms';
import { creatureDrawerState, drawerState } from '@atoms/navAtoms';
import { ActionSymbol } from '@common/Actions';
import { BuyItemButton } from '@common/BuyItemButton';
import TraitsDisplay from '@common/TraitsDisplay';
import { fetchContentAll, fetchContentById, getCachedContent, getDefaultSources } from '@content/content-store';
import { isActionCost } from '@content/content-utils';
import { isItemArchaic } from '@items/inv-utils';
import {
  ActionIcon,
  Avatar,
  Badge,
  Box,
  Button,
  ButtonProps,
  Center,
  FocusTrap,
  Group,
  Indicator,
  Loader,
  Menu,
  Pagination,
  ScrollArea,
  Stack,
  Tabs,
  Text,
  TextInput,
  ThemeIcon,
  Title,
  rem,
  useMantineTheme,
} from '@mantine/core';
import { useDebouncedValue, useDidUpdate, useElementSize, useHover, useMergedRef } from '@mantine/hooks';
import { ContextModalProps, modals, openContextModal } from '@mantine/modals';
import { getAdjustedAncestryOperations } from '@operations/operation-controller';
import { ObjectWithUUID, getSelectedCustomOption } from '@operations/operation-utils';
import {
  IconCheck,
  IconChevronDown,
  IconChevronUp,
  IconCopy,
  IconDots,
  IconSearch,
  IconTransform,
  IconTrash,
  IconX,
  IconZoomCheck,
  IconZoomQuestion,
} from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { DrawerType, GenericData } from '@schemas/index';
import { OperationSelectOptionCustom } from '@schemas/operations';
import { ExtendedProficiencyType, ProficiencyType, VariableListStr, VariableProf } from '@schemas/variables';
import { isPhoneSized } from '@utils/mobile-responsive';
import { pluralize, toLabel } from '@utils/strings';
import { hasTraitType } from '@utils/traits';
import {
  getResizableModalContextProps,
  useModalSizePersistence,
} from '@utils/use-resizable-modal';
import {
  passesItemGroupFilter,
  extractAncestrySize,
  matchesCastTime,
} from './filter-helpers';
import { getStatBlockDisplay, getStatDisplay } from '@variables/initial-stats-display';
import { meetsPrerequisites } from '@variables/prereq-detection';
import { getFinalProfValue } from '@variables/variable-helpers';
import {
  getAllAncestryTraitVariables,
  getAllArchetypeTraitVariables,
  getAllAttributeVariables,
  getAllClassTraitVariables,
  getVariable,
} from '@variables/variable-manager';
import {
  compileProficiencyType,
  isProficiencyType,
  maxProficiencyType,
  nextProficiencyType,
  prevProficiencyType,
} from '@variables/variable-utils';
import * as JsSearch from 'js-search';
import { ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { useAtom, useAtomValue } from 'jotai';
import {
  AbilityBlock,
  AbilityBlockType,
  Ancestry,
  Archetype,
  Background,
  Class,
  ClassArchetype,
  ContentType,
  Creature,
  Item,
  Language,
  Spell,
  Trait,
  VersatileHeritage,
} from '@schemas/content';
import { adjustCreature } from '@utils/creature';
import { intersection, isEqual, isNumber } from 'lodash-es';
import { getEntityLevel } from '@utils/entity-utils';
import { FiltersParams } from '@modals/AdvancedSearchModal';
import {
  IMPRINT_BG_COLOR,
  IMPRINT_BG_COLOR_HOVER,
  IMPRINT_BG_COLOR_HOVER_2,
  IMPRINT_BORDER_COLOR,
} from '@constants/data';
import SelectContentFilters, {
  activeFilterCount,
  ContentFilterState,
  DEFAULT_FILTER_STATE,
  FeatType,
  TriState,
  TriStateMap,
} from './SelectContentFilters';
import {
  buildSpellFilterDomain,
  parseAreaFt,
  parseDistanceFt,
  parseDurationSec,
} from './spell-filter-domain';
import { IconFilter } from '@tabler/icons-react';

export function SelectContentButton<T extends Record<string, any> = Record<string, any>>(props: {
  type: ContentType;
  onClick: (option: T) => void;
  onClear?: () => void;
  selectedId?: number;
  options?: {
    overrideOptions?: T[];
    overrideLabel?: string;
    abilityBlockType?: AbilityBlockType;
    skillAdjustment?: ExtendedProficiencyType;
    filterFn?: (option: T) => boolean;
    advancedPresetFilters?: Partial<FiltersParams>;
    showButton?: boolean;
    includeOptions?: boolean;
    description?: ReactNode;
  };
}) {
  const [_drawer, openDrawer] = useAtom(drawerState);
  const [selected, setSelected] = useState<T | undefined>();
  const [debouncedSelected] = useDebouncedValue(selected, 3000);

  // Sync the selected content (only after huge delay)
  useEffect(() => {
    (async () => {
      // If they're the same, no need to do anything
      if (props.selectedId === selected?.id) {
        return;
      }
      // If it's been a short time since the selected changed, don't do anything
      if (!isEqual(debouncedSelected, selected)) {
        return;
      }

      if (!props.selectedId) {
        setSelected(undefined);
        return;
      }

      if (isNumber(props.selectedId)) {
        const content = await fetchContentById<T>(props.type, props.selectedId);
        if (content) {
          setSelected(content);
          return;
        }
      }

      if (props.options?.overrideOptions) {
        const option = props.options.overrideOptions.find(
          // @ts-ignore
          (option) => option.id === props.selectedId
        );
        if (option) {
          setSelected(option);
          return;
        }
      }
    })();
  }, [debouncedSelected, props.selectedId, props.type, props.options?.overrideOptions]);

  const typeName = toLabel(props.options?.abilityBlockType || props.type);

  const label = selected ? selected.name : (props.options?.overrideLabel ?? `Select ${typeName}`);

  const onSelect = () => {
    selectContent<T>(
      props.type,
      (option) => {
        setSelected(option);
        props.onClick(option);
      },
      {
        overrideOptions: props.options?.overrideOptions as Record<string, any>[],
        overrideLabel: props.options?.overrideLabel,
        abilityBlockType: props.options?.abilityBlockType,
        skillAdjustment: props.options?.skillAdjustment,
        // @ts-ignore
        selectedId: selected?.id,
        // @ts-ignore
        filterFn: props.options?.filterFn,
        showButton: props.options?.showButton,
        includeOptions: props.options?.includeOptions,
        advancedPresetFilters: props.options?.advancedPresetFilters,
        description: props.options?.description,
      }
    );
  };

  const drawerType: DrawerType = props.options?.abilityBlockType ?? props.type;
  const customSelect =
    props.options?.overrideOptions &&
    props.options.overrideOptions.length > 0 &&
    props.options.overrideOptions[0]._custom_select;
  const hideSwitch = drawerType === 'ability-block' && !customSelect;
  const showLongName = drawerType === 'ability-block';

  const onView = () => {
    if (customSelect) {
      openDrawer({
        type: 'generic',
        data: selected,
        extra: { addToHistory: true },
      });
    } else {
      openDrawer({
        type: drawerType,
        data: { zIndex: 1600, id: selected?.id },
        extra: { addToHistory: true },
      });
    }
  };

  return (
    <Button.Group className='selection-choice-base'>
      <Button
        className={selected ? 'selection-choice-selected' : 'selection-choice-unselected'}
        variant={selected ? 'light' : 'filled'}
        size='compact-sm'
        radius='xl'
        w={showLongName ? undefined : 160}
        miw={showLongName ? 140 : undefined}
        onClick={() => {
          if (selected && !hideSwitch) {
            onView();
          } else {
            onSelect();
          }
        }}
      >
        {label}
      </Button>
      {selected && (
        <>
          {!hideSwitch && (
            <Button
              variant='light'
              size='compact-sm'
              radius='xl'
              onClick={() => {
                onSelect();
              }}
              style={{
                borderLeft: '1px solid',
              }}
            >
              <IconTransform size='0.9rem' />
            </Button>
          )}
          <Button
            variant='light'
            size='compact-sm'
            radius='xl'
            onClick={() => {
              setSelected(undefined);
              props.onClear && props.onClear();
            }}
            style={{
              borderLeft: '1px solid',
            }}
          >
            <IconX size='1rem' />
          </Button>
        </>
      )}
    </Button.Group>
  );
}

export function selectContent<T = Record<string, any>>(
  type: ContentType,
  onClick?: (option: T) => void,
  options?: {
    overrideOptions?: Record<string, any>[];
    overrideLabel?: string;
    abilityBlockType?: AbilityBlockType;
    skillAdjustment?: ExtendedProficiencyType;
    selectedId?: number;
    filterFn?: (option: Record<string, any>) => boolean;
    advancedPresetFilters?: Partial<FiltersParams>;
    showButton?: boolean;
    includeOptions?: boolean;
    zIndex?: number;
    description?: ReactNode;
  }
) {
  let label = `Select ${toLabel(options?.abilityBlockType || type)}`;
  if (options?.overrideLabel) label = options.overrideLabel;

  // Resizable + size-persistent. We pull the saved size synchronously
  // here so the modal opens at the user's last chosen dimensions —
  // no flicker, no jump-to-saved-size after mount. The matching
  // `useModalSizePersistence('select-content')` call inside
  // SelectContentModal writes the new size back when the user drags.
  // Default 1300×800 doubles the old 'xl' footprint, fitting the
  // multi-column filter panel + option list comfortably on a 1080p
  // monitor.
  // Unified at 1500×900 to match the other codex popups (Add Items,
  // Manage Spells, Advanced Search). Still user-resizable via the
  // drag handle so they can grow it if they need more room.
  const resizable = getResizableModalContextProps('select-content', {
    width: 1500,
    height: 900,
  });

  // Every content-type picker now flows through the wg4 parchment shell
  // (`Wg4PickerShell`). Title gets a leading flourish glyph that the
  // shell paints in accent colour next to the italic Newsreader title.
  const titleText = `✦ ${label}`;

  // The marker class `.codex-select-content-body` is applied to the
  // Mantine modal body for EVERY type so codex-bridge.css can:
  //   • lock the frame to 1500×75vh (matching Add Items / Manage Spells)
  //   • paint the parchment surface
  //   • set the near-opaque overlay
  //   • hide the Mantine header (the wg4 shell renders its own
  //     `.csp-head` with italic title + close X)
  // The legacy `.codex-select-spell-body` alias is kept for backwards
  // compatibility — see codex-bridge.css.
  const mergedClassNames = {
    ...resizable.classNames,
    body: 'codex-select-content-body',
  };

  openContextModal({
    modal: 'selectContent',
    // Drop the Mantine title for every type — the wg4 `.csp-head`
    // renders its own italic Newsreader title with a flourish glyph
    // and the close X.
    title: null,
    // Default zIndex 1100 so the picker sits ABOVE the description
    // drawers (which mount at zIndex 1000). Per user request: popups
    // should always render on top of the side description panels so
    // the chosen content stays focused while browsing the list.
    zIndex: options?.zIndex ?? 1100,
    // Mantine's size= would override our explicit width via CSS vars,
    // so we pass undefined and let the styles.content width win.
    size: undefined,
    classNames: mergedClassNames,
    styles: resizable.styles,
    // Hide the Mantine close-X — the `.csp-close` button in the wg4
    // header handles closing.
    withCloseButton: false,
    // Near-opaque overlay + slight blur to match Add Items / Manage
    // Spells dimming behaviour.
    overlayProps: { backgroundOpacity: 0.85, blur: 3 },
    // Drop the default Mantine body padding — the wg4 shell paints
    // its own padding via `.csp-head` / `.csp-search-row` etc.
    padding: 0,
    innerProps: {
      type,
      onClick: onClick ? (option: any) => onClick(option as T) : undefined,
      options,
      _titleText: titleText,
    },
  });
}

// ──────────────────────────────────────────────────────────────────────
// SpellPickerShell — custom parchment shell for the spell picker.
//
// Strategy B (from the wg4 mockup `proposals/spell-modals-mockup.html`):
// we paint the entire modal body ourselves instead of trying to override
// Mantine's deep DOM via CSS, mirroring how `.codex-add-items` /
// `.codex-manage-spells` already work. SelectContentModal short-circuits
// to this component when `innerProps.type === 'spell'`.
//
// Reuses the existing data pipeline: same fetchContentAll('spell',…),
// same SelectContentFilters component for the filter panel, same
// triStateMatches + parseDistanceFt/parseAreaFt/parseDurationSec helpers.
// Only the visual scaffolding changes — and it's quarantined to the
// spell type so feat / item / ancestry / language / creature pickers
// keep their existing chrome unchanged.
// ──────────────────────────────────────────────────────────────────────
function SpellPickerShell(props: {
  titleText: string;
  onClose: () => void;
  // Optional consumer callback. When set, clicking "Add" on a row
  // forwards the spell here and closes the modal — same shape as the
  // legacy SelectionOptions onClick.
  onClick?: (option: Spell) => void;
  // Same options shape SelectContentModal sees — we only read a small
  // subset (filterFn, overrideOptions, advancedPresetFilters,
  // showButton, includeOptions).
  options?: {
    overrideOptions?: Record<string, any>[];
    filterFn?: (option: Record<string, any>) => boolean;
    advancedPresetFilters?: Partial<FiltersParams>;
    showButton?: boolean;
    includeOptions?: boolean;
  };
}) {
  const NUM_PER_PAGE = 18;
  const [_drawer, openDrawer] = useAtom(drawerState);

  const [searchQuery, setSearchQuery] = useState('');
  const [searchQueryDebounced] = useDebouncedValue(searchQuery, 200);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filterState, setFilterState] = useState<ContentFilterState>(() => ({
    ...DEFAULT_FILTER_STATE,
  }));
  // "Find a filter" query — hoisted up out of SelectContentFilters so
  // the modal's top search bar can host it when the filter panel is
  // open (same pattern as AddItemsModal).
  const [filterSearchQuery, setFilterSearchQuery] = useState('');
  const [activePage, setPage] = useState(1);

  // Fetch the full spell store, then narrow with consumer filterFn.
  const { data: rawSpells, isFetching } = useQuery({
    queryKey: [`spell-picker-shell-spells`],
    queryFn: async () => {
      return (await fetchContentAll<Spell>('spell', getDefaultSources('PAGE'))) ?? [];
    },
  });

  // Build (or reuse) a JsSearch index on the loaded spells. Re-indexes
  // when the dataset changes.
  const search = useRef(new JsSearch.Search('id'));
  useEffect(() => {
    if (!rawSpells) return;
    // Re-create the index so we don't keep stale documents from a
    // previous fetch.
    const s = new JsSearch.Search('id');
    s.addIndex('name');
    s.addDocuments(rawSpells);
    search.current = s;
  }, [rawSpells]);

  // Trait cache for row subtitle. The cached content store is populated
  // on first fetch; if it's empty we just leave the subtitle blank
  // rather than blocking the render.
  const traitCache = useMemo(() => {
    const cache = getCachedContent<Trait>('trait') ?? [];
    const map = new Map<number, string>();
    for (const t of cache) map.set(t.id, t.name);
    return map;
  }, [rawSpells]);

  // Domain values for the Range / Area / Duration sliders. Built from
  // the actual fetched spells so the slider only spans values that
  // exist.
  const spellDomain = useMemo(() => {
    if (!rawSpells) return undefined;
    return buildSpellFilterDomain(rawSpells);
  }, [rawSpells]);

  // Allowed traits — narrow the Traits autocomplete to traits that
  // actually appear on spells in the current set.
  const allowedTraitIds = useMemo(() => {
    if (!rawSpells) return undefined;
    const ids = new Set<number>();
    for (const s of rawSpells) for (const t of s.traits ?? []) ids.add(t);
    return [...ids];
  }, [rawSpells]);

  const maxRank = useMemo(() => {
    if (!rawSpells || rawSpells.length === 0) return 10;
    return Math.min(10, rawSpells.reduce((m, s) => Math.max(m, s.rank ?? 0), 0));
  }, [rawSpells]);

  // Apply the same filter pipeline SelectContentModal uses, narrowed to
  // the fields that actually apply to spells.
  const triStateMatches = <K,>(map: TriStateMap<K>, value: K | undefined): boolean => {
    if (map.size === 0) return true;
    if (value !== undefined && map.get(value) === 'exclude') return false;
    const hasInclude = [...map.values()].includes('include');
    if (hasInclude && (value === undefined || map.get(value) !== 'include')) return false;
    return true;
  };
  const triStateMatchesAny = <K,>(map: TriStateMap<K>, values: K[]): boolean => {
    if (map.size === 0) return true;
    if (values.some((v) => map.get(v) === 'exclude')) return false;
    const hasInclude = [...map.values()].includes('include');
    if (hasInclude && !values.some((v) => map.get(v) === 'include')) return false;
    return true;
  };

  const applyFilter = (spell: Spell): boolean => {
    const rnk = spell.rank ?? 0;
    if (rnk < filterState.rankMin || rnk > filterState.rankMax) return false;
    const rarity = (spell.rarity ?? 'COMMON') as any;
    if (!triStateMatches(filterState.rarities, rarity)) return false;
    const availability = ((spell as any).availability ?? 'STANDARD') as any;
    if (!triStateMatches(filterState.availabilities, availability)) return false;
    if (filterState.traditions.size > 0) {
      const tr = ((spell.traditions ?? []) as string[]).map((x) => x.toUpperCase());
      if (!triStateMatchesAny(filterState.traditions, tr)) return false;
    }
    if (filterState.spellTypes.size > 0) {
      const meta = (spell as any).meta_data ?? {};
      const isRitual = !!meta.ritual;
      const isFocus = !!meta.focus;
      const kind: 'NORMAL' | 'FOCUS' | 'RITUAL' = isRitual ? 'RITUAL' : isFocus ? 'FOCUS' : 'NORMAL';
      if (!triStateMatches(filterState.spellTypes, kind)) return false;
    }
    if (filterState.traits.length > 0) {
      const traits = (spell.traits ?? []) as number[];
      if (!filterState.traits.every((id) => traits.includes(id))) return false;
    }
    if (filterState.rangeFt) {
      const n = parseDistanceFt(spell.range);
      if (n !== null && (n < filterState.rangeFt[0] || n > filterState.rangeFt[1])) return false;
    }
    if (filterState.areaFt) {
      const n = parseAreaFt(spell.area);
      if (n !== null && (n < filterState.areaFt[0] || n > filterState.areaFt[1])) return false;
    }
    if (filterState.durationSec) {
      const n = parseDurationSec(spell.duration);
      if (n !== null && (n < filterState.durationSec[0] || n > filterState.durationSec[1])) return false;
    }
    if (filterState.cast.trim()) {
      if (!matchesCastTime(spell.cast, filterState.cast.trim())) return false;
    }
    const textChecks: Array<[keyof ContentFilterState, string]> = [
      ['description', 'description'],
      ['defense', 'defense'],
      ['targets', 'targets'],
      ['trigger', 'trigger'],
      ['requirements', 'requirements'],
    ];
    for (const [key, field] of textChecks) {
      const needle = String(filterState[key] ?? '').trim().toLowerCase();
      if (!needle) continue;
      const haystack = String((spell as any)[field] ?? '').toLowerCase();
      if (!haystack.includes(needle)) return false;
    }
    return true;
  };

  // Compose final option list: search → consumer filterFn → state filter → sort.
  const allFilteredSpells = useMemo(() => {
    const base: Spell[] = (() => {
      if (!rawSpells) return [];
      if (searchQueryDebounced.trim()) {
        return (search.current.search(searchQueryDebounced.trim()) as Spell[]) ?? [];
      }
      return rawSpells;
    })();
    return base
      .filter((s) => (props.options?.filterFn ? props.options.filterFn(s as any) : true))
      .filter(applyFilter)
      .sort((a, b) => {
        if (a.rank === b.rank) return a.name.localeCompare(b.name);
        return a.rank - b.rank;
      });
  }, [rawSpells, searchQueryDebounced, filterState, props.options?.filterFn]);

  // Reset to page 1 whenever the result set could change underneath us.
  useEffect(() => {
    setPage(1);
  }, [searchQueryDebounced, filterState, rawSpells]);
  useEffect(() => {
    if (!filtersOpen) setFilterSearchQuery('');
  }, [filtersOpen]);

  const totalCount = allFilteredSpells.length;
  const totalPages = Math.max(1, Math.ceil(totalCount / NUM_PER_PAGE));
  const pageSpells = allFilteredSpells.slice((activePage - 1) * NUM_PER_PAGE, activePage * NUM_PER_PAGE);
  const fromIndex = totalCount === 0 ? 0 : (activePage - 1) * NUM_PER_PAGE + 1;
  const toIndex = Math.min(activePage * NUM_PER_PAGE, totalCount);
  const filterCount = activeFilterCount(filterState, 'spell');

  // Pretty-print a tradition list, e.g. ['ARCANE','OCCULT'] → "Arcane · Occult".
  const fmtTraditions = (spell: Spell): string => {
    const list = ((spell.traditions ?? []) as string[]).map((s) => toLabel(s));
    if (list.length === 0) return '—';
    if (list.length === 4) return 'All Four';
    return list.join(' · ');
  };

  // Subtitle for the spell row — list of trait names (lowercase, dot
  // separated) so a player can see "concentrate · auditory · mental" at
  // a glance.
  const fmtTraitSubtitle = (spell: Spell): string => {
    const ids = spell.traits ?? [];
    if (ids.length === 0) return '';
    const names = ids
      .map((id) => traitCache.get(id))
      .filter((n): n is string => !!n)
      .map((n) => n.toLowerCase());
    return names.join(' · ');
  };

  const onPickSpell = (spell: Spell) => {
    props.onClick?.(spell);
    props.onClose();
  };

  return (
    <div className='codex-select-content codex-spell-picker'>
      <div className='csp-head'>
        <div className='csp-title'>
          {props.titleText.includes('✦') ? (
            <>
              <span className='csp-flourish'>✦</span> {props.titleText.replace('✦', '').trim()}
            </>
          ) : (
            <>
              <span className='csp-flourish'>✦</span> {props.titleText}
            </>
          )}
        </div>
        <button
          type='button'
          className='csp-close'
          onClick={props.onClose}
          aria-label='Close'
        >
          ✕
        </button>
      </div>

      <div className='csp-search-row'>
        <div className='csp-search'>
          <span className='csp-search-icon' aria-hidden='true' />
          <input
            type='text'
            placeholder={filtersOpen ? 'Find a filter — e.g. "rank", "tradition", "cast time"…' : 'Search spells by name…'}
            value={filtersOpen ? filterSearchQuery : searchQuery}
            onChange={(e) => (filtersOpen ? setFilterSearchQuery(e.target.value) : setSearchQuery(e.target.value))}
            autoFocus
          />
        </div>
        <button
          type='button'
          className={`csp-filters-btn${filtersOpen ? ' on' : ''}`}
          onClick={() => setFiltersOpen((v) => !v)}
        >
          ⚙ Filters{filterCount > 0 ? ` (${filterCount})` : ''}
          <span className='csp-filters-caret' aria-hidden='true'>{filtersOpen ? '▴' : '▾'}</span>
        </button>
      </div>

      <div className='csp-body'>
        {filtersOpen ? (
          <div className='csp-filter-panel'>
            <SelectContentFilters
              type='spell'
              state={filterState}
              onChange={setFilterState}
              maxRank={maxRank}
              spellDomain={spellDomain}
              allowedTraitIds={allowedTraitIds}
              searchQuery={filterSearchQuery}
              onSearchQueryChange={setFilterSearchQuery}
              hideSearchInput
            />
          </div>
        ) : (
          <>
            <div className='csp-table'>
              <div className='csp-thead'>
                <div className='csp-col-rank'>Rank</div>
                <div className='csp-col-spell'>Spell</div>
                <div className='csp-col-trd'>Tradition</div>
                <div className='csp-col-action'>Action</div>
              </div>
              <div className='csp-tbody'>
                {isFetching && pageSpells.length === 0 && (
                  <div className='csp-empty'>Loading spells…</div>
                )}
                {!isFetching && pageSpells.length === 0 && (
                  <div className='csp-empty'>
                    {searchQueryDebounced.trim()
                      ? `No spells match "${searchQueryDebounced.trim()}".`
                      : filterCount > 0
                        ? 'No spells match the current filters.'
                        : 'No spells available.'}
                  </div>
                )}
                {pageSpells.map((spell) => {
                  const sub = fmtTraitSubtitle(spell);
                  const trd = fmtTraditions(spell);
                  return (
                    <div
                      key={spell.id}
                      className='csp-row'
                      onClick={() =>
                        openDrawer({
                          type: 'spell',
                          data: { zIndex: 1600, id: spell.id },
                          extra: { addToHistory: true },
                        })
                      }
                    >
                      <div className='csp-col-rank csp-rank'>
                        {spell.rank === 0 ? 'C' : spell.rank}
                      </div>
                      <div className='csp-col-spell csp-name'>
                        {spell.name}
                        {sub && <em className='csp-sub'>{sub}</em>}
                      </div>
                      <div className='csp-col-trd csp-trd'>{trd}</div>
                      <div className='csp-col-action csp-action'>
                        <button
                          type='button'
                          className='csp-btn'
                          onClick={(e) => {
                            e.stopPropagation();
                            onPickSpell(spell);
                          }}
                        >
                          Add
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className='csp-pager'>
              <button
                type='button'
                className='csp-pg-nav'
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={activePage <= 1}
                aria-label='Previous'
              >
                ‹
              </button>
              {/* Pager — show a window of 7 buttons around the current
                  page, plus first/last with `…` gaps. Mirrors the same
                  helper in AddItemsModal.tsx. */}
              {(() => {
                const WINDOW = 7;
                const out: (number | '…')[] = [];
                if (totalPages <= WINDOW + 2) {
                  for (let p = 1; p <= totalPages; p++) out.push(p);
                } else {
                  let start = activePage - Math.floor(WINDOW / 2);
                  let end = activePage + Math.floor(WINDOW / 2);
                  if (start < 1) { end += 1 - start; start = 1; }
                  if (end > totalPages) { start -= end - totalPages; end = totalPages; }
                  start = Math.max(1, start);
                  end = Math.min(totalPages, end);
                  if (start > 1) {
                    out.push(1);
                    if (start > 2) out.push('…');
                  }
                  for (let p = start; p <= end; p++) out.push(p);
                  if (end < totalPages) {
                    if (end < totalPages - 1) out.push('…');
                    out.push(totalPages);
                  }
                }
                return out.map((p, i) =>
                  p === '…' ? (
                    <span key={`gap${i}`} className='csp-pg-gap'>
                      …
                    </span>
                  ) : (
                    <button
                      key={p}
                      type='button'
                      className={`csp-pg${p === activePage ? ' on' : ''}`}
                      onClick={() => setPage(p)}
                    >
                      {p}
                    </button>
                  )
                );
              })()}
              <button
                type='button'
                className='csp-pg-nav'
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={activePage >= totalPages}
                aria-label='Next'
              >
                ›
              </button>
            </div>
            <div className='csp-count'>
              Showing {fromIndex} – {toIndex} of <b>{totalCount.toLocaleString()}</b> spells
            </div>
          </>
        )}
      </div>

      <div className='csp-footer'>
        <div className='csp-foot-hint'>
          {filtersOpen ? (
            <>
              <b>Reset</b> clears every filter <i>·</i> <b>Apply</b> returns to the spell list
            </>
          ) : (
            <>
              <b>Click</b> a row to view spell <i>·</i> <b>Add</b> adds it to the repertoire
            </>
          )}
        </div>
        <div className='csp-foot-actions'>
          {filtersOpen ? (
            <>
              <button
                type='button'
                className='csp-foot-close'
                onClick={() => setFilterState({ ...DEFAULT_FILTER_STATE })}
              >
                Reset
              </button>
              <button
                type='button'
                className='csp-foot-done'
                onClick={() => setFiltersOpen(false)}
              >
                Apply
              </button>
            </>
          ) : (
            <>
              <button
                type='button'
                className='csp-foot-close'
                onClick={props.onClose}
              >
                Close
              </button>
              <button
                type='button'
                className='csp-foot-done'
                onClick={props.onClose}
              >
                Done
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Wg4PickerShell — unified parchment shell for every NON-spell picker.
//
// Same chrome the spell picker uses (`.codex-select-content` /
// `.csp-*` classes from codex-bridge.css), but now hosts the existing
// SelectContentModal data pipeline: per-type fetchContentAll, JsSearch
// indexing, tab handling for ancestry-feat / class-feat / heritage
// flows, advancedPresetFilters, content-source filtering, drawer
// open on row click, addToHistory, etc. — preserved verbatim. The only
// thing that changes is the visual scaffolding around the rows: rows
// now render as wg4 `<div className='csp-row'>` markup via per-type
// row renderers (renderSimpleRow / renderFeatRow / renderItemRow / …)
// instead of Mantine's dark BaseSelectionOption.
// ──────────────────────────────────────────────────────────────────────
type PickerRow = {
  key: string | number;
  // The option payload — passed through to onClick and to the parent's
  // drawer-open path. Plain Record<string, any> mirrors what
  // SelectionOptions consumed historically.
  option: Record<string, any>;
  // Rendered JSX for the row's main content. The shell wraps this in
  // the `<div className='csp-row'>` chrome + handles the click/select
  // behaviour, so renderers only return the inner slots
  // (`.csp-row-lvl`, `.csp-row-name`, `.csp-row-badges`,
  // `<button className='csp-row-select'>`).
  content: ReactNode;
  // Click behaviour for the row body (typically opens the drawer). The
  // select button still calls onSelect via the renderer.
  onClick?: () => void;
  // Optional row variant class added to the row element. Currently used
  // for "simple" two-column rows (ancestry, attribute, …) that skip
  // the level/badges columns.
  variantClass?: string;
};

type Wg4Tab = {
  key: string;
  label: string;
  count?: number;
};

function Wg4PickerShell(props: {
  titleText: string;
  metaText?: string;
  onClose: () => void;
  // Type-aware filter panel — same SelectContentFilters component the
  // legacy modal used. Pass-through to render the right filter blocks.
  type: ContentType;
  abilityBlockType?: AbilityBlockType;
  featType?: FeatType;
  maxLevel?: number;
  maxRank?: number;
  spellDomain?: ReturnType<typeof buildSpellFilterDomain>;
  allowedTraitIds?: number[];
  // Filter state + handler — lifted into Wg4PickerShell so the search
  // row owns the "Filters (N)" badge count.
  filterState: ContentFilterState;
  setFilterState: (next: ContentFilterState) => void;
  // Search bar placeholder. Defaults to "Search options…".
  searchPlaceholder?: string;
  searchQuery: string;
  setSearchQuery: (next: string) => void;
  // Custom-select mode (attribute boost / skill prof picks etc.)
  // hides the Filters button entirely.
  hideFilters?: boolean;
  // Optional tabs strip — when present, renders a Newsreader/Geist tab
  // bar above the search row with the count chip. activeTab + setTab
  // are owned by the parent so the body re-fetches on tab change.
  tabs?: Wg4Tab[];
  activeTab?: string;
  setActiveTab?: (next: string) => void;
  // Body — list of rows to render in the current page. The shell owns
  // pagination + the count strip; the parent provides the slice via
  // `rows`, `totalCount`, `pageFrom`, `pageTo`, plus `activePage` +
  // `setPage` + `totalPages`. `isLoading` keeps the parchment frame
  // visible while options stream in.
  rows: PickerRow[];
  totalCount: number;
  pageFrom: number;
  pageTo: number;
  totalPages: number;
  activePage: number;
  setPage: (next: number) => void;
  isLoading: boolean;
  // Empty-state message override. Defaults to "No options match …".
  emptyMessage?: string;
  // Pretty-print label for the count strip (e.g. "spells", "feats",
  // "items"). Defaults to "options".
  countNoun?: string;
  // Optional description ReactNode rendered above the body (passed
  // through from selectContent({ ..., description })). Keeps the
  // existing OperationsModal behaviour where some pickers prefix a
  // sentence above the list.
  description?: ReactNode;
}) {
  const [filtersOpen, setFiltersOpen] = useState(false);
  // "Find a filter" query — hoisted up into the modal's top search bar
  // so it replaces the items search when the filter panel is open
  // (same pattern as AddItemsModal / SpellPickerShell).
  const [filterSearchQuery, setFilterSearchQuery] = useState('');
  useEffect(() => {
    if (!filtersOpen) setFilterSearchQuery('');
  }, [filtersOpen]);

  const filterCount = activeFilterCount(
    props.filterState,
    props.type,
    props.abilityBlockType
  );

  const pagerWindow = (() => {
    const WINDOW = 7;
    const out: (number | '…')[] = [];
    const tp = props.totalPages;
    const ap = props.activePage;
    if (tp <= WINDOW + 2) {
      for (let p = 1; p <= tp; p++) out.push(p);
    } else {
      let start = ap - Math.floor(WINDOW / 2);
      let end = ap + Math.floor(WINDOW / 2);
      if (start < 1) {
        end += 1 - start;
        start = 1;
      }
      if (end > tp) {
        start -= end - tp;
        end = tp;
      }
      start = Math.max(1, start);
      end = Math.min(tp, end);
      if (start > 1) {
        out.push(1);
        if (start > 2) out.push('…');
      }
      for (let p = start; p <= end; p++) out.push(p);
      if (end < tp) {
        if (end < tp - 1) out.push('…');
        out.push(tp);
      }
    }
    return out;
  })();

  return (
    <div className='codex-select-content'>
      <div className='csp-head'>
        <div className='csp-title'>
          <span className='csp-flourish'>✦</span>{' '}
          {props.titleText.replace(/^✦\s*/, '').trim()}
          {props.metaText && <span className='csp-meta'>{props.metaText}</span>}
        </div>
        <button
          type='button'
          className='csp-close'
          onClick={props.onClose}
          aria-label='Close'
        >
          ✕
        </button>
      </div>

      {props.tabs && props.tabs.length > 1 && (
        <div className='csp-tabstrip'>
          {props.tabs.map((tab) => (
            <button
              key={tab.key}
              type='button'
              className={props.activeTab === tab.key ? 'on' : ''}
              onClick={() => props.setActiveTab?.(tab.key)}
            >
              {tab.label}
              {tab.count !== undefined && (
                <span className='ct'>{tab.count}</span>
              )}
            </button>
          ))}
        </div>
      )}

      <div className='csp-search-row'>
        <div className='csp-search'>
          <span className='csp-search-icon' aria-hidden='true' />
          <input
            type='text'
            placeholder={
              filtersOpen
                ? 'Find a filter — e.g. "level", "trait"…'
                : props.searchPlaceholder ?? 'Search options…'
            }
            value={filtersOpen ? filterSearchQuery : props.searchQuery}
            onChange={(e) =>
              filtersOpen
                ? setFilterSearchQuery(e.target.value)
                : props.setSearchQuery(e.target.value)
            }
            autoFocus
          />
        </div>
        {!props.hideFilters && (
          <button
            type='button'
            className={`csp-filters-btn${filtersOpen ? ' on' : ''}`}
            onClick={() => setFiltersOpen((v) => !v)}
          >
            ⚙ Filters{filterCount > 0 ? ` (${filterCount})` : ''}
            <span className='csp-filters-caret' aria-hidden='true'>
              {filtersOpen ? '▴' : '▾'}
            </span>
          </button>
        )}
      </div>

      <div className='csp-body'>
        {filtersOpen ? (
          <div className='csp-filter-panel'>
            <SelectContentFilters
              type={props.type}
              abilityBlockType={props.abilityBlockType}
              featType={props.featType}
              state={props.filterState}
              onChange={props.setFilterState}
              maxLevel={props.maxLevel}
              maxRank={props.maxRank}
              spellDomain={props.spellDomain}
              allowedTraitIds={props.allowedTraitIds}
              searchQuery={filterSearchQuery}
              onSearchQueryChange={setFilterSearchQuery}
              hideSearchInput
            />
          </div>
        ) : (
          <>
            <div className='csp-table'>
              {props.description && (
                <div className='csp-description'>{props.description}</div>
              )}
              <div className='csp-tbody'>
                {props.isLoading && props.rows.length === 0 && (
                  <div className='csp-empty'>Loading {props.countNoun ?? 'options'}…</div>
                )}
                {!props.isLoading && props.rows.length === 0 && (
                  <div className='csp-empty'>
                    {props.emptyMessage ?? `No ${props.countNoun ?? 'options'} match the current filters.`}
                  </div>
                )}
                {props.rows.map((row) => (
                  <div
                    key={row.key}
                    className={`csp-row${row.variantClass ? ` ${row.variantClass}` : ''}`}
                    onClick={row.onClick}
                  >
                    {row.content}
                  </div>
                ))}
              </div>
            </div>

            {props.totalPages > 1 && (
              <div className='csp-pager'>
                <button
                  type='button'
                  className='csp-pg-nav'
                  onClick={() => props.setPage(Math.max(1, props.activePage - 1))}
                  disabled={props.activePage <= 1}
                  aria-label='Previous'
                >
                  ‹
                </button>
                {pagerWindow.map((p, i) =>
                  p === '…' ? (
                    <span key={`gap${i}`} className='csp-pg-gap'>
                      …
                    </span>
                  ) : (
                    <button
                      key={p}
                      type='button'
                      className={`csp-pg${p === props.activePage ? ' on' : ''}`}
                      onClick={() => props.setPage(p)}
                    >
                      {p}
                    </button>
                  )
                )}
                <button
                  type='button'
                  className='csp-pg-nav'
                  onClick={() =>
                    props.setPage(Math.min(props.totalPages, props.activePage + 1))
                  }
                  disabled={props.activePage >= props.totalPages}
                  aria-label='Next'
                >
                  ›
                </button>
              </div>
            )}
            <div className='csp-count'>
              {props.totalCount === 0
                ? `NO ${(props.countNoun ?? 'OPTIONS').toUpperCase()}`
                : props.totalPages > 1
                  ? <>Showing {props.pageFrom} – {props.pageTo} of <b>{props.totalCount.toLocaleString()}</b> {props.countNoun ?? 'options'}</>
                  : <>Showing all <b>{props.totalCount.toLocaleString()}</b> {props.countNoun ?? 'options'}</>}
            </div>
          </>
        )}
      </div>

      <div className='csp-footer'>
        <div className='csp-foot-hint'>
          {filtersOpen ? (
            <>
              <b>Reset</b> clears every filter <i>·</i> <b>Apply</b> returns to the list
            </>
          ) : (
            <>
              <b>Click</b> a row to view <i>·</i> <b>Select</b> chooses the option
            </>
          )}
        </div>
        <div className='csp-foot-actions'>
          {filtersOpen ? (
            <>
              <button
                type='button'
                className='csp-foot-close'
                onClick={() => props.setFilterState({ ...DEFAULT_FILTER_STATE })}
              >
                Reset
              </button>
              <button
                type='button'
                className='csp-foot-done'
                onClick={() => setFiltersOpen(false)}
              >
                Apply
              </button>
            </>
          ) : (
            <>
              <button
                type='button'
                className='csp-foot-close'
                onClick={props.onClose}
              >
                Close
              </button>
              <button
                type='button'
                className='csp-foot-done'
                onClick={props.onClose}
              >
                Done
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Wg4 row renderers — per-type. Each returns the inner content for one
// `.csp-row` (the shell wraps it in the row chrome + handles clicks).
//
// Row shape (per the wg4 mockup):
//   • simple (.csp-row-simple): name+subtitle on left, Select button on right
//   • full: level chip · name+subtitle · trait badges · Select button
//   • skill: prof letter chip · name+attribute · mod chip · Train/Increase
//
// All variants share the same outer `.csp-row` div the shell provides.
// ──────────────────────────────────────────────────────────────────────

/** Resolve a list of trait IDs to their display names via the cached
 *  content store. Returns lowercase, dot-separated list — e.g.
 *  "concentrate · polymorph". Empty array → empty string. */
function wg4FormatTraitSubtitle(
  traitIds: number[],
  traitCache: Map<number, string>,
  maxEntries = 3
): string {
  const names = traitIds
    .map((id) => traitCache.get(id))
    .filter((n): n is string => !!n)
    .map((n) => n.toLowerCase());
  if (names.length === 0) return '';
  return names.slice(0, maxEntries).join(' · ');
}

/** Format an action-cost enum into the glyph used in the row name.
 *  We render text glyphs rather than the SVG ActionSymbol so the wg4
 *  Newsreader/Geist baseline stays clean. Returns null for non-action
 *  casts ("10 minutes" on a spell, etc.). */
function wg4ActionGlyph(cost?: string | null): string | null {
  if (typeof cost !== 'string') return null;
  switch (cost) {
    case 'ONE-ACTION': return '◆';
    case 'TWO-ACTIONS': return '◆◆';
    case 'THREE-ACTIONS': return '◆◆◆';
    case 'FREE-ACTION': return '◇';
    case 'REACTION': return '⤴';
    case 'ONE-TO-TWO-ACTIONS': return '◆–◆◆';
    case 'ONE-TO-THREE-ACTIONS': return '◆–◆◆◆';
    case 'TWO-TO-THREE-ACTIONS': return '◆◆–◆◆◆';
    default: return null;
  }
}

/** Trait → wg4 badge component. The first trait in a feat list gets
 *  the dot accent (matches the mockup's "Anadi" badge); the rest are
 *  plain Caps badges. */
function Wg4TraitBadges({
  traitIds,
  traitCache,
  max = 3,
}: {
  traitIds: number[];
  traitCache: Map<number, string>;
  max?: number;
}) {
  const names = traitIds
    .map((id) => traitCache.get(id))
    .filter((n): n is string => !!n);
  if (names.length === 0) return null;
  const visible = names.slice(0, max);
  return (
    <>
      {visible.map((name, i) => (
        <span key={`${name}-${i}`} className={`csp-badge${i === 0 ? ' dot' : ''}`}>
          {name}
        </span>
      ))}
    </>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Build a wg4 PickerRow for any non-spell option. Dispatches on
// type / abilityBlockType so the level chip, badges and Select label
// look right for ancestries vs feats vs items vs creatures vs ….
// ──────────────────────────────────────────────────────────────────────
function buildWg4Row(opts: {
  option: Record<string, any>;
  type: ContentType;
  abilityBlockType?: AbilityBlockType;
  skillAdjustment?: ExtendedProficiencyType;
  selectedId?: number;
  traitCache: Map<number, string>;
  openDrawer: (next: any) => void;
  onSelect: (option: Record<string, any>) => void;
}): PickerRow {
  const {
    option,
    type,
    abilityBlockType: ab,
    skillAdjustment,
    selectedId,
    traitCache,
    openDrawer,
    onSelect,
  } = opts;
  const key = option.id ?? option._select_uuid ?? option.name;
  const isSelected = option.id !== undefined && selectedId === option.id;

  const selectBtn = (
    <button
      type='button'
      className='csp-row-select'
      onClick={(e) => {
        e.stopPropagation();
        onSelect(option);
      }}
      disabled={isSelected}
    >
      {isSelected ? 'Selected' : 'Select'}
    </button>
  );

  const openOnRowClick = (drawerType: DrawerType, extraData?: Record<string, any>) => () =>
    openDrawer({
      type: drawerType,
      data: { zIndex: 1600, id: option.id, ...extraData },
      extra: { addToHistory: true },
    });

  // ── Feat / Class-feature / Action / Sense / Physical-feature / Mode
  if (type === 'ability-block') {
    if (ab === 'feat') {
      const traits = (option.traits ?? []) as number[];
      const traitSub = wg4FormatTraitSubtitle(traits, traitCache);
      const actionGlyph = wg4ActionGlyph(option.actions);
      return {
        key,
        option,
        variantClass: '',
        onClick: openOnRowClick('feat'),
        content: (
          <>
            <div className='csp-row-lvl'>{option.level ?? 1}</div>
            <div className='csp-row-name'>
              {option.name}
              {actionGlyph && <span className='csp-row-glyph'>{actionGlyph}</span>}
              {traitSub && <span className='csp-row-sub'>{traitSub}</span>}
            </div>
            <div className='csp-row-badges'>
              <Wg4TraitBadges traitIds={traits} traitCache={traitCache} />
            </div>
            {selectBtn}
          </>
        ),
      };
    }
    if (ab === 'class-feature') {
      const traits = (option.traits ?? []) as number[];
      return {
        key,
        option,
        onClick: openOnRowClick('class-feature'),
        content: (
          <>
            <div className='csp-row-lvl'>{option.level ?? 1}</div>
            <div className='csp-row-name'>{option.name}</div>
            <div className='csp-row-badges'>
              <Wg4TraitBadges traitIds={traits} traitCache={traitCache} />
            </div>
            {selectBtn}
          </>
        ),
      };
    }
    if (ab === 'action') {
      const traits = (option.traits ?? []) as number[];
      const actionGlyph = wg4ActionGlyph(option.actions);
      return {
        key,
        option,
        variantClass: 'csp-row-simple',
        onClick: openOnRowClick('action'),
        content: (
          <>
            <div className='csp-row-name'>
              {option.name}
              {actionGlyph && <span className='csp-row-glyph'>{actionGlyph}</span>}
              {traits.length > 0 && (
                <span className='csp-row-sub'>
                  {wg4FormatTraitSubtitle(traits, traitCache)}
                </span>
              )}
            </div>
            {selectBtn}
          </>
        ),
      };
    }
    if (ab === 'heritage') {
      return {
        key,
        option,
        variantClass: 'csp-row-simple',
        onClick: openOnRowClick('heritage'),
        content: (
          <>
            <div className='csp-row-name'>{option.name}</div>
            {selectBtn}
          </>
        ),
      };
    }
    if (ab === 'sense' || ab === 'physical-feature' || ab === 'mode') {
      return {
        key,
        option,
        variantClass: 'csp-row-simple',
        onClick: openOnRowClick(ab as DrawerType),
        content: (
          <>
            <div className='csp-row-name'>{option.name}</div>
            {selectBtn}
          </>
        ),
      };
    }
    // Generic ability-block fallback (variable picks, attribute boosts, etc.)
    // — see GenericSelectionOption's "variable" branch. Skill increases get
    // the prof letter + mod chip; everything else gets a simple two-column
    // row.
    const variable = getVariable('CHARACTER', option.variable);
    if (variable?.type === 'prof' && skillAdjustment) {
      let currentProf: ProficiencyType | undefined | null = compileProficiencyType((variable as VariableProf).value);
      let nextProf: ProficiencyType | undefined | null =
        skillAdjustment === '1'
          ? nextProficiencyType(currentProf ?? 'U')
          : skillAdjustment === '-1'
            ? prevProficiencyType(currentProf ?? 'U')
            : (skillAdjustment as ProficiencyType);
      // @ts-ignore — same as legacy: option.variable is a string variable
      const finalTotal = getFinalProfValue('CHARACTER', option.variable, undefined, undefined, nextProf ?? currentProf);
      return {
        key,
        option,
        content: (
          <>
            <div className={`csp-row-lvl pf-chip pf-${currentProf ?? 'U'}`}>
              {currentProf ?? 'U'}
            </div>
            <div className='csp-row-name'>
              {option.name}
              <span className='csp-row-sub'>
                {(variable.value as any)?.attribute ?? ''}
              </span>
            </div>
            <div className='csp-row-badges'>
              <span className='csp-badge'>
                {typeof finalTotal === 'number' && finalTotal >= 0
                  ? `+${finalTotal}`
                  : finalTotal ?? ''}
              </span>
            </div>
            <button
              type='button'
              className='csp-row-select'
              onClick={(e) => {
                e.stopPropagation();
                onSelect(option);
              }}
              disabled={isSelected}
            >
              {currentProf === 'U' ? 'Train' : 'Increase'}
            </button>
          </>
        ),
      };
    }
    // Custom select (operation-generated options like attribute boost,
    // language pick). Two-column simple row.
    if (option._custom_select) {
      return {
        key,
        option,
        variantClass: 'csp-row-simple',
        onClick: () =>
          openDrawer({
            type: 'generic',
            data: { zIndex: 1600,
              ...option._custom_select,
              onSelect: () => onSelect(option),
            },
            extra: { addToHistory: true },
          }),
        content: (
          <>
            <div className='csp-row-name'>{option._custom_select.title ?? option.name}</div>
            {selectBtn}
          </>
        ),
      };
    }
    return {
      key,
      option,
      variantClass: 'csp-row-simple',
      content: (
        <>
          <div className='csp-row-name'>{option.name}</div>
          {selectBtn}
        </>
      ),
    };
  }

  if (type === 'ancestry') {
    const sub = (() => {
      const sz = extractAncestrySize(option);
      const rarity = option.rarity ?? null;
      const bits: string[] = [];
      if (sz) bits.push(String(sz).toLowerCase());
      if (rarity && rarity !== 'COMMON') bits.push(String(rarity).toLowerCase());
      return bits.join(' · ');
    })();
    return {
      key,
      option,
      variantClass: 'csp-row-simple',
      onClick: openOnRowClick('ancestry'),
      content: (
        <>
          <div className='csp-row-name'>
            {option.name}
            {sub && <span className='csp-row-sub'>{sub}</span>}
          </div>
          {selectBtn}
        </>
      ),
    };
  }

  if (type === 'background') {
    return {
      key,
      option,
      variantClass: 'csp-row-simple',
      onClick: openOnRowClick('background'),
      content: (
        <>
          <div className='csp-row-name'>{option.name}</div>
          {selectBtn}
        </>
      ),
    };
  }

  if (type === 'class') {
    return {
      key,
      option,
      variantClass: 'csp-row-simple',
      onClick: openOnRowClick('class'),
      content: (
        <>
          <div className='csp-row-name'>{option.name}</div>
          {selectBtn}
        </>
      ),
    };
  }

  if (type === 'archetype') {
    return {
      key,
      option,
      variantClass: 'csp-row-simple',
      onClick: openOnRowClick('archetype'),
      content: (
        <>
          <div className='csp-row-name'>{option.name}</div>
          {selectBtn}
        </>
      ),
    };
  }

  if (type === 'versatile-heritage') {
    return {
      key,
      option,
      variantClass: 'csp-row-simple',
      onClick: openOnRowClick('versatile-heritage'),
      content: (
        <>
          <div className='csp-row-name'>{option.name}</div>
          {selectBtn}
        </>
      ),
    };
  }

  if (type === 'class-archetype') {
    return {
      key,
      option,
      variantClass: 'csp-row-simple',
      onClick: () =>
        option.id === -999
          ? openDrawer({ type: 'class', data: { zIndex: 1600, id: option.class_id }, extra: { addToHistory: true } })
          : openDrawer({ type: 'class-archetype', data: { zIndex: 1600, id: option.id }, extra: { addToHistory: true } }),
      content: (
        <>
          <div className='csp-row-name'>{option.name}</div>
          {selectBtn}
        </>
      ),
    };
  }

  if (type === 'item') {
    const traits = (option.traits ?? []) as number[];
    return {
      key,
      option,
      onClick: openOnRowClick('item'),
      content: (
        <>
          <div className='csp-row-lvl'>{option.level ?? 0}</div>
          <div className='csp-row-name'>
            {option.name}
            {option.bulk !== undefined && option.bulk !== null && option.bulk !== '' && (
              <span className='csp-row-sub'>bulk {String(option.bulk).toLowerCase()}</span>
            )}
          </div>
          <div className='csp-row-badges'>
            <Wg4TraitBadges traitIds={traits} traitCache={traitCache} />
          </div>
          {selectBtn}
        </>
      ),
    };
  }

  if (type === 'creature') {
    return {
      key,
      option,
      onClick: () =>
        openDrawer({
          type: 'creature',
          data: { zIndex: 1600, id: option.id },
          extra: { addToHistory: true },
        }),
      content: (
        <>
          <div className='csp-row-lvl'>{getEntityLevel(option as Creature)}</div>
          <div className='csp-row-name'>{option.name}</div>
          <div className='csp-row-badges'>
            <Wg4TraitBadges
              traitIds={(option.traits ?? []) as number[]}
              traitCache={traitCache}
            />
          </div>
          {selectBtn}
        </>
      ),
    };
  }

  if (type === 'language') {
    return {
      key,
      option,
      variantClass: 'csp-row-simple',
      onClick: openOnRowClick('language'),
      content: (
        <>
          <div className='csp-row-name'>{option.name}</div>
          {selectBtn}
        </>
      ),
    };
  }

  if (type === 'trait') {
    return {
      key,
      option,
      variantClass: 'csp-row-simple',
      onClick: openOnRowClick('trait'),
      content: (
        <>
          <div className='csp-row-name'>{option.name}</div>
          {selectBtn}
        </>
      ),
    };
  }

  // Fallback — never hit in practice but keeps the renderer total.
  return {
    key,
    option,
    variantClass: 'csp-row-simple',
    content: (
      <>
        <div className='csp-row-name'>{option.name ?? `Option ${option.id}`}</div>
        {selectBtn}
      </>
    ),
  };
}

export default function SelectContentModal({
  context,
  id,
  innerProps,
}: ContextModalProps<{
  type: ContentType;
  onClick?: (option: Record<string, any>) => void;
  options?: {
    overrideOptions?: Record<string, any>[];
    abilityBlockType?: AbilityBlockType;
    skillAdjustment?: ExtendedProficiencyType;
    selectedId?: number;
    filterFn?: (option: Record<string, any>) => boolean;
    advancedPresetFilters?: Partial<FiltersParams>;
    showButton?: boolean;
    includeOptions?: boolean;
    zIndex?: number;
    description?: ReactNode;
  };
  // Plain title text — only the spell picker reads this (to render its
  // own .csp-title since the Mantine header chrome is hidden for spells).
  // Optional so older non-spell call paths that don't set it still type-check.
  _titleText?: string;
}>) {
  // Spell pickers render an entirely custom parchment shell (wg4
  // mockup). We early-return BEFORE the rest of the SelectContentModal
  // hooks fire — `innerProps.type` is invariant after mount, so the
  // Rules of Hooks order stays consistent across renders for any
  // given modal instance.
  if (innerProps.type === 'spell') {
    return (
      <SpellPickerShell
        titleText={innerProps._titleText ?? 'Select Spell'}
        onClose={() => context.closeModal(id)}
        onClick={
          innerProps.onClick
            ? (spell) => {
                innerProps.onClick!(spell as unknown as Record<string, any>);
              }
            : undefined
        }
        options={innerProps.options}
      />
    );
  }

  const theme = useMantineTheme();

  // Pairs with `getResizableModalContextProps('select-content', ...)`
  // in the openContextModal call: the static props seed the initial
  // size + apply the `resize: both` style; this hook attaches a
  // ResizeObserver that persists drag-resizes back to localStorage.
  useModalSizePersistence('select-content');

  const [searchQuery, setSearchQuery] = useState('');
  const [searchQueryDebounced] = useDebouncedValue(searchQuery, 200);

  // Category-aware filter state with tri-state chip support. See
  // SelectContentFilters.tsx — most fields are TriStateMap<K> where a
  // missing key means "no filter", 'include' means "must match one of
  // these", and 'exclude' means "must NOT be any of these".
  const [filterState, setFilterState] = useState<ContentFilterState>(() => ({
    ...DEFAULT_FILTER_STATE,
  }));
  // filtersOpen state lives inside Wg4PickerShell now — see line ~960.

  // Feat-type detection: peek at the first option's traits and decide
  // which filter blocks the panel should surface. Skill feats → all blocks
  // + skill block, general feats → all minus skill block, class/ancestry
  // feats → minimal (level + rarity + prereq). Non-feat searches get
  // undefined and the panel uses its content-type defaults.
  const featType: FeatType | undefined = useMemo(() => {
    if (innerProps.options?.abilityBlockType !== 'feat') return undefined;
    const opts = innerProps.options?.overrideOptions ?? [];
    // No options yet — show the broadest filter set so nothing is hidden.
    if (opts.length === 0) return 'other';

    const classTraitIds = (getAllClassTraitVariables('CHARACTER') ?? []).map((v) => v.value);
    const ancestryTraitIds = (getAllAncestryTraitVariables('CHARACTER') ?? []).map((v) => v.value);
    // Resolve the "Skill" and "General" trait ids by name from the cache.
    // Falls back to undefined if the trait cache hasn't been warmed yet,
    // in which case we still detect class/ancestry feats by trait id.
    const traits = getCachedContent<Trait>('trait');
    const skillTraitId = traits.find((t) => t.name === 'Skill')?.id;
    const generalTraitId = traits.find((t) => t.name === 'General')?.id;

    // Sample the first option (the list comes pre-filtered to one feat
    // kind in the existing class-feat / ancestry-feat code paths).
    const sample = opts[0];
    const sampleTraits = (sample.traits ?? []) as number[];

    if (skillTraitId !== undefined && sampleTraits.includes(skillTraitId)) return 'skill';
    if (classTraitIds.length > 0 && intersection(sampleTraits, classTraitIds).length > 0) return 'class';
    if (ancestryTraitIds.length > 0 && intersection(sampleTraits, ancestryTraitIds).length > 0) return 'ancestry';
    if (generalTraitId !== undefined && sampleTraits.includes(generalTraitId)) return 'general';
    return 'other';
  }, [innerProps.options?.overrideOptions, innerProps.options?.abilityBlockType]);

  // ─── tri-state filter helpers ─────────────────────────────────────────
  // Single-value check: does `value` pass this tri-state map?
  //   • empty map           → pass (no filter active)
  //   • map has 'exclude'   → fail if value is in the exclude set
  //   • map has 'include'   → pass only if value is in the include set
  const triStateMatches = <K,>(map: TriStateMap<K>, value: K | undefined): boolean => {
    if (map.size === 0) return true;
    if (value !== undefined && map.get(value) === 'exclude') return false;
    const hasInclude = [...map.values()].includes('include');
    if (hasInclude && (value === undefined || map.get(value) !== 'include')) return false;
    return true;
  };
  // Multi-value variant (e.g. spell.traditions is an array): include-mode
  // passes if ANY option value is an include match; exclude-mode fails if
  // ANY option value hits an exclude entry.
  const triStateMatchesAny = <K,>(map: TriStateMap<K>, values: K[]): boolean => {
    if (map.size === 0) return true;
    if (values.some((v) => map.get(v) === 'exclude')) return false;
    const hasInclude = [...map.values()].includes('include');
    if (hasInclude && !values.some((v) => map.get(v) === 'include')) return false;
    return true;
  };

  // Expand a single action cost into its constituent single-step costs.
  // ONE-TO-TWO-ACTIONS abilities are valid 1-action plays AND valid
  // 2-action plays, so they should match both chip filters individually.
  // Non-enum / free-text casts ("10 minutes" on a spell) return [].
  const expandActionCost = (cost: any): string[] => {
    if (typeof cost !== 'string') return [];
    switch (cost) {
      case 'ONE-ACTION':
      case 'TWO-ACTIONS':
      case 'THREE-ACTIONS':
      case 'FREE-ACTION':
      case 'REACTION':
        return [cost];
      case 'ONE-TO-TWO-ACTIONS':
        return ['ONE-ACTION', 'TWO-ACTIONS'];
      case 'ONE-TO-THREE-ACTIONS':
        return ['ONE-ACTION', 'TWO-ACTIONS', 'THREE-ACTIONS'];
      case 'TWO-TO-THREE-ACTIONS':
        return ['TWO-ACTIONS', 'THREE-ACTIONS'];
      default:
        return [];
    }
  };

  // Apply filterState to a single option.
  //
  // Free-text filters are case-insensitive substring matches against the
  // field on the option. Tri-state chip filters use triStateMatches /
  // triStateMatchesAny (multi-value).
  //
  // Field-name notes:
  //   - Spell action cost lives in `option.cast` (NOT `option.actions`)
  //   - Item action cost doesn't exist (items don't have action costs)
  //   - Spell type is derived from `meta_data.focus` / `meta_data.ritual`
  //     (the schema does NOT define a `meta_data.spell_type` field — the
  //     old code that read that always returned 'NORMAL', silently)
  const applyStateFilter = (option: Record<string, any>): boolean => {
    const ab = innerProps.options?.abilityBlockType;
    const t = innerProps.type;

    // ── Prerequisites (meets / not-met) ──────────────────────────────────
    if ((ab === 'feat' || ab === 'class-feature') && filterState.prereqs !== 'neutral') {
      const prereqs = option.prerequisites ?? [];
      if (prereqs.length === 0) {
        if (filterState.prereqs === 'must-not-meet') return false;
      } else {
        const r = meetsPrerequisites('CHARACTER', prereqs).result;
        const isMet = r === 'FULLY' || r === 'PARTIALLY' || r === 'UNKNOWN';
        if (filterState.prereqs === 'must-meet' && !isMet) return false;
        if (filterState.prereqs === 'must-not-meet' && isMet) return false;
      }
    }

    // ── Numeric ranges ───────────────────────────────────────────────────
    if (t === 'item' || t === 'creature' || ab === 'feat' || ab === 'class-feature') {
      const lvl = option.level ?? 0;
      if (lvl < filterState.levelMin || lvl > filterState.levelMax) return false;
    }
    if (t === 'spell') {
      const rnk = option.rank ?? 0;
      if (rnk < filterState.rankMin || rnk > filterState.rankMax) return false;
    }

    // ── Tri-state chip filters ──────────────────────────────────────────
    // Rarity defaults to 'COMMON' when null/absent — matching PF2e's
    // implicit-common convention. Without this default, including
    // "Common" in the filter would silently drop every option whose
    // rarity field is null (the majority of base items), which the user
    // experienced as "Common filter shows nothing".
    const rarity = (option.rarity ?? 'COMMON') as any;
    if (!triStateMatches(filterState.rarities, rarity)) return false;

    // Availability defaults to 'STANDARD' when null/absent (PF2e convention).
    const availability = (option.availability ?? 'STANDARD') as any;
    if (!triStateMatches(filterState.availabilities, availability)) return false;

    // Action cost: lives in `cast` on spells, `actions` on ability blocks.
    // Range costs (ONE-TO-TWO-ACTIONS, ONE-TO-THREE-ACTIONS, etc.) expand
    // to their constituent single-action costs so a 1-or-2-action ability
    // matches BOTH the "1 action" and "2 actions" chip filters. Spells
    // with free-text cast ("10 minutes") won't match any chip — that's
    // correct: those aren't single-action-cost spells.
    if (filterState.actions.size > 0) {
      const rawCost = t === 'spell' ? option.cast : (ab ? option.actions : undefined);
      const costs = expandActionCost(rawCost);
      if (!triStateMatchesAny(filterState.actions, costs)) return false;
    }

    // Skill (ability blocks). `meta_data.skill` can be a single string or
    // an array; normalise to an array of upper-case strings.
    if (filterState.skills.size > 0) {
      const raw = option.meta_data?.skill;
      const skills: string[] = Array.isArray(raw)
        ? raw.map((s) => String(s).toUpperCase())
        : raw
          ? [String(raw).toUpperCase()]
          : [];
      // Skill FEATS don't populate meta_data.skill — their skill lives in the
      // prerequisites ("trained in Acrobatics"). When there's no explicit
      // skill, derive it from the prerequisites (and trait list) so the Skill
      // filter actually matches skill feats instead of emptying the list.
      if (skills.length === 0) {
        const SKILL_NAMES = [
          'ACROBATICS', 'ARCANA', 'ATHLETICS', 'CRAFTING', 'DECEPTION', 'DIPLOMACY',
          'INTIMIDATION', 'LORE', 'MEDICINE', 'NATURE', 'OCCULTISM', 'PERFORMANCE',
          'RELIGION', 'SOCIETY', 'STEALTH', 'SURVIVAL', 'THIEVERY',
        ];
        const prereq = Array.isArray(option.prerequisites)
          ? option.prerequisites.join(' ')
          : String(option.prerequisites ?? '');
        const hay = prereq.toUpperCase();
        for (const sk of SKILL_NAMES) {
          if (new RegExp('\\b' + sk + '\\b').test(hay) && !skills.includes(sk)) skills.push(sk);
        }
      }
      // AND mode: every include-key must be present; OR mode: any one.
      const exclude = [...filterState.skills.entries()]
        .filter(([, v]) => v === 'exclude')
        .map(([k]) => k);
      const include = [...filterState.skills.entries()]
        .filter(([, v]) => v === 'include')
        .map(([k]) => k);
      if (exclude.some((k) => skills.includes(k))) return false;
      if (include.length > 0) {
        const matched = filterState.skillsMode === 'AND'
          ? include.every((k) => skills.includes(k))
          : include.some((k) => skills.includes(k));
        if (!matched) return false;
      }
    }

    // Tradition (spells). `traditions` is an array of names; normalise case.
    if (t === 'spell' && filterState.traditions.size > 0) {
      const tr = ((option.traditions ?? []) as string[]).map((x) => x.toUpperCase());
      if (!triStateMatchesAny(filterState.traditions, tr)) return false;
    }

    // Spell type — derive from meta_data flags rather than a non-existent
    // `spell_type` field. Focus and ritual are mutually-exclusive; absence
    // of both means a normal spell.
    if (t === 'spell' && filterState.spellTypes.size > 0) {
      const meta = option.meta_data ?? {};
      const isRitual = !!meta.ritual;
      const isFocus = !!meta.focus;
      const kind: 'NORMAL' | 'FOCUS' | 'RITUAL' = isRitual ? 'RITUAL' : isFocus ? 'FOCUS' : 'NORMAL';
      if (!triStateMatches(filterState.spellTypes, kind)) return false;
    }

    // Size — items have a direct size field; ancestries store size in
    // their operations JSON (no size column), so we route through
    // extractAncestrySize. Creatures encode size via traits, not a
    // field, and aren't checked here.
    if (filterState.sizes.size > 0) {
      if (t === 'item') {
        if (!triStateMatches(filterState.sizes, option.size as any)) return false;
      } else if (t === 'ancestry') {
        const sz = extractAncestrySize(option);
        if (!triStateMatches(filterState.sizes, sz as any)) return false;
      }
    }

    // Item group — the chip labels are 37 PF2e categories (Alchemical
    // Items, Held Items, Wands, …) that mostly map to TRAITS rather
    // than to the 7-value `item.group` enum. `passesItemGroupFilter`
    // dispatches each label to the right comparison.
    if (t === 'item' && filterState.itemGroups.size > 0) {
      if (!passesItemGroupFilter(option, filterState.itemGroups as Map<string, 'include' | 'exclude'>)) {
        return false;
      }
    }

    // Traits — every selected trait ID must appear in option.traits (AND
    // match). `traits` is an array of numeric IDs on most content types.
    if (filterState.traits.length > 0) {
      const optTraits = (option.traits ?? []) as number[];
      if (!filterState.traits.every((id) => optTraits.includes(id))) return false;
    }

    // ── Spell range / area / duration sliders ───────────────────────────
    // Each slider stores either null (inactive) or [min, max]. We parse
    // the spell's free-text field to a number; if it's unparseable
    // ("varies", "(see text)", etc.) we leave the spell visible rather
    // than silently filtering it out.
    if (t === 'spell') {
      if (filterState.rangeFt) {
        const n = parseDistanceFt(option.range);
        if (n !== null && (n < filterState.rangeFt[0] || n > filterState.rangeFt[1])) return false;
      }
      if (filterState.areaFt) {
        const n = parseAreaFt(option.area);
        if (n !== null && (n < filterState.areaFt[0] || n > filterState.areaFt[1])) return false;
      }
      if (filterState.durationSec) {
        const n = parseDurationSec(option.duration);
        if (n !== null && (n < filterState.durationSec[0] || n > filterState.durationSec[1])) return false;
      }
    }

    // ── Cast Time (spells only) ─────────────────────────────────────────
    // The Cast Time chip puts a value like 'one-or-two' or '1 minute'
    // into state.cast. Spells store cast as either the canonical 'to'-form
    // enum ('ONE-TO-TWO-ACTIONS') or a free-text duration, so a naïve
    // substring check misses the 'or'-form chips. matchesCastTime resolves
    // the chip to the right substring set.
    if (t === 'spell' && filterState.cast.trim()) {
      if (!matchesCastTime(option.cast, filterState.cast.trim())) return false;
    }

    // ── Free-text substring filters ─────────────────────────────────────
    // Each entry maps a filter-state key to the option's field name (if
    // different). Empty filter strings short-circuit; all matching is
    // case-insensitive substring. The `cast` key is intentionally
    // omitted — for spells we handled it above; for non-spells `cast`
    // doesn't apply.
    const textChecks: Array<[keyof ContentFilterState, string]> = [
      ['description', 'description'],
      ['defense', 'defense'],
      ['targets', 'targets'],
      ['frequency', 'frequency'],
      ['trigger', 'trigger'],
      ['requirements', 'requirements'],
      ['usage', 'usage'],
      ['hands', 'hands'],
      ['bulk', 'bulk'],
      ['craftRequirements', 'craft_requirements'],
    ];
    for (const [filterKey, fieldName] of textChecks) {
      const needle = String(filterState[filterKey] ?? '').trim().toLowerCase();
      if (!needle) continue;
      const haystack = String(option[fieldName] ?? '').toLowerCase();
      if (!haystack.includes(needle)) return false;
    }

    // Prerequisites text — searches across the array of prereq strings.
    if (filterState.prerequisitesText.trim()) {
      const needle = filterState.prerequisitesText.trim().toLowerCase();
      const prereqs = (option.prerequisites ?? []) as string[];
      if (!prereqs.some((p) => String(p).toLowerCase().includes(needle))) return false;
    }

    return true;
  };

  const getMergedFilterFn = () => {
    const newFilterFn = (option: Record<string, any>) => {
      if (innerProps.options?.filterFn && !innerProps.options.filterFn(option)) return false;
      if (!applyStateFilter(option)) return false;
      return true;
    };
    return newFilterFn;
  };

  // Same as getMergedFilterFn but additionally AND-ed with an extra
  // per-tab predicate. Used by tabs that bolt on their own static
  // criteria — archetype-feat (only feats sharing an archetype trait
  // with the character), add-dedication (only DEDICATION-trait feats),
  // ancestry-heritage / versatile-heritage (split by whether the
  // heritage is on the character's versatile list), universal-ancestry-feat
  // (name whitelist) — without dropping the toolbar filter state. Before
  // this existed each of those tabs passed a bare custom filter and
  // the user's chip / slider / "must-meet" choices were silently
  // ignored. See history.
  const mergeWithStateFilter = (custom: (option: Record<string, any>) => boolean) => {
    const merged = getMergedFilterFn();
    return (option: Record<string, any>) => {
      if (!custom(option)) return false;
      if (!merged(option)) return false;
      return true;
    };
  };

  // filterCount lives inside Wg4PickerShell now (drives the "Filters (N)" pill).

  // typeName retained for the legacy advanced-search hook only; the wg4
  // shell formats labels via toLabel directly. Suppress unused-locals
  // warnings with a `void` reference below.
  const typeName = toLabel(innerProps.options?.abilityBlockType || innerProps.type);
  void typeName;

  // Detect "custom-select mode": when ALL options are operation-generated
  // custom picks (attribute boost, skill proficiency choices, language
  // picks etc.). These aren't filterable content — they're handcrafted
  // option lists — so we hide the Filters button entirely.
  const isCustomSelectMode = useMemo(() => {
    const opts = innerProps.options?.overrideOptions ?? [];
    if (opts.length === 0) return false;
    return opts.every((o) => o?._custom_select);
  }, [innerProps.options?.overrideOptions]);

  // Clamp the Level / Rank sliders to the actual range the user could
  // pick. E.g. a level-3 feat selection only shows level 0..3 on the
  // slider — there's no point letting them drag to 10. Fallbacks to the
  // type's natural max when no options have been passed (the picker is
  // browsing the full content store).
  const optionMaxLevel = useMemo(() => {
    const opts = innerProps.options?.overrideOptions;
    if (!opts || opts.length === 0) return undefined;
    let m = 0;
    for (const o of opts) {
      const lv = typeof o?.level === 'number' ? o.level : 0;
      if (lv > m) m = lv;
    }
    return m;
  }, [innerProps.options?.overrideOptions]);

  const optionMaxRank = useMemo(() => {
    const opts = innerProps.options?.overrideOptions;
    if (!opts || opts.length === 0) return undefined;
    let m = 0;
    for (const o of opts) {
      const r = typeof o?.rank === 'number' ? o.rank : 0;
      if (r > m) m = r;
    }
    return m;
  }, [innerProps.options?.overrideOptions]);

  // Range / Area / Duration sliders for spell pickers need to know which
  // values actually exist in the data. Use the curated overrideOptions
  // if provided (e.g. "spells you know" lists), otherwise fall back to
  // the warmed content cache for the full spell store. Re-runs only on
  // option changes — the cache itself is stable.
  const spellFilterDomain = useMemo(() => {
    if (innerProps.type !== 'spell') return undefined;
    const opts = innerProps.options?.overrideOptions;
    const spells = (opts && opts.length > 0)
      ? (opts as Array<Partial<Spell>>)
      : getCachedContent<Spell>('spell');
    return buildSpellFilterDomain(spells);
  }, [innerProps.options?.overrideOptions, innerProps.type]);

  // Traits filter autocomplete — restrict to traits that actually appear
  // on the current option set. For a level-1 elf ancestry feat picker
  // this gives you only the elf-relevant traits; for a feat picker it
  // excludes item / spell traits entirely. When the picker is browsing
  // the full store (no overrideOptions), use the cached content for the
  // requested type — ability-block options need the ability-block cache,
  // spells need the spell cache, etc.
  const allowedTraitIds = useMemo(() => {
    const ab = innerProps.options?.abilityBlockType;
    const opts = innerProps.options?.overrideOptions;
    let pool: Array<{ traits?: number[] | null }> = [];
    if (opts && opts.length > 0) {
      pool = opts as Array<{ traits?: number[] | null }>;
    } else {
      // Walk the cache for this content type. Ability-block pickers
      // narrow further to the matching ab-type so feat traits don't get
      // polluted by action / heritage traits.
      const all = getCachedContent<{ type?: string; traits?: number[] | null }>(innerProps.type) ?? [];
      pool = ab ? all.filter((o) => o.type === ab) : all;
    }
    const set = new Set<number>();
    for (const o of pool) {
      const ts = o?.traits ?? [];
      for (const t of ts) set.add(t);
    }
    return [...set];
  }, [innerProps.options?.overrideOptions, innerProps.options?.abilityBlockType, innerProps.type]);

  // (Legacy `getSelectionContents` helper was removed when the
  // SelectContentModal body migrated to the wg4 parchment shell —
  // the Wg4PickerShell now owns the search row, filters button,
  // filter panel toggle and the inner option list rendering.)

  /// Handle Class Feats ///

  const [classFeatTab, setClassFeatTab] = useState<string | null>('class-feat');
  const isClassFeat = useMemo(() => {
    if (innerProps.options?.abilityBlockType !== 'feat') return false;

    const classTraitIds = getAllClassTraitVariables('CHARACTER').map((v) => v.value) ?? [];
    const options = innerProps.options?.overrideOptions ?? [];
    if (options.length === 0) return false;
    if (classTraitIds.length === 0) return false;

    // Check if all of the selection options contain at least one of the class traits
    for (const option of options) {
      if (intersection(classTraitIds, option.traits ?? []).length === 0) {
        return false;
      }
    }

    return true;
  }, [innerProps.options?.abilityBlockType, innerProps.options?.overrideOptions]);
  const classFeatSourceLevel =
    innerProps.options?.overrideOptions && innerProps.options?.overrideOptions.length > 0
      ? innerProps.options?.overrideOptions?.[0]?._source_level
      : 0;

  const { data: selectedClassFeat } = useQuery({
    queryKey: [`select-content-selected-class-feat`, { selectedId: innerProps.options?.selectedId }],
    queryFn: async ({ queryKey }) => {
      // @ts-ignore

      const [_key, { selectedId }] = queryKey;
      return await fetchContentById<AbilityBlock>('ability-block', selectedId ?? -1);
    },
    enabled: !!innerProps.options?.selectedId && isClassFeat,
  });

  useEffect(() => {
    if (!selectedClassFeat) return;

    if (hasTraitType('DEDICATION', selectedClassFeat.traits ?? undefined)) {
      setClassFeatTab('add-dedication');
    } else if (
      intersection(getAllArchetypeTraitVariables('CHARACTER').map((v) => v.value) ?? [], selectedClassFeat.traits ?? [])
        .length > 0
    ) {
      setClassFeatTab('archetype-feat');
    } else {
      setClassFeatTab('class-feat');
    }
  }, [selectedClassFeat]);

  /// ------------------ ///

  /// Handle Versatile Heritages ///

  const [versHeritageTab, setVersHeritageTab] = useState<string | null>('ancestry-heritage');
  const isHeritage = useMemo(() => {
    // Do all this because sometimes we can have a heritage select that isn't abilityBlockType === 'heritage'
    if (innerProps.options?.abilityBlockType === 'feat') return false;

    const ancestryTraitIds = getAllAncestryTraitVariables('CHARACTER').map((v) => v.value) ?? [];
    const options = innerProps.options?.overrideOptions ?? [];
    if (options.length === 0) return false;
    if (ancestryTraitIds.length === 0) return false;

    // Check if all of the selection options contain at least one of the ancestry traits
    for (const option of options) {
      if (intersection(ancestryTraitIds, option.traits ?? []).length === 0) {
        return false;
      }
    }

    return true;
  }, [innerProps.options?.overrideOptions, innerProps.options?.abilityBlockType]);

  const { data: versHeritageData } = useQuery({
    queryKey: [`select-content-vers-heritage-data`, { selectedId: innerProps.options?.selectedId }],
    queryFn: async ({ queryKey }) => {
      // @ts-ignore

      const [_key, { selectedId }] = queryKey;
      const heritage = await fetchContentById<AbilityBlock>('ability-block', selectedId ?? -1);
      const versHeritages = await fetchContentAll<VersatileHeritage>('versatile-heritage', getDefaultSources('PAGE'));
      return {
        heritage,
        versHeritages,
      };
    },
    enabled: isHeritage,
  });

  useEffect(() => {
    if (!versHeritageData) return;
    const verHeritage = versHeritageData.versHeritages.find((v) => v.heritage_id === versHeritageData.heritage?.id);
    if (verHeritage) {
      setVersHeritageTab('versatile-heritage');
    } else {
      setVersHeritageTab('ancestry-heritage');
    }
  }, [versHeritageData]);

  /// ------------------ ///

  /// Handle Ancestry Feats — add a "Universal Ancestry Feats" tab alongside
  /// the existing ancestry-specific list. Universal ones are tagged with the
  /// "Ancestry" meta-trait or the "General" trait and are available to any
  /// ancestry. We look those trait ids up by name at runtime so the filter
  /// stays correct across content sources that re-define them.

  const [ancestryFeatTab, setAncestryFeatTab] = useState<string | null>('ancestry-feat');
  const isAncestryFeat = useMemo(() => {
    if (innerProps.options?.abilityBlockType !== 'feat') return false;
    const ancestryTraitIds = getAllAncestryTraitVariables('CHARACTER').map((v) => v.value) ?? [];
    const classTraitIds = getAllClassTraitVariables('CHARACTER').map((v) => v.value) ?? [];
    const options = innerProps.options?.overrideOptions ?? [];
    if (options.length === 0) return false;
    if (ancestryTraitIds.length === 0) return false;
    // Treat as ancestry-feat selection if at least one option carries an
    // ancestry trait AND no option carries a class trait (which would mean
    // class-feat selection — handled by its own tabs above).
    let hasAncestry = false;
    for (const option of options) {
      if (intersection(ancestryTraitIds, option.traits ?? []).length > 0) hasAncestry = true;
      if (intersection(classTraitIds, option.traits ?? []).length > 0) return false;
    }
    return hasAncestry;
  }, [innerProps.options?.abilityBlockType, innerProps.options?.overrideOptions]);

  const ancestryFeatSourceLevel =
    innerProps.options?.overrideOptions && innerProps.options?.overrideOptions.length > 0
      ? (innerProps.options?.overrideOptions?.[0]?._source_level ?? 1)
      : 1;

  // WG's data has no single trait for "feats any ancestry can take" — what
  // AoN calls Universal Ancestry Feats. The same feats are tagged variably
  // as "General", "Human", or specific ancestry-name traits across content
  // sources, so we can't filter by trait alone. Use a name whitelist of
  // canonical PF2e feats and match against the cached feat set; whichever
  // ones the enabled sources carry will appear. Extend this list as more
  // sources get loaded into the DB.
  // AoN's "Universal Ancestry" trait list. WG's data doesn't carry that trait
  // (only General/Human/specific ancestry traits), so we match by feat name.
  // The names below come from AoN's Traits=Universal+Ancestry filter — every
  // one of them is present in the data dump's feat table (verified by name).
  const UNIVERSAL_ANCESTRY_FEAT_NAMES = useMemo(
    () =>
      new Set(
        [
          // Level 1
          'Animal Soul Siblings',
          "Let's Try That Again",
          'Like a Roach',
          'Weight of Experience',
          'Wisdom From Another Life',
          // Level 5
          'Empathy Incarnate',
          'Fey Influence',
          "I've Had Many Jobs",
          'Reincarnated Ridiculer',
          'Sleep of the Reborn',
          // Level 9
          'Drain Emotion',
          'Fey Ascension',
          'Lingering Echoes',
          'Plant Soul Siblings',
          'Rapid Retraining',
          'You Seem Somewhat Familiar',
          // Level 13
          'Cannibalize Magic',
          'Clinging to Life',
          'Eldritch Calm',
          'Glamour',
          'I Sense Malevolence',
          'Linguistic Revival',
          'Pain is Temporary',
          'Stone Soul Siblings',
          'Unbreakable Resolve',
          // Level 17
          'Boneyard Acquaintance',
          'Fey Transcendence',
          'Indomitable Spirit',
          'Release the Light',
          'See You in Hell',
          "This is What It's Like to Die",
          'This Time, Bring the Body',
        ].map((s) => s.toLowerCase())
      ),
    []
  );

  /// ------------------ ///

  // ── Wg4 shell wiring ───────────────────────────────────────────────
  // Decide what tab strip (if any) to render, and which data
  // pipeline + per-tab filter applies to the active tab. The legacy
  // SelectionOptions component handled this internally via three
  // parallel <Tabs.Panel>s; we now compute it up-front and feed the
  // result into a single Wg4PickerShell so the parchment chrome
  // stays consistent.
  type TabSpec = {
    key: string;
    label: string;
    // Per-tab data source — defaults to (innerProps.type, abilityBlockType)
    // but archetype / dedication / heritage / universal-ancestry tabs
    // need a different fetch.
    fetchType: ContentType;
    fetchAbilityBlockType?: AbilityBlockType;
    // Whether this tab uses overrideOptions (for class-feat / heritage /
    // ancestry-feat default tabs) or fetches all-of-type.
    useOverrideOptions: boolean;
    // Per-tab predicate. AND-ed with the global filter state.
    tabPredicate?: (option: Record<string, any>) => boolean;
    // Per-tab onClick adapter — archetype / dedication / universal /
    // versatile tabs synthesize `_select_uuid` + `_content_type` so the
    // selection ops engine downstream knows which content set the
    // selection came from.
    adaptOnClick?: (option: Record<string, any>) => Record<string, any>;
  };

  const tabSpecs: TabSpec[] = (() => {
    if (isClassFeat) {
      return [
        {
          key: 'class-feat',
          label: 'Class Feats',
          fetchType: innerProps.type,
          fetchAbilityBlockType: innerProps.options?.abilityBlockType,
          useOverrideOptions: true,
        },
        {
          key: 'archetype-feat',
          label: 'Archetype Feats',
          fetchType: 'ability-block',
          fetchAbilityBlockType: 'feat',
          useOverrideOptions: false,
          tabPredicate: (option) =>
            intersection(
              getAllArchetypeTraitVariables('CHARACTER').map((v) => v.value) ?? [],
              option.traits ?? []
            ).length > 0 && option.level <= classFeatSourceLevel,
          adaptOnClick: (option) => ({
            ...option,
            _select_uuid: `${option.id}`,
            _content_type: 'ability-block',
          }),
        },
        {
          key: 'add-dedication',
          label: 'Add Dedication',
          fetchType: 'ability-block',
          fetchAbilityBlockType: 'feat',
          useOverrideOptions: false,
          tabPredicate: (option) =>
            hasTraitType('DEDICATION', option.traits) && option.level <= classFeatSourceLevel,
          adaptOnClick: (option) => ({
            ...option,
            _select_uuid: `${option.id}`,
            _content_type: 'ability-block',
          }),
        },
      ];
    }
    if (isHeritage) {
      return [
        {
          key: 'ancestry-heritage',
          label: 'Ancestry Heritages',
          fetchType: innerProps.type,
          fetchAbilityBlockType: innerProps.options?.abilityBlockType,
          useOverrideOptions: true,
          tabPredicate: (option) =>
            !versHeritageData?.versHeritages.find((v) => v.heritage_id === option.id),
        },
        {
          key: 'versatile-heritage',
          label: 'Versatile Heritages',
          fetchType: 'ability-block',
          fetchAbilityBlockType: 'heritage',
          useOverrideOptions: false,
          tabPredicate: (option) =>
            !!versHeritageData?.versHeritages.find((v) => v.heritage_id === option.id),
          adaptOnClick: (option) => ({
            ...option,
            _select_uuid: `${option.id}`,
            _content_type: 'ability-block',
          }),
        },
      ];
    }
    if (isAncestryFeat) {
      return [
        {
          key: 'ancestry-feat',
          label: 'Ancestry Feats',
          fetchType: innerProps.type,
          fetchAbilityBlockType: innerProps.options?.abilityBlockType,
          useOverrideOptions: true,
        },
        {
          key: 'universal-ancestry-feat',
          label: 'Universal Ancestry',
          fetchType: 'ability-block',
          fetchAbilityBlockType: 'feat',
          useOverrideOptions: false,
          tabPredicate: (option) => {
            if (!UNIVERSAL_ANCESTRY_FEAT_NAMES.has(((option.name || '') as string).toLowerCase())) return false;
            const lvl = option.level;
            if (lvl !== undefined && lvl !== null && lvl > ancestryFeatSourceLevel) return false;
            return true;
          },
          adaptOnClick: (option) => ({
            ...option,
            _select_uuid: `${option.id}`,
            _content_type: 'ability-block',
          }),
        },
      ];
    }
    return [
      {
        key: 'default',
        label: '',
        fetchType: innerProps.type,
        fetchAbilityBlockType: innerProps.options?.abilityBlockType,
        useOverrideOptions: true,
      },
    ];
  })();

  const activeTabKey = isClassFeat
    ? classFeatTab ?? tabSpecs[0].key
    : isHeritage
      ? versHeritageTab ?? tabSpecs[0].key
      : isAncestryFeat
        ? ancestryFeatTab ?? tabSpecs[0].key
        : tabSpecs[0].key;
  const setActiveTabKey = (next: string) => {
    if (isClassFeat) setClassFeatTab(next);
    else if (isHeritage) setVersHeritageTab(next);
    else if (isAncestryFeat) setAncestryFeatTab(next);
  };
  const activeTabSpec = tabSpecs.find((t) => t.key === activeTabKey) ?? tabSpecs[0];

  // Fetch data for the active tab. The query key includes the tab key
  // so switching tabs hits the correct cache slot.
  const character = useAtomValue(characterState);
  const sortByPrereqs =
    innerProps.options?.abilityBlockType === 'feat' &&
    (character?.options?.auto_detect_prerequisites ?? false);

  const { data: rawOptions, isFetching: isLoadingOptions } = useQuery({
    queryKey: [
      `select-content-options-${activeTabSpec.fetchType}`,
      { ab: activeTabSpec.fetchAbilityBlockType, tab: activeTabSpec.key },
    ],
    queryFn: async () => {
      return (
        (await fetchContentAll(
          activeTabSpec.fetchType,
          getDefaultSources('PAGE')
        )) ?? null
      );
    },
    refetchOnMount: true,
  });

  // Trait cache for row badges/subtitles. Populated by the global
  // content store; if cold, badges fall back to empty.
  const traitCache = useMemo(() => {
    const cache = getCachedContent<Trait>('trait') ?? [];
    const map = new Map<number, string>();
    for (const t of cache) map.set(t.id, t.name);
    return map;
  }, [rawOptions]);

  // Compose the option pool. When the tab uses overrideOptions and
  // they're available, prefer them; otherwise fall back to the
  // fetched cache. Mirrors SelectionOptions's logic.
  const optionPool = useMemo(() => {
    let pool: Record<string, any>[];
    if (activeTabSpec.useOverrideOptions && innerProps.options?.overrideOptions) {
      pool = innerProps.options.overrideOptions;
    } else {
      pool = rawOptions ? [...rawOptions.values()] : [];
    }
    pool = pool.filter((d) => d);

    // Ability block type narrow (skip when the tab spec already
    // pre-filters; otherwise belt-and-braces).
    if (activeTabSpec.fetchAbilityBlockType) {
      pool = pool.filter((o) => o.type === activeTabSpec.fetchAbilityBlockType);
    } else if (
      activeTabSpec.fetchType === 'ability-block' &&
      (!activeTabSpec.useOverrideOptions ||
        !innerProps.options?.overrideOptions ||
        innerProps.options.overrideOptions.length === 0)
    ) {
      pool = [];
    }

    // Already-selected feats / languages — mirrors SelectionOptions.
    if (innerProps.options?.abilityBlockType === 'feat') {
      const featIds = getVariable<VariableListStr>('CHARACTER', 'FEAT_IDS')?.value.map((v) => parseInt(v)) ?? [];
      pool = pool.filter((option) => !featIds.includes(option.id) || option.meta_data?.can_select_multiple_times);
    }
    if (
      innerProps.options?.overrideOptions &&
      innerProps.options.overrideOptions.length > 0 &&
      innerProps.options.overrideOptions[0]._content_type === 'language'
    ) {
      const languageIds = getVariable<VariableListStr>('CHARACTER', 'LANGUAGE_IDS')?.value.map((v) => parseInt(v)) ?? [];
      pool = pool.filter((option) => !languageIds.includes(option.id));
    }
    return pool;
  }, [
    rawOptions,
    innerProps.options?.overrideOptions,
    innerProps.options?.abilityBlockType,
    activeTabSpec.fetchAbilityBlockType,
    activeTabSpec.fetchType,
    activeTabSpec.useOverrideOptions,
  ]);

  // JsSearch index for the current pool. Re-builds whenever the pool
  // changes (rare — usually only on tab switch).
  const search = useRef(new JsSearch.Search('id'));
  useEffect(() => {
    if (optionPool.length === 0) return;
    const s = new JsSearch.Search('id');
    s.addIndex('name');
    s.addDocuments(optionPool);
    search.current = s;
  }, [optionPool]);

  // ── Pagination ────────────────────────────────────────────────────
  const NUM_PER_PAGE = 20;
  const [activePage, setPage] = useState(1);
  useEffect(() => {
    setPage(1);
  }, [activeTabKey, searchQueryDebounced, filterState]);

  // Compose final filtered + sorted list.
  const filteredAndSorted = useMemo(() => {
    let base = searchQueryDebounced
      ? (search.current.search(searchQueryDebounced) as Record<string, any>[])
      : optionPool;

    // Apply consumer filterFn + state filter + tab predicate.
    base = base.filter((o) => {
      if (innerProps.options?.filterFn && !innerProps.options.filterFn(o)) return false;
      if (!applyStateFilter(o)) return false;
      if (activeTabSpec.tabPredicate && !activeTabSpec.tabPredicate(o)) return false;
      return true;
    });

    // Prereq sorting (feats only when auto-detect is on).
    const prereqRank = new Map<number, number>();
    if (sortByPrereqs) {
      for (const opt of base) {
        if (!opt.prerequisites || opt.prerequisites.length === 0) {
          prereqRank.set(opt.id, 0);
          continue;
        }
        const r = meetsPrerequisites('CHARACTER', opt.prerequisites).result;
        prereqRank.set(opt.id, r === 'FULLY' ? 0 : r === 'PARTIALLY' ? 1 : r === 'NOT' ? 3 : 2);
      }
    }

    return [...base].sort((a, b) => {
      if (a.level !== undefined && b.level !== undefined && a.level !== b.level) {
        return innerProps.options?.overrideOptions
          ? b.level - a.level
          : a.level - b.level;
      }
      if (a.rank !== undefined && b.rank !== undefined && a.rank !== b.rank) {
        return innerProps.options?.overrideOptions
          ? b.rank - a.rank
          : a.rank - b.rank;
      }
      if (sortByPrereqs) {
        const diff = (prereqRank.get(a.id) ?? 2) - (prereqRank.get(b.id) ?? 2);
        if (diff !== 0) return diff;
      }
      return (a.name ?? '').localeCompare(b.name ?? '');
    });
  }, [
    optionPool,
    searchQueryDebounced,
    filterState,
    innerProps.options?.filterFn,
    innerProps.options?.overrideOptions,
    activeTabSpec.tabPredicate,
    sortByPrereqs,
  ]);

  const totalCount = filteredAndSorted.length;
  const totalPages = Math.max(1, Math.ceil(totalCount / NUM_PER_PAGE));
  const pageSlice = filteredAndSorted.slice(
    (activePage - 1) * NUM_PER_PAGE,
    activePage * NUM_PER_PAGE
  );
  const pageFrom = totalCount === 0 ? 0 : (activePage - 1) * NUM_PER_PAGE + 1;
  const pageTo = Math.min(activePage * NUM_PER_PAGE, totalCount);

  // Drawer + onPick adapter for the active tab.
  const [, openDrawer] = useAtom(drawerState);
  const onPick = (option: Record<string, any>) => {
    if (!innerProps.onClick) return;
    const adapted = activeTabSpec.adaptOnClick ? activeTabSpec.adaptOnClick(option) : option;
    innerProps.onClick(adapted);
    context.closeModal(id);
  };

  const wg4Rows: PickerRow[] = pageSlice.map((option) =>
    buildWg4Row({
      option,
      type: activeTabSpec.fetchType,
      abilityBlockType: activeTabSpec.fetchAbilityBlockType,
      skillAdjustment: innerProps.options?.skillAdjustment,
      selectedId: innerProps.options?.selectedId,
      traitCache,
      openDrawer,
      onSelect: onPick,
    })
  );

  // Pretty noun for the count strip + empty state.
  const countNoun = pluralize(
    toLabel(innerProps.options?.abilityBlockType ?? innerProps.type).toLowerCase()
  );
  // Avoid the noisy theme reference in the no-deps tab-only case.
  void theme;

  return (
    <Wg4PickerShell
      titleText={innerProps._titleText ?? `✦ Select ${toLabel(innerProps.options?.abilityBlockType ?? innerProps.type)}`}
      onClose={() => context.closeModal(id)}
      type={activeTabSpec.fetchType}
      abilityBlockType={activeTabSpec.fetchAbilityBlockType}
      featType={featType}
      maxLevel={optionMaxLevel}
      maxRank={optionMaxRank}
      spellDomain={spellFilterDomain}
      allowedTraitIds={allowedTraitIds}
      filterState={filterState}
      setFilterState={setFilterState}
      searchPlaceholder={`Search ${countNoun}…`}
      searchQuery={searchQuery}
      setSearchQuery={setSearchQuery}
      hideFilters={isCustomSelectMode}
      tabs={tabSpecs.length > 1 ? tabSpecs.map((t) => ({ key: t.key, label: t.label, count: undefined })) : undefined}
      activeTab={activeTabKey}
      setActiveTab={setActiveTabKey}
      rows={wg4Rows}
      totalCount={totalCount}
      pageFrom={pageFrom}
      pageTo={pageTo}
      totalPages={totalPages}
      activePage={activePage}
      setPage={setPage}
      isLoading={isLoadingOptions}
      countNoun={countNoun}
      description={innerProps.options?.description}
    />
  );
}

function SelectionOptions(props: {
  searchQuery: string;
  type: ContentType;
  skillAdjustment?: ExtendedProficiencyType;
  abilityBlockType?: AbilityBlockType;
  sourceId?: number | 'all';
  onClick?: (option: Record<string, any>) => void;
  selectedId?: number;
  overrideOptions?: Record<string, any>[];
  filterFn?: (option: Record<string, any>) => boolean;
  advancedPresetFilters?: Partial<FiltersParams>;
  includeOptions?: boolean;
  showButton?: boolean;
  limitSelectedOptions: boolean;
}) {
  // Read character to honor `auto_detect_prerequisites`. When the user has
  // enabled prereq detection on a feat selector, we sort feats they qualify
  // for ahead of feats they don't.
  const character = useAtomValue(characterState);
  const sortByPrereqs = props.abilityBlockType === 'feat' && (character?.options?.auto_detect_prerequisites ?? false);

  const { data, isFetching } = useQuery({
    queryKey: [`select-content-options-${props.type}`, { sourceId: props.sourceId }],
    queryFn: async ({ queryKey }) => {
      // @ts-ignore
      const [_key, { sourceId }] = queryKey;
      return (
        (await fetchContentAll(props.type, sourceId === 'all' || !sourceId ? getDefaultSources('PAGE') : [sourceId])) ??
        null
      );
    },
    refetchOnMount: true,
    //enabled: !props.overrideOptions, Run even for override options to update JsSearch
  });
  let options = useMemo(() => (data ? [...data.values()] : []), [data]);
  if (props.overrideOptions) options = props.overrideOptions;
  options = options.filter((d) => d).filter(props.filterFn ? props.filterFn : () => true);

  // Filter options based on source
  if (props.sourceId !== undefined && props.sourceId !== 'all') {
    options = options.filter((option) => option.content_source_id === props.sourceId);
  }

  // Filter by ability block type
  if (props.abilityBlockType) {
    options = options.filter((option) => option.type === props.abilityBlockType);
  } else {
    // An ability block type is required for ability blocks
    if (props.type === 'ability-block' && (!props.overrideOptions || props.overrideOptions.length === 0)) {
      options = [];
    }
  }

  // Filter out already selected feats
  if (props.limitSelectedOptions && props.abilityBlockType === 'feat') {
    const featIds = getVariable<VariableListStr>('CHARACTER', 'FEAT_IDS')?.value.map((v) => parseInt(v)) ?? [];
    options = options.filter((option) => !featIds.includes(option.id) || option.meta_data?.can_select_multiple_times);
  }

  // Filter out already selected languages
  if (
    props.limitSelectedOptions &&
    props.overrideOptions &&
    props.overrideOptions.length > 0 &&
    props.overrideOptions[0]._content_type === 'language'
  ) {
    const languageIds = getVariable<VariableListStr>('CHARACTER', 'LANGUAGE_IDS')?.value.map((v) => parseInt(v)) ?? [];
    options = options.filter((option) => !languageIds.includes(option.id));
  }

  // Filter options based on search query
  const search = useRef(new JsSearch.Search('id'));
  useEffect(() => {
    if (!options) return;
    search.current.addIndex('name');
    //search.current.addIndex('description');
    search.current.addDocuments(options);
  }, [options]);
  let filteredOptions = props.searchQuery
    ? (search.current.search(props.searchQuery) as Record<string, any>[])
    : options;

  // Pre-compute the prereq-met rank per option once (rather than re-running
  // `meetsPrerequisites` on every comparator call). Lower rank = better fit:
  // FULLY (0) → PARTIALLY (1) → UNKNOWN/null (2) → NOT (3). Items with no
  // prerequisites are treated as fully met since they always qualify.
  const prereqRank = new Map<number, number>();
  if (sortByPrereqs) {
    for (const opt of filteredOptions) {
      if (!opt.prerequisites || opt.prerequisites.length === 0) {
        prereqRank.set(opt.id, 0);
        continue;
      }
      const r = meetsPrerequisites('CHARACTER', opt.prerequisites).result;
      prereqRank.set(opt.id, r === 'FULLY' ? 0 : r === 'PARTIALLY' ? 1 : r === 'NOT' ? 3 : 2);
    }
  }

  // Sort by level/rank, then prereqs-met (when enabled for feats), then name
  filteredOptions = filteredOptions.sort((a, b) => {
    if (a.level !== undefined && b.level !== undefined) {
      if (a.level !== b.level) {
        // Sort greatest first if it's overrideOptions
        if (props.overrideOptions) {
          return b.level - a.level;
        } else {
          return a.level - b.level;
        }
      }
    } else if (a.rank !== undefined && b.rank !== undefined) {
      if (a.rank !== b.rank) {
        // Sort greatest first if it's overrideOptions
        if (props.overrideOptions) {
          return b.rank - a.rank;
        } else {
          return a.rank - b.rank;
        }
      }
    }
    if (sortByPrereqs) {
      const diff = (prereqRank.get(a.id) ?? 2) - (prereqRank.get(b.id) ?? 2);
      if (diff !== 0) return diff;
    }
    return a.name.localeCompare(b.name);
  });

  return (
    <SelectionOptionsInner
      options={filteredOptions}
      type={props.type}
      skillAdjustment={props.skillAdjustment}
      abilityBlockType={props.abilityBlockType}
      isLoading={isFetching || !options}
      onClick={props.onClick}
      selectedId={props.selectedId}
      showButton={props.showButton}
      includeOptions={props.includeOptions}
    />
  );
}

export function SelectionOptionsInner(props: {
  options: Record<string, any>[];
  type: ContentType;
  skillAdjustment?: ExtendedProficiencyType;
  abilityBlockType?: AbilityBlockType;
  isLoading: boolean;
  onClick?: (option: Record<string, any>) => void;
  selectedId?: number;
  includeOptions?: boolean;
  showButton?: boolean;
  onDelete?: (id: number) => void;
  onCopy?: (id: number) => void;
  h?: number;
}) {
  const NUM_PER_PAGE = 20;
  const [activePage, setPage] = useState(1);

  useEffect(() => {
    setPage(1);
    scrollToTop();
  }, [props.options.length]);

  const viewport = useRef<HTMLDivElement>(null);
  const scrollToTop = () => viewport.current?.scrollTo({ top: 0 });

  const typeName = toLabel(props.abilityBlockType || props.type);
  if (!props.isLoading && props.options.length === 0) {
    return (
      <Box pt='lg'>
        <Text fz='md' c='dimmed' ta='center' fs='italic'>
          No {pluralize(typeName.toLowerCase())} found!
        </Text>
      </Box>
    );
  }

  return (
    <>
      {/* h='100%' + flex:1 makes the ScrollArea fill whatever vertical
          space its flex parent gives it, which now varies depending on
          whether the filter panel is open above. With the previous fixed
          540px (or fixed calc), the ScrollArea overflowed the modal
          frame whenever the filter panel was also visible — clipping
          the bottom of the option list. */}
      <ScrollArea
        viewportRef={viewport}
        h={props.h ?? '100%'}
        style={props.h ? { position: 'relative' } : { position: 'relative', flex: 1, minHeight: 0 }}
        scrollbars='y'
      >
        {props.isLoading ? (
          <Loader
            type='bars'
            style={{
              position: 'absolute',
              top: '35%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
            }}
          />
        ) : (
          <SelectionOptionsRoot
            options={props.options.slice((activePage - 1) * NUM_PER_PAGE, activePage * NUM_PER_PAGE)}
            type={props.type}
            skillAdjustment={props.skillAdjustment}
            abilityBlockType={props.abilityBlockType}
            onClick={props.onClick ? props.onClick : () => {}}
            selectedId={props.selectedId}
            showButton={props.showButton}
            includeOptions={props.includeOptions}
            onDelete={props.onDelete}
            onCopy={props.onCopy}
          />
        )}
      </ScrollArea>
      <Center>
        <Pagination
          size='sm'
          total={Math.ceil(props.options.length / NUM_PER_PAGE)}
          value={activePage}
          siblings={3}
          onChange={(value) => {
            setPage(value);
            scrollToTop();
          }}
        />
      </Center>
    </>
  );
}

function SelectionOptionsRoot(props: {
  options: Record<string, any>[];
  type: ContentType;
  skillAdjustment?: ExtendedProficiencyType;
  abilityBlockType?: AbilityBlockType;
  onClick: (option: Record<string, any>) => void;
  selectedId?: number;
  includeOptions?: boolean;
  showButton?: boolean;
  onDelete?: (id: number) => void;
  onCopy?: (id: number) => void;
}) {
  // Render appropriate options based on type
  if (props.type === 'ability-block') {
    if (props.abilityBlockType === 'feat') {
      return (
        <>
          {props.options.map((feat, index) => (
            <FeatSelectionOption
              key={'feat-' + index}
              feat={feat as AbilityBlock}
              onClick={props.onClick}
              selected={props.selectedId === feat.id}
              displayLevel={true}
              showButton={props.showButton}
              includeOptions={props.includeOptions}
              onDelete={props.onDelete}
              onCopy={props.onCopy}
            />
          ))}
        </>
      );
    } else if (props.abilityBlockType === 'action') {
      return (
        <>
          {props.options.map((action, index) => (
            <ActionSelectionOption
              key={'action-' + index}
              action={action as AbilityBlock}
              onClick={props.onClick}
              selected={props.selectedId === action.id}
              showButton={props.showButton}
              includeOptions={props.includeOptions}
              onDelete={props.onDelete}
              onCopy={props.onCopy}
            />
          ))}
        </>
      );
    } else if (props.abilityBlockType === 'class-feature') {
      return (
        <>
          {props.options.map((classFeature, index) => (
            <ClassFeatureSelectionOption
              key={'class-feature-' + index}
              classFeature={classFeature as AbilityBlock}
              onClick={props.onClick}
              selected={props.selectedId === classFeature.id}
              showButton={props.showButton}
              includeOptions={props.includeOptions}
              onDelete={props.onDelete}
              onCopy={props.onCopy}
            />
          ))}
        </>
      );
    } else if (props.abilityBlockType === 'sense') {
      return (
        <>
          {props.options.map((sense, index) => (
            <SenseSelectionOption
              key={'sense-' + index}
              sense={sense as AbilityBlock}
              onClick={props.onClick}
              selected={props.selectedId === sense.id}
              showButton={props.showButton}
              includeOptions={props.includeOptions}
              onDelete={props.onDelete}
              onCopy={props.onCopy}
            />
          ))}
        </>
      );
    } else if (props.abilityBlockType === 'physical-feature') {
      return (
        <>
          {props.options.map((physicalFeature, index) => (
            <PhysicalFeatureSelectionOption
              key={'physical-feature-' + index}
              physicalFeature={physicalFeature as AbilityBlock}
              onClick={props.onClick}
              selected={props.selectedId === physicalFeature.id}
              showButton={props.showButton}
              includeOptions={props.includeOptions}
              onDelete={props.onDelete}
              onCopy={props.onCopy}
            />
          ))}
        </>
      );
    } else if (props.abilityBlockType === 'mode') {
      return (
        <>
          {props.options.map((mode, index) => (
            <ModeSelectionOption
              key={'mode-' + index}
              mode={mode as AbilityBlock}
              onClick={props.onClick}
              selected={props.selectedId === mode.id}
              showButton={props.showButton}
              includeOptions={props.includeOptions}
              onDelete={props.onDelete}
              onCopy={props.onCopy}
            />
          ))}
        </>
      );
    } else if (props.abilityBlockType === 'heritage') {
      return (
        <>
          {props.options.map((heritage, index) => (
            <HeritageSelectionOption
              key={'heritage-' + index}
              heritage={heritage as AbilityBlock}
              onClick={props.onClick}
              selected={props.selectedId === heritage.id}
              showButton={props.showButton}
              includeOptions={props.includeOptions}
              onDelete={props.onDelete}
              onCopy={props.onCopy}
            />
          ))}
        </>
      );
    }
  }
  if (props.type === 'class') {
    return (
      <>
        {props.options.map((class_, index) => (
          <ClassSelectionOption
            key={'class-' + index}
            class_={class_ as Class}
            onClick={props.onClick}
            selected={props.selectedId === class_.id}
            hasSelected={props.selectedId !== undefined}
            showButton={props.showButton}
            includeOptions={props.includeOptions}
            onDelete={props.onDelete}
            onCopy={props.onCopy}
          />
        ))}
      </>
    );
  }
  if (props.type === 'background') {
    return (
      <>
        {props.options.map((background, index) => (
          <BackgroundSelectionOption
            key={'background-' + index}
            background={background as Background}
            onClick={props.onClick}
            selected={props.selectedId === background.id}
            hasSelected={props.selectedId !== undefined}
            showButton={props.showButton}
            includeOptions={props.includeOptions}
            onDelete={props.onDelete}
            onCopy={props.onCopy}
          />
        ))}
      </>
    );
  }
  if (props.type === 'ancestry') {
    return (
      <>
        {props.options.map((ancestry, index) => (
          <AncestrySelectionOption
            key={'ancestry-' + index}
            ancestry={ancestry as Ancestry}
            onClick={props.onClick}
            selected={props.selectedId === ancestry.id}
            hasSelected={props.selectedId !== undefined}
            showButton={props.showButton}
            includeOptions={props.includeOptions}
            onDelete={props.onDelete}
            onCopy={props.onCopy}
          />
        ))}
      </>
    );
  }
  if (props.type === 'archetype') {
    return (
      <>
        {props.options.map((archetype, index) => (
          <ArchetypeSelectionOption
            key={'archetype-' + index}
            archetype={archetype as Archetype}
            onClick={props.onClick}
            selected={props.selectedId === archetype.id}
            hasSelected={props.selectedId !== undefined}
            showButton={props.showButton}
            includeOptions={props.includeOptions}
            onDelete={props.onDelete}
            onCopy={props.onCopy}
          />
        ))}
      </>
    );
  }
  if (props.type === 'versatile-heritage') {
    return (
      <>
        {props.options.map((versatileHeritage, index) => (
          <VersatileHeritageSelectionOption
            key={'versatile-heritage-' + index}
            versatileHeritage={versatileHeritage as VersatileHeritage}
            onClick={props.onClick}
            selected={props.selectedId === versatileHeritage.id}
            hasSelected={props.selectedId !== undefined}
            showButton={props.showButton}
            includeOptions={props.includeOptions}
            onDelete={props.onDelete}
            onCopy={props.onCopy}
          />
        ))}
      </>
    );
  }
  if (props.type === 'item') {
    return (
      <>
        {props.options.map((item, index) => (
          <ItemSelectionOption
            key={'item-' + index}
            item={item as Item}
            onClick={props.onClick}
            selected={props.selectedId === item.id}
            showButton={props.showButton}
            includeOptions={props.includeOptions}
            onDelete={props.onDelete}
            onCopy={props.onCopy}
          />
        ))}
      </>
    );
  }
  if (props.type === 'spell') {
    return (
      <>
        {props.options.map((spell, index) => (
          <SpellSelectionOption
            key={'spell-' + index}
            spell={spell as Spell}
            onClick={props.onClick}
            selected={props.selectedId === spell.id}
            showButton={props.showButton}
            includeOptions={props.includeOptions}
            onDelete={props.onDelete}
            onCopy={props.onCopy}
          />
        ))}
      </>
    );
  }
  if (props.type === 'trait') {
    return (
      <>
        {props.options.map((trait, index) => (
          <TraitSelectionOption
            key={'trait-' + index}
            trait={trait as Trait}
            onClick={props.onClick}
            selected={props.selectedId === trait.id}
            showButton={props.showButton}
            includeOptions={props.includeOptions}
            onDelete={props.onDelete}
            onCopy={props.onCopy}
          />
        ))}
      </>
    );
  }
  if (props.type === 'class-archetype') {
    return (
      <>
        {props.options.map((classArchetype, index) => (
          <ClassArchetypeSelectionOption
            key={'class-archetype-' + index}
            classArchetype={classArchetype as ClassArchetype}
            onClick={props.onClick}
            selected={props.selectedId === classArchetype.id}
            showButton={props.showButton}
            includeOptions={props.includeOptions}
            onDelete={props.onDelete}
            onCopy={props.onCopy}
          />
        ))}
      </>
    );
  }
  if (props.type === 'language') {
    return (
      <>
        {props.options.map((language, index) => (
          <LanguageSelectionOption
            key={'language-' + index}
            language={language as Language}
            onClick={props.onClick}
            selected={props.selectedId === language.id}
            showButton={props.showButton}
            includeOptions={props.includeOptions}
            onDelete={props.onDelete}
            onCopy={props.onCopy}
          />
        ))}
      </>
    );
  }
  if (props.type === 'creature') {
    return (
      <>
        {props.options.map((creature, index) => (
          <CreatureSelectionOption
            key={'creature-' + index}
            creature={creature as Creature}
            onClick={props.onClick}
            selected={props.selectedId === creature.id}
            showButton={props.showButton}
            includeOptions={props.includeOptions}
            onDelete={props.onDelete}
            onCopy={props.onCopy}
          />
        ))}
      </>
    );
  }

  // Skill increase with lore support
  const isSkillIncreaseWithLore = props.skillAdjustment && props.options.find((o) => o.variable === 'SKILL_LORE____');
  if (isSkillIncreaseWithLore) {
    const addNewLore = (option: AbilityBlock) => {
      openContextModal({
        modal: 'addNewLore',
        title: <Title order={3}>Add New Lore</Title>,
        innerProps: {
          onConfirm: (loreName: string) => {
            props.onClick({
              ...option,
              _select_uuid: `SKILL_LORE_${loreName}`,
            });
          },
        },
      });
    };

    // If the only options are lores, it's adding a new lore. Just shortcut to that.
    if (props.options.filter((o) => o.variable.startsWith('SKILL_LORE_')).length === props.options.length) {
      modals.closeAll();
      addNewLore(isSkillIncreaseWithLore as AbilityBlock);
      return null;
    }

    return (
      <>
        {props.options
          .filter((o) => o.variable !== 'SKILL_LORE____')
          .map((option, index) => (
            <GenericSelectionOption
              key={'generic-' + index}
              option={option as GenericAbilityBlock}
              onClick={props.onClick}
              selected={props.selectedId === option.id}
              skillAdjustment={props.skillAdjustment}
              showButton={props.showButton}
              includeOptions={props.includeOptions}
              onDelete={props.onDelete}
              onCopy={props.onCopy}
            />
          ))}
        <GenericSelectionOption
          option={
            {
              ...isSkillIncreaseWithLore,
              name: `Add New Lore`,
            } as GenericAbilityBlock
          }
          onClick={(option) => {
            addNewLore(option);
          }}
          selected={false}
          skillAdjustment={props.skillAdjustment}
          showButton={props.showButton}
          includeOptions={props.includeOptions}
          onDelete={props.onDelete}
          onCopy={props.onCopy}
        />
      </>
    );
  }

  // Generic ability block. Probably used for variables.
  return (
    <>
      {props.options.map((option, index) => (
        <GenericSelectionOption
          key={'generic-' + index}
          option={option as GenericAbilityBlock}
          onClick={props.onClick}
          selected={props.selectedId === option.id}
          skillAdjustment={props.skillAdjustment}
          showButton={props.showButton}
          includeOptions={props.includeOptions}
          onDelete={props.onDelete}
          onCopy={props.onCopy}
        />
      ))}
    </>
  );
}

interface GenericAbilityBlock extends AbilityBlock {
  _content_type?: ContentType;
  _select_uuid?: string;
  _custom_select?: GenericData;
  _is_core?: boolean;
  _source_level?: number;
}
export function GenericSelectionOption(props: {
  option: GenericAbilityBlock;
  onClick: (option: GenericAbilityBlock) => void;
  selected?: boolean;
  skillAdjustment?: ExtendedProficiencyType;
  showButton?: boolean;
  includeOptions?: boolean;
  onDelete?: (id: number) => void;
  onCopy?: (id: number) => void;
}) {
  const [hovered, setHovered] = useState(false);
  const [_drawer, openDrawer] = useAtom(drawerState);

  if (props.option._content_type === 'language') {
    // Route to language option
    return (
      <LanguageSelectionOption
        language={props.option as unknown as Language}
        onClick={() => props.onClick(props.option)}
        selected={props.selected}
        includeOptions={props.includeOptions}
        onDelete={props.onDelete}
        onCopy={props.onCopy}
      />
    );
  }

  // It's a custom selection option
  if (props.option._custom_select) {
    return (
      <BaseSelectionOption
        leftSection={
          <Group wrap='nowrap' gap={5}>
            <Box pl={8}>
              <Text fz='sm'>{props.option._custom_select.title}</Text>
            </Box>
          </Group>
        }
        showButton={props.showButton}
        selected={props.selected}
        onClick={() => {
          openDrawer({
            type: 'generic',
            data: { zIndex: 1600,
              ...props.option._custom_select,
              onSelect:
                props.showButton || props.showButton === undefined ? () => props.onClick(props.option) : undefined,
            },
            extra: { addToHistory: true },
          });
          props.onClick(props.option);
        }}
        onButtonClick={() => {
          props.onClick(props.option);
        }}
        includeOptions={props.includeOptions}
        onOptionsDelete={() => props.onDelete?.(props.option.id)}
        onOptionsCopy={() => props.onCopy?.(props.option.id)}
      />
    );
  }

  // @ts-ignore
  const variable = getVariable('CHARACTER', props.option.variable);

  // It's some kind of variable selection option that's not a prof or a prof but without an attribute
  if (variable?.type !== 'prof' || !variable.value.attribute) {
    return (
      <BaseSelectionOption
        leftSection={
          <Group wrap='nowrap' gap={8} pl={8}>
            <Text fz='sm'>{props.option.name}</Text>
          </Group>
        }
        showButton={props.showButton}
        selected={props.selected}
        onClick={() => {
          props.onClick(props.option);
        }}
        onHover={setHovered}
        includeOptions={props.includeOptions}
        onOptionsDelete={() => props.onDelete?.(props.option.id)}
        onOptionsCopy={() => props.onCopy?.(props.option.id)}
      />
    );
  }

  ////////////////////////////
  // It's a prof selection: //
  ////////////////////////////

  let currentProf: ProficiencyType | undefined | null = compileProficiencyType((variable as VariableProf)?.value);
  let nextProf =
    props.skillAdjustment === '1'
      ? nextProficiencyType(currentProf ?? 'U')
      : props.skillAdjustment === '-1'
        ? prevProficiencyType(currentProf ?? 'U')
        : props.skillAdjustment;

  // If selected already, show the previous data to reflect the change
  if (props.selected && currentProf) {
    nextProf = currentProf;
    currentProf =
      props.skillAdjustment === '1'
        ? prevProficiencyType(currentProf)
        : props.skillAdjustment === '-1'
          ? nextProficiencyType(currentProf)
          : props.skillAdjustment;
  }

  let limitedByLevel = false;
  if (props.skillAdjustment === '1') {
    if (nextProf && nextProf === 'M' && (props.option._source_level ?? 1) < 7) {
      limitedByLevel = true;
    } else if (nextProf && nextProf === 'L' && (props.option._source_level ?? 1) < 15) {
      limitedByLevel = true;
    }
  }

  let alreadyProficient =
    !props.selected &&
    currentProf &&
    (currentProf === props.skillAdjustment ||
      (isProficiencyType(props.skillAdjustment) &&
        maxProficiencyType(currentProf ?? 'U', props.skillAdjustment) === currentProf));

  if (nextProf === null) {
    alreadyProficient = true;
  }

  const disabled = alreadyProficient || limitedByLevel;

  // Get bonus totals
  // @ts-ignore
  const currentTotal = getFinalProfValue('CHARACTER', props.option.variable, undefined, undefined, currentProf);
  // @ts-ignore
  const nextTotal = getFinalProfValue('CHARACTER', props.option.variable, undefined, undefined, nextProf);

  return (
    <BaseSelectionOption
      leftSection={
        <Group wrap='nowrap' gap={8} pl={8}>
          {alreadyProficient ? (
            <Badge size='sm' variant='light' color='gray' circle>
              {currentProf ?? 'U'}
            </Badge>
          ) : (
            <>
              {props.selected || (hovered && !disabled) ? (
                <Badge size='sm' circle>
                  {nextProf ?? 'U'}
                </Badge>
              ) : (
                <Badge size='sm' variant='light' circle>
                  {currentProf ?? 'U'}
                </Badge>
              )}
            </>
          )}
          <Text fz='sm'>{props.option.name}</Text>
          {props.selected || (hovered && !disabled) ? (
            <Text c='gray.2' fw={600} fz='sm'>
              {nextTotal}
            </Text>
          ) : (
            <Text c='gray.6' fz='sm'>
              {currentTotal}
            </Text>
          )}
        </Group>
      }
      showButton={props.showButton}
      selected={props.selected}
      disabled={disabled}
      onClick={() => {
        props.onClick(props.option);
      }}
      onHover={setHovered}
      includeOptions={props.includeOptions}
      onOptionsDelete={() => props.onDelete?.(props.option.id)}
      onOptionsCopy={() => props.onCopy?.(props.option.id)}
    />
  );
}

export function BaseSelectionOption(props: {
  selected?: boolean;
  buttonTitle?: string;
  buttonProps?: ButtonProps;
  includeOptions?: boolean;
  buttonOverride?: React.ReactNode;
  showButton?: boolean;
  onClick: () => void;
  onHover?: (active: boolean) => void;
  onButtonClick?: () => void;
  onOptionsDelete?: () => void;
  onOptionsCopy?: () => void;
  leftSection?: React.ReactNode;
  rightSection?: React.ReactNode;
  level?: string | number;
  noBackground?: boolean;
  disabled?: boolean;
  disableButton?: boolean;
  px?: number;
}) {
  const theme = useMantineTheme();
  const { hovered, ref: hoverRef } = useHover();
  const { ref: sizeRef, width } = useElementSize();
  const mergedRef = useMergedRef(hoverRef, sizeRef);

  const { hovered: hoveredButton, ref: buttonRef } = useHover();

  const isPhone = isPhoneSized(width);

  useDidUpdate(() => {
    props.onHover?.(hovered);
  }, [hovered]);

  const displayButton =
    (props.showButton || props.showButton === undefined) && (props.buttonTitle || props.buttonOverride);

  return (
    <Group
      ref={mergedRef}
      py='sm'
      px={props.px ?? 'sm'}
      style={{
        cursor: 'pointer',
        borderBottom: '1px solid ' + IMPRINT_BORDER_COLOR,
        backgroundColor: (hovered || props.selected) && !props.noBackground ? 'rgba(0,0,0,0.1)' : 'transparent',
        position: 'relative',
        opacity: props.disabled ? 0.4 : 1,
        width: '100%',
        pointerEvents: props.disabled ? 'none' : undefined,
      }}
      onClick={displayButton ? props.onClick : (props.onButtonClick ?? props.onClick)}
      justify='space-between'
    >
      {props.level && parseInt(`${props.level}`) !== 0 && !isNaN(parseInt(`${props.level}`)) && (
        <Text
          fz={10}
          c='dimmed'
          ta='right'
          w={14}
          style={{
            position: 'absolute',
            top: 15,
            left: 1,
          }}
        >
          {props.level}.
        </Text>
      )}
      {props.leftSection && <Box>{props.leftSection}</Box>}
      {!isPhone && props.rightSection && (
        <Group wrap='nowrap' justify='flex-end' style={{ marginLeft: 'auto' }}>
          <Box>{props.rightSection}</Box>
          {/* Placeholder reserves space for the absolute-positioned
              SELECT button so trait pills don't bleed underneath. The
              old 55 / 95 widths were narrower than the SELECT button
              itself (~95px) so traits visually overlapped the button —
              widened to 120 / 160 to give the button clearance + a
              small gap between traits and SELECT. */}
          {displayButton ? <Box w={props.includeOptions ? 160 : 120}></Box> : null}
        </Group>
      )}

      {displayButton && (
        <>
          {props.buttonOverride ? (
            props.buttonOverride
          ) : (
            <>
              {props.buttonTitle && (
                <Box
                  style={{
                    position: 'absolute',
                    top: 0,
                    right: props.includeOptions ? 45 : 15,
                  }}
                >
                  <Button
                    ref={buttonRef}
                    disabled={props.disableButton}
                    size='sm'
                    variant={hoveredButton ? 'filled' : 'light'}
                    onClick={(e) => {
                      e.stopPropagation();
                      props.onButtonClick?.();
                    }}
                    {...props.buttonProps}
                    style={{
                      height: 47, // Hardcoded for roughly how tall option is
                      borderRadius: 0,
                      ...props.buttonProps?.style,
                    }}
                  >
                    {props.buttonTitle}
                  </Button>
                </Box>
              )}
            </>
          )}
        </>
      )}

      {props.includeOptions && (
        <Menu shadow='md' width={200} zIndex={1000}>
          <Menu.Target>
            <ActionIcon
              size='sm'
              variant='subtle'
              color='gray.5'
              radius='xl'
              style={{
                position: 'absolute',
                top: 13,
                right: 15,
              }}
              aria-label='Options'
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
              }}
            >
              <IconDots size='1rem' />
            </ActionIcon>
          </Menu.Target>

          <Menu.Dropdown>
            <Menu.Label>Options</Menu.Label>
            {props.onOptionsCopy && (
              <Menu.Item
                leftSection={<IconCopy style={{ width: rem(14), height: rem(14) }} />}
                onClick={(e) => {
                  e.stopPropagation();
                  props.onOptionsCopy?.();
                }}
              >
                Duplicate
              </Menu.Item>
            )}

            {props.onOptionsDelete && (
              <Menu.Item
                color='red'
                leftSection={<IconTrash style={{ width: rem(14), height: rem(14) }} />}
                onClick={(e) => {
                  e.stopPropagation();
                  props.onOptionsDelete?.();
                }}
              >
                Delete
              </Menu.Item>
            )}
          </Menu.Dropdown>
        </Menu>
      )}
    </Group>
  );
}

export function FeatSelectionOption(props: {
  feat: AbilityBlock;
  onClick: (feat: AbilityBlock) => void;
  selected?: boolean;
  displayLevel?: boolean;
  showButton?: boolean;
  includeOptions?: boolean;
  onDelete?: (id: number) => void;
  onCopy?: (id: number) => void;
}) {
  const [_drawer, openDrawer] = useAtom(drawerState);
  const character = useAtomValue(characterState);
  const DETECT_PREREQUS = character?.options?.auto_detect_prerequisites ?? false;

  const prereqMet = DETECT_PREREQUS && meetsPrerequisites('CHARACTER', props.feat.prerequisites ?? undefined);

  // Hide deprecated options
  if (props.feat.meta_data?.deprecated && !props.selected) return null;

  return (
    <BaseSelectionOption
      leftSection={
        <Group wrap='nowrap' gap={5} pl={8}>
          <Box>
            <Text fz='sm'>{props.feat.name}</Text>
          </Box>
          <Box>
            <ActionSymbol cost={props.feat.actions} gap={5} />
          </Box>
          {prereqMet && prereqMet.result && (
            <>
              {prereqMet.result === 'FULLY' && (
                <ThemeIcon variant='light' size='xs' radius='xl'>
                  <IconCheck style={{ width: '70%', height: '70%' }} />
                </ThemeIcon>
              )}
              {prereqMet.result === 'PARTIALLY' && (
                <ThemeIcon variant='light' size='xs' radius='xl'>
                  <IconZoomCheck style={{ width: '70%', height: '70%' }} />
                </ThemeIcon>
              )}
              {prereqMet.result === 'UNKNOWN' && (
                <ThemeIcon variant='light' size='xs' radius='xl' color='yellow'>
                  <IconZoomQuestion style={{ width: '70%', height: '70%' }} />
                </ThemeIcon>
              )}
              {prereqMet.result === 'NOT' && (
                <ThemeIcon variant='light' size='xs' radius='xl' color='red'>
                  <IconX style={{ width: '70%', height: '70%' }} />
                </ThemeIcon>
              )}
            </>
          )}
        </Group>
      }
      rightSection={
        <TraitsDisplay
          justify='flex-end'
          size='xs'
          traitIds={props.feat.traits ?? []}
          rarity={props.feat.rarity}
          availability={props.feat.availability ?? undefined}
        />
      }
      showButton={props.showButton}
      level={
        props.displayLevel && props.feat.meta_data?.unselectable !== true ? (props.feat.level ?? undefined) : undefined
      }
      selected={props.selected}
      onClick={() =>
        openDrawer({
          type: 'feat',
          data: { zIndex: 1600,
            id: props.feat.id,
            onSelect: props.showButton || props.showButton === undefined ? () => props.onClick(props.feat) : undefined,
          },
          extra: { addToHistory: true },
        })
      }
      buttonTitle='Select'
      disableButton={props.selected}
      onButtonClick={() => props.onClick(props.feat)}
      includeOptions={props.includeOptions}
      onOptionsDelete={() => props.onDelete?.(props.feat.id)}
      onOptionsCopy={() => props.onCopy?.(props.feat.id)}
    />
  );
}

export function ActionSelectionOption(props: {
  action: AbilityBlock;
  onClick: (action: AbilityBlock) => void;
  selected?: boolean;
  includeOptions?: boolean;
  showButton?: boolean;
  onDelete?: (id: number) => void;
  onCopy?: (id: number) => void;
}) {
  const [_drawer, openDrawer] = useAtom(drawerState);

  // Hide deprecated options
  if (props.action.meta_data?.deprecated && !props.selected) return null;

  return (
    <BaseSelectionOption
      leftSection={
        <Group wrap='nowrap' gap={5}>
          <Box pl={8}>
            <Text fz='sm'>{props.action.name}</Text>
          </Box>
          <Box>
            <ActionSymbol cost={props.action.actions} gap={5} />
          </Box>
        </Group>
      }
      rightSection={
        <TraitsDisplay
          justify='flex-end'
          size='xs'
          traitIds={props.action.traits ?? []}
          rarity={props.action.rarity}
          availability={props.action.availability ?? undefined}
          skill={props.action.meta_data?.skill}
        />
      }
      showButton={props.showButton}
      selected={props.selected}
      onClick={() =>
        openDrawer({
          type: 'action',
          data: { zIndex: 1600,
            id: props.action.id,
            onSelect:
              props.showButton || props.showButton === undefined ? () => props.onClick(props.action) : undefined,
          },
          extra: { addToHistory: true },
        })
      }
      buttonTitle='Select'
      disableButton={props.selected}
      onButtonClick={() => props.onClick(props.action)}
      includeOptions={props.includeOptions}
      onOptionsDelete={() => props.onDelete?.(props.action.id)}
      onOptionsCopy={() => props.onCopy?.(props.action.id)}
    />
  );
}

export function ClassFeatureSelectionOption(props: {
  classFeature: AbilityBlock;
  onClick: (classFeature: AbilityBlock) => void;
  selected?: boolean;
  includeOptions?: boolean;
  showButton?: boolean;
  onDelete?: (id: number) => void;
  onCopy?: (id: number) => void;
}) {
  const [_drawer, openDrawer] = useAtom(drawerState);
  const character = useAtomValue(characterState);

  // Find first selected option
  let selectedOption: OperationSelectOptionCustom | null = null;
  for (const op of props.classFeature.operations ?? []) {
    const option = getSelectedCustomOption(character, op);
    if (option) {
      selectedOption = option;
      break;
    }
  }

  // Hide deprecated options
  if (props.classFeature.meta_data?.deprecated && !props.selected) return null;

  return (
    <BaseSelectionOption
      leftSection={
        <Group wrap='nowrap' gap={5}>
          <Box pl={8}>
            <Text fz='sm'>
              {props.classFeature.name}
              {selectedOption ? ` — ${selectedOption.title}` : ''}
            </Text>
          </Box>
          <Box>
            <ActionSymbol cost={props.classFeature.actions} gap={5} />
          </Box>
        </Group>
      }
      rightSection={
        <TraitsDisplay
          justify='flex-end'
          size='xs'
          traitIds={props.classFeature.traits ?? []}
          rarity={props.classFeature.rarity}
          availability={props.classFeature.availability ?? undefined}
          skill={props.classFeature.meta_data?.skill}
        />
      }
      level={props.classFeature.level ?? undefined}
      showButton={props.showButton}
      selected={props.selected}
      onClick={() =>
        openDrawer({
          type: 'class-feature',
          data: { zIndex: 1600,
            id: props.classFeature.id,
            onSelect:
              props.showButton || props.showButton === undefined ? () => props.onClick(props.classFeature) : undefined,
          },
          extra: { addToHistory: true },
        })
      }
      buttonTitle='Select'
      disableButton={props.selected}
      onButtonClick={() => props.onClick(props.classFeature)}
      includeOptions={props.includeOptions}
      onOptionsDelete={() => props.onDelete?.(props.classFeature.id)}
      onOptionsCopy={() => props.onCopy?.(props.classFeature.id)}
    />
  );
}

export function HeritageSelectionOption(props: {
  heritage: AbilityBlock;
  onClick: (heritage: AbilityBlock) => void;
  selected?: boolean;
  showButton?: boolean;
  includeOptions?: boolean;
  onDelete?: (id: number) => void;
  onCopy?: (id: number) => void;
}) {
  const [_drawer, openDrawer] = useAtom(drawerState);

  // Hide deprecated options
  if (props.heritage.meta_data?.deprecated && !props.selected) return null;

  return (
    <BaseSelectionOption
      leftSection={
        <Group wrap='nowrap' gap={5}>
          <Box pl={8}>
            <Text fz='sm'>{props.heritage.name}</Text>
          </Box>
          <Box>
            <ActionSymbol cost={props.heritage.actions} gap={5} />
          </Box>
        </Group>
      }
      rightSection={
        <TraitsDisplay
          justify='flex-end'
          size='xs'
          traitIds={props.heritage.traits ?? []}
          rarity={props.heritage.rarity}
          availability={props.heritage.availability ?? undefined}
          skill={props.heritage.meta_data?.skill}
        />
      }
      showButton={props.showButton}
      selected={props.selected}
      onClick={() =>
        openDrawer({
          type: 'heritage',
          data: { zIndex: 1600,
            id: props.heritage.id,
            onSelect:
              props.showButton || props.showButton === undefined ? () => props.onClick(props.heritage) : undefined,
          },
          extra: { addToHistory: true },
        })
      }
      buttonTitle='Select'
      disableButton={props.selected}
      onButtonClick={() => props.onClick(props.heritage)}
      includeOptions={props.includeOptions}
      onOptionsDelete={() => props.onDelete?.(props.heritage.id)}
      onOptionsCopy={() => props.onCopy?.(props.heritage.id)}
    />
  );
}

export function PhysicalFeatureSelectionOption(props: {
  physicalFeature: AbilityBlock;
  onClick: (physicalFeature: AbilityBlock) => void;
  selected?: boolean;
  showButton?: boolean;
  includeOptions?: boolean;
  onDelete?: (id: number) => void;
  onCopy?: (id: number) => void;
}) {
  const [_drawer, openDrawer] = useAtom(drawerState);

  // Hide deprecated options
  if (props.physicalFeature.meta_data?.deprecated && !props.selected) return null;

  return (
    <BaseSelectionOption
      leftSection={
        <Group wrap='nowrap' gap={5}>
          <Box pl={8}>
            <Text fz='sm'>{props.physicalFeature.name}</Text>
          </Box>
          <Box>
            <ActionSymbol cost={props.physicalFeature.actions} gap={5} />
          </Box>
        </Group>
      }
      rightSection={
        <TraitsDisplay
          justify='flex-end'
          size='xs'
          traitIds={props.physicalFeature.traits ?? []}
          rarity={props.physicalFeature.rarity}
          availability={props.physicalFeature.availability ?? undefined}
          skill={props.physicalFeature.meta_data?.skill}
        />
      }
      showButton={props.showButton}
      selected={props.selected}
      onClick={() =>
        openDrawer({
          type: 'physical-feature',
          data: { zIndex: 1600,
            id: props.physicalFeature.id,
            onSelect:
              props.showButton || props.showButton === undefined
                ? () => props.onClick(props.physicalFeature)
                : undefined,
          },
          extra: { addToHistory: true },
        })
      }
      buttonTitle='Select'
      disableButton={props.selected}
      onButtonClick={() => props.onClick(props.physicalFeature)}
      includeOptions={props.includeOptions}
      onOptionsDelete={() => props.onDelete?.(props.physicalFeature.id)}
      onOptionsCopy={() => props.onCopy?.(props.physicalFeature.id)}
    />
  );
}

export function ModeSelectionOption(props: {
  mode: AbilityBlock;
  onClick: (mode: AbilityBlock) => void;
  selected?: boolean;
  showButton?: boolean;
  buttonTitle?: string;
  buttonProps?: ButtonProps;
  includeOptions?: boolean;
  onDelete?: (id: number) => void;
  onCopy?: (id: number) => void;
}) {
  const [_drawer, openDrawer] = useAtom(drawerState);

  // Hide deprecated options
  if (props.mode.meta_data?.deprecated && !props.selected) return null;

  return (
    <BaseSelectionOption
      leftSection={
        <Group wrap='nowrap' gap={5}>
          <Box pl={8}>
            <Text fz='sm'>{props.mode.name}</Text>
          </Box>
        </Group>
      }
      rightSection={
        <TraitsDisplay
          justify='flex-end'
          size='xs'
          traitIds={props.mode.traits ?? []}
          rarity={props.mode.rarity}
          availability={props.mode.availability ?? undefined}
          skill={props.mode.meta_data?.skill}
        />
      }
      showButton={props.showButton}
      selected={props.selected}
      onClick={() =>
        openDrawer({
          type: 'mode',
          data: { zIndex: 1600,
            id: props.mode.id,
            onSelect: props.showButton || props.showButton === undefined ? () => props.onClick(props.mode) : undefined,
          },
          extra: { addToHistory: true },
        })
      }
      buttonTitle={props.buttonTitle ?? 'Select'}
      buttonProps={props.buttonProps}
      disableButton={props.selected}
      onButtonClick={() => props.onClick(props.mode)}
      includeOptions={props.includeOptions}
      onOptionsDelete={() => props.onDelete?.(props.mode.id)}
      onOptionsCopy={() => props.onCopy?.(props.mode.id)}
    />
  );
}

export function SenseSelectionOption(props: {
  sense: AbilityBlock;
  onClick: (sense: AbilityBlock) => void;
  selected?: boolean;
  showButton?: boolean;
  includeOptions?: boolean;
  onDelete?: (id: number) => void;
  onCopy?: (id: number) => void;
}) {
  const [_drawer, openDrawer] = useAtom(drawerState);

  // Hide deprecated options
  if (props.sense.meta_data?.deprecated && !props.selected) return null;

  return (
    <BaseSelectionOption
      leftSection={
        <Group wrap='nowrap' gap={5}>
          <Box pl={8}>
            <Text fz='sm'>{props.sense.name}</Text>
          </Box>
          <Box>
            <ActionSymbol cost={props.sense.actions} gap={5} />
          </Box>
        </Group>
      }
      rightSection={
        <TraitsDisplay
          justify='flex-end'
          size='xs'
          traitIds={props.sense.traits ?? []}
          rarity={props.sense.rarity}
          availability={props.sense.availability ?? undefined}
          skill={props.sense.meta_data?.skill}
        />
      }
      showButton={props.showButton}
      selected={props.selected}
      onClick={() =>
        openDrawer({
          type: 'sense',
          data: { zIndex: 1600,
            id: props.sense.id,
            onSelect: props.showButton || props.showButton === undefined ? () => props.onClick(props.sense) : undefined,
          },
          extra: { addToHistory: true },
        })
      }
      buttonTitle='Select'
      disableButton={props.selected}
      onButtonClick={() => props.onClick(props.sense)}
      includeOptions={props.includeOptions}
      onOptionsDelete={() => props.onDelete?.(props.sense.id)}
      onOptionsCopy={() => props.onCopy?.(props.sense.id)}
    />
  );
}

export function ClassSelectionOption(props: {
  class_: Class;
  onClick: (class_: Class) => void;
  selected?: boolean;
  hasSelected?: boolean;
  showButton?: boolean;
  includeOptions?: boolean;
  onDelete?: (id: number) => void;
  onCopy?: (id: number) => void;
}) {
  const [_drawer, openDrawer] = useAtom(drawerState);

  const classHp = getStatDisplay('CHARACTER', 'MAX_HEALTH_CLASS_PER_LEVEL', props.class_.operations ?? [], 'READ');
  const attributes = getStatBlockDisplay(
    'CHARACTER',
    getAllAttributeVariables('CHARACTER').map((v) => v.name),
    props.class_.operations ?? [],
    'READ'
  );
  const keyAttribute =
    attributes.length > 0
      ? attributes[0]
      : {
          ui: null,
          operation: null,
        };

  const openConfirmModal = () =>
    modals.openConfirmModal({
      id: 'change-option',
      title: <Title order={4}>Change Class</Title>,
      children: (
        <Text size='sm'>Are you sure you want to change your class? Any previous class selections will be erased.</Text>
      ),
      labels: { confirm: 'Confirm', cancel: 'Cancel' },
      onCancel: () => {},
      onConfirm: () => props.onClick(props.class_),
    });

  const onSelect = () => {
    if (props.hasSelected && !props.selected) {
      openConfirmModal();
    } else {
      props.onClick(props.class_);
    }
  };

  // Hide deprecated options
  if (props.class_.deprecated && !props.selected) return null;

  return (
    <BaseSelectionOption
      leftSection={
        <Group wrap='nowrap'>
          <Avatar
            src={props.class_.artwork_url}
            radius='sm'
            styles={{
              image: {
                objectFit: 'contain',
              },
            }}
          />

          <div style={{ flex: 1 }}>
            <Text size='sm' fw={500}>
              {props.class_.name}
            </Text>

            <Group gap={5}>
              <Badge
                variant='dot'
                size='xs'
                styles={{
                  root: {
                    // @ts-ignore
                    '--badge-dot-size': 0,
                  },
                }}
                c='gray.6'
              >
                {classHp.ui ?? '-'} HP
              </Badge>
              <Badge
                variant='dot'
                size='xs'
                styles={{
                  root: {
                    // @ts-ignore
                    '--badge-dot-size': 0,
                  },
                }}
                c='gray.6'
              >
                {keyAttribute.ui ?? 'Varies'}
              </Badge>
            </Group>
          </div>
        </Group>
      }
      rightSection={<TraitsDisplay justify='flex-end' size='xs' traitIds={[]} rarity={props.class_.rarity} />}
      showButton={props.showButton}
      selected={props.selected}
      onClick={() =>
        openDrawer({
          type: 'class',
          data: { zIndex: 1600,
            id: props.class_.id,
            onSelect: props.showButton || props.showButton === undefined ? () => onSelect() : undefined,
          },
          extra: { addToHistory: true },
        })
      }
      buttonTitle='Select'
      buttonProps={{
        style: {
          height: 63,
        },
      }}
      disableButton={props.selected}
      onButtonClick={() => onSelect()}
      includeOptions={props.includeOptions}
      onOptionsDelete={() => props.onDelete?.(props.class_.id)}
      onOptionsCopy={() => props.onCopy?.(props.class_.id)}
    />
  );
}

export function AncestrySelectionOption(props: {
  ancestry: Ancestry;
  onClick: (ancestry: Ancestry) => void;
  selected?: boolean;
  hasSelected?: boolean;
  showButton?: boolean;
  includeOptions?: boolean;
  onDelete?: (id: number) => void;
  onCopy?: (id: number) => void;
}) {
  const [_drawer, openDrawer] = useAtom(drawerState);
  const character = useAtomValue(characterState);

  const operations = character
    ? getAdjustedAncestryOperations('CHARACTER', character, props.ancestry.operations ?? [])
    : (props.ancestry.operations ?? []);

  const ancestryHp = getStatDisplay('CHARACTER', 'MAX_HEALTH_ANCESTRY', operations, 'READ');
  const attributes = getStatBlockDisplay(
    'CHARACTER',
    getAllAttributeVariables('CHARACTER').map((v) => v.name),
    operations,
    'READ'
  );

  const flawAttributes = getStatBlockDisplay(
    'CHARACTER',
    getAllAttributeVariables('CHARACTER').map((v) => v.name),
    operations,
    'READ',
    undefined,
    { onlyNegatives: true }
  );

  const openConfirmModal = () =>
    modals.openConfirmModal({
      id: 'change-option',
      title: <Title order={4}>Change Ancestry</Title>,
      children: (
        <Text size='sm'>
          Are you sure you want to change your ancestry? Any previous ancestry selections will be erased.
        </Text>
      ),
      labels: { confirm: 'Confirm', cancel: 'Cancel' },
      onCancel: () => {},
      onConfirm: () => props.onClick(props.ancestry),
    });

  const onSelect = () => {
    if (props.hasSelected && !props.selected) {
      openConfirmModal();
    } else {
      props.onClick(props.ancestry);
    }
  };

  // Hide deprecated options
  if (props.ancestry.deprecated && !props.selected) return null;

  return (
    <BaseSelectionOption
      leftSection={
        <Group wrap='nowrap'>
          <Avatar
            src={props.ancestry.artwork_url}
            radius='sm'
            styles={{
              image: {
                objectFit: 'contain',
              },
            }}
          />

          <div style={{ flex: 1 }}>
            <Text size='sm' fw={500}>
              {props.ancestry.name}
            </Text>

            <Group gap={5}>
              <Badge
                variant='dot'
                size='xs'
                styles={{
                  root: {
                    // @ts-ignore
                    '--badge-dot-size': 0,
                  },
                }}
                c='gray.6'
              >
                {ancestryHp.ui} HP
              </Badge>
              <Badge
                variant='dot'
                size='xs'
                styles={{
                  root: {
                    // @ts-ignore
                    '--badge-dot-size': 0,
                  },
                }}
                c='gray.6'
              >
                +
                {attributes.flatMap((attribute, index) =>
                  index < attributes.length - 1 ? [attribute.ui, ', '] : [attribute.ui]
                )}
              </Badge>
              {flawAttributes.length > 0 && (
                <Badge
                  variant='dot'
                  size='xs'
                  styles={{
                    root: {
                      // @ts-ignore
                      '--badge-dot-size': 0,
                    },
                  }}
                  c='gray.6'
                >
                  -
                  {flawAttributes.flatMap((attribute, index) =>
                    index < flawAttributes.length - 1 ? [attribute.ui, ', '] : [attribute.ui]
                  )}
                </Badge>
              )}
            </Group>
          </div>
        </Group>
      }
      rightSection={<TraitsDisplay justify='flex-end' size='xs' traitIds={[]} rarity={props.ancestry.rarity} />}
      showButton={props.showButton}
      selected={props.selected}
      onClick={() =>
        openDrawer({
          type: 'ancestry',
          data: { zIndex: 1600,
            id: props.ancestry.id,
            onSelect: props.showButton || props.showButton === undefined ? () => onSelect() : undefined,
          },
          extra: { addToHistory: true },
        })
      }
      buttonTitle='Select'
      buttonProps={{
        style: {
          height: 63,
        },
      }}
      disableButton={props.selected}
      onButtonClick={() => onSelect()}
      includeOptions={props.includeOptions}
      onOptionsDelete={() => props.onDelete?.(props.ancestry.id)}
      onOptionsCopy={() => props.onCopy?.(props.ancestry.id)}
    />
  );
}

export function BackgroundSelectionOption(props: {
  background: Background;
  onClick: (background: Background) => void;
  selected?: boolean;
  hasSelected?: boolean;
  showButton?: boolean;
  includeOptions?: boolean;
  onDelete?: (id: number) => void;
  onCopy?: (id: number) => void;
}) {
  const [_drawer, openDrawer] = useAtom(drawerState);

  const openConfirmModal = () =>
    modals.openConfirmModal({
      id: 'change-option',
      title: <Title order={4}>Change Background</Title>,
      children: (
        <Text size='sm'>
          Are you sure you want to change your background? Any previous background selections will be erased.
        </Text>
      ),
      labels: { confirm: 'Confirm', cancel: 'Cancel' },
      onCancel: () => {},
      onConfirm: () => props.onClick(props.background),
    });

  const attributes = getStatBlockDisplay(
    'CHARACTER',
    getAllAttributeVariables('CHARACTER').map((v) => v.name),
    props.background.operations ?? [],
    'READ'
  );

  const onSelect = () => {
    if (props.hasSelected && !props.selected) {
      openConfirmModal();
    } else {
      props.onClick(props.background);
    }
  };

  // Hide deprecated options
  if (props.background.deprecated && !props.selected) return null;

  return (
    <BaseSelectionOption
      leftSection={
        <Group wrap='nowrap'>
          <div style={{ flex: 1 }}>
            <Text size='sm' fw={500}>
              {props.background.name}
            </Text>

            <Group gap={5}>
              {attributes.map((attribute, index) => (
                <Badge
                  key={index}
                  variant='dot'
                  size='xs'
                  styles={{
                    root: {
                      // @ts-ignore
                      '--badge-dot-size': 0,
                    },
                  }}
                  c='gray.6'
                >
                  {attribute.ui}
                </Badge>
              ))}
            </Group>
          </div>
        </Group>
      }
      rightSection={<TraitsDisplay justify='flex-end' size='xs' traitIds={[]} rarity={props.background.rarity} />}
      showButton={props.showButton}
      selected={props.selected}
      onClick={() =>
        openDrawer({
          type: 'background',
          data: { zIndex: 1600,
            id: props.background.id,
            onSelect: props.showButton || props.showButton === undefined ? () => onSelect() : undefined,
          },
          extra: { addToHistory: true },
        })
      }
      buttonTitle='Select'
      buttonProps={{
        style: {
          height: 63,
        },
      }}
      disableButton={props.selected}
      onButtonClick={() => onSelect()}
      includeOptions={props.includeOptions}
      onOptionsDelete={() => props.onDelete?.(props.background.id)}
      onOptionsCopy={() => props.onCopy?.(props.background.id)}
    />
  );
}

export function ArchetypeSelectionOption(props: {
  archetype: Archetype;
  onClick: (archetype: Archetype) => void;
  selected?: boolean;
  hasSelected?: boolean;
  showButton?: boolean;
  includeOptions?: boolean;
  onDelete?: (id: number) => void;
  onCopy?: (id: number) => void;
}) {
  const [_drawer, openDrawer] = useAtom(drawerState);

  // Hide deprecated options
  if (props.archetype.deprecated && !props.selected) return null;

  return (
    <BaseSelectionOption
      leftSection={
        <Group wrap='nowrap'>
          <Avatar
            src={props.archetype.artwork_url}
            radius='sm'
            styles={{
              image: {
                objectFit: 'contain',
              },
            }}
          />

          <div style={{ flex: 1 }}>
            <Text size='sm' fw={500}>
              {props.archetype.name}
            </Text>
          </div>
        </Group>
      }
      rightSection={<TraitsDisplay justify='flex-end' size='xs' traitIds={[]} rarity={props.archetype.rarity} />}
      showButton={props.showButton}
      selected={props.selected}
      onClick={() =>
        openDrawer({
          type: 'archetype',
          data: { zIndex: 1600,
            id: props.archetype.id,
            onSelect:
              props.showButton || props.showButton === undefined ? () => props.onClick(props.archetype) : undefined,
          },
          extra: { addToHistory: true },
        })
      }
      buttonTitle='Select'
      disableButton={props.selected}
      onButtonClick={() => props.onClick(props.archetype)}
      includeOptions={props.includeOptions}
      onOptionsDelete={() => props.onDelete?.(props.archetype.id)}
      onOptionsCopy={() => props.onCopy?.(props.archetype.id)}
    />
  );
}

export function VersatileHeritageSelectionOption(props: {
  versatileHeritage: VersatileHeritage;
  onClick: (versatileHeritage: VersatileHeritage) => void;
  selected?: boolean;
  hasSelected?: boolean;
  showButton?: boolean;
  includeOptions?: boolean;
  onDelete?: (id: number) => void;
  onCopy?: (id: number) => void;
}) {
  const [_drawer, openDrawer] = useAtom(drawerState);

  // Hide deprecated options
  if (props.versatileHeritage.deprecated && !props.selected) return null;

  return (
    <BaseSelectionOption
      leftSection={
        <Group wrap='nowrap'>
          <Avatar
            src={props.versatileHeritage.artwork_url}
            radius='sm'
            styles={{
              image: {
                objectFit: 'contain',
              },
            }}
          />

          <div style={{ flex: 1 }}>
            <Text size='sm' fw={500}>
              {props.versatileHeritage.name}
            </Text>
          </div>
        </Group>
      }
      rightSection={
        <TraitsDisplay justify='flex-end' size='xs' traitIds={[]} rarity={props.versatileHeritage.rarity} />
      }
      showButton={props.showButton}
      selected={props.selected}
      onClick={() =>
        openDrawer({
          type: 'versatile-heritage',
          data: { zIndex: 1600,
            id: props.versatileHeritage.id,
            onSelect:
              props.showButton || props.showButton === undefined
                ? () => props.onClick(props.versatileHeritage)
                : undefined,
          },
          extra: { addToHistory: true },
        })
      }
      buttonTitle='Select'
      disableButton={props.selected}
      onButtonClick={() => props.onClick(props.versatileHeritage)}
      includeOptions={props.includeOptions}
      onOptionsDelete={() => props.onDelete?.(props.versatileHeritage.id)}
      onOptionsCopy={() => props.onCopy?.(props.versatileHeritage.id)}
    />
  );
}

export function ItemSelectionOption(props: {
  item: Item;
  onClick?: (item: Item) => void;
  selected?: boolean;
  showButton?: boolean;
  includeOptions?: boolean;
  onDelete?: (id: number) => void;
  onCopy?: (id: number) => void;
  includeAdd?: boolean;
  onAdd?: (item: Item, type: 'GIVE' | 'BUY' | 'FORMULA') => void;
}) {
  const [_drawer, openDrawer] = useAtom(drawerState);

  // Hide deprecated options
  if (props.item.meta_data?.deprecated && !props.selected) return null;

  return (
    <BaseSelectionOption
      leftSection={
        <Group wrap='nowrap' pl={8}>
          <Box>
            <Text fz='sm'>{props.item.name}</Text>
          </Box>
        </Group>
      }
      rightSection={
        <TraitsDisplay
          justify='flex-end'
          size='xs'
          traitIds={props.item.traits ?? []}
          rarity={props.item.rarity}
          availability={props.item.availability ?? undefined}
          pfSize={props.item.size}
          archaic={isItemArchaic(props.item)}
        />
      }
      showButton={props.showButton}
      selected={props.selected}
      onClick={
        props.onClick
          ? () =>
              openDrawer({
                type: 'item',
                data: { zIndex: 1600,
                  id: props.item.id,
                  onSelect:
                    props.showButton || props.showButton === undefined ? () => props.onClick?.(props.item) : undefined,
                },
                extra: { addToHistory: true },
              })
          : () => {}
      }
      level={props.item.level}
      buttonOverride={
        props.includeAdd ? (
          <Box
            style={{
              position: 'absolute',
              top: 13,
              right: 15,
            }}
          >
            <BuyItemButton
              onBuy={() => props.onAdd?.(props.item, 'BUY')}
              onGive={() => props.onAdd?.(props.item, 'GIVE')}
              onFormula={() => props.onAdd?.(props.item, 'FORMULA')}
            />
          </Box>
        ) : undefined
      }
      buttonTitle='Select'
      disableButton={props.selected}
      onButtonClick={props.onClick ? () => props.onClick?.(props.item) : undefined}
      includeOptions={props.includeOptions}
      onOptionsDelete={() => props.onDelete?.(props.item.id)}
      onOptionsCopy={() => props.onCopy?.(props.item.id)}
    />
  );
}

export function SpellSelectionOption(props: {
  spell: Spell;
  onClick?: (spell: Spell) => void;
  selected?: boolean;
  includeOptions?: boolean;
  showButton?: boolean;
  hideTraits?: boolean;
  leftSection?: React.ReactNode;
  onDelete?: (id: number) => void;
  onCopy?: (id: number) => void;
  noBackground?: boolean;
  hideRank?: boolean;
  exhausted?: boolean;
  px?: number;
  prefix?: React.ReactNode;
}) {
  const [_drawer, openDrawer] = useAtom(drawerState);

  // Hide deprecated options
  if (props.spell.meta_data?.deprecated && !props.selected) return null;

  return (
    <BaseSelectionOption
      leftSection={
        <Group wrap='nowrap' gap={5}>
          <Box pl={8}>
            <Text fz='sm' td={props.exhausted ? 'line-through' : undefined}>
              {props.prefix}
              {props.spell.name}
            </Text>
          </Box>
          {isActionCost(props.spell.cast) && (
            <Box>
              <ActionSymbol cost={props.spell.cast} gap={5} />
            </Box>
          )}
          {props.leftSection && <Box>{props.leftSection}</Box>}
        </Group>
      }
      rightSection={
        props.hideTraits ? null : (
          <TraitsDisplay
            justify='flex-end'
            size='xs'
            traitIds={props.spell.traits ?? []}
            rarity={props.spell.rarity}
            availability={props.spell.availability ?? undefined}
          />
        )
      }
      showButton={props.showButton}
      selected={props.selected}
      level={!props.hideRank && props.spell.rank !== 0 ? props.spell.rank : undefined}
      disabled={props.exhausted}
      noBackground={props.noBackground}
      onClick={
        props.onClick
          ? () =>
              openDrawer({
                type: 'spell',
                data: { zIndex: 1600,
                  id: props.spell.id,
                  onSelect:
                    props.showButton || props.showButton === undefined ? () => props.onClick?.(props.spell) : undefined,
                },
                extra: { addToHistory: true },
              })
          : () => {}
      }
      buttonTitle='Select'
      px={props.px}
      disableButton={props.selected}
      onButtonClick={props.onClick ? () => props.onClick?.(props.spell) : undefined}
      includeOptions={props.includeOptions}
      onOptionsDelete={props.onDelete ? () => props.onDelete?.(props.spell.id) : undefined}
      onOptionsCopy={props.onCopy ? () => props.onCopy?.(props.spell.id) : undefined}
    />
  );
}

export function TraitSelectionOption(props: {
  trait: Trait;
  onClick: (trait: Trait) => void;
  selected?: boolean;
  showButton?: boolean;
  includeOptions?: boolean;
  onDelete?: (id: number) => void;
  onCopy?: (id: number) => void;
}) {
  const theme = useMantineTheme();
  const [_drawer, openDrawer] = useAtom(drawerState);

  // Hide deprecated options
  if (props.trait.meta_data?.deprecated && !props.selected) return null;

  return (
    <BaseSelectionOption
      leftSection={
        <Group wrap='nowrap' gap={5}>
          <Indicator
            disabled={!props.trait.meta_data?.important}
            inline
            size={12}
            offset={-10}
            position='middle-end'
            color={theme.colors.gray[5]}
            withBorder
          >
            <Box pl={8}>
              <Text fz='sm'>{props.trait.name}</Text>
            </Box>
          </Indicator>
        </Group>
      }
      showButton={props.showButton}
      selected={props.selected}
      onClick={() =>
        openDrawer({
          type: 'trait',
          data: { zIndex: 1600,
            id: props.trait.id,
            onSelect: props.showButton || props.showButton === undefined ? () => props.onClick(props.trait) : undefined,
          },
          extra: { addToHistory: true },
        })
      }
      buttonTitle='Select'
      disableButton={props.selected}
      onButtonClick={() => props.onClick(props.trait)}
      includeOptions={props.includeOptions}
      onOptionsDelete={() => props.onDelete?.(props.trait.id)}
      onOptionsCopy={() => props.onCopy?.(props.trait.id)}
    />
  );
}

export function LanguageSelectionOption(props: {
  language: Language;
  onClick: (language: Language) => void;
  selected?: boolean;
  showButton?: boolean;
  includeOptions?: boolean;
  onDelete?: (id: number) => void;
  onCopy?: (id: number) => void;
}) {
  const [_drawer, openDrawer] = useAtom(drawerState);

  // Hide deprecated options
  if (props.language.deprecated && !props.selected) return null;

  return (
    <BaseSelectionOption
      leftSection={
        <Group wrap='nowrap' gap={5}>
          <Box pl={8}>
            <Text fz='sm'>{props.language.name}</Text>
          </Box>
          {/* @ts-ignore */}
          {props.language._is_core && (
            <ThemeIcon variant='light' size='xs' radius='xl'>
              <IconCheck style={{ width: '70%', height: '70%' }} />
            </ThemeIcon>
          )}
        </Group>
      }
      rightSection={
        <TraitsDisplay
          justify='flex-end'
          size='xs'
          traitIds={[]}
          rarity={props.language.rarity}
          availability={props.language.availability ?? undefined}
        />
      }
      showButton={props.showButton}
      selected={props.selected}
      onClick={() =>
        openDrawer({
          type: 'language',
          data: { zIndex: 1600,
            id: props.language.id,
            onSelect:
              props.showButton || props.showButton === undefined ? () => props.onClick(props.language) : undefined,
          },
          extra: { addToHistory: true },
        })
      }
      buttonTitle='Select'
      disableButton={props.selected}
      onButtonClick={() => props.onClick(props.language)}
      includeOptions={props.includeOptions}
      onOptionsDelete={() => props.onDelete?.(props.language.id)}
      onOptionsCopy={() => props.onCopy?.(props.language.id)}
    />
  );
}

export function ClassArchetypeSelectionOption(props: {
  classArchetype: ClassArchetype;
  onClick: (classArchetype: ClassArchetype) => void;
  selected?: boolean;
  showButton?: boolean;
  includeOptions?: boolean;
  onDelete?: (id: number) => void;
  onCopy?: (id: number) => void;
}) {
  const [_drawer, openDrawer] = useAtom(drawerState);

  // Hide deprecated options
  if (props.classArchetype.deprecated && !props.selected) return null;

  console.log('Rendering ClassArchetypeSelectionOption for', props.classArchetype);

  return (
    <BaseSelectionOption
      leftSection={
        <Group wrap='nowrap' gap={5}>
          <Box pl={8}>
            <Text fz='sm'>{props.classArchetype.name}</Text>
          </Box>
        </Group>
      }
      rightSection={<TraitsDisplay justify='flex-end' size='xs' traitIds={[]} rarity={props.classArchetype.rarity} />}
      showButton={props.showButton}
      selected={props.selected}
      onClick={() => {
        // If is 'Base Class (No Archetype)' option,
        if (props.classArchetype.id === -999) {
          // Just show the normal base class drawer
          openDrawer({
            type: 'class',
            data: { zIndex: 1600,
              id: props.classArchetype.class_id,
            },
            extra: { addToHistory: true },
          });
        } else {
          openDrawer({
            type: 'class-archetype',
            data: { zIndex: 1600,
              id: props.classArchetype.id,
            },
            extra: { addToHistory: true },
          });
        }
      }}
      buttonTitle='Select'
      disableButton={props.selected}
      onButtonClick={() => props.onClick(props.classArchetype)}
      includeOptions={props.includeOptions}
      onOptionsDelete={() => props.onDelete?.(props.classArchetype.id)}
      onOptionsCopy={() => props.onCopy?.(props.classArchetype.id)}
    />
  );
}

export function CreatureSelectionOption(props: {
  creature: Creature;
  onClick: (creature: Creature) => void;
  selected?: boolean;
  hasSelected?: boolean;
  showButton?: boolean;
  includeOptions?: boolean;
  onDelete?: (id: number) => void;
  onCopy?: (id: number) => void;
}) {
  const [_drawer, openDrawer] = useAtom(drawerState);
  const [_creatureDrawer, openCreatureDrawer] = useAtom(creatureDrawerState);

  // Hide deprecated options
  if (props.creature.deprecated && !props.selected) return null;

  return (
    <BaseSelectionOption
      leftSection={
        <Group ml={8} wrap='nowrap'>
          <Avatar
            src={props.creature.details.image_url}
            radius='sm'
            styles={{
              image: {
                objectFit: 'contain',
              },
            }}
          />
          <div style={{ flex: 1 }}>
            <Text size='sm' fw={500}>
              {props.creature.name}
            </Text>

            <Group gap={5}>
              {/* {props.creature.family_type && (
              <Badge
                variant='dot'
                size='xs'
                styles={{
                  root: {
                    // @ts-ignore
                    '--badge-dot-size': 0,
                    textTransform: 'initial',
                  },
                }}
                c='gray.6'
              >
                {props.creature.family_type}
              </Badge>
            )} */}
              {/* <Badge
              variant='dot'
              size='xs'
              styles={{
                root: {
                  // @ts-ignore
                  '--badge-dot-size': 0,
                },
              }}
              c='gray.6'
            >
              AC {props.creature.stats?.ac}
            </Badge> */}
              {/* <Badge
              variant='dot'
              size='xs'
              styles={{
                root: {
                  // @ts-ignore
                  '--badge-dot-size': 0,
                },
              }}
              c='gray.6'
            >
              {props.creature.stats?.hp.max} HP
            </Badge> */}
            </Group>
          </div>
        </Group>
      }
      // rightSection={
      //   <TraitsDisplay
      //     justify='flex-end'
      //     size='xs'
      //     traitIds={props.creature.traits ?? []}
      //     rarity={props.creature.rarity}
      //   />
      // }
      showButton={props.showButton}
      selected={props.selected}
      level={getEntityLevel(props.creature)}
      onClick={() =>
        openCreatureDrawer({
          data: {
            id: props.creature.id,
            readOnly: true,
          },
        })
      }
      buttonOverride={
        <Button.Group>
          <Button
            size='compact-xs'
            variant='filled'
            onClick={(e) => {
              e.stopPropagation();
              props.onClick(props.creature);
            }}
            styles={{
              section: {
                marginLeft: 3,
              },
            }}
          >
            Select
          </Button>
          <Menu shadow='md' zIndex={1000}>
            <Menu.Target>
              <Button
                size='compact-xs'
                variant='filled'
                style={{
                  borderLeft: '1px solid',
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                }}
              >
                <IconChevronDown size='1.2rem' />
              </Button>
            </Menu.Target>

            <Menu.Dropdown>
              <Menu.Item
                onClick={(e) => {
                  e.stopPropagation();
                  props.onClick(adjustCreature(props.creature, 'ELITE'));
                }}
              >
                Elite
              </Menu.Item>
              <Menu.Item
                onClick={(e) => {
                  e.stopPropagation();
                  props.onClick(adjustCreature(props.creature, 'WEAK'));
                }}
              >
                Weak
              </Menu.Item>
            </Menu.Dropdown>
          </Menu>
        </Button.Group>
      }
      buttonTitle='Select'
      disableButton={props.selected}
      //onButtonClick={() => props.onClick(props.creature)}
      includeOptions={props.includeOptions}
      onOptionsDelete={() => props.onDelete?.(props.creature.id)}
      onOptionsCopy={() => props.onCopy?.(props.creature.id)}
    />
  );
}
