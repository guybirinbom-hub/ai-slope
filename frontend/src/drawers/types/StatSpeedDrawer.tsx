import { Wg4 } from '@common/wg4/primitives';
import RichText from '@common/RichText';
import { Title, Text, Group, Box, List, Divider, NumberInput, Button } from '@mantine/core';
import { LivingEntity } from '@schemas/content';
import { StoreID, VariableNum } from '@schemas/variables';
import { sign } from '@utils/numbers';
import { toLabel } from '@utils/strings';
import { getSpeedValue, getVariableBreakdown } from '@variables/variable-helpers';
import { getAllSpeedVariables } from '@variables/variable-manager';
import { useAtom } from 'jotai';
import { characterState } from '@atoms/characterAtoms';

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
  // Temporary speed — a play-time override of the computed Speed (e.g.
  // difficult terrain, a spell, a status). Stored on the character's
  // meta_data and backed by the global characterState atom so the change
  // propagates to the sheet's Speed stat (and persists). Only the
  // CHARACTER store can edit it; other stores read the computed value.
  const [character, setCharacter] = useAtom(characterState);
  const isChar = props.data.id === 'CHARACTER';
  const tempSpeed = isChar
    ? ((character?.meta_data as { temp_speed?: number } | undefined)?.temp_speed ?? null)
    : null;
  const tempActive = typeof tempSpeed === 'number';
  const setTempSpeed = (v: number | null) => {
    setCharacter((c) =>
      c ? { ...c, meta_data: { ...c.meta_data, temp_speed: v == null ? undefined : v } } : c
    );
  };

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
        value={
          tempActive ? (
            <span style={{ color: '#d9742e' }}>{tempSpeed} ft</span>
          ) : (
            `${primary.data.total} ft`
          )
        }
        metaLabel={tempActive ? 'Temporary speed' : others.length > 0 ? 'Other speeds' : 'Speed'}
        metaValue={
          others.length > 0
            ? others.map((s) => `${speedLabel(s.variable.name).toLowerCase()} ${s.data.total}`).join(' · ')
            : speedLabel(primary.variable.name)
        }
      />

      {isChar && (
        <Box px={22} pt={4} pb={10}>
          <Wg4.Lbl>Temporary speed</Wg4.Lbl>
          <Group gap={8} mt={5} wrap='nowrap' align='center'>
            <NumberInput
              // Pre-fill with the current computed speed so the player can just
              // bump it (step 5) — e.g. a +5 status bonus is one press of the up
              // arrow. tempActive still keys off the STORED temp_speed, so this
              // pre-fill doesn't mark a temporary override until they change it.
              value={tempSpeed ?? primary.data.total}
              onChange={(v) => setTempSpeed(v === '' || v === null || v === undefined ? null : Number(v))}
              min={0}
              step={5}
              suffix=' ft'
              size='xs'
              w={120}
              aria-label='Temporary speed'
            />
            <Button
              variant='light'
              color='gray'
              size='xs'
              disabled={!tempActive}
              onClick={() => setTempSpeed(null)}
            >
              Reset to default
            </Button>
          </Group>
          <Text fz='xs' c='dimmed' mt={5}>
            Override your Speed during play. While a temporary speed is set the Speed shows in{' '}
            <Text c='#d9742e' span fz='xs' fw={600}>
              this color
            </Text>
            ; Reset returns to the computed default.
          </Text>
        </Box>
      )}

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
            <Text c='var(--wg4-accent)' span>
              {breakdown.conditionals.length} situational
            </Text>
            <Text size='xs' mt={6}>
              These will only apply situationally:
            </Text>
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
          </Wg4.Indent>
        </Box>
      )}
    </Box>
  );
}
