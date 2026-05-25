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
        data: { id: selected?.id },
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

  openContextModal({
    modal: 'selectContent',
    title: <Title order={3}>{label}</Title>,
    zIndex: options?.zIndex ?? 499,
    // Mantine's size= would override our explicit width via CSS vars,
    // so we pass undefined and let the styles.content width win.
    size: undefined,
    classNames: resizable.classNames,
    styles: resizable.styles,
    innerProps: {
      type,
      onClick: onClick ? (option: any) => onClick(option as T) : undefined,
      options,
    },
  });
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
}>) {
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
  const [filtersOpen, setFiltersOpen] = useState(false);

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

  const filterCount = activeFilterCount(filterState, innerProps.type, innerProps.options?.abilityBlockType);

  const typeName = toLabel(innerProps.options?.abilityBlockType || innerProps.type);

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

  const getSelectionContents = (selectionOptions: React.ReactNode) => {
    return (
      // flex-fill chain: this Stack stretches inside the outer flex Box
      // (see line ~1038) so the filter panel / option list below can
      // flex-1 themselves. Without this the panel collapses to its
      // intrinsic height and leaves a dead-space gap below.
      <Stack gap={10} style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        {/* Search row: input + Filters toggle button, both same height. The
            Filters button is sized to match the TextInput visually so they
            read as siblings rather than search-plus-tiny-action. The body
            below this row swaps between the result list and the filter
            panel based on `filtersOpen` — toggling Filters reveals the
            panel; toggling again returns to the results. The advanced
            search modal is gone — everything filterable now lives in the
            unified filter panel. */}
        <Group wrap='nowrap' gap={8}>
          <FocusTrap active={true}>
            <TextInput
              data-autofocus
              style={{ flex: 1 }}
              size='md'
              leftSection={<IconSearch size='0.9rem' />}
              placeholder={`Search ${pluralize(typeName.toLowerCase())}`}
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              rightSection={
                searchQuery.trim() ? (
                  <ActionIcon
                    variant='subtle'
                    size='md'
                    color='gray'
                    radius='xl'
                    aria-label='Clear search'
                    onClick={() => {
                      setSearchQuery('');
                    }}
                  >
                    <IconX size='1.2rem' stroke={2} />
                  </ActionIcon>
                ) : undefined
              }
              styles={{
                input: {
                  borderColor: searchQuery.trim().length > 0 ? theme.colors['guide'][8] : undefined,
                },
              }}
            />
          </FocusTrap>
          {/* Custom-select mode (attribute boost / skill prof picks) has
              no filterable content — just hide the button entirely. */}
          {!isCustomSelectMode && (
            <Indicator
              color={theme.primaryColor}
              label={filterCount > 0 ? filterCount : undefined}
              disabled={filterCount === 0}
              size={16}
              offset={6}
            >
              <Button
                size='md'
                variant={filtersOpen ? 'filled' : 'default'}
                color={filtersOpen ? theme.primaryColor : undefined}
                leftSection={<IconFilter size='1rem' />}
                rightSection={
                  filtersOpen ? <IconChevronUp size='0.9rem' stroke={2.5} /> : <IconChevronDown size='0.9rem' stroke={2.5} />
                }
                onClick={() => setFiltersOpen((o) => !o)}
                aria-expanded={filtersOpen}
              >
                Filters
              </Button>
            </Indicator>
          )}
        </Group>

        {/* Filter panel and result list are now MUTUALLY EXCLUSIVE
            — when filters open, they fill the whole modal body and
            the result list is hidden; when filters close, the
            result list comes back. This matches the AddItemsModal
            UX and the user's explicit preference: "filters take
            the entire popup; closing filters shows the results."
            Reset / Done buttons sit at the bottom of the filter
            panel so the player has both a one-click way to clear
            and a clear way back to results without having to find
            the toolbar Filters button again. */}
        {filtersOpen && !isCustomSelectMode ? (
          <Box
            p='sm'
            style={{
              backgroundColor: IMPRINT_BG_COLOR,
              border: `1px solid ${IMPRINT_BORDER_COLOR}`,
              borderRadius: theme.radius.md,
              flex: 1,
              minHeight: 0,
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
            }}
          >
            <Box style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
              <SelectContentFilters
                type={innerProps.type}
                abilityBlockType={innerProps.options?.abilityBlockType}
                featType={featType}
                state={filterState}
                onChange={setFilterState}
                maxLevel={optionMaxLevel}
                maxRank={optionMaxRank}
                spellDomain={spellFilterDomain}
                allowedTraitIds={allowedTraitIds}
              />
            </Box>
            <Group
              justify='space-between'
              wrap='nowrap'
              gap={8}
              pt='sm'
              mt='sm'
              style={{ borderTop: `1px solid ${IMPRINT_BORDER_COLOR}`, flex: '0 0 auto' }}
            >
              <Button
                size='sm'
                variant='default'
                onClick={() => setFilterState({ ...DEFAULT_FILTER_STATE })}
                disabled={filterCount === 0}
              >
                Reset filters{filterCount > 0 ? ` (${filterCount})` : ''}
              </Button>
              <Button
                size='sm'
                variant='filled'
                color={theme.primaryColor}
                onClick={() => setFiltersOpen(false)}
              >
                Done — show results
              </Button>
            </Group>
          </Box>
        ) : (
          selectionOptions
        )}
      </Stack>
    );
  };

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

  return (
    // Stack + inner Box now flex-fill the modal body. The previous
    // implementation pinned the Box to a fixed 620/700px height which
    // left dead space at the bottom whenever the user-resizable modal
    // was taller than that — exactly what the user was seeing in the
    // Add Spell / Add Item screenshots. With flex:1 + minHeight:0 the
    // option list (or the filter panel) grows to whatever vertical
    // space the modal frame gives us.
    <Stack style={{ flex: 1, minHeight: 0 }} gap={10}>
      {innerProps.options?.description}
      <Box style={{ position: 'relative', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        {isClassFeat && (
          <Tabs value={classFeatTab} onChange={setClassFeatTab}>
            <Tabs.List grow mb={10}>
              <Tabs.Tab value='class-feat'>Class Feats</Tabs.Tab>
              <Tabs.Tab value='archetype-feat'>Archetype Feats</Tabs.Tab>
              <Tabs.Tab value='add-dedication'>Add Dedication</Tabs.Tab>
            </Tabs.List>

            <Tabs.Panel value='class-feat'>
              <Box>
                {getSelectionContents(
                  <SelectionOptions
                    type={innerProps.type}
                    abilityBlockType={innerProps.options?.abilityBlockType}
                    skillAdjustment={innerProps.options?.skillAdjustment}
                    selectedId={innerProps.options?.selectedId}
                    overrideOptions={innerProps.options?.overrideOptions}
                    searchQuery={searchQueryDebounced}
                    onClick={
                      innerProps.onClick
                        ? (option) => {
                            innerProps.onClick!(option);
                            context.closeModal(id);
                          }
                        : undefined
                    }
                    filterFn={getMergedFilterFn()}
                    includeOptions={innerProps.options?.includeOptions}
                    showButton={innerProps.options?.showButton}
                    limitSelectedOptions={true}
                  />
                )}
              </Box>
            </Tabs.Panel>

            <Tabs.Panel value='archetype-feat'>
              <Box>
                {getSelectionContents(
                  <SelectionOptions
                    type='ability-block'
                    abilityBlockType='feat'
                    selectedId={innerProps.options?.selectedId}
                    searchQuery={searchQueryDebounced}
                    onClick={
                      innerProps.onClick
                        ? (option) => {
                            innerProps.onClick!({
                              ...option,
                              // Need this for selection ops to work correctly
                              // since we're not using the override options
                              _select_uuid: `${option.id}`,
                              _content_type: 'ability-block',
                            } satisfies ObjectWithUUID);
                            context.closeModal(id);
                          }
                        : undefined
                    }
                    filterFn={(option) =>
                      intersection(
                        getAllArchetypeTraitVariables('CHARACTER').map((v) => v.value) ?? [],
                        option.traits ?? []
                      ).length > 0 && option.level <= classFeatSourceLevel
                    }
                    includeOptions={innerProps.options?.includeOptions}
                    showButton={innerProps.options?.showButton}
                    limitSelectedOptions={true}
                  />
                )}
              </Box>
            </Tabs.Panel>

            <Tabs.Panel value='add-dedication'>
              <Box>
                {getSelectionContents(
                  <SelectionOptions
                    type='ability-block'
                    abilityBlockType='feat'
                    selectedId={innerProps.options?.selectedId}
                    searchQuery={searchQueryDebounced}
                    onClick={
                      innerProps.onClick
                        ? (option) => {
                            innerProps.onClick!({
                              ...option,
                              // Need this for selection ops to work correctly
                              // since we're not using the override options
                              _select_uuid: `${option.id}`,
                              _content_type: 'ability-block',
                            } satisfies ObjectWithUUID);
                            context.closeModal(id);
                          }
                        : undefined
                    }
                    filterFn={(option) =>
                      hasTraitType('DEDICATION', option.traits) && option.level <= classFeatSourceLevel
                    }
                    includeOptions={innerProps.options?.includeOptions}
                    showButton={innerProps.options?.showButton}
                    limitSelectedOptions={true}
                  />
                )}
              </Box>
            </Tabs.Panel>
          </Tabs>
        )}

        {isHeritage && (
          <Tabs value={versHeritageTab} onChange={setVersHeritageTab}>
            <Tabs.List grow mb={10}>
              <Tabs.Tab value='ancestry-heritage'>Ancestry Heritages</Tabs.Tab>
              <Tabs.Tab value='versatile-heritage'>Versatile Heritages</Tabs.Tab>
            </Tabs.List>

            <Tabs.Panel value='ancestry-heritage'>
              <Box>
                {getSelectionContents(
                  <SelectionOptions
                    type={innerProps.type}
                    abilityBlockType={innerProps.options?.abilityBlockType}
                    skillAdjustment={innerProps.options?.skillAdjustment}
                    selectedId={innerProps.options?.selectedId}
                    overrideOptions={innerProps.options?.overrideOptions}
                    searchQuery={searchQueryDebounced}
                    onClick={
                      innerProps.onClick
                        ? (option) => {
                            innerProps.onClick!(option);
                            context.closeModal(id);
                          }
                        : undefined
                    }
                    filterFn={(option) =>
                      getMergedFilterFn() && !versHeritageData?.versHeritages.find((v) => v.heritage_id === option.id)
                    }
                    includeOptions={innerProps.options?.includeOptions}
                    showButton={innerProps.options?.showButton}
                    limitSelectedOptions={true}
                  />
                )}
              </Box>
            </Tabs.Panel>

            <Tabs.Panel value='versatile-heritage'>
              <Box>
                {getSelectionContents(
                  <SelectionOptions
                    type='ability-block'
                    abilityBlockType='heritage'
                    selectedId={innerProps.options?.selectedId}
                    searchQuery={searchQueryDebounced}
                    onClick={
                      innerProps.onClick
                        ? (option) => {
                            innerProps.onClick!({
                              ...option,
                              // Need this for selection ops to work correctly
                              // since we're not using the override options
                              _select_uuid: `${option.id}`,
                              _content_type: 'ability-block',
                            } satisfies ObjectWithUUID);
                            context.closeModal(id);
                          }
                        : undefined
                    }
                    filterFn={(option) => !!versHeritageData?.versHeritages.find((v) => v.heritage_id === option.id)}
                    includeOptions={innerProps.options?.includeOptions}
                    showButton={innerProps.options?.showButton}
                    limitSelectedOptions={true}
                  />
                )}
              </Box>
            </Tabs.Panel>
          </Tabs>
        )}

        {isAncestryFeat && (
          <Tabs value={ancestryFeatTab} onChange={setAncestryFeatTab}>
            <Tabs.List grow mb={10}>
              <Tabs.Tab value='ancestry-feat'>Ancestry Feats</Tabs.Tab>
              <Tabs.Tab value='universal-ancestry-feat'>Universal Ancestry Feats</Tabs.Tab>
            </Tabs.List>

            <Tabs.Panel value='ancestry-feat'>
              <Box>
                {getSelectionContents(
                  <SelectionOptions
                    type={innerProps.type}
                    abilityBlockType={innerProps.options?.abilityBlockType}
                    skillAdjustment={innerProps.options?.skillAdjustment}
                    selectedId={innerProps.options?.selectedId}
                    overrideOptions={innerProps.options?.overrideOptions}
                    searchQuery={searchQueryDebounced}
                    onClick={
                      innerProps.onClick
                        ? (option) => {
                            innerProps.onClick!(option);
                            context.closeModal(id);
                          }
                        : undefined
                    }
                    filterFn={getMergedFilterFn()}
                    includeOptions={innerProps.options?.includeOptions}
                    showButton={innerProps.options?.showButton}
                    limitSelectedOptions={true}
                  />
                )}
              </Box>
            </Tabs.Panel>

            <Tabs.Panel value='universal-ancestry-feat'>
              <Box>
                {getSelectionContents(
                  <SelectionOptions
                    type='ability-block'
                    abilityBlockType='feat'
                    selectedId={innerProps.options?.selectedId}
                    searchQuery={searchQueryDebounced}
                    onClick={
                      innerProps.onClick
                        ? (option) => {
                            innerProps.onClick!({
                              ...option,
                              // Mirror the class-feat fallthrough pattern: when we
                              // hand back a feat the parent didn't pre-list, we have
                              // to synthesize the bookkeeping ids the selection ops
                              // engine reads.
                              _select_uuid: `${option.id}`,
                              _content_type: 'ability-block',
                            } satisfies ObjectWithUUID);
                            context.closeModal(id);
                          }
                        : undefined
                    }
                    filterFn={(option) => {
                      // Name whitelist — see UNIVERSAL_ANCESTRY_FEAT_NAMES above.
                      if (!UNIVERSAL_ANCESTRY_FEAT_NAMES.has(((option.name || '') as string).toLowerCase())) {
                        return false;
                      }
                      // Level gate — ancestry feat slots only accept feats at or
                      // below the slot's source level. PF2e ancestry feats only
                      // exist at levels 1/5/9/13/17 so <= naturally clamps to those.
                      const lvl = option.level;
                      if (lvl !== undefined && lvl !== null && lvl > ancestryFeatSourceLevel) return false;
                      return true;
                    }}
                    includeOptions={innerProps.options?.includeOptions}
                    showButton={innerProps.options?.showButton}
                    limitSelectedOptions={true}
                  />
                )}
              </Box>
            </Tabs.Panel>
          </Tabs>
        )}

        {!(isClassFeat || isHeritage || isAncestryFeat) && (
          <Box style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
            {getSelectionContents(
              <SelectionOptions
                type={innerProps.type}
                abilityBlockType={innerProps.options?.abilityBlockType}
                skillAdjustment={innerProps.options?.skillAdjustment}
                selectedId={innerProps.options?.selectedId}
                overrideOptions={innerProps.options?.overrideOptions}
                searchQuery={searchQueryDebounced}
                onClick={
                  innerProps.onClick
                    ? (option) => {
                        innerProps.onClick!(option);
                        context.closeModal(id);
                      }
                    : undefined
                }
                filterFn={getMergedFilterFn()}
                includeOptions={innerProps.options?.includeOptions}
                showButton={innerProps.options?.showButton}
                limitSelectedOptions={!!innerProps.options?.overrideOptions}
              />
            )}
          </Box>
        )}
      </Box>
    </Stack>
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
            data: {
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
          data: {
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
          data: {
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
          data: {
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
          data: {
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
          data: {
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
          data: {
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
          data: {
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
          data: {
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
          data: {
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
          data: {
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
          data: {
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
          data: {
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
                data: {
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
                data: {
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
          data: {
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
          data: {
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
            data: {
              id: props.classArchetype.class_id,
            },
            extra: { addToHistory: true },
          });
        } else {
          openDrawer({
            type: 'class-archetype',
            data: {
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
