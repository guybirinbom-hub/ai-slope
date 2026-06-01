import { Wg4 } from '@common/wg4/primitives';
import { getWeaponStats } from '@items/weapon-handler';
import { Box, Group, Title, Text } from '@mantine/core';
import { Item } from '@schemas/content';
import { StoreID } from '@schemas/variables';
import { sign } from '@utils/numbers';

export function StatWeaponDrawerTitle(props: { data: { id: StoreID; item: Item } }) {
  return (
    <Group justify='space-between' wrap='nowrap'>
      <Group wrap='nowrap' gap={10}>
        <Box>
          <Title order={3}>{props.data.item.name}</Title>
        </Box>
      </Group>
      <Box></Box>
    </Group>
  );
}

export function StatWeaponDrawerContent(props: { data: { id: StoreID; item: Item } }) {
  const stats = getWeaponStats(props.data.id, props.data.item);
  const total = stats.attack_bonus.total[0];

  const attackRows: { label: string; source: string; value: string | number; sign?: 'pos' | 'neg' }[] = [];
  for (const [partKey, value] of stats.attack_bonus.parts.entries()) {
    attackRows.push({
      label: partKey,
      source: '',
      value: sign(value),
      sign: value >= 0 ? 'pos' : 'neg',
    });
  }

  const damageRows: { label: string; source: string; value: string | number; sign?: 'pos' | 'neg' }[] = [
    {
      label: 'Dice',
      source: `${stats.damage.dice}${stats.damage.die}`,
      value: `${stats.damage.dice}${stats.damage.die}`,
      sign: 'pos',
    },
  ];
  for (const [partKey, value] of stats.damage.bonus.parts.entries()) {
    damageRows.push({
      label: partKey,
      source: '',
      value: sign(value),
      sign: value >= 0 ? 'pos' : 'neg',
    });
  }
  damageRows.push({
    label: 'Total damage',
    source: stats.damage.damageType,
    value: `${stats.damage.dice}${stats.damage.die}${stats.damage.bonus.total ? ` ${sign(stats.damage.bonus.total)}` : ''}`,
    sign: 'pos',
  });

  const mapBonus = total - 5;
  const mapBonus2 = total - 10;

  return (
    <Box>
      <Wg4.StatHero
        value={sign(total)}
        metaLabel='MAP'
        metaValue={`${sign(mapBonus)} / ${sign(mapBonus2)}`}
      />
      <Box px={22} pt={8}>
        <Wg4.Lbl>Attack roll</Wg4.Lbl>
      </Box>
      <Wg4.StatBreakdown
        rows={[
          ...attackRows,
          { label: 'Total', source: '', value: sign(total), total: true },
        ]}
      />
      <Box px={22} pt={4}>
        <Wg4.Divider />
        <Wg4.Lbl>Damage</Wg4.Lbl>
      </Box>
      <Wg4.StatBreakdown rows={damageRows} />
      {stats.damage.other && stats.damage.other.length > 0 && (
        <Box px={22} pb={14}>
          <Wg4.Divider />
          <Wg4.Indent>
            <Wg4.Lbl>Other damage</Wg4.Lbl>{' '}
            <Text span>{stats.damage.other.map((o: any) => `${o.dice}${o.die} ${o.damageType}`).join(' + ')}</Text>
          </Wg4.Indent>
        </Box>
      )}
    </Box>
  );
}
