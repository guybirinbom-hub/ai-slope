// Per-level spell-pick prompts for the character BUILDER.
//
// Reads the verified per-class casting tables (see process/spells/casting-tables.ts)
// and surfaces "you still need to pick X spells of rank Y" prompts at each
// level of the builder. The actual spell selection uses the same selectContent
// modal the rest of the app uses, with tradition + rank + Common filters
// pre-applied so the player can't pick a wrong-tradition or wrong-rank spell.
//
// Storage: picks are appended to character.spells.list with shape
//   { spell_id, rank, source }
// where `source` is the casting source name read from the class's
// CASTING_SOURCES variable (so multiclass / multi-source casters keep working
// even if we don't yet surface them).
//
// This file is intentionally self-contained — the rest of the builder doesn't
// import from it except CharBuilderCreation.tsx, which slots it into
// LevelSection / InitialStatsLevelSection. Removing the import + the JSX
// fully reverts the feature.

import { drawerState } from '@atoms/navAtoms';
import { selectContent } from '@common/select/SelectContent';
import { IMPRINT_BG_COLOR, IMPRINT_BG_COLOR_HOVER, IMPRINT_BORDER_COLOR } from '@constants/data';
import { collectEntitySpellcasting } from '@content/collect-content';
import { fetchContentAll, getDefaultSources } from '@content/content-store';
import {
  ActionIcon,
  Badge,
  Box,
  Group,
  Stack,
  Text,
  useMantineTheme,
} from '@mantine/core';
import { AbilityBlock, Character, Spell } from '@schemas/content';
import { IconPlus, IconX } from '@tabler/icons-react';
import { useAtom } from 'jotai';
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { characterState } from '@atoms/characterAtoms';
import {
  getCastingProfile,
  getCumulativePicks,
  getSpellPicksAtLevel,
  SpellPick,
} from '@spells/casting-tables';
import { rankNumber } from '@utils/numbers';
import { toLabel } from '@utils/strings';
import { getVariable } from '@variables/variable-manager';
import { VariableListStr } from '@schemas/variables';

// Render the spell-pick prompts that apply AT the given character level.
// Returns null when:
//   - the character has no class yet
//   - the class isn't a spellcaster we have rules for
//   - the level has no picks (e.g. Cleric/Druid every level — they prep daily)
export default function BuilderSpellPicks(props: { level: number }) {
  const theme = useMantineTheme();
  const [character, setCharacter] = useAtom(characterState);

  const className = character?.details?.class?.name ?? null;
  const profile = useMemo(() => getCastingProfile(className), [className]);
  const picksAtThisLevel = useMemo(
    () => (profile ? getSpellPicksAtLevel(className, props.level) : []),
    [profile, className, props.level]
  );

  // Read the casting source from the class's CASTING_SOURCES variable so we
  // store picks under the right source name (Wizard='wizard' typically, but
  // homebrew classes can name their source anything).
  const castingInfo = useMemo(() => {
    if (!character) return null;
    return collectEntitySpellcasting('CHARACTER', character);
  }, [character]);
  const primarySource = castingInfo?.sources?.[0];

  // Wizard-only: find the curriculum spell IDs of the player's chosen
  // arcane school. We grab the school's AbilityBlock from the content store
  // and extract `link_spell_NNNN` markers from its description. Only the
  // "Curriculum" portion is parsed; School Spells (focus spells the school
  // auto-grants) are excluded by cutting the description at that marker.
  const isWizardWithCurriculumPick =
    className?.toLowerCase() === 'wizard' &&
    picksAtThisLevel.some((p) => p.kind === 'curriculum-spell');
  const { data: curriculumSpellIds } = useQuery({
    queryKey: ['builder-spell-picks-curriculum', { characterId: character?.id, level: props.level }],
    queryFn: async () => extractCurriculumSpellIds(),
    enabled: isWizardWithCurriculumPick,
  });

  if (!profile || picksAtThisLevel.length === 0) return null;
  // If the class's spellcasting hasn't been set up yet (no CASTING_SOURCES
  // variable populated by class operations), we can't store picks correctly.
  // Render an info banner instead of broken pickers.
  if (!primarySource) {
    return (
      <Box
        p='sm'
        mt={5}
        style={{
          backgroundColor: IMPRINT_BG_COLOR,
          border: `1px solid ${IMPRINT_BORDER_COLOR}`,
          borderRadius: theme.radius.sm,
        }}
      >
        <Text fz='xs' c='dimmed' fs='italic'>
          Pick a class with spellcasting to see spell-pick prompts here.
        </Text>
      </Box>
    );
  }

  // Look up the tradition. For fixed-tradition classes we use the table
  // value; for by-subclass classes (Sorcerer/Witch/Summoner) we read from
  // the source's tradition field — which the class operation populated when
  // the player picked their bloodline / patron / eidolon.
  const tradition: string | null =
    profile.tradition.mode === 'fixed'
      ? profile.tradition.value
      : (primarySource.tradition?.toLowerCase?.() ?? null);

  // Compute the highest spell rank the character can cast at this level
  // (used for "spellbook"/level-up picks that allow any rank up to the cap).
  const highestRankSlot = (castingInfo?.slots ?? [])
    .filter((s) => s.source === primarySource.name)
    .reduce((max, s) => Math.max(max, s.rank), 0);

  return (
    <Box
      p='sm'
      mt={5}
      style={{
        backgroundColor: IMPRINT_BG_COLOR,
        border: `1px solid ${IMPRINT_BORDER_COLOR}`,
        borderRadius: theme.radius.sm,
      }}
    >
      <Group justify='space-between' align='center' mb={6}>
        <Text c='gray.2' fw={600} fz='sm'>
          Spells to pick
        </Text>
        <Text c='dimmed' fz='xs' fs='italic'>
          {toLabel(tradition ?? primarySource.name)}
          {' '}· Common
        </Text>
      </Group>
      <Stack gap={4}>
        {picksAtThisLevel.map((pick, idx) => (
          <SpellPickRow
            key={idx}
            pick={pick}
            level={props.level}
            tradition={tradition}
            sourceName={primarySource.name}
            highestRankSlot={highestRankSlot}
            character={character}
            setCharacter={setCharacter}
            curriculumSpellIds={curriculumSpellIds ?? null}
          />
        ))}
      </Stack>
    </Box>
  );
}

