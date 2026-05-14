// Unified filter panel for the content picker. Replaces what used to be the
// split "Filters + Advanced Search" pair — everything filterable now lives
// here.
//
// Three-state chips replace the boolean Mantine Chip throughout:
//   0 clicks → neutral (chip is greyed out, contributes no filter)
//   1 click  → include (green, option must match)
//   2 clicks → exclude (red, option must NOT match)
//   3 clicks → back to neutral
// This mirrors Archives of Nethys's filter UI and lets the user say
// "Common but not Rare" in two chip clicks without a separate "exclude"
// mode toggle.
//
// Feat searches additionally surface a different filter set per feat type:
//   skill feats    → rarity + actions + level + skills + traits + prereq
//   general feats  → rarity + actions + level + traits + prereq (no skill)
//   class feats    → level + rarity + prereq only
//   ancestry feats → level + rarity + prereq only
//   other feats    → everything except the skill block
// Class / ancestry feats deliberately drop the action-cost / trait blocks
// because they nearly always have the class or ancestry trait already
// applied as a precondition, and the rest is noise.
//
// State lives in SelectContentModal; this component is purely controlled.

import {
  Box,
  Button,
  Group,
  RangeSlider,
  SegmentedControl,
  Stack,
  Text,
  TextInput,
} from '@mantine/core';
import {
  ActionCost,
  AbilityBlockType,
  Availability,
  ContentType,
  ItemGroup,
  Rarity,
  Size,
  Trait,
} from '@schemas/content';
import { IconCheck, IconMinus } from '@tabler/icons-react';
import { ReactNode } from 'react';
import TraitsInput from '@common/TraitsInput';
import { SpellFilterDomain, formatDurationSec, formatFeet } from './spell-filter-domain';

export type TriState = 'include' | 'exclude';

// Sparse tri-state map: a missing key = neutral (no filter). Only keys
// flipped to include/exclude appear in the map.
export type TriStateMap<K> = Map<K, TriState>;

// Feat type detection — narrowed at the SelectContentModal level by
// peeking at the first option's traits. Anything we can't classify falls
// back to 'other', which surfaces the broadest filter set.
export type FeatType = 'skill' | 'general' | 'class' | 'ancestry' | 'other';

export type SpellType = 'NORMAL' | 'FOCUS' | 'RITUAL';

export type ContentFilterState = {
  // Tri-state chip filters
  rarities: TriStateMap<Rarity>;
  availabilities: TriStateMap<Availability>;
  actions: TriStateMap<ActionCost>;
  skills: TriStateMap<string>;                 // uppercase skill name
  traditions: TriStateMap<string>;             // ARCANE/DIVINE/OCCULT/PRIMAL
  sizes: TriStateMap<Size>;
  itemGroups: TriStateMap<ItemGroup>;
  spellTypes: TriStateMap<SpellType>;

  // Modes for multi-value filters that ask "AND/OR" semantics.
  skillsMode: 'AND' | 'OR';

  // Numeric ranges
  levelMin: number;
  levelMax: number;
  rankMin: number;
  rankMax: number;

  // Traits: AND-match (option must include every selected trait). The
  // option's `traits` field is an array of trait IDs; we match on IDs.
  traits: number[];

  // Free-text searches (case-insensitive substring match against the field)
  description: string;
  cast: string;
  defense: string;
  targets: string;
  frequency: string;
  trigger: string;
  requirements: string;
  usage: string;
  hands: string;
  bulk: string;
  craftRequirements: string;
  prerequisitesText: string;

  // Spell range / area / duration are sliders, not text inputs. null =
  // inactive (no filter applied); [min, max] = active. The slider's
  // available values are computed from the option list at render time
  // — see SpellFilterDomain. parseDistanceFt / parseAreaFt /
  // parseDurationSec do the actual matching.
  rangeFt: [number, number] | null;
  areaFt: [number, number] | null;
  durationSec: [number, number] | null;

  // Prereq tri-state. 'must-meet' = only feats whose prereqs are met or
  // are absent. 'must-not-meet' = only feats whose prereqs we don't meet
  // (useful for shopping for future level-ups). 'neutral' = show all.
  prereqs: 'neutral' | 'must-meet' | 'must-not-meet';
};

