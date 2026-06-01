import { Wg4 } from '@common/wg4/primitives';
import RichText from '@common/RichText';
import { Title, Text, Group, Box } from '@mantine/core';
import { StoreID, VariableListStr } from '@schemas/variables';
import { displayResistWeak, getResistWeaks } from '@utils/resist-weaks';
import { getVariable } from '@variables/variable-manager';

export function StatResistWeakDrawerTitle(props: { data: { id: StoreID } }) {
  return (
    <Group justify='space-between' wrap='nowrap'>
      <Group wrap='nowrap' gap={10}>
        <Box>
          <Title order={3}>Resistances &amp; Weaknesses</Title>
        </Box>
      </Group>
    </Group>
  );
}

export function StatResistWeakDrawerContent(props: { data: { id: StoreID } }) {
  const resists = getResistWeaks(props.data.id, 'RESISTANCES');
  const weaks = getResistWeaks(props.data.id, 'WEAKNESSES');
  const immuneVar = getVariable<VariableListStr>(props.data.id, 'IMMUNITIES');
  const immunities = immuneVar?.value ?? [];

  return (
    <Box px={22} py={14}>
      <Wg4.Lbl>Resistances</Wg4.Lbl>
      {resists.length === 0 ? (
        <Box py={6}>
          <Text fz='sm' fs='italic' c='var(--wg4-ink-4)'>
            None
          </Text>
        </Box>
      ) : (
        <Wg4.Traits traits={resists} />
      )}
      <Wg4.Divider />

      <Wg4.Lbl>Weaknesses</Wg4.Lbl>
      {weaks.length === 0 ? (
        <Box py={6}>
          <Text fz='sm' fs='italic' c='var(--wg4-ink-4)'>
            None
          </Text>
        </Box>
      ) : (
        <Wg4.Traits traits={weaks} />
      )}
      <Wg4.Divider />

      <Wg4.Lbl>Immunities</Wg4.Lbl>
      {immunities.length === 0 ? (
        <Box py={6}>
          <Text fz='sm' fs='italic' c='var(--wg4-ink-4)'>
            None
          </Text>
        </Box>
      ) : (
        <Wg4.Traits traits={immunities.map((opt) => displayResistWeak(props.data.id, opt))} />
      )}

      <Wg4.Divider />
      <Wg4.Prose>
        <RichText ta='justify' store={props.data.id}>
          {`Resistance reduces incoming damage of that type by the listed value. Weakness increases the damage taken by the value. Immunity blocks the damage or condition entirely.`}
        </RichText>
      </Wg4.Prose>
    </Box>
  );
}