// Finds the player's chosen arcane school (read from CLASS_FEATURE_NAMES,
// which the operations engine populates as the player checks features),
// fetches every class-feature AbilityBlock, locates the one matching the
// school name, and parses its description for curriculum spell IDs.
//
// Strategy intentionally narrow: we only scan the substring between the
// "**Curriculum**" marker and the "**School Spells**" marker, so the
// school's focus-spell IDs aren't included by mistake. If the school is
// "School of Unified Magical Theory" (Universalist) there's no curriculum,
// so we return an empty array and the picker falls back to all common
// arcane spells of the right rank.
async function extractCurriculumSpellIds(): Promise<number[]> {
  const featureNames = (getVariable<VariableListStr>('CHARACTER', 'CLASS_FEATURE_NAMES')?.value ?? []) as string[];
  // Class feature names are stored UPPERCASED by the operations engine.
  const schoolName = featureNames.find((n) => n.toUpperCase().startsWith('SCHOOL OF'));
  if (!schoolName) return [];

  // Universalist is a special case: it has no curriculum spells. The rules
  // doc handles this — the Wizard's curriculum prompt should still show but
  // the player picks any 1st-rank common arcane spell instead.
  if (/UNIFIED MAGICAL THEORY/i.test(schoolName)) return [];

  const blocks = await fetchContentAll<AbilityBlock>('ability-block', getDefaultSources('PAGE'));
  const school = blocks.find(
    (b) => b.type === 'class-feature' && (b.name ?? '').toUpperCase() === schoolName.toUpperCase()
  );
  if (!school) return [];

  // Slice the description to just the curriculum portion. The school AB
  // descriptions on AoN follow a consistent format:
  //   **Curriculum** cantrips: ...; 1st: ...; ...; 9th: ...
  //   **School Spells** initial: ...; advanced: ...
  // We want the IDs from the first half only.
  const desc = school.description ?? '';
  const curriculumStart = desc.indexOf('**Curriculum**');
  if (curriculumStart < 0) return [];
  const afterCurriculum = desc.slice(curriculumStart);
  const schoolSpellsStart = afterCurriculum.indexOf('**School Spells**');
  const curriculumSection = schoolSpellsStart < 0 ? afterCurriculum : afterCurriculum.slice(0, schoolSpellsStart);

  // link_spell_NNNN markers — extract spell IDs.
  const ids = new Set<number>();
  const re = /link_spell_(\d+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(curriculumSection)) !== null) {
    const id = Number(m[1]);
    if (!Number.isNaN(id)) ids.add(id);
  }
  return [...ids];
}