export const DEFAULT_FILTER_STATE: ContentFilterState = {
  rarities: new Map(),
  availabilities: new Map(),
  actions: new Map(),
  skills: new Map(),
  traditions: new Map(),
  sizes: new Map(),
  itemGroups: new Map(),
  spellTypes: new Map(),
  skillsMode: 'OR',
  levelMin: 0,
  levelMax: 25,
  rankMin: 0,
  rankMax: 10,
  traits: [],
  description: '',
  cast: '',
  defense: '',
  targets: '',
  frequency: '',
  trigger: '',
  requirements: '',
  usage: '',
  hands: '',
  bulk: '',
  craftRequirements: '',
  prerequisitesText: '',
  rangeFt: null,
  areaFt: null,
  durationSec: null,
  // Default for feat searches: only show feats the character actually
  // qualifies for. Toggle to 'neutral' to see everything (with X marker).
  prereqs: 'must-meet',
};

const RARITY_OPTIONS: Rarity[] = ['COMMON', 'UNCOMMON', 'RARE', 'UNIQUE'];
const AVAILABILITY_OPTIONS: Availability[] = ['STANDARD', 'LIMITED', 'RESTRICTED'];
const SIZE_OPTIONS: Size[] = ['TINY', 'SMALL', 'MEDIUM', 'LARGE', 'HUGE', 'GARGANTUAN'];
const ITEM_GROUP_OPTIONS: ItemGroup[] = ['GENERAL', 'ARMOR', 'SHIELD', 'WEAPON', 'RUNE', 'UPGRADE', 'MATERIAL'];
const TRADITION_OPTIONS = ['ARCANE', 'DIVINE', 'OCCULT', 'PRIMAL'] as const;
const SPELL_TYPE_OPTIONS: SpellType[] = ['NORMAL', 'FOCUS', 'RITUAL'];

const SKILL_OPTIONS = [
  'Acrobatics', 'Arcana', 'Athletics', 'Crafting',
  'Deception', 'Diplomacy', 'Intimidation', 'Lore',
  'Medicine', 'Nature', 'Occultism', 'Performance',
  'Religion', 'Society', 'Stealth', 'Survival', 'Thievery',
];

// Count active (non-default) filter dimensions, used for the
// "Filters (N)" indicator on the modal's filter toggle button.
export function activeFilterCount(s: ContentFilterState, type: ContentType, ab?: AbilityBlockType): number {
  let n = 0;
  if (s.rarities.size > 0) n++;
  if (s.availabilities.size > 0) n++;
  if (s.actions.size > 0) n++;
  if (s.skills.size > 0) n++;
  if (s.traditions.size > 0) n++;
  if (s.sizes.size > 0) n++;
  if (s.itemGroups.size > 0) n++;
  if (s.spellTypes.size > 0) n++;
  if (s.prereqs !== DEFAULT_FILTER_STATE.prereqs) n++;
  if ((type === 'item' || type === 'creature' || ab === 'feat' || ab === 'class-feature') &&
      (s.levelMin !== DEFAULT_FILTER_STATE.levelMin || s.levelMax !== DEFAULT_FILTER_STATE.levelMax)) n++;
  if (type === 'spell' &&
      (s.rankMin !== DEFAULT_FILTER_STATE.rankMin || s.rankMax !== DEFAULT_FILTER_STATE.rankMax)) n++;
  if (s.traits.length > 0) n++;
  // Spell range / area / duration sliders. null = inactive.
  if (s.rangeFt !== null) n++;
  if (s.areaFt !== null) n++;
  if (s.durationSec !== null) n++;
  // Each non-empty free-text filter is one active dimension.
  for (const key of FREE_TEXT_KEYS) {
    if ((s[key] ?? '').trim() !== '') n++;
  }
  return n;
}

