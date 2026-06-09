import { Wg4 } from '@common/wg4/primitives';
import RichText from '@common/RichText';
import { Title, Text, Group, Box, List, Divider, Badge } from '@mantine/core';
import { StoreID, VariableProf } from '@schemas/variables';
import { sign } from '@utils/numbers';
import { displayFinalProfValue } from '@variables/variable-display';
import { getProfValueParts } from '@variables/variable-helpers';
import { getVariable } from '@variables/variable-manager';
import {
  compileProficiencyType,
  proficiencyTypeToLabel,
  variableToLabel,
} from '@variables/variable-utils';

export function StatPerceptionDrawerTitle(props: { data: { id: StoreID } }) {
  const variable = getVariable<VariableProf>(props.data.id, 'PERCEPTION');
  if (!variable) return null;
  return (
    <Group justify='space-between' wrap='nowrap'>
      <Group wrap='nowrap' gap={10}>
        <Box>
          <Title order={3}>{variableToLabel(variable)}</Title>
        </Box>
      </Group>
      <Box>
        <Badge color='gray' tt='none' size='lg'>
          {proficiencyTypeToLabel(compileProficiencyType(variable.value))}
        </Badge>
      </Box>
    </Group>
  );
}

export function StatPerceptionDrawerContent(props: { data: { id: StoreID } }) {
  const variable = getVariable<VariableProf>(props.data.id, 'PERCEPTION');
  if (!variable) return null;
  const parts = getProfValueParts(props.data.id, 'PERCEPTION')!;
  const total = displayFinalProfValue(props.data.id, 'PERCEPTION');
  const profRank = proficiencyTypeToLabel(compileProficiencyType(variable.value));

  const bonusRows: { label: string; source: string; value: number }[] = [];
  for (const [key, bonus] of parts.breakdown.bonuses.entries()) {
    const label = key.startsWith('untyped ') ? 'Untyped bonus' : `${key.charAt(0).toUpperCase()}${key.slice(1)} bonus`;
    const src = bonus.composition.map((c) => c.source).join(', ');
    bonusRows.push({ label, source: src, value: bonus.value });
  }

  return (
    <Box>
      <Wg4.StatHero value={total} metaLabel='Proficiency' metaValue={profRank} />
      <Wg4.StatBreakdown
        rows={[
          ...(parts.attributeMod !== null
            ? [
                {
                  label: 'Wisdom',
                  source: 'attribute',
                  value: sign(parts.attributeMod),
                  sign: (parts.attributeMod >= 0 ? 'pos' : 'neg') as 'pos' | 'neg',
                },
              ]
            : []),
          {
            label: 'Proficiency',
            source: `${profRank} + level ${parts.level}`,
            value: sign(parts.profValue + parts.level),
            sign: (parts.profValue + parts.level >= 0 ? 'pos' : 'neg') as 'pos' | 'neg',
          },
          ...bonusRows.map((r) => ({
            label: r.label,
            source: r.source,
            value: sign(r.value),
            sign: (r.value >= 0 ? 'pos' : 'neg') as 'pos' | 'neg',
          })),
          { label: 'Total', source: '', value: total, total: true },
        ]}
      />

      {parts.breakdown.conditionals.length > 0 && (
        <Box px={22} pb={14}>
          <Wg4.Divider />
          <Wg4.Indent>
            <Wg4.Lbl>Conditional</Wg4.Lbl>{' '}
            <Text c='var(--wg4-accent)' span>
              {parts.breakdown.conditionals.length} situational bonus
              {parts.breakdown.conditionals.length === 1 ? '' : 'es'}
            </Text>
            <Text size='xs' mt={6}>
              These will only apply situationally:
            </Text>
            <Divider my={5} />
            <List size='xs'>
              {parts.breakdown.conditionals.map((item, i) => (
                <List.Item key={i}>
                  {item.text}
                  <br />
                  <Text c='dimmed' fs='italic' span>
                    — from {item.source}
                  </Text>
                </List.Item>
              ))}
            </List>
          </Wg4.Indent>
        </Box>
      )}

      <Box px={22} pb={14}>
        <Wg4.Divider />
        <RichText ta='justify' store={props.data.id}>
          Perception measures your ability to be aware of your environment. Whenever you must spot a hidden creature,
          find a hidden object, or determine what's true in a scene, you'll use your Perception modifier.
        </RichText>
      </Box>
    </Box>
  );
}
