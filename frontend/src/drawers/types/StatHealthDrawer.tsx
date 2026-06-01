import { Title, Text, Group, Box, HoverCard, List, Divider } from '@mantine/core';
import { StoreID } from '@schemas/variables';
import { sign } from '@utils/numbers';
import { getHealthValueParts } from '@variables/variable-helpers';
import { displayFinalHealthValue } from '@variables/variable-display';
import { Wg4 } from '@common/wg4/primitives';

export function StatHealthDrawerTitle(props: { data: { id: StoreID } }) {
  return (
    <Group justify='space-between' wrap='nowrap'>
      <Group wrap='nowrap' gap={10}>
        <Box>
          <Title order={3}>Hit Points</Title>
        </Box>
      </Group>
      <Box></Box>
    </Group>
  );
}

export function StatHealthDrawerContent(props: { data: { id: StoreID } }) {
  const parts = getHealthValueParts(props.data.id);
  const finalHp = displayFinalHealthValue(props.data.id);

  // Aggregate the bonus-source rows from breakdown.bonuses (Map of
  // typed-bonus group → composition list). One row per source so the
  // wg4 breakdown stays scannable; the "use greatest" semantics live
  // in the `source` cell text rather than nested hovercards.
  const bonusRows: { label: string; source: string; value: number }[] = [];
  for (const [key, bonus] of parts.breakdown.bonuses.entries()) {
    const label = key.startsWith('untyped ') ? 'Untyped bonus' : `${key.charAt(0).toUpperCase()}${key.slice(1)} bonus`;
    const src = bonus.composition.map((c) => c.source).join(', ');
    bonusRows.push({ label, source: src, value: bonus.value });
  }

  return (
    <Box>
      <Wg4.StatHero
        value={finalHp}
        metaLabel='Max HP'
        metaValue={`Class ${parts.classHp} + Con ${sign(parts.conMod)} per level`}
      />
      <Wg4.StatBreakdown
        rows={[
          {
            label: 'Class HP per level',
            source: `${parts.classHp} × ${parts.level}`,
            value: parts.classHp * parts.level,
            sign: 'pos',
          },
          {
            label: 'Constitution per level',
            source: `${sign(parts.conMod)} × ${parts.level}`,
            value: parts.conMod * parts.level,
            sign: parts.conMod >= 0 ? 'pos' : 'neg',
          },
          {
            label: 'Ancestry HP',
            source: 'base (level 1)',
            value: parts.ancestryHp,
            sign: 'pos',
          },
          ...(parts.bonusHp > 0 && parts.breakdown.bonusValue === 0
            ? [{ label: 'Bonus HP', source: 'various', value: parts.bonusHp, sign: 'pos' as const }]
            : []),
          ...bonusRows.map((r) => ({
            label: r.label,
            source: r.source,
            value: sign(r.value),
            sign: (r.value >= 0 ? 'pos' : 'neg') as 'pos' | 'neg',
          })),
          {
            label: 'Total',
            source: '',
            value: finalHp,
            total: true,
          },
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
                  {parts.breakdown.conditionals.length} situational bonus{parts.breakdown.conditionals.length === 1 ? '' : 'es'}
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