// Keys whose value is a free-text string; iterating these makes both the
// counter and the apply-fn easier to keep in sync.
const FREE_TEXT_KEYS = [
  'description', 'cast', 'defense', 'targets',
  'frequency', 'trigger', 'requirements',
  'usage', 'hands', 'bulk', 'craftRequirements', 'prerequisitesText',
] as const satisfies readonly (keyof ContentFilterState)[];

// ---------------------------------------------------------------------------
// Tri-state chip
// ---------------------------------------------------------------------------

// Cycle: neutral → include → exclude → neutral.
function nextState(s: TriState | undefined): TriState | undefined {
  if (s === undefined) return 'include';
  if (s === 'include') return 'exclude';
  return undefined;
}

function TriChip(props: {
  label: ReactNode;
  state: TriState | undefined;
  onClick: () => void;
}) {
  // Visual: outline for neutral, filled green for include, filled red for
  // exclude. Right-icon hints at the action without taking much space.
  const baseStyles = {
    borderRadius: 999,
    fontSize: 11,
    paddingLeft: 10,
    paddingRight: 8,
    height: 26,
    minHeight: 26,
    lineHeight: 1,
  } as const;
  const isInclude = props.state === 'include';
  const isExclude = props.state === 'exclude';
  return (
    <Button
      variant={isInclude || isExclude ? 'filled' : 'outline'}
      color={isExclude ? 'red.7' : isInclude ? 'teal.8' : 'gray.6'}
      size='compact-xs'
      onClick={props.onClick}
      styles={{ root: baseStyles, label: { fontWeight: 500 } }}
      rightSection={
        isInclude ? (
          <IconCheck size={11} stroke={3} />
        ) : isExclude ? (
          <IconMinus size={11} stroke={3} />
        ) : (
          <Box w={11} h={11} style={{ borderRadius: 999, border: '1.5px solid currentColor', opacity: 0.6 }} />
        )
      }
    >
      {props.label}
    </Button>
  );
}

