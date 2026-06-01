import { Wg4 } from '@common/wg4/primitives';
import RichText from '@common/RichText';
import { Title, Text, Group, Box, HoverCard, List, Divider } from '@mantine/core';
import { LivingEntity } from '@schemas/content';
import { StoreID, VariableNum } from '@schemas/variables';
import { sign } from '@utils/numbers';
import { toLabel } from '@utils/strings';
import { getSpeedValue, getVariableBreakdown } from '@variables/variable-helpers';
import { getAllSpeedVariables } from '@variables/variable-manager';

function speedLabel(name: string) {
  if (name === 'SPEED') return 'Land';
  return toLabel(name.replace(/^SPEED_/, ''));
}

export function StatSpeedDrawerTitle(props: { data: { id: StoreID } }) {
  const speedVars = getAllSpeedVariables(props.data.id);
  return (
    <Group justify='space-between' wrap='nowrap'>
      <Group wrap='nowrap' gap={10}>
        <Box>
          <Title order={3}>{speedVars.filter((s) => s.value).length > 1 ? 'Speeds' : 'Speed'}</Title>
        </Box>
      </Group>
    </Group>
  );
}

export function StatSpeedDrawerContent(props: { data: { id: StoreID; entity: LivingEntity | null } }) {
  const speedVars = getAllSpeedVariables(props.data.id);
  const activeSpeeds = speedVars
    .map((variable) => ({ variable, data: getSpeedValue(props.data.id, variable, props.data.entity) }))
    .filter((s) => s.data.value !== 0);

  if (activeSpeeds.length === 0) return null;

  // Hero shows the LAND speed. Other speeds list in the meta.
  const landIdx = activeSpeeds.findIndex((s) => s.variable.name === 'SPEED');
  const primary = landIdx >= 0 ? activeSpeeds[landIdx] : activeSpeeds[0];
  const others = activeSpeeds.filter((s) => s !== primary);

  return (
    <Box>
      <Wg4.StatHero
        value={`${primary.data.total} ft`}
        metaLabel={others.length > 0 ? 'Other speeds' : 'Speed'}
        metaValue={
          others.length > 0
            ? others.map((s) => `${speedLabel(s.variable.name).toLowerCase()} ${s.data.total}`).join(' · ')
            : speedLabel(primary.variable.name)
        }
      />
      {activeSpeeds.map((s, idx) => (
        <StatSpeedBreakdown key={idx} id={props.data.id} variable={s.variable} entity={props.data.entity} showHeader={activeSpeeds.length > 1} />
      ))}

      <Box px={22} pb={14}>
        <Wg4.Divider />
        <RichText ta='justify' store={props.data.id}>
          Speed is the distance you can move using a single action, measured in feet. There are various kinds of speeds,
          allowing you to easily fly, swim, or dig, but the most common speed is for walking normally. Penalties to a
          speed can decrease it to a minimum of 5 feet.
        </RichText>
      </Box>
    </Box>
  );
}

function StatSpeedBreakdown(props: {
  id: StoreID;
  variable: VariableNum;
  entity: LivingEntity | null;
  showHeader: boolean;
}) {
  const breakdown = getVariableBreakdown(props.id, props.variable.name);
  const finalData = getSpeedValue(props.id, props.variable, props.entity);
  if (finalData.value === 0) return null;

  const bonusRows: { label: string; source: string; value: number }[] = [];
  for (const [key, bonus] of breakdown.bonuses.entries()) {
    const label = key.startsWith('untyped ') ? 'Untyped bonus' : `${key.charAt(0).toUpperCase()}${key.slice(1)} bonus`;
    const src = bonus.composition.map((c) => c.source).join(', ');
    bonusRows.push({ label, source: src, value: bonus.value });
  }

  return (
    <Box>
      {props.showHeader && (
        <Box px={22} pt={12} pb={2}>
          <Wg4.Lbl>{speedLabel(props.variable.name)} Speed</Wg4.Lbl>
        </Box>
      )}
      <Wg4.StatBreakdown
        rows={[
          {
            label: 'Base',
            source: speedLabel(props.variable.name).toLowerCase() + ' speed',
            value: `${finalData.value} ft`,
            sign: 'pos',
          },
          ...bonusRows.map((r) => ({
            label: r.label,
            source: r.source,
            value: `${sign(r.value)} ft`,
            sign: (r.value >= 0 ? 'pos' : 'neg') as 'pos' | 'neg',
          })),
          { label: 'Total', source: '', value: `${finalData.total} ft`, total: true },
        ]}
      />
      {breakdown.conditionals.length > 0 && (
        <Box px={22} pb={8}>
          <Wg4.Indent>
            <Wg4.Lbl>Conditional</Wg4.Lbl>{' '}
            <HoverCard shadow='md' openDelay={250} width={260} position='bottom' zIndex={10000} withArrow>
              <HoverCard.Target>
                <Text c='var(--wg4-accent)' style={{ cursor: 'pointer', borderBottom: '1px dotted var(--wg4-accent)' }} span>
                  {breakdown.conditionals.length} situational
                </Text>
              </HoverCard.Target>
              <HoverCard.Dropdown py={6} px={10}>
                <Text size='xs'>These will only apply situationally:</Text>
                <Divider my={5} />
                <List size='xs'>
                  {breakdown.conditionals.map((item, i) => (
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
