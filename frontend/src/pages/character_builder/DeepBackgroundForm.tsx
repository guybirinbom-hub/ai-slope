// Custom background form used when the Deep Background variant is on.
//
// Replaces the published-background picker inside BackgroundAccordionItem.
// Captures: name, description, two attribute boosts, a Lore skill name,
// and one skill feat. Each form change re-synthesises a fake Background
// object (id = -1) with the corresponding operations and writes it to
// character.details.background, so the rest of the builder's operation
// engine processes the boosts / lore / feat / prereq-skill grant exactly
// like a real background's operations.
//
// Prereq-skill auto-train rule: when the player picks a skill feat, we
// scan its prerequisites for "trained in <Skill>" patterns. Single-skill
// prereqs are applied automatically. Multi-skill prereqs (e.g. "trained
// in Diplomacy or Intimidation") surface a small picker so the player
// chooses which one to be trained in.

import { characterState } from '@atoms/characterAtoms';
import { drawerState } from '@atoms/navAtoms';
import { fetchContentById, getCachedContent } from '@content/content-store';
import { selectContent } from '@common/select/SelectContent';
import {
  Box,
  Button,
  Group,
  Select,
  Stack,
  Text,
  Textarea,
  TextInput,
  Title,
} from '@mantine/core';
import { IconBook, IconStar } from '@tabler/icons-react';
import { useAtom } from 'jotai';
import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AbilityBlock, Background } from '@schemas/content';
import { Operation } from '@schemas/operations';
import { labelToVariable } from '@variables/variable-utils';

// Skill names — match the proficiency variable naming convention used
// throughout WG (SKILL_<NAME_UPPER>). Lore is handled separately.
const SKILL_NAMES = [
  'Acrobatics', 'Arcana', 'Athletics', 'Crafting', 'Deception',
  'Diplomacy', 'Intimidation', 'Medicine', 'Nature', 'Occultism',
  'Performance', 'Religion', 'Society', 'Stealth', 'Survival', 'Thievery',
];

const ATTRIBUTES = [
  { code: 'STR', label: 'Strength' },
  { code: 'DEX', label: 'Dexterity' },
  { code: 'CON', label: 'Constitution' },
  { code: 'INT', label: 'Intelligence' },
  { code: 'WIS', label: 'Wisdom' },
  { code: 'CHA', label: 'Charisma' },
];

// Extracts "trained in X" or "trained in X or Y" patterns from a feat's
// prerequisite strings. Returns the candidate skill name(s) so the form
// can either auto-train (1 option) or prompt the player (2+ options).
function extractPrereqSkills(prereqs: string[] | null | undefined): string[] {
  if (!prereqs || prereqs.length === 0) return [];
  const text = prereqs.join(' ').toLowerCase();
  // Match the phrase that introduces a skill prerequisite. The skill name
  // is captured by matching against the known SKILL_NAMES list rather
  // than parsing arbitrary tokens, which avoids picking up flavour words.
  const found = new Set<string>();
  for (const skill of SKILL_NAMES) {
    const re = new RegExp(`trained in [^.;]*\\b${skill.toLowerCase()}\\b`);
    if (re.test(text)) found.add(skill);
  }
  return [...found];
}

// Builds the synthetic Background object that the operation engine sees.
// All operations are tagged with stable UUIDs derived from data so the
// engine doesn't churn selection state on every keystroke.
function synthesizeBackground(data: NonNullable<DeepBackgroundData>): Background {
  const ops: Operation[] = [];

  const opId = (suffix: string) => `deep-bg-${suffix}`;

  // Two attribute boosts.
  if (data.boost1) {
    ops.push({
      id: opId(`boost-1-${data.boost1}`),
      type: 'adjValue',
      data: { variable: `ATTRIBUTE_${data.boost1}`, value: { value: 1, partial: false } },
    } as Operation);
  }
  if (data.boost2 && data.boost2 !== data.boost1) {
    ops.push({
      id: opId(`boost-2-${data.boost2}`),
      type: 'adjValue',
      data: { variable: `ATTRIBUTE_${data.boost2}`, value: { value: 1, partial: false } },
    } as Operation);
  }

  // Lore skill: create the variable if it doesn't already exist (the
  // engine de-dupes by variable name), then train it.
  if (data.lore_name && data.lore_name.trim()) {
    const loreVar = `SKILL_LORE___${labelToVariable(data.lore_name)}`;
    ops.push({
      id: opId(`lore-create-${loreVar}`),
      type: 'createValue',
      data: { variable: loreVar, type: 'prof', value: { value: 'U' } },
    } as Operation);
    ops.push({
      id: opId(`lore-train-${loreVar}`),
      type: 'adjValue',
      data: { variable: loreVar, value: { value: 'T' } },
    } as Operation);
  }

  // Skill feat.
  if (data.skill_feat_id) {
    ops.push({
      id: opId(`feat-${data.skill_feat_id}`),
      type: 'giveAbilityBlock',
      data: { type: 'feat', abilityBlockId: data.skill_feat_id },
    } as Operation);
  }

  // Auto-trained prereq skill. The op-runner already handles the "already
  // trained → pick another skill" upgrade path, so a flat adjValue is
  // safe even when the character happens to also start trained in this
  // skill via ancestry / class.
  if (data.prereq_skill) {
    const skillVar = `SKILL_${data.prereq_skill.toUpperCase()}`;
    ops.push({
      id: opId(`prereq-train-${skillVar}`),
      type: 'adjValue',
      data: { variable: skillVar, value: { value: 'T' } },
    } as Operation);
  }

  return {
    id: -1, // sentinel — distinguishes synthetic backgrounds from DB rows
    created_at: '',
    name: (data.name && data.name.trim()) || 'Deep Background',
    description: data.description ?? '',
    operations: ops,
    rarity: 'COMMON',
    content_source_id: 0,
    artwork_url: null,
    deprecated: null,
    version: '',
  } as Background;
}