// Helper: toggle a key in a tri-state map and return the next map.
function toggleKey<K>(map: TriStateMap<K>, key: K): TriStateMap<K> {
  const next = new Map(map);
  const ns = nextState(next.get(key));
  if (ns === undefined) next.delete(key);
  else next.set(key, ns);
  return next;
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function SelectContentFilters(props: {
  type: ContentType;
  abilityBlockType?: AbilityBlockType;
  // For feat searches, narrows the visible filter blocks to match feat
  // type. Pass undefined for non-feat searches.
  featType?: FeatType;
  state: ContentFilterState;
  onChange: (next: ContentFilterState) => void;
  // Dynamic upper bound for the Level slider. Defaults to 20 (or 25 for
  // creatures). Pass the highest level among the actual options so the
  // slider only spans levels the user could pick — e.g. a level-3 feat
  // selection caps the slider at 3.
  maxLevel?: number;
  // Same idea for spell rank.
  maxRank?: number;
  // Domain values for the spell-specific Range / Area / Duration
  // sliders. Built from the current option list (see
  // buildSpellFilterDomain). The slider hides itself if the domain has
  // < 2 distinct values.
  spellDomain?: SpellFilterDomain;
  // Trait IDs that actually appear on the current option list. The
  // Traits autocomplete restricts to this set so the dropdown only
  // suggests traits the user can productively filter by — no item
  // traits in a feat picker, no dwarf trait in an elf ancestry feat
  // picker, etc. undefined = no restriction.
  allowedTraitIds?: number[];
}) {
  const { type, abilityBlockType: ab, featType, state, onChange } = props;
  const isFeat = ab === 'feat';
  const isItem = type === 'item';
  const isSpell = type === 'spell';
  const isCreature = type === 'creature';
  const isAbilityBlock = type === 'ability-block';

  // What sections to render. Action chips appear for every feat and every
  // spell now (class/ancestry feats included — the user wants action cost
  // visible on those too).
  const showRarity = !!ab || type !== 'trait';
  const showAvailability = !!ab || type !== 'trait';
  const showActions = isFeat || isSpell || ab === 'action' || ab === 'physical-feature';
  const showLevelRange = isItem || isCreature || ab === 'class-feature' || isFeat;
  const showRankRange = isSpell;
  const showTradition = isSpell;
  const showSpellType = isSpell;
  const showSkills = isFeat && featType === 'skill';
  const showPrereqs = isFeat || ab === 'class-feature';
  // Size is a structured field only on items. Creatures encode size as a
  // trait (Large, Huge, etc.), so size filtering for creatures should be
  // done via the trait filter — not a separate size chip group.
  const showSize = isItem;
  const showItemGroup = isItem;
  // Traits filter only makes sense for types whose options carry a
  // `traits` array. That's items, spells, ability-blocks, creatures,
  // ancestries.
  const showTraits = isItem || isSpell || isAbilityBlock || isCreature || type === 'ancestry';

  // Description is a meaningful free-text filter for almost every type that
  // has a description body. Skip it for traits (their descriptions are tiny
  // and search-by-name is enough).
  const showDescription = type !== 'trait';

  // Clamp the slider's upper bound to the actual content available. If the
  // caller passes a tighter range (e.g. only level-1 feats), the slider
  // shouldn't pretend you can pick level 5+. Default falls back to the
  // type-wide max.
  const defaultLevelMax = type === 'creature' ? 25 : 20;
  const levelSliderMax = Math.max(0, props.maxLevel ?? defaultLevelMax);
  const rankSliderMax = Math.max(0, props.maxRank ?? 10);

  const patch = (over: Partial<ContentFilterState>) => onChange({ ...state, ...over });

  return (
    <Stack gap='md'>
      {showDescription && (
        <FilterBlock title='Description'>
          <TextInput
            placeholder='Any text in the description, e.g. "Strike"'
            value={state.description}
            onChange={(e) => patch({ description: e.currentTarget.value })}
          />
        </FilterBlock>
      )}

      {showRarity && (
        <FilterBlock title='Rarity'>
          <Group gap={6} wrap='wrap'>
            {RARITY_OPTIONS.map((r) => (
              <TriChip
                key={r}
                label={toTitleCase(r)}
                state={state.rarities.get(r)}
                onClick={() => patch({ rarities: toggleKey(state.rarities, r) })}
              />
            ))}
          </Group>
        </FilterBlock>
      )}

      {showAvailability && (
        <FilterBlock title='Availability'>
          <Group gap={6} wrap='wrap'>
            {AVAILABILITY_OPTIONS.map((a) => (
              <TriChip
                key={a}
                label={toTitleCase(a)}
                state={state.availabilities.get(a)}
                onClick={() => patch({ availabilities: toggleKey(state.availabilities, a) })}
              />
            ))}
          </Group>
        </FilterBlock>
      )}

      {showTraits && (
        <FilterBlock title='Traits'>
          <TraitsInput
            placeholder='Add traits the option must have'
            traits={state.traits}
            onTraitChange={(ts: Trait[]) => patch({ traits: ts.map((t) => t.id) })}
            allowedTraitIds={props.allowedTraitIds}
          />
        </FilterBlock>
      )}

      {showActions && (
        <FilterBlock title='Actions / Cast time'>
          <Group gap={6} wrap='wrap'>
            {(
              [
                ['ONE-ACTION', '1 action'],
                ['TWO-ACTIONS', '2 actions'],
                ['THREE-ACTIONS', '3 actions'],
                ['FREE-ACTION', 'Free'],
                ['REACTION', 'Reaction'],
              ] as const
            ).map(([val, label]) => (
              <TriChip
                key={val}
                label={label}
                state={state.actions.get(val as ActionCost)}
                onClick={() => patch({ actions: toggleKey(state.actions, val as ActionCost) })}
              />
            ))}
          </Group>
        </FilterBlock>
      )}

      {showLevelRange && (
        <FilterBlock
          title={`Level: ${Math.min(state.levelMin, levelSliderMax)}–${Math.min(state.levelMax, levelSliderMax)}`}
        >
          <RangeSlider
            min={0}
            max={levelSliderMax}
            step={1}
            // minRange=0 lets the user squeeze both thumbs to the same level
            // so they can filter "exactly level 3" rather than being forced
            // to a 10-wide window. Mantine's default is 10.
            minRange={0}
            value={[Math.min(state.levelMin, levelSliderMax), Math.min(state.levelMax, levelSliderMax)]}
            onChange={(val) => patch({ levelMin: val[0], levelMax: val[1] })}
            size='sm'
          />
        </FilterBlock>
      )}

      {showRankRange && (
        <FilterBlock
          title={`Rank: ${Math.min(state.rankMin, rankSliderMax)}–${Math.min(state.rankMax, rankSliderMax)}`}
        >
          <RangeSlider
            min={0}
            max={rankSliderMax}
            step={1}
            minRange={0}
            value={[Math.min(state.rankMin, rankSliderMax), Math.min(state.rankMax, rankSliderMax)]}
            onChange={(val) => patch({ rankMin: val[0], rankMax: val[1] })}
            size='sm'
          />
        </FilterBlock>
      )}

      {showSkills && (
        <FilterBlock
          title='Skill'
          right={
            <SegmentedControl
              size='xs'
              value={state.skillsMode}
              onChange={(v) => patch({ skillsMode: v as 'AND' | 'OR' })}
              data={[
                { label: 'Any', value: 'OR' },
                { label: 'All', value: 'AND' },
              ]}
            />
          }
        >
          <Group gap={6} wrap='wrap'>
            {SKILL_OPTIONS.map((skill) => (
              <TriChip
                key={skill}
                label={skill}
                state={state.skills.get(skill.toUpperCase())}
                onClick={() => patch({ skills: toggleKey(state.skills, skill.toUpperCase()) })}
              />
            ))}
          </Group>
        </FilterBlock>
      )}

      {showTradition && (
        <FilterBlock title='Tradition'>
          <Group gap={6} wrap='wrap'>
            {TRADITION_OPTIONS.map((t) => (
              <TriChip
                key={t}
                label={toTitleCase(t)}
                state={state.traditions.get(t)}
                onClick={() => patch({ traditions: toggleKey(state.traditions, t) })}
              />
            ))}
          </Group>
        </FilterBlock>
      )}

      {showSpellType && (
        <FilterBlock title='Spell type'>
          <Group gap={6} wrap='wrap'>
            {SPELL_TYPE_OPTIONS.map((t) => (
              <TriChip
                key={t}
                label={toTitleCase(t)}
                state={state.spellTypes.get(t)}
                onClick={() => patch({ spellTypes: toggleKey(state.spellTypes, t) })}
              />
            ))}
          </Group>
        </FilterBlock>
      )}

      {/* Spell-specific filters. Range / Area / Duration are sliders
          whose available values come from the actual spells in the
          option list (props.spellDomain). Cast / Defense / Targets stay
          as free-text since their content is too irregular to slot
          onto a numeric axis. */}
      {isSpell && (
        <>
          <FilterBlock title='Cast'>
            <TextInput
              placeholder='Any cast text, e.g. "10 minutes"'
              value={state.cast}
              onChange={(e) => patch({ cast: e.currentTarget.value })}
            />
          </FilterBlock>
          <FilterBlock title='Defense'>
            <TextInput
              placeholder='Any defense, e.g. "basic Reflex"'
              value={state.defense}
              onChange={(e) => patch({ defense: e.currentTarget.value })}
            />
          </FilterBlock>

          <DataDrivenSlider
            title='Range'
            domain={props.spellDomain?.range ?? []}
            value={state.rangeFt}
            onChange={(v) => patch({ rangeFt: v })}
            formatLabel={formatFeet}
          />
          <DataDrivenSlider
            title='Area'
            domain={props.spellDomain?.area ?? []}
            value={state.areaFt}
            onChange={(v) => patch({ areaFt: v })}
            formatLabel={formatFeet}
          />
          <DataDrivenSlider
            title='Duration'
            domain={props.spellDomain?.duration ?? []}
            value={state.durationSec}
            onChange={(v) => patch({ durationSec: v })}
            formatLabel={formatDurationSec}
          />

          <FilterBlock title='Targets'>
            <TextInput
              placeholder='Any targets, e.g. "1 creature"'
              value={state.targets}
              onChange={(e) => patch({ targets: e.currentTarget.value })}
            />
          </FilterBlock>
        </>
      )}

      {/* Frequency: ability blocks (action/feat/physical-feature) only. */}
      {isAbilityBlock && (ab === 'action' || ab === 'feat' || ab === 'physical-feature') && (
        <FilterBlock title='Frequency'>
          <TextInput
            placeholder='Any frequency, e.g. "once per day"'
            value={state.frequency}
            onChange={(e) => patch({ frequency: e.currentTarget.value })}
          />
        </FilterBlock>
      )}

      {/* Trigger / Requirements: spell + action/feat/physical-feature. */}
      {(isSpell || (isAbilityBlock && (ab === 'action' || ab === 'feat' || ab === 'physical-feature'))) && (
        <>
          <FilterBlock title='Trigger'>
            <TextInput
              placeholder='Any trigger, e.g. "you take damage"'
              value={state.trigger}
              onChange={(e) => patch({ trigger: e.currentTarget.value })}
            />
          </FilterBlock>
          <FilterBlock title='Requirements'>
            <TextInput
              placeholder='Any requirements, e.g. "you have a free hand"'
              value={state.requirements}
              onChange={(e) => patch({ requirements: e.currentTarget.value })}
            />
          </FilterBlock>
        </>
      )}

      {/* Prerequisites text + Meets-prerequisites filter (feats only). */}
      {isFeat && (
        <FilterBlock title='Prerequisites text'>
          <TextInput
            placeholder='Any prerequisite text, e.g. "trained in Diplomacy"'
            value={state.prerequisitesText}
            onChange={(e) => patch({ prerequisitesText: e.currentTarget.value })}
          />
        </FilterBlock>
      )}

      {showPrereqs && (
        <FilterBlock title='Meets prerequisites'>
          <SegmentedControl
            size='xs'
            value={state.prereqs}
            onChange={(v) => patch({ prereqs: v as ContentFilterState['prereqs'] })}
            data={[
              { label: 'Met (or none)', value: 'must-meet' },
              { label: 'Not met', value: 'must-not-meet' },
              { label: 'Show all', value: 'neutral' },
            ]}
          />
        </FilterBlock>
      )}

      {/* Item-specific filters. */}
      {showItemGroup && (
        <FilterBlock title='Item group'>
          <Group gap={6} wrap='wrap'>
            {ITEM_GROUP_OPTIONS.map((g) => (
              <TriChip
                key={g}
                label={toTitleCase(g)}
                state={state.itemGroups.get(g)}
                onClick={() => patch({ itemGroups: toggleKey(state.itemGroups, g) })}
              />
            ))}
          </Group>
        </FilterBlock>
      )}

      {isItem && (
        <>
          <FilterBlock title='Usage'>
            <TextInput
              placeholder='Any usage, e.g. "held in one hand"'
              value={state.usage}
              onChange={(e) => patch({ usage: e.currentTarget.value })}
            />
          </FilterBlock>
          <FilterBlock title='Hands'>
            <TextInput
              placeholder='Any hands, e.g. "1+"'
              value={state.hands}
              onChange={(e) => patch({ hands: e.currentTarget.value })}
            />
          </FilterBlock>
          <FilterBlock title='Bulk'>
            <TextInput
              placeholder='Any bulk, e.g. "1" or "0.1" (for L)'
              value={state.bulk}
              onChange={(e) => patch({ bulk: e.currentTarget.value })}
            />
          </FilterBlock>
          <FilterBlock title='Craft requirements'>
            <TextInput
              placeholder='Any text, e.g. "duskwood worth at least 55 gp"'
              value={state.craftRequirements}
              onChange={(e) => patch({ craftRequirements: e.currentTarget.value })}
            />
          </FilterBlock>
        </>
      )}

      {/* Size (items + creatures). */}
      {showSize && (
        <FilterBlock title='Size'>
          <Group gap={6} wrap='wrap'>
            {SIZE_OPTIONS.map((s) => (
              <TriChip
                key={s}
                label={toTitleCase(s)}
                state={state.sizes.get(s)}
                onClick={() => patch({ sizes: toggleKey(state.sizes, s) })}
              />
            ))}
          </Group>
        </FilterBlock>
      )}
    </Stack>
  );
}

// Small section wrapper to keep the markup readable + consistent spacing.
function FilterBlock(props: { title: string; right?: ReactNode; children: ReactNode }) {
  return (
    <Box>
      <Group justify='space-between' align='center' mb={6}>
        <Text fz='xs' fw={700} c='gray.2' tt='uppercase' style={{ letterSpacing: 0.5 }}>
          {props.title}
        </Text>
        {props.right}
      </Group>
      {props.children}
    </Box>
  );
}

function toTitleCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

// A two-thumbed slider that snaps to the discrete values present in the
// option list. The domain is sorted unique numbers; we map them to
// indices and use `restrictToMarks` so the user can only park the
// thumbs at real values. Hides itself if the domain has fewer than two
// distinct values (a single-mark slider has nothing meaningful to do).
//
// Reset button clears the filter back to null (full-range, inactive),
// which keeps the active-filter counter accurate.
function DataDrivenSlider(props: {
  title: string;
  domain: number[];
  value: [number, number] | null;
  onChange: (v: [number, number] | null) => void;
  formatLabel: (n: number) => string;
}) {
  const { domain, value, onChange, formatLabel } = props;
  if (domain.length < 2) return null;

  const lo = domain[0];
  const hi = domain[domain.length - 1];
  // Use the underlying values directly as the slider scale — marks at
  // exactly the data points so `restrictToMarks` snaps the thumbs to
  // them. We render labels on a sparse subset to keep the axis legible
  // when the domain is dense (e.g. 30+ distinct spell ranges).
  const labelStride = Math.max(1, Math.floor(domain.length / 8));
  const marks = domain.map((v, idx) => ({
    value: v,
    label: idx % labelStride === 0 || idx === domain.length - 1 ? formatLabel(v) : '',
  }));

  const current: [number, number] = value ?? [lo, hi];
  const isActive = value !== null && (value[0] !== lo || value[1] !== hi);

  return (
    <Box>
      <Group justify='space-between' align='center' mb={6}>
        <Text fz='xs' fw={700} c='gray.2' tt='uppercase' style={{ letterSpacing: 0.5 }}>
          {props.title}: {formatLabel(current[0])}–{formatLabel(current[1])}
        </Text>
        {isActive && (
          <Button
            variant='subtle'
            size='compact-xs'
            color='gray'
            onClick={() => onChange(null)}
          >
            Reset
          </Button>
        )}
      </Group>
      <Box px={6} pb={20}>
        <RangeSlider
          min={lo}
          max={hi}
          minRange={0}
          step={1}
          restrictToMarks
          marks={marks}
          value={current}
          onChange={(v) => onChange([v[0], v[1]])}
          label={(v) => formatLabel(v)}
          size='sm'
        />
      </Box>
    </Box>
  );
}
