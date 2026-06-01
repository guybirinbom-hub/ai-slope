import { Wg4 } from '@common/wg4/primitives';
import { Title, Text, Group, Box, Badge, HoverCard, List, Divider } from '@mantine/core';
import { StoreID, VariableProf } from '@schemas/variables';
import { sign } from '@utils/numbers';
import { toLabel } from '@utils/strings';
import { displayFinalProfValue } from '@variables/variable-display';
import { getProfValueParts } from '@variables/variable-helpers';
import { getVariable } from '@variables/variable-manager';
import {
  compileProficiencyType,
  proficiencyTypeToLabel,
  variableToLabel,
} from '@variables/variable-utils';
import { titleCase } from 'title-case';

export function StatProfDrawerTitle(props: { data: { id: StoreID; variableName: string; isDC?: boolean } }) {
  const variable = getVariable<VariableProf>(props.data.id, props.data.variableName);
  if (!variable) return null;
  return (
    <Group justify='space-between' wrap='nowrap'>
      <Group wrap='nowrap' gap={10}>
        <Box>
          <Title order={3}>{titleCase(variableToLabel(variable))}</Title>
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

export function StatProfDrawerContent(props: { data: { id: StoreID; variableName: string; isDC?: boolean } }) {
  const variable = getVariable<VariableProf>(props.data.id, props.data.variableName);
  if (!variable) return null;
  const parts = getProfValueParts(props.data.id, props.data.variableName)!;
  const total = displayFinalProfValue(props.data.id, props.data.variableName, props.data.isDC);
  const profRank = proficiencyTypeToLabel(compileProficiencyType(variable.value));
  const attrName = variable.value.attribute ? toLabel(variable.value.attribute) : 'Attribute';

  const bonusRows: { label: string; source: string; value: number }[] = [];
  for (const [key, bonus] of parts.breakdown.bonuses.entries()) {
    const label = key.startsWith('untyped ') ? 'Untyped bonus' : `${key.charAt(0).toUpperCase()}${key.slice(1)} bonus`;
    const src = bonus.composition.map((c) => c.source).join(', ');
    bonusRows.push({ label, source: src, value: bonus.value });
  }

  return (
    <Box>
      <Wg4.StatHero
        value={total}
        metaLabel={props.data.isDC ? 'DC' : 'Proficiency'}
        metaValue={profRank}
      />
      <Wg4.StatBreakdown
        rows={[
          ...(props.data.isDC ? [{ label: 'Base', source: '10', value: 10, sign: 'pos' as const }] : []),
          ...(parts.attributeMod !== null
            ? [
                {
                  label: attrName,
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
            <HoverCard shadow='md' openDelay={250} width={260} position='bottom' zIndex={10000} withArrow>
              <HoverCard.Target>
                <Text c='var(--wg4-accent)' style={{ cursor: 'pointer', borderBottom: '1px dotted var(--wg4-accent)' }} span>
                  {parts.breakdown.conditionals.length} situational bonus
                  {parts.breakdown.conditionals.length === 1 ? '' : 'es'}
                </Text>
              </HoverCard.Target>
              <HoverCard.Dropdown py={6} px={10}>
                <Text size='xs'>These will only apply situationally:</Text>
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
              </HoverCard.Dropdown>
            </HoverCard>
          </Wg4.Indent>
        </Box>
      )}
    </Box>
  );
}