type DeepBackgroundData = NonNullable<
  NonNullable<NonNullable<ReturnType<typeof useAtom<typeof characterState>>[0]>['details']>['info']
>['deep_background'];

export default function DeepBackgroundForm() {
  const [character, setCharacter] = useAtom(characterState);
  const [_drawer, openDrawer] = useAtom(drawerState);

  // Pull current form data out of details.info.deep_background — keep it
  // as a local snapshot so the controlled inputs feel responsive even
  // though the actual write is debounced into the character atom.
  const data: NonNullable<DeepBackgroundData> = character?.details?.info?.deep_background ?? {};

  // Fetch the chosen feat to detect its prereq skills.
  const { data: chosenFeat } = useQuery<AbilityBlock | null>({
    queryKey: ['deep-background-feat', { id: data.skill_feat_id }],
    queryFn: () => (data.skill_feat_id ? fetchContentById<AbilityBlock>('ability-block', data.skill_feat_id) : Promise.resolve(null)),
    enabled: !!data.skill_feat_id,
  });
  const candidateSkills = useMemo(() => extractPrereqSkills(chosenFeat?.prerequisites), [chosenFeat]);

  // When candidate skills resolve and there's only one, auto-set
  // prereq_skill. When 2+, leave prereq_skill blank so the player
  // explicitly picks one via the SegmentedControl below.
  useEffect(() => {
    if (!chosenFeat) return;
    if (candidateSkills.length === 1 && data.prereq_skill !== candidateSkills[0]) {
      patch({ prereq_skill: candidateSkills[0] });
    } else if (candidateSkills.length === 0 && data.prereq_skill) {
      patch({ prereq_skill: undefined });
    } else if (candidateSkills.length > 1 && data.prereq_skill && !candidateSkills.includes(data.prereq_skill)) {
      // Previously picked skill no longer matches the new feat's options.
      patch({ prereq_skill: undefined });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chosenFeat?.id, candidateSkills.join('|')]);

  // Whenever the snapshot updates, regenerate the synthetic background +
  // write it to character.details.background so the operation engine
  // reapplies the boosts / lore / feat / prereq-skill grant.
  useEffect(() => {
    setCharacter((prev) => {
      if (!prev) return prev;
      const synth = synthesizeBackground(data);
      // Avoid a write if nothing actually changed (prevents reactive
      // loops between this effect and the data snapshot).
      if (prev.details?.background?.id === -1 && prev.details.background.name === synth.name) {
        const opsEqual =
          JSON.stringify(prev.details.background.operations) === JSON.stringify(synth.operations);
        const descEqual = prev.details.background.description === synth.description;
        if (opsEqual && descEqual) return prev;
      }
      return {
        ...prev,
        details: {
          ...(prev.details ?? {}),
          background: synth,
        },
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    data.name,
    data.description,
    data.boost1,
    data.boost2,
    data.lore_name,
    data.skill_feat_id,
    data.prereq_skill,
  ]);

  // Helper to patch the details.info.deep_background slice in one write.
  const patch = (over: Partial<NonNullable<DeepBackgroundData>>) => {
    setCharacter((prev) => {
      if (!prev) return prev;
      const cur = prev.details?.info?.deep_background ?? {};
      return {
        ...prev,
        details: {
          ...(prev.details ?? {}),
          info: {
            ...(prev.details?.info ?? {}),
            deep_background: { ...cur, ...over },
          },
        },
      };
    });
  };

  return (
    <Stack gap='md'>
      <Box>
        <Title order={5} c='gray.0' mb={6}>
          Deep Background
        </Title>
        <Text c='dimmed' fz='xs'>
          Build your own background. Two attribute boosts to different scores, training in a Lore
          skill, and one skill feat. You'll be automatically trained in the feat's prerequisite skill.
        </Text>
      </Box>

      <TextInput
        size='sm'
        label='Name'
        placeholder='e.g. Star-gazing nomad'
        value={data.name ?? ''}
        onChange={(e) => patch({ name: e.currentTarget.value })}
      />

      <Textarea
        size='sm'
        label='Description'
        placeholder='Where did your character come from? What did they do before adventuring?'
        autosize
        minRows={3}
        maxRows={8}
        value={data.description ?? ''}
        onChange={(e) => patch({ description: e.currentTarget.value })}
      />

      <Group grow align='flex-start'>
        <Select
          size='sm'
          label='First attribute boost'
          placeholder='Pick one'
          value={data.boost1 ?? null}
          onChange={(v) => patch({ boost1: v ?? undefined })}
          data={ATTRIBUTES.map((a) => ({
            value: a.code,
            label: a.label,
            disabled: a.code === data.boost2,
          }))}
        />
        <Select
          size='sm'
          label='Second attribute boost'
          placeholder='Pick one (different from the first)'
          value={data.boost2 ?? null}
          onChange={(v) => patch({ boost2: v ?? undefined })}
          data={ATTRIBUTES.map((a) => ({
            value: a.code,
            label: a.label,
            disabled: a.code === data.boost1,
          }))}
        />
      </Group>

      <TextInput
        size='sm'
        label='Lore skill'
        placeholder='e.g. Cooking, Sailing, Heraldry'
        leftSection={<IconBook size='0.9rem' />}
        value={data.lore_name ?? ''}
        onChange={(e) => patch({ lore_name: e.currentTarget.value })}
        description='Becomes "Lore: ___" — trained automatically.'
      />

      <Box>
        <Text fz='sm' fw={500} mb={4}>
          Skill feat
        </Text>
        <Group gap='xs' wrap='nowrap'>
          <Button
            size='compact-sm'
            variant='light'
            leftSection={<IconStar size='0.9rem' />}
            onClick={() => {
              selectContent<AbilityBlock>(
                'ability-block',
                (option) => {
                  if (!option) return;
                  patch({ skill_feat_id: option.id });
                },
                {
                  abilityBlockType: 'feat',
                  selectedId: data.skill_feat_id,
                  advancedPresetFilters: {
                    type: 'ability-block',
                    ab_type: 'feat',
                    // Restrict to skill feats (the Skill trait id is
                    // resolved at modal-open time via the existing
                    // trait cache in SelectContentFilters).
                    level_min: 1,
                    level_max: 1,
                  },
                  // Hard filter — Skill trait + level 1 only, since the
                  // Deep Background variant grants exactly one L1 skill
                  // feat.
                  filterFn: (rec) => {
                    const ab = rec as AbilityBlock;
                    if (ab.type !== 'feat') return false;
                    if ((ab.level ?? 0) !== 1) return false;
                    const traits = getCachedContent<{ id: number; name: string }>('trait');
                    const skillTraitId = traits.find((t) => t.name === 'Skill')?.id;
                    if (skillTraitId === undefined) return true; // permissive fallback
                    return (ab.traits ?? []).includes(skillTraitId);
                  },
                  overrideLabel: 'Pick a 1st-level skill feat',
                }
              );
            }}
          >
            {chosenFeat ? chosenFeat.name : 'Pick a skill feat'}
          </Button>
          {data.skill_feat_id && (
            <Button
              size='compact-sm'
              variant='subtle'
              color='gray'
              onClick={() => patch({ skill_feat_id: undefined, prereq_skill: undefined })}
            >
              Clear
            </Button>
          )}
        </Group>

        {/* Multi-option prereq picker. Only shown when the chosen feat
            has more than one candidate skill in its prerequisites. */}
        {candidateSkills.length > 1 && (
          <Box mt={6}>
            <Text fz='xs' c='dimmed' mb={4}>
              This feat's prerequisite lets you pick the skill you're trained in:
            </Text>
            <Group gap={6} wrap='wrap'>
              {candidateSkills.map((s) => (
                <Button
                  key={s}
                  size='compact-xs'
                  variant={data.prereq_skill === s ? 'filled' : 'outline'}
                  onClick={() => patch({ prereq_skill: s })}
                >
                  {s}
                </Button>
              ))}
            </Group>
          </Box>
        )}
        {candidateSkills.length === 1 && data.prereq_skill && (
          <Text fz='xs' c='dimmed' mt={6}>
            Auto-trained in <b>{data.prereq_skill}</b> (the feat's prerequisite).
          </Text>
        )}
        {chosenFeat && candidateSkills.length === 0 && (
          <Text fz='xs' c='dimmed' mt={6}>
            This feat has no trained-skill prerequisite; no extra skill training granted.
          </Text>
        )}
      </Box>
    </Stack>
  );
}
