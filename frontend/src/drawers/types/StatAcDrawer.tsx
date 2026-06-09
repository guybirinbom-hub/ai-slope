import { characterState } from '@atoms/characterAtoms';
import { Wg4 } from '@common/wg4/primitives';
import RichText from '@common/RichText';
import { getAcParts } from '@items/armor-handler';
import { getBestArmor } from '@items/inv-utils';
import { Title, Text, Group, Box, List, Divider, Button } from '@mantine/core';
import { Inventory, InventoryItem } from '@schemas/content';
import { StoreID } from '@schemas/variables';
import { sign } from '@utils/numbers';
import { getFinalAcValue, getVariableBreakdown } from '@variables/variable-helpers';
import { useAtomValue } from 'jotai';

export function StatAcDrawerTitle(props: {
  data: { id: StoreID; inventory?: Inventory; onViewItem?: (invItem: InventoryItem) => void };
}) {
  const _character = useAtomValue(characterState);
  const inventory = props.data.inventory ?? _character?.inventory;
  const bestArmor = getBestArmor(props.data.id, inventory);
  const itemName = bestArmor?.item.name ?? 'Unarmored';

  return (
    <Group justify='space-between' wrap='nowrap'>
      <Group wrap='nowrap' gap={10}>
        <Box>
          <Title order={3}>Armor Class</Title>
        </Box>
      </Group>
      <Box>
        {bestArmor && (
          <Button
            variant='light'
            size='compact-xs'
            radius='xl'
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              props.data.onViewItem?.(bestArmor);
            }}
          >
            View {itemName}
          </Button>
        )}
      </Box>
    </Group>
  );
}

export function StatAcDrawerContent(props: { data: { id: StoreID; inventory?: Inventory } }) {
  const _character = useAtomValue(characterState);
  const inventory = props.data.inventory ?? _character?.inventory;
  const bestArmor = getBestArmor(props.data.id, inventory);

  const parts = getAcParts(props.data.id, bestArmor?.item);
  const armorName = bestArmor?.item.name ?? 'unarmored';
  const acBonusParts = getVariableBreakdown(props.data.id, 'AC_BONUS')!;
  const totalAc = getFinalAcValue(props.data.id, bestArmor?.item);

  const bonusRows: { label: string; source: string; value: number }[] = [];
  for (const [key, bonus] of acBonusParts.bonuses.entries()) {
    const label = key.startsWith('untyped ') ? 'Untyped bonus' : `${key.charAt(0).toUpperCase()}${key.slice(1)} bonus`;
    const src = bonus.composition.map((c) => c.source).join(', ');
    bonusRows.push({ label, source: src, value: bonus.value });
  }

  return (
    <Box>
      <Wg4.StatHero value={totalAc} metaLabel='Armor' metaValue={armorName} />
      <Wg4.StatBreakdown
        rows={[
          { label: 'Base', source: 'starting', value: 10, sign: 'pos' },
          {
            label: 'Proficiency',
            source: `wearing ${armorName}`,
            value: sign(parts.profBonus),
            sign: (parts.profBonus >= 0 ? 'pos' : 'neg') as 'pos' | 'neg',
          },
          {
            label: 'Dexterity',
            source: bestArmor?.item ? 'attribute · armor Dex cap' : 'attribute',
            value: sign(parts.dexBonus),
            sign: (parts.dexBonus >= 0 ? 'pos' : 'neg') as 'pos' | 'neg',
          },
          {
            label: armorName !== 'unarmored' ? armorName : 'Armor item',
            source: 'item bonus',
            value: sign(parts.armorBonus),
            sign: (parts.armorBonus >= 0 ? 'pos' : 'neg') as 'pos' | 'neg',
          },
          ...(acBonusParts.baseValue !== 0
            ? [
                {
                  label: 'Base AC modifier',
                  source: 'adjustment',
                  value: sign(acBonusParts.baseValue),
                  sign: (acBonusParts.baseValue >= 0 ? 'pos' : 'neg') as 'pos' | 'neg',
                },
              ]
            : []),
          ...bonusRows.map((r) => ({
            label: r.label,
            source: r.source,
            value: sign(r.value),
            sign: (r.value >= 0 ? 'pos' : 'neg') as 'pos' | 'neg',
          })),
          { label: 'Total', source: '', value: totalAc, total: true },
        ]}
      />

      {acBonusParts.conditionals.length > 0 && (
        <Box px={22} pb={14}>
          <Wg4.Divider />
          <Wg4.Indent>
            <Wg4.Lbl>Conditional</Wg4.Lbl>{' '}
            <Text c='var(--wg4-accent)' span>
              {acBonusParts.conditionals.length} situational bonus
              {acBonusParts.conditionals.length === 1 ? '' : 'es'}
            </Text>
            <Text size='xs' mt={6}>
              These will only apply situationally:
            </Text>
            <Divider my={5} />
            <List size='xs'>
              {acBonusParts.conditionals.map((item, i) => (
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
          Armor Class represents how difficult this individual is to hit and damage in combat. This metric is the
          combination of their ability to dodge, their natural toughness, and the protection provided by their armor.
        </RichText>
      </Box>
    </Box>
  );
}
