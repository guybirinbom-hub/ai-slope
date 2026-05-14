import {
  FUNDAMENTAL_RUNES,
  isItemArmor,
  isItemWeapon,
  isItemWithPropertyRunes,
  isItemWithRunes,
  isItemWithUpgrades,
} from '@items/inv-utils';
import { applyMonsterPartsToItem } from '@items/monster-parts';
import { Box, Button, Divider, Group, Text } from '@mantine/core';
import { Item } from '@schemas/content';
import RichText from './RichText';
import { useAtom } from 'jotai';
import { drawerState } from '@atoms/navAtoms';
import { useQuery } from '@tanstack/react-query';
import { fetchContentById } from '@content/content-store';

export function ItemRunesDescription({ item }: { item: Item }) {
  const [_drawer, openDrawer] = useAtom(drawerState);

  // Battlezoo Monster Parts: when the item is in MP mode, project the
  // refinement value back onto the runes fields so the display below
  // (which reads item.meta_data.runes.* directly) shows the derived
  // potency / striking / resilient and lists the imbued properties.
  if (item.meta_data?.battlezoo?.enabled) {
    item = applyMonsterPartsToItem(item);
  }

  // Fetch BOTH fundamental rune items AND any property rune items that
  // weren't inflated at save time (we save only `{id, name}` for
  // property runes added via the Battlezoo picker; the upstream
  // content path normally pre-inflates with the full Item embedded).
  // Returns { fundamentals: Item[], property: Map<id, Item> }.
  const propertyRuneIds = (item.meta_data?.runes?.property ?? [])
    .filter((p) => typeof p !== 'string' && !p.rune?.description)
    .map((p) => p.id);

  const { data } = useQuery({
    queryKey: [
      `get-item-fundamentals-runes`,
      { itemId: item.id, propIds: propertyRuneIds.join(',') },
    ],
    queryFn: async () => {
      const fundamentalIds: number[] = [];

      // Get potency rune item
      const potencyNum = item.meta_data?.runes?.potency;
      if (potencyNum) {
        if (isItemWeapon(item)) {
          fundamentalIds.push(FUNDAMENTAL_RUNES[`potency_weapon_${potencyNum}`]);
        } else if (isItemArmor(item)) {
          fundamentalIds.push(FUNDAMENTAL_RUNES[`potency_armor_${potencyNum}`]);
        }
      }
      // Get striking rune item
      const strikingNum = item.meta_data?.runes?.striking;
      if (strikingNum) fundamentalIds.push(FUNDAMENTAL_RUNES[`striking_${strikingNum}`]);
      // Get resilient rune item
      const resilientNum = item.meta_data?.runes?.resilient;
      if (resilientNum) fundamentalIds.push(FUNDAMENTAL_RUNES[`resilient_${resilientNum}`]);

      const [fundamentalResults, propertyResults] = await Promise.all([
        Promise.allSettled(fundamentalIds.map((id) => fetchContentById<Item>('item', id))),
        Promise.allSettled(propertyRuneIds.map((id) => fetchContentById<Item>('item', id))),
      ]);

      const fundamentals: Item[] = fundamentalResults
        .filter((r): r is PromiseFulfilledResult<Item> => r.status === 'fulfilled' && !!r.value)
        .map((r) => r.value);

      const property = new Map<number, Item>();
      propertyResults.forEach((r, i) => {
        if (r.status === 'fulfilled' && r.value) {
          property.set(propertyRuneIds[i], r.value);
        }
      });

      return { fundamentals, property };
    },
    enabled: isItemWithRunes(item),
  });

  if (!isItemWithRunes(item)) {
    return <></>;
  }

  const fundamentalRunes = data?.fundamentals ?? [];
  const fetchedProperty = data?.property ?? new Map<number, Item>();

  // For old broken item runes, we just return null to not show anything in order to avoid the page from breaking.
  if (
    item.meta_data?.runes?.property &&
    item.meta_data.runes.property.length > 0 &&
    item.meta_data.runes.property.every((s) => typeof s === 'string')
  ) {
    return null;
  }
  // Property runes — prefer the inflated `rune` object on the entry,
  // otherwise fall back to whatever we fetched in the query above.
  // This makes Battlezoo Imbued Property items (stored as `{id, name}`
  // only) render their full descriptions just like Paizo property runes.
  const propertyRunes = (item.meta_data?.runes?.property || [])
    .map((p) => ({
      ...p,
      rune: p.rune ?? fetchedProperty.get(p.id),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <>
      {propertyRunes.length > 0 && (
        <Box pb={10}>
          <Divider mb='sm' label='Property Runes' />
          {propertyRunes.map((rune, index) => (
            <Box key={index}>
              {index > 0 && <Divider my='sm' />}
              <Group align='start' justify='space-between' pb={2}>
                <Box>
                  <Text fw={600} c='gray.2' span>
                    {rune.name}
                  </Text>
                </Box>
                <Button
                  variant='light'
                  size='compact-xs'
                  radius='xl'
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    openDrawer({
                      type: 'item',
                      data: { id: rune.id },
                      extra: { addToHistory: true },
                    });
                  }}
                >
                  View Item
                </Button>
              </Group>
              <RichText>{rune.rune?.description}</RichText>
            </Box>
          ))}
        </Box>
      )}

      {fundamentalRunes.length > 0 && (
        <Box>
          <Divider mb='sm' label='Fundamental Runes' />
          {fundamentalRunes.map((rune, index) => (
            <Box key={index}>
              {index > 0 && <Divider my='sm' />}
              <Group align='start' justify='space-between' pb={2}>
                <Box>
                  <Text fw={600} c='gray.2' span>
                    {rune.name}
                  </Text>
                </Box>
                <Button
                  variant='light'
                  size='compact-xs'
                  radius='xl'
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    openDrawer({
                      type: 'item',
                      data: { id: rune.id },
                      extra: { addToHistory: true },
                    });
                  }}
                >
                  View Item
                </Button>
              </Group>
              <RichText>{rune?.description}</RichText>
            </Box>
          ))}
        </Box>
      )}
    </>
  );
}

export function ItemUpgradesDescription(props: { item: Item }) {
  const [_drawer, openDrawer] = useAtom(drawerState);
  const { item } = props;

  if (!isItemWithUpgrades(item)) {
    return <></>;
  }

  const slots = item.meta_data?.starfinder?.slots || [];
  slots.sort((a, b) => a.name.localeCompare(b.name));

  return (
    <>
      <Divider mb='sm' />
      {slots.map((slot, index) => (
        <Box key={index}>
          {index > 0 && <Divider my='sm' />}
          <Group align='start' justify='space-between' pb={2}>
            <Box>
              <Text fw={600} c='gray.2' span>
                {slot.name}
              </Text>
            </Box>
            <Button
              variant='light'
              size='compact-xs'
              radius='xl'
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                openDrawer({
                  type: 'item',
                  data: { id: slot.id },
                  extra: { addToHistory: true },
                });
              }}
            >
              View Item
            </Button>
          </Group>
          <RichText>{slot.upgrade?.description}</RichText>
        </Box>
      ))}
    </>
  );
}