// One row per pick prompt at this level. Tracks current-vs-target by counting
// how many spells the character already has in their repertoire/spellbook for
// the matching rank + source.
function SpellPickRow(props: {
  pick: SpellPick;
  level: number;
  tradition: string | null;
  sourceName: string;
  highestRankSlot: number;
  character: Character | null;
  setCharacter: (updater: (prev: Character | null) => Character | null) => void;
  // Curriculum spell IDs (Wizard only). When present and the pick kind is
  // 'curriculum-spell', the picker is restricted to spells in this list.
  // Null = no curriculum constraint (either not a curriculum pick, or the
  // school hasn't been selected yet, or the school is Universalist).
  curriculumSpellIds: number[] | null;
}) {
  const theme = useMantineTheme();
  const [_drawer, openDrawer] = useAtom(drawerState);

  // Cumulative target through this level — so the badge reflects "you've
  // picked X of Y total expected by this level", not just at this single
  // level. This way the player can level up retroactively without resetting.
  const cumulative = useMemo(() => {
    const className = props.character?.details?.class?.name ?? null;
    return getCumulativePicks(className, props.level);
  }, [props.character, props.level]);

  const target = useMemo(() => {
    const pick = props.pick;
    // Pre-narrow the rank so TS doesn't lose the narrowing inside the find
    // callback (control-flow narrowing doesn't carry into nested closures).
    if (pick.kind === 'spell') {
      const wantRank = pick.rank;
      const entry = cumulative.find((c) => c.kind === 'spell' && c.rank === wantRank);
      return entry && entry.kind === 'spell' ? entry.count : 0;
    }
    if (pick.kind === 'cantrip') {
      const entry = cumulative.find((c) => c.kind === 'cantrip');
      return entry && entry.kind === 'cantrip' ? entry.count : 0;
    }
    if (pick.kind === 'spellbook') {
      const entry = cumulative.find((c) => c.kind === 'spellbook');
      return entry && entry.kind === 'spellbook' ? entry.count : 0;
    }
    if (pick.kind === 'curriculum-spell') {
      const wantRank = pick.rank;
      const entry = cumulative.find((c) => c.kind === 'curriculum-spell' && c.rank === wantRank);
      return entry && entry.kind === 'curriculum-spell' ? entry.count : 0;
    }
    return pick.count;
  }, [cumulative, props.pick]);

  // Count picks already made. Heuristic: the rows in character.spells.list
  // for our source whose rank matches this pick are "what we've picked."
  // We don't store level-of-pick, so cantrips (rank=0) count toward the
  // cantrip target, R1 spells count toward the R1 target, etc.
  const current = useMemo(() => {
    const list = props.character?.spells?.list ?? [];
    const pick = props.pick;
    if (pick.kind === 'cantrip') {
      return list.filter((e) => e.source === props.sourceName && e.rank === 0).length;
    }
    if (pick.kind === 'spell' || pick.kind === 'curriculum-spell') {
      const wantRank = pick.rank;
      return list.filter((e) => e.source === props.sourceName && e.rank === wantRank).length;
    }
    if (pick.kind === 'spellbook') {
      // Any non-cantrip spell at this source counts toward the running total.
      return list.filter((e) => e.source === props.sourceName && e.rank > 0).length;
    }
    return 0;
  }, [props.character, props.pick, props.sourceName]);

  const picked = props.character?.spells?.list ?? [];
  const filled = current >= target;
  const needed = Math.max(0, target - current);

  // Label and filter parameters for the picker
  const { label, rank, rankMin, rankMax } = (() => {
    if (props.pick.kind === 'cantrip') {
      return { label: `Cantrips`, rank: 0, rankMin: 0, rankMax: 0 };
    }
    if (props.pick.kind === 'spell') {
      // Allow any rank ≤ the target slot. A lower-rank spell picked
      // into a higher slot is stored AT the slot's rank (see `rank`
      // below) — semantically "heightened to the slot rank", which
      // matches how PF2e spontaneous repertoire + signature-spell
      // heightening work, and how prepared casters can prepare a
      // lower-rank spell into a higher slot. Without this the picker
      // hid most of the player's actual options at high level.
      return {
        label: `${rankNumber(props.pick.rank)} spells`,
        rank: props.pick.rank,
        rankMin: 1,
        rankMax: props.pick.rank,
      };
    }
    if (props.pick.kind === 'spellbook') {
      return {
        label: `Spellbook (any rank you can cast)`,
        rank: 1,
        rankMin: 1,
        rankMax: Math.max(props.highestRankSlot, 1),
      };
    }
    if (props.pick.kind === 'curriculum-spell') {
      // Same lower-rank-allowed semantics as the 'spell' case above.
      return {
        label: `${rankNumber(props.pick.rank)} curriculum spells`,
        rank: props.pick.rank,
        rankMin: 1,
        rankMax: props.pick.rank,
      };
    }
    if (props.pick.kind === 'apparition') {
      return { label: `Apparition${props.pick.primary ? ' (primary)' : ''}`, rank: 0, rankMin: 0, rankMax: 0 };
    }
    return { label: 'Pick', rank: 0, rankMin: 0, rankMax: 0 };
  })();

  // Apparitions aren't ordinary spells — surface a placeholder note instead
  // of a broken spell picker. Apparition selection lives in the Class section
  // (handled by class operations).
  if (props.pick.kind === 'apparition') {
    return (
      <Group justify='space-between' wrap='nowrap' gap='xs'>
        <Text c='gray.2' fz='sm'>
          {label}: choose in the Class section
        </Text>
      </Group>
    );
  }

  // Curriculum picks (Wizard only) restrict to the school's curriculum list
  // when we have it. If curriculumSpellIds is null we either haven't fetched
  // yet or the school doesn't have a curriculum (Universalist) — fall back
  // to the standard tradition/rank/Common filter.
  const restrictToCurriculum =
    props.pick.kind === 'curriculum-spell' && props.curriculumSpellIds && props.curriculumSpellIds.length > 0;

  const openPicker = () => {
    selectContent<Spell>(
      'spell',
      (option) => {
        if (!option) return;
        const newEntry = { spell_id: option.id, rank, source: props.sourceName };
        props.setCharacter((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            spells: {
              ...(prev.spells ?? {
                slots: [],
                list: [],
                focus_point_current: 0,
                innate_casts: [],
              }),
              list: [...(prev.spells?.list ?? []), newEntry],
            },
          };
        });
      },
      {
        showButton: true,
        overrideLabel: `Add to ${label.toLowerCase()}`,
        // Client-side filter: keep only Common-rarity spells of the right
        // tradition + rank. Uncommon/rare reachable only via Learn a Spell
        // (which we leave to the freeform manage flow elsewhere).
        // For Wizard curriculum picks: additionally restrict to the chosen
        // school's curriculum spell IDs.
        filterFn: (rec) => {
          const spell = rec as Spell;
          if (!spell) return false;
          if (restrictToCurriculum) {
            if (!props.curriculumSpellIds!.includes(spell.id)) return false;
            // Curriculum spells inherit whatever rarity the school grants —
            // bypass the Common-only check for curriculum picks since the
            // school has already granted access.
          } else {
            if (props.tradition && !(spell.traditions ?? []).map((t) => t.toLowerCase()).includes(props.tradition))
              return false;
            // 'COMMON' is the canonical uppercase rarity; some homebrew may
            // use lowercase, so we accept either.
            const rarity = (spell.rarity ?? 'COMMON').toUpperCase();
            if (rarity !== 'COMMON') return false;
          }
          if (spell.rank < rankMin || spell.rank > rankMax) return false;
          return true;
        },
        advancedPresetFilters: {
          type: 'spell',
          spell_type: 'NORMAL',
          traditions: props.tradition ? [props.tradition] : undefined,
          rank_min: rankMin,
          rank_max: rankMax,
          content_sources: getDefaultSources('PAGE'),
        },
      }
    );
  };

  return (
    <Group justify='space-between' wrap='nowrap' gap='xs' align='center'>
      <Group gap={8} wrap='nowrap'>
        <Badge
          variant='outline'
          color={filled ? 'teal' : needed > 0 ? 'yellow' : 'gray.5'}
          size='sm'
          styles={{ root: { textTransform: 'none' } }}
        >
          {current}/{target}
        </Badge>
        <Text c='gray.2' fz='sm'>
          {label}
          {needed > 0 && (
            <Text c='dimmed' span fz='xs'>
              {' '}· need {needed} more
            </Text>
          )}
        </Text>
      </Group>
      <ActionIcon
        size='sm'
        variant='light'
        // No-overshoot: once the count hits target we dim & disable the
        // button. To go beyond the class baseline the player must use
        // Learn a Spell (managed elsewhere). This prevents accidentally
        // double-picking and exceeding the class's expected spells known.
        color={filled ? 'gray.5' : theme.primaryColor}
        radius='xl'
        disabled={filled}
        aria-label={filled ? `${label} target reached` : `Add ${label}`}
        title={filled ? 'Target reached — use Learn a Spell elsewhere to add more' : undefined}
        onClick={openPicker}
      >
        <IconPlus size='0.9rem' />
      </ActionIcon>
    </Group>
  );
}
