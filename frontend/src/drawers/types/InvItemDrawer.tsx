import { characterState } from '@atoms/characterAtoms';
import { glassStyle } from '@utils/colors';
import IndentedText from '@common/IndentedText';
import RichText from '@common/RichText';
import TraitsDisplay from '@common/TraitsDisplay';
import { priceToString } from '@items/currency-handler';
import {
  FUNDAMENTAL_RUNES,
  compileTraits,
  determineItemMetaType,
  getCurrentUses,
  usesSpentChargeConvention,
  getFillableSpellHolder,
  getItemHealth,
  getMaxUses,
  getScrollWandDisplayName,
  isItemArchaic,
  isItemArmor,
  isItemBroken,
  isItemContainer,
  isItemExhausted,
  isItemFormula,
  isItemRangedWeapon,
  isItemShield,
  isItemWeapon,
  isItemMetaAttack,
  isItemWithGradeImprovement,
  isItemWithMaterial,
  isItemWithPropertyRunes,
  isItemWithQuantity,
  isItemWithRunes,
  isItemWithUpgrades,
  labelizeBulk,
  isItemWithHealth,
} from '@items/inv-utils';
import { getWeaponStats, parseOtherDamage } from '@items/weapon-handler';
import {
  MAGIC_ITEM_DCS,
  levelFromValue,
  monsterPartsCategoryFor,
  refinementBonuses,
  valueForLevel,
} from '@items/monster-parts';
import { getCachedContent } from '@content/content-store';
import { selectContent } from '@common/select/SelectContent';
import type { Trait } from '@schemas/content';
import {
  Accordion,
  ActionIcon,
  Badge,
  Box,
  Button,
  Divider,
  Group,
  HoverCard,
  Menu,
  NumberInput,
  Paper,
  ScrollArea,
  Select,
  Stack,
  Text,
  TextInput,
  Title,
  rem,
  useMantineTheme,
} from '@mantine/core';
import { getHotkeyHandler } from '@mantine/hooks';
import { CreateItemModal } from '@modals/CreateItemModal';
import {
  IconChevronDown,
  IconEdit,
  IconHelpCircle,
  IconRefresh,
  IconSquareRounded,
  IconSquareRoundedFilled,
  IconTrashXFilled,
} from '@tabler/icons-react';
import { InventoryItem } from '@schemas/content';
import { sign } from '@utils/numbers';
import { toLabel } from '@utils/strings';
import { evaluate } from 'mathjs/number';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchItemByName } from '@content/content-store';
import { useAtom, useAtomValue } from 'jotai';
import { SetterOrUpdater } from '@utils/type-fixing';
import { getArmorSpecialization } from '@specializations/armor-specializations';
import { getWeaponSpecialization } from '@specializations/weapon-specializations';
import { drawerState } from '@atoms/navAtoms';
import TokenSelect from '@common/TokenSelect';
import { ItemRunesDescription, ItemUpgradesDescription } from '@common/ItemRunesDescription';
import { EllipsisText } from '@common/EllipsisText';
import { getIconMap } from '@common/ItemIcon';
import { DisplayIcon } from '@common/IconDisplay';
import { StoreID } from '@schemas/variables';
import { cloneDeep } from 'lodash-es';
import { titleCase } from 'title-case';
import { getAnchorStyles } from '@utils/anchor';
import { ItemMetaGroupArmor, ItemMetaGroupWeapon } from '@schemas/shared';

export function InvItemDrawerTitle(props: { data: { invItem: InventoryItem } }) {
  // Items that have hit 0 charges/uses get dimmed in the title so
  // the player can tell at a glance the thing is "spent". Dim is
  // purely visual — the drawer body stays interactive (the refill
  // button on the charges row needs to remain clickable).
  const exhausted = isItemExhausted(props.data.invItem.item);
  // For generic scroll/wand items with a chosen spell, render
  // "Magic Wand of Fireball (3rd-Rank)" instead of the bland
  // "Magic Wand (3rd-rank Spell)". Falls through to the raw name
  // for everything else.
  const displayName = getScrollWandDisplayName(props.data.invItem.item);
  return (
    <>
      <Group
        justify='space-between'
        wrap='nowrap'
        style={exhausted ? { opacity: 0.45 } : undefined}
      >
        <Group wrap='nowrap' gap={10}>
          <Box>
            <Title order={3}>{displayName}</Title>
          </Box>
        </Group>
        <Text style={{ textWrap: 'nowrap' }}>{determineItemMetaType(props.data.invItem.item, true)}</Text>
      </Group>
    </>
  );
}

export function InvItemDrawerContent(props: {
  data: {
    storeId: StoreID;
    invItem: InventoryItem;
    onItemUpdate: (invItem: InventoryItem) => void;
    onItemDelete: (invItem: InventoryItem) => void;
    onItemMove: (invItem: InventoryItem, containerItem: InventoryItem | null) => void;
  };
}) {
  // InvItem cache (to handle updates while the drawer is still open)
  const [_cachedInvItem, _setCachedInvItem] = useState<InventoryItem | null>(null);
  const onItemUpdate = (i: InventoryItem) => {
    const cloneI = cloneDeep(i);
    props.data.onItemUpdate(cloneI);
    _setCachedInvItem(cloneI);
  };
  const invItem = _cachedInvItem ?? props.data.invItem;
  //

  const theme = useMantineTheme();
  const [_drawer, openDrawer] = useAtom(drawerState);

  const [editingItem, setEditingItem] = useState(false);

  const character = useAtomValue(characterState);
  const containerItems = (character?.inventory?.items.filter((item) => isItemContainer(item.item)) ?? []).filter(
    (i) => i.id !== invItem.id
  );

  let price = null;
  const _invItemPrice = invItem.item.price
    ? {
        cp: Number(invItem.item.price.cp) || undefined,
        sp: Number(invItem.item.price.sp) || undefined,
        gp: Number(invItem.item.price.gp) || undefined,
        pp: Number(invItem.item.price.pp) || undefined,
      }
    : undefined;
  if (_invItemPrice && priceToString(_invItemPrice) !== '—') {
    price = (
      <>
        <Text key={1} fw={600} c='gray.2' span>
          Price
        </Text>{' '}
        {priceToString(_invItemPrice)}
      </>
    );
  }

  const UBH = [];
  if (invItem.item.usage) {
    UBH.push(
      <>
        <Text key={0} fw={600} c='gray.2' span>
          Usage
        </Text>{' '}
        {invItem.item.usage.replace(/-/g, ' ')}
      </>
    );
  }
  if (
    invItem.item.bulk !== undefined &&
    invItem.item.bulk !== null &&
    `${invItem.item.bulk}`.trim() !== '' &&
    !(isItemMetaAttack(invItem.item) && `${invItem.item.bulk}`.trim() === '0')
  ) {
    UBH.push(
      <>
        <Text key={1} fw={600} c='gray.2' span>
          Bulk
        </Text>{' '}
        {labelizeBulk(invItem.is_formula ? '0' : invItem.item.bulk)}
      </>
    );
  }
  if (invItem.item.hands && !invItem.item.usage?.trim()) {
    UBH.push(
      <>
        <Text key={1} fw={600} c='gray.2' span>
          Hands
        </Text>{' '}
        {invItem.item.hands}
      </>
    );
  }

  let craftReq = null;
  if (invItem.item.craft_requirements) {
    craftReq = (
      <>
        <Text key={1} fw={600} c='gray.2' span>
          Craft Requirements
        </Text>{' '}
        {invItem.item.craft_requirements}
      </>
    );
  }

  return (
    <Box pb={20}>
      <DisplayIcon strValue={invItem.item.meta_data?.image_url} />
      <Box>
        {/* Note: Can't use a Stack here as it breaks the floating image */}
        <Box pb={2}>
          <TraitsDisplay
            traitIds={compileTraits(invItem.item)}
            rarity={invItem.item.rarity}
            pfSize={invItem.item.size}
            broken={isItemBroken(invItem.item)}
            shoddy={invItem.item.meta_data?.is_shoddy}
            archaic={isItemArchaic(invItem.item)}
            formula={isItemFormula(invItem)}
            interactable
          />
        </Box>

        <InvItemSections
          storeId={props.data.storeId}
          invItem={invItem}
          onItemUpdate={(invItem) => onItemUpdate(invItem)}
          openDrawer={openDrawer}
        />

        {price && <IndentedText ta='justify'>{price}</IndentedText>}
        {UBH.length > 0 && (
          <IndentedText ta='justify'>
            {UBH.flatMap((node, index) => (index < UBH.length - 1 ? [node, '; '] : [node]))}
          </IndentedText>
        )}

        <Divider />
        {(() => {
          // For generic scroll/wand items with a chosen spell, prepend
          // a "Spell: [name](link_spell_<id>) (cast at Nth rank)" line
          // so the description shows the chosen spell and the name is
          // a clickable link into the spell drawer. RichText's
          // link_<type>_<id> sentinel resolver does the click → drawer
          // plumbing for us.
          //
          // When the holder's rank > the spell's natural rank (e.g. a
          // 3rd-rank wand holding Magic Missile, naturally 1st-rank),
          // we render "1st → 3rd" with the Unicode arrow to mirror
          // how cantrips auto-heighten by character level.
          const holder = getFillableSpellHolder(invItem.item);
          const chosen = invItem.item.meta_data?.scroll_wand;
          let description = invItem.item.description;
          if (holder && chosen?.spell_id && chosen?.spell_name) {
            const ord = (n: number) => {
              const m10 = n % 10;
              const m100 = n % 100;
              if (m10 === 1 && m100 !== 11) return 'st';
              if (m10 === 2 && m100 !== 12) return 'nd';
              if (m10 === 3 && m100 !== 13) return 'rd';
              return 'th';
            };
            const castRank = chosen.spell_rank;
            const baseRank = chosen.base_rank;
            const rankDisplay =
              typeof baseRank === 'number' && baseRank > 0 && baseRank < castRank
                ? `${baseRank}${ord(baseRank)} → ${castRank}${ord(castRank)}`
                : `${castRank}${ord(castRank)}`;
            const prelude = `**Spell:** [${chosen.spell_name}](link_spell_${chosen.spell_id}) (cast at ${rankDisplay} rank)\n\n`;
            description = prelude + description;
          }
          return (
            <RichText ta='justify' store={props.data.storeId} py={5}>
              {description}
            </RichText>
          );
        })()}

        {/* Runes accordion — always shown when the item supports runes.
            For items in Monster Parts mode, ItemRunesDescription
            internally calls applyMonsterPartsToItem so the displayed
            rune values reflect the derived ones from refinement, and
            the imbued properties show up in the same list with their
            descriptions. The header is relabelled in MP mode to
            reflect what the player is actually looking at. */}
        {isItemWithRunes(invItem.item) && (
          <Accordion variant='separated' my={5}>
            <Accordion.Item value='runes'>
              <Accordion.Control icon={getIconMap('1.0rem', theme.colors.gray[6])['RUNE']}>
                {invItem.item.meta_data?.battlezoo?.enabled ? 'Refinement & Imbued Properties' : 'Runes'}
              </Accordion.Control>
              <Accordion.Panel>
                <ItemRunesDescription item={invItem.item} />
              </Accordion.Panel>
            </Accordion.Item>
          </Accordion>
        )}

        {/* Battlezoo Monster Parts panel — only shows on items that
            can carry runes AND when the character has the variant on.
            Lets the user flip the item into monster-parts mode and set
            its refinement value (gp of monster parts invested). The
            derived rune values are computed at character-compute time
            via applyMonsterPartsToItem (see process/items/monster-parts.ts). */}
        {isItemWithRunes(invItem.item) && character?.variants?.monster_parts && (
          <MonsterPartsPanel invItem={invItem} onItemUpdate={onItemUpdate} />
        )}

        {isItemWithUpgrades(invItem.item) && (
          <Accordion variant='separated' my={5}>
            <Accordion.Item value='upgrades'>
              <Accordion.Control icon={getIconMap('1.0rem', theme.colors.gray[6])['UPGRADE']}>
                Upgrades
              </Accordion.Control>
              <Accordion.Panel>
                <ItemUpgradesDescription item={invItem.item} />
              </Accordion.Panel>
            </Accordion.Item>
          </Accordion>
        )}

        {craftReq && (
          <>
            <Divider />
            <IndentedText ta='justify'>{craftReq}</IndentedText>
          </>
        )}
      </Box>
      <Box
        style={[
          // Aligns with the favorite-star / edit / delete row in
          // DrawerBase, which sits at b: 50 to stay well clear of
          // the Windows taskbar / window bottom edge.
          getAnchorStyles({ r: 5, b: 50 }),
          {
            width: '100%',
          },
        ]}
      >
        <Group justify='space-between' wrap='nowrap'>
          <Group wrap='nowrap' gap={15} ml={0}>
            {/* Per-instance charges / uses tracker. Visible for any
                item with an inferred max (explicit charges.max, a
                "Frequency N per day" phrase in the description, or
                a CONSUMABLE trait — see getMaxUses in inv-utils).
                Click individual tokens to flip used/unused; the ↻
                Refill button resets back to full. Refill works on
                single-use consumables too — handy if you tapped one
                by accident. We persist BOTH `current` AND `max` on
                every save so a description-derived max gets pinned
                to the item and won't shift if the dataset changes. */}
            {(() => {
              const maxUses = getMaxUses(invItem.item);
              if (maxUses <= 0) return null;
              // `current` is always uses REMAINING here (full = max), so a
              // full item shows filled tokens and the Refill button fills
              // them — identical to what Rest does. getCurrentUses already
              // normalises wands/staves (which persist SPENT) into this.
              const current = getCurrentUses(invItem.item);
              const spentConvention = usesSpentChargeConvention(invItem.item);
              const setCurrent = (remaining: number) =>
                onItemUpdate({
                  ...invItem,
                  item: {
                    ...invItem.item,
                    meta_data: {
                      ...invItem.item.meta_data!,
                      charges: {
                        ...invItem.item.meta_data?.charges,
                        // Persist in the item's native convention: wands/
                        // staves store SPENT (so casting/overcharge keeps
                        // working), everything else stores REMAINING.
                        current: spentConvention ? Math.max(0, maxUses - remaining) : remaining,
                        max: maxUses,
                      },
                    },
                  },
                });
              // The favorite star floats at left: 5 px with a ~40 px
              // backdrop pill; ml: 55 puts the charges row to the
              // right of it with breathing room. The token row sizes
              // with the use count so single-use items don't leave a
              // wide empty strip between the lone token and the
              // refill button — both numbers are pure CSS, nothing
              // here changes click / pointer-events behavior.
              const tokenAreaWidth = Math.max(28, Math.min(maxUses * 22, 220));
              return (
                <Box mb={-10} ml={55}>
                  <Group gap={6} wrap='nowrap' align='center'>
                    {/* Explicit "N / max" text so the player can see at a
                        glance how many uses are left, even on single-use
                        items where the token row is just one square.
                        Tokens stay clickable for setting any value in
                        between; the refill (↻) button at the end resets
                        to max. */}
                    <Text fz='xs' fw={600} c='gray.2' style={{ minWidth: 32, textAlign: 'right' }}>
                      {current} / {maxUses}
                    </Text>
                    <ScrollArea scrollbars='x' w={tokenAreaWidth}>
                      <TokenSelect
                        count={maxUses}
                        value={current}
                        onChange={setCurrent}
                        size='xs'
                        emptySymbol={
                          <ActionIcon
                            variant='transparent'
                            color='gray.1'
                            aria-label='Item Charge, Spent'
                            size='xs'
                            style={{
                              opacity: 0.7,
                              ...glassStyle(),
                            }}
                          >
                            <IconSquareRounded size='1rem' />
                          </ActionIcon>
                        }
                        fullSymbol={
                          <ActionIcon
                            variant='transparent'
                            color='gray.1'
                            aria-label='Item Charge, Available'
                            size='xs'
                            style={{
                              opacity: 0.7,
                              ...glassStyle(),
                            }}
                          >
                            <IconSquareRoundedFilled size='1rem' />
                          </ActionIcon>
                        }
                      />
                    </ScrollArea>
                    <ActionIcon
                      variant='subtle'
                      color='gray.3'
                      aria-label='Refill charges'
                      title='Refill'
                      size='sm'
                      radius='xl'
                      onClick={() => setCurrent(maxUses)}
                    >
                      <IconRefresh size='0.9rem' />
                    </ActionIcon>
                  </Group>
                </Box>
              );
            })()}
          </Group>
          <Group wrap='nowrap' gap={15} mr={15}>
            {!invItem.item.meta_data?.unselectable && containerItems.length > 0 && (
              <Menu
                transitionProps={{ transition: 'pop-top-right' }}
                position='top-end'
                // width={140}
                withinPortal
                zIndex={10000}
              >
                <Menu.Target>
                  <Button
                    variant='light'
                    color='teal'
                    size='compact-sm'
                    radius='xl'
                    rightSection={<IconChevronDown style={{ width: rem(18), height: rem(18) }} stroke={1.5} />}
                    styles={{
                      section: {
                        marginLeft: 5,
                      },
                    }}
                    style={{
                      ...glassStyle(),
                    }}
                    pr={5}
                  >
                    Move Item
                  </Button>
                </Menu.Target>
                <Menu.Dropdown>
                  <Menu.Item
                    onClick={() => {
                      props.data.onItemMove(invItem, null);
                    }}
                  >
                    Unstored
                  </Menu.Item>
                  <Menu.Divider />
                  {containerItems.map((containerItem, index) => (
                    <Menu.Item
                      key={index}
                      onClick={() => {
                        props.data.onItemMove(invItem, containerItem);
                      }}
                    >
                      {containerItem.item.name}
                    </Menu.Item>
                  ))}
                </Menu.Dropdown>
              </Menu>
            )}
            <ActionIcon
              variant='light'
              color='cyan'
              radius='xl'
              aria-label='Edit Item'
              style={{
                ...glassStyle(),
              }}
              onClick={() => {
                setEditingItem(true);
              }}
            >
              <IconEdit style={{ width: '70%', height: '70%' }} stroke={1.5} />
            </ActionIcon>
            {!invItem.item.meta_data?.unselectable && (
              <ActionIcon
                variant='light'
                color='red'
                radius='xl'
                aria-label='Remove Item'
                style={{
                  ...glassStyle(),
                }}
                onClick={() => {
                  props.data.onItemDelete(invItem);
                }}
              >
                <IconTrashXFilled style={{ width: '70%', height: '70%' }} stroke={1.5} />
              </ActionIcon>
            )}
          </Group>
        </Group>
        {editingItem && (
          <CreateItemModal
            opened={editingItem}
            editItem={invItem.item}
            onComplete={async (item) => {
              const newInvItem = {
                ...cloneDeep(invItem),
                item,
              };
              onItemUpdate(newInvItem);
              openDrawer(null);
              setTimeout(() => {
                openDrawer({
                  type: 'inv-item',
                  data: {
                    ...props.data,
                    invItem: newInvItem,
                  },
                });
              }, 1);
            }}
            onCancel={() => {
              setEditingItem(false);
            }}
          />
        )}
      </Box>
    </Box>
  );
}

function InvItemSections(props: {
  storeId: StoreID;
  invItem: InventoryItem;
  onItemUpdate: (invItem: InventoryItem) => void;
  openDrawer: SetterOrUpdater<any>;
}) {
  const [drawer, openDrawer] = useAtom(drawerState);

  const materialType = props.invItem.item.meta_data?.material?.type;
  const materialGrade = props.invItem.item.meta_data?.material?.grade;

  const { data: materialItem } = useQuery({
    queryKey: [`find-material-item-${materialType}`],
    queryFn: async () => {
      if (!materialType) return null;
      return await fetchItemByName(materialType);
    },
    enabled: !!materialType,
  });

  const ac = props.invItem.item.meta_data?.ac_bonus;
  let dexCap = props.invItem.item.meta_data?.dex_cap;
  let strength = props.invItem.item.meta_data?.strength;
  if (!dexCap && dexCap !== 0) {
    dexCap = undefined;
  }
  if (!strength && strength !== 0) {
    strength = undefined;
  }

  const checkPenalty = props.invItem.item.meta_data?.check_penalty;
  const speedPenalty = props.invItem.item.meta_data?.speed_penalty;

  const healthStats = getItemHealth(props.invItem.item);

  const healthRef = useRef<HTMLInputElement>(null);
  const [health, setHealth] = useState<string>(
    props.invItem.item.meta_data?.hp !== undefined ? `${props.invItem.item.meta_data.hp}` : `${healthStats.hp_max}`
  );
  useEffect(() => {
    if (props.invItem.item.meta_data?.hp && props.invItem.item.meta_data.hp !== parseInt(health)) {
      setHealth(`${props.invItem.item.meta_data.hp}`);
    }
  }, [props.invItem]);

  ///

  const hasQuantity = isItemWithQuantity(props.invItem.item);
  const hasHealth = isItemWithHealth(props.invItem.item);
  const hasAttackAndDamage = isItemWeapon(props.invItem.item);
  const hasArmor = isItemArmor(props.invItem.item) || isItemShield(props.invItem.item);

  ///

  let quantitySection = null;
  if (hasQuantity) {
    quantitySection = (
      <Paper shadow='xs' my={5} py={5} px={10} bg='var(--wg4-surface-2)' radius='md' style={{ border: '1px solid var(--wg4-border-soft)', boxShadow: 'none' }}>
        <Group wrap='nowrap'>
          <Text fw={600} c='gray.2' span>
            Quantity
          </Text>{' '}
          <NumberInput
            placeholder='Amount'
            size='xs'
            min={1}
            defaultValue={props.invItem.item.meta_data?.quantity}
            onChange={(value) => {
              props.onItemUpdate({
                ...props.invItem,
                item: {
                  ...props.invItem.item,
                  meta_data: {
                    ...props.invItem.item.meta_data!,
                    quantity: parseInt(`${value}`) || 1,
                  },
                },
              });
            }}
          />
        </Group>
      </Paper>
    );
  }

  let healthSection = null;
  if (hasHealth) {
    const handleHealthSubmit = () => {
      const inputHealth = health ?? '0';
      let result = -1;
      try {
        result = evaluate(inputHealth);
      } catch (e) {
        result = parseInt(inputHealth);
      }
      if (isNaN(result)) result = 0;
      result = Math.floor(result);
      if (result < 0) result = 0;
      if (result > healthStats.hp_max) result = healthStats.hp_max;

      props.onItemUpdate({
        ...props.invItem,
        item: {
          ...props.invItem.item,
          meta_data: {
            ...props.invItem.item.meta_data!,
            hp: result,
          },
        },
      });
      setHealth(`${result}`);
      healthRef.current?.blur();
    };

    healthSection = (
      <Paper shadow='xs' my={5} py={5} px={10} bg='var(--wg4-surface-2)' radius='md' style={{ position: 'relative', border: '1px solid var(--wg4-border-soft)', boxShadow: 'none' }}>
        <Group gap={5}>
          <Group wrap='nowrap' gap={10} style={{ flexGrow: 1 }}>
            <Text fw={600} c='gray.2' span>
              Hit Points
            </Text>{' '}
            <TextInput
              ref={healthRef}
              w={120}
              placeholder='HP'
              value={health}
              onChange={(e) => {
                setHealth(e.target.value);
              }}
              onFocus={(e) => {
                const length = e.target.value.length;
                // Move cursor to end
                requestAnimationFrame(() => {
                  e.target.setSelectionRange(length, length);
                });
              }}
              onBlur={handleHealthSubmit}
              onKeyDown={getHotkeyHandler([
                ['mod+Enter', handleHealthSubmit],
                ['Enter', handleHealthSubmit],
              ])}
              rightSection={
                <Group>
                  <Text>/</Text>
                  <Text>{healthStats.hp_max}</Text>
                </Group>
              }
              rightSectionWidth={60}
            />
          </Group>
          <Group gap={5} style={{ flexGrow: 1 }}>
            <Stack gap={0}>
              <Text ta='right' fz={10}>
                Hardness
              </Text>
              <Text ta='right' fz={10}>
                Broken Threshold
              </Text>
            </Stack>
            <Stack gap={0}>
              <Text ta='left' fw={500} c='gray.4' fz={10}>
                {healthStats.hardness}
              </Text>
              <Text ta='left' fw={500} c='gray.4' fz={10}>
                {healthStats.bt}
              </Text>
            </Stack>
          </Group>
        </Group>
        <HoverCard shadow='md' openDelay={250} width={200} zIndex={1000} position='top' withinPortal>
          <HoverCard.Target>
            <ActionIcon
              variant='subtle'
              aria-label='Help'
              radius='xl'
              size='sm'
              style={{
                position: 'absolute',
                top: 5,
                right: 5,
              }}
            >
              <IconHelpCircle style={{ width: '80%', height: '80%' }} stroke={1.5} />
            </ActionIcon>
          </HoverCard.Target>
          <HoverCard.Dropdown py={5} px={10}>
            <Text fz='xs'>
              An item can be broken or destroyed if it takes enough damage. Each time an item takes damage, reduce any
              damage by its Hardness value.
            </Text>
            <Text fz='xs'>
              It becomes broken when its Hit Points are equal to or lower than its Broken Threshold (BT); once its HP is
              reduced to 0, it is destroyed.
            </Text>
          </HoverCard.Dropdown>
        </HoverCard>
      </Paper>
    );
  }

  let attackAndDamageSection = null;
  if (hasAttackAndDamage) {
    const weaponStats = getWeaponStats(props.storeId, props.invItem.item);

    const damageBonus = weaponStats.damage.bonus.total > 0 ? ` + ${weaponStats.damage.bonus.total}` : ``;

    attackAndDamageSection = (
      <Paper shadow='xs' my={5} py={5} px={10} bg='var(--wg4-surface-2)' radius='md' style={{ border: '1px solid var(--wg4-border-soft)', boxShadow: 'none' }}>
        <Group
          grow
          gap={0}
          style={{
            cursor: 'pointer',
          }}
          onClick={() => {
            openDrawer({
              type: 'stat-weapon',
              data: { id: props.storeId, item: props.invItem.item },
              extra: { addToHistory: true },
            });
          }}
        >
          <Group wrap='nowrap' gap={10} style={{ overflow: 'hidden' }}>
            <Text fw={600} c='gray.2' span style={{ overflow: 'hidden' }}>
              Attack
            </Text>
            <Text c='gray.2' span>
              {sign(weaponStats.attack_bonus.total[0])}{' '}
              <Text c='gray.5' span>
                / {sign(weaponStats.attack_bonus.total[1])} / {sign(weaponStats.attack_bonus.total[2])}
              </Text>
            </Text>
          </Group>
          <Group wrap='nowrap' gap={10} style={{ overflow: 'hidden' }} maw={300}>
            <Text fw={600} c='gray.2' span>
              Damage
            </Text>
            <EllipsisText c='gray.2' span>
              {weaponStats.damage.dice}
              {weaponStats.damage.die}
              {damageBonus} {weaponStats.damage.damageType}
              {parseOtherDamage(weaponStats.damage.other)}
              {weaponStats.damage.extra ? ` + ${weaponStats.damage.extra}` : ''}
            </EllipsisText>
          </Group>
        </Group>
      </Paper>
    );
  }

  let runesSection = null;
  if (isItemWithRunes(props.invItem.item)) {
    let strikingLabel = '';
    if (props.invItem.item.meta_data!.runes!.striking === 1) {
      strikingLabel = 'Striking';
    } else if (props.invItem.item.meta_data!.runes!.striking === 2) {
      strikingLabel = 'Greater Striking';
    } else if (props.invItem.item.meta_data!.runes!.striking === 3) {
      strikingLabel = 'Major Striking';
    } else if (props.invItem.item.meta_data!.runes!.striking === 10) {
      strikingLabel = 'Mythic Striking';
    }

    let resilientLabel = '';
    if (props.invItem.item.meta_data!.runes!.resilient === 1) {
      resilientLabel = 'Resilient';
    } else if (props.invItem.item.meta_data!.runes!.resilient === 2) {
      resilientLabel = 'Greater Resilient';
    } else if (props.invItem.item.meta_data!.runes!.resilient === 3) {
      resilientLabel = 'Major Resilient';
    } else if (props.invItem.item.meta_data!.runes!.resilient === 10) {
      resilientLabel = 'Mythic Resilient';
    }

    let potencyLabel = '';
    if (props.invItem.item.meta_data!.runes!.potency) {
      potencyLabel = `+${Math.min(props.invItem.item.meta_data!.runes!.potency, 4)} `;
    }

    const rightLabel = strikingLabel || resilientLabel;

    runesSection = (
      <Paper shadow='xs' my={5} py={10} px={10} bg='var(--wg4-surface-2)' radius='md' style={{ border: '1px solid var(--wg4-border-soft)', boxShadow: 'none' }}>
        <Group gap={5}>
          {potencyLabel && (
            <Badge
              size='lg'
              variant='light'
              color='gray'
              style={{ cursor: 'pointer' }}
              styles={{ root: { textTransform: 'initial' } }}
              onClick={() => {
                const potencyNum = props.invItem.item.meta_data!.runes!.potency;
                const potencyId = isItemWeapon(props.invItem.item)
                  ? FUNDAMENTAL_RUNES[`potency_weapon_${potencyNum}`]
                  : FUNDAMENTAL_RUNES[`potency_armor_${potencyNum}`];
                if (potencyId) {
                  props.openDrawer({ type: 'item', data: { id: potencyId }, extra: { addToHistory: true } });
                }
              }}
            >
              {potencyLabel.trim()}
            </Badge>
          )}
          {rightLabel && (
            <Badge
              size='lg'
              variant='light'
              color='gray'
              style={{ cursor: 'pointer' }}
              styles={{ root: { textTransform: 'initial' } }}
              onClick={() => {
                const strikingNum = props.invItem.item.meta_data!.runes!.striking;
                const resilientNum = props.invItem.item.meta_data!.runes!.resilient;
                const runeId = strikingNum
                  ? FUNDAMENTAL_RUNES[`striking_${strikingNum}`]
                  : FUNDAMENTAL_RUNES[`resilient_${resilientNum}`];
                if (runeId) {
                  props.openDrawer({ type: 'item', data: { id: runeId }, extra: { addToHistory: true } });
                }
              }}
            >
              {rightLabel}
            </Badge>
          )}

          {isItemWithPropertyRunes(props.invItem.item) && (
            <>
              {props.invItem.item.meta_data!.runes!.property?.map((rune, index) => (
                <Badge
                  key={index}
                  variant='light'
                  color='gray'
                  style={{
                    cursor: 'pointer',
                  }}
                  styles={{
                    root: {
                      textTransform: 'initial',
                    },
                  }}
                  onClick={() => {
                    props.openDrawer({
                      type: 'item',
                      data: { id: rune.id },
                      extra: { addToHistory: true },
                    });
                  }}
                >
                  {toLabel(rune.name)}
                </Badge>
              ))}
            </>
          )}
        </Group>
      </Paper>
    );
  }

  let materialSection = null;
  if (isItemWithMaterial(props.invItem.item)) {
    materialSection = (
      <Paper shadow='xs' my={5} py={10} px={10} bg='var(--wg4-surface-2)' radius='md' style={{ border: '1px solid var(--wg4-border-soft)', boxShadow: 'none' }}>
        <Group gap={5}>
          {materialType && (
            <Badge
              size='lg'
              variant='light'
              color='gray'
              style={{ cursor: materialItem ? 'pointer' : undefined }}
              styles={{ root: { textTransform: 'initial' } }}
              onClick={() => {
                if (materialItem) {
                  openDrawer({ type: 'item', data: { id: materialItem.id }, extra: { addToHistory: true } });
                }
              }}
            >
              {toLabel(materialType)} {materialGrade ? `– ${toLabel(materialGrade)}-grade` : ''}
            </Badge>
          )}
        </Group>
      </Paper>
    );
  }

  let upgradeSection = null;
  if (isItemWithGradeImprovement(props.invItem.item)) {
    upgradeSection = (
      <Paper shadow='xs' my={5} py={5} px={10} bg='var(--wg4-surface-2)' radius='md' style={{ border: '1px solid var(--wg4-border-soft)', boxShadow: 'none' }}>
        <Group gap={10}>
          <Group wrap='nowrap' mr={5}>
            <Text fw={600} c='gray.2' span>
              Grade
            </Text>{' '}
            <Text c='gray.2' span>
              {toLabel(props.invItem.item.meta_data?.starfinder?.grade)}
            </Text>
          </Group>

          {isItemWithUpgrades(props.invItem.item) && (
            <>
              {props.invItem.item.meta_data?.starfinder?.slots?.map((slot, index) => (
                <Badge
                  key={index}
                  variant='light'
                  style={{
                    cursor: 'pointer',
                  }}
                  styles={{
                    root: {
                      textTransform: 'initial',
                    },
                  }}
                  onClick={() => {
                    props.openDrawer({
                      type: 'item',
                      data: { id: slot.id },
                      extra: { addToHistory: true },
                    });
                  }}
                >
                  {toLabel(slot.name)}
                </Badge>
              ))}
            </>
          )}
        </Group>
      </Paper>
    );
  }

  let rangeAndReloadSection = null;
  if (isItemRangedWeapon(props.invItem.item)) {
    rangeAndReloadSection = (
      <Paper shadow='xs' my={5} py={5} px={10} bg='var(--wg4-surface-2)' radius='md' style={{ border: '1px solid var(--wg4-border-soft)', boxShadow: 'none' }}>
        <Group gap={0}>
          <Group wrap='nowrap' gap={10} style={{ flexGrow: 1 }}>
            <Text fw={600} c='gray.2' span>
              Range
            </Text>
            <Text c='gray.2' span>
              {props.invItem.item.meta_data?.range} ft.
            </Text>
          </Group>
          <Group wrap='nowrap' gap={10} style={{ flexGrow: 1 }}>
            <Text fw={600} c='gray.2' span>
              Reload
            </Text>
            <Text c='gray.2' span>
              {props.invItem.item.meta_data?.reload ?? '—'}
            </Text>
          </Group>
        </Group>
      </Paper>
    );
  }

  let capacityAndUsageSection = null;
  if (props.invItem.item.meta_data?.starfinder?.capacity || props.invItem.item.meta_data?.starfinder?.usage) {
    capacityAndUsageSection = (
      <Paper shadow='xs' my={5} py={5} px={10} bg='var(--wg4-surface-2)' radius='md' style={{ border: '1px solid var(--wg4-border-soft)', boxShadow: 'none' }}>
        <Group gap={0}>
          <Group wrap='nowrap' gap={10} style={{ flexGrow: 1 }}>
            <Text fw={600} c='gray.2' span>
              Capacity
            </Text>
            <Text c='gray.2' span>
              {props.invItem.item.meta_data?.starfinder?.capacity ?? '—'}
            </Text>
          </Group>
          <Group wrap='nowrap' gap={10} style={{ flexGrow: 1 }}>
            <Text fw={600} c='gray.2' span>
              Ammo Usage
            </Text>
            <Text c='gray.2' span>
              {props.invItem.item.meta_data?.starfinder?.usage ?? '—'}
            </Text>
          </Group>
        </Group>
      </Paper>
    );
  }

  let categoryAndGroupSection = null;
  if (props.invItem.item.meta_data?.category || props.invItem.item.meta_data?.group) {
    let groupDesc =
      getWeaponSpecialization(props.invItem.item.meta_data?.group as ItemMetaGroupWeapon) ??
      getArmorSpecialization(props.invItem.item.meta_data?.group as ItemMetaGroupArmor);
    if (groupDesc && hasAttackAndDamage) {
      if (hasAttackAndDamage) {
        groupDesc = {
          ...groupDesc,
          description: `**Critical Specialization Effect**\n\n${groupDesc.description}`,
        };
      } else {
        groupDesc = {
          ...groupDesc,
          description: `**Armor Specialization Effect**\n\n${groupDesc.description}`,
        };
      }
    }

    categoryAndGroupSection = (
      <Paper shadow='xs' my={5} py={5} px={10} bg='var(--wg4-surface-2)' radius='md' style={{ border: '1px solid var(--wg4-border-soft)', boxShadow: 'none' }}>
        <Group gap={0}>
          {props.invItem.item.meta_data?.category && (
            <Group wrap='nowrap' gap={10} style={{ flexGrow: 1 }}>
              <Text fw={600} c='gray.2' span>
                Category
              </Text>
              <Text c='gray.2' span>
                {/* TitleCase it again in cases like 'unarmored defense' */}
                {titleCase(toLabel(props.invItem.item.meta_data?.category))}
              </Text>
            </Group>
          )}
          {props.invItem.item.meta_data?.group && (
            <Group wrap='nowrap' gap={10} style={{ flexGrow: 1 }}>
              <Text fw={600} c='gray.2' span>
                Group
              </Text>
              <HoverCard
                disabled={!groupDesc}
                width={265}
                shadow='md'
                zIndex={2000}
                openDelay={250}
                withinPortal
                withArrow
              >
                <HoverCard.Target>
                  <Text c='gray.2' style={{ cursor: groupDesc ? 'pointer' : undefined }} span>
                    {toLabel(props.invItem.item.meta_data?.group)}
                  </Text>
                </HoverCard.Target>
                <HoverCard.Dropdown>
                  <RichText ta='justify' fz='xs' store={props.storeId}>
                    {groupDesc?.description}
                  </RichText>
                </HoverCard.Dropdown>
              </HoverCard>
            </Group>
          )}
        </Group>
      </Paper>
    );
  }

  let armorSection = null;
  if (hasArmor) {
    armorSection = (
      <Paper shadow='xs' my={5} py={5} px={10} bg='var(--wg4-surface-2)' radius='md' style={{ position: 'relative', border: '1px solid var(--wg4-border-soft)', boxShadow: 'none' }}>
        <Group gap={0}>
          <Group wrap='nowrap' mr={20} style={{ flexGrow: 1 }}>
            <Text fw={600} c='gray.2' span>
              AC Bonus
            </Text>{' '}
            <Text c='gray.2' span>
              {sign(ac ?? 0)}
            </Text>
          </Group>
          <Group wrap='nowrap' align='flex-start' style={{ flexGrow: 1 }}>
            {(dexCap !== undefined || strength !== undefined) && (
              <Group gap={5}>
                <Stack gap={0}>
                  {dexCap !== undefined && (
                    <Text ta='right' fz={10}>
                      Dex Cap
                    </Text>
                  )}
                  {strength !== undefined && (
                    <Text ta='right' fz={10}>
                      Strength
                    </Text>
                  )}
                </Stack>
                <Stack gap={0}>
                  {dexCap !== undefined && (
                    <Text ta='left' fw={500} c='gray.4' fz={10}>
                      {sign(dexCap)}
                    </Text>
                  )}
                  {strength !== undefined && (
                    <Text ta='left' fw={500} c='gray.4' fz={10}>
                      {sign(strength)}
                    </Text>
                  )}
                </Stack>
              </Group>
            )}
            {(!!checkPenalty || !!speedPenalty) && (
              <Group gap={5}>
                <Stack gap={0}>
                  {!!checkPenalty && (
                    <Text ta='right' fz={10}>
                      Check Penalty
                    </Text>
                  )}
                  {!!speedPenalty && (
                    <Text ta='right' fz={10}>
                      Speed Penalty
                    </Text>
                  )}
                </Stack>
                <Stack gap={0}>
                  {!!checkPenalty && (
                    <Text ta='left' fw={500} c='gray.4' fz={10}>
                      {sign(checkPenalty)}
                    </Text>
                  )}
                  {!!speedPenalty && (
                    <Text ta='left' fw={500} c='gray.4' fz={10}>
                      {sign(speedPenalty)} ft.
                    </Text>
                  )}
                </Stack>
              </Group>
            )}
          </Group>
        </Group>
        <HoverCard shadow='md' openDelay={250} width={200} zIndex={1000} position='top' withinPortal>
          <HoverCard.Target>
            <ActionIcon
              variant='subtle'
              aria-label='Help'
              radius='xl'
              size='sm'
              style={{
                position: 'absolute',
                top: 5,
                right: 5,
              }}
            >
              <IconHelpCircle style={{ width: '80%', height: '80%' }} stroke={1.5} />
            </ActionIcon>
          </HoverCard.Target>
          <HoverCard.Dropdown py={5} px={10}>
            <ScrollArea h={dexCap ? 250 : undefined} pr={14} scrollbars='y'>
              {ac !== undefined && (
                <Text fz='xs'>
                  <Text fz='xs' fw={600} span>
                    AC Bonus:
                  </Text>{' '}
                  This is the item bonus you add for the armor when determining AC.
                </Text>
              )}
              {dexCap !== undefined && (
                <Text fz='xs'>
                  <Text fz='xs' fw={600} span>
                    Dex Cap:
                  </Text>{' '}
                  This is the maximum Dexterity modifier you can benefit from towards your AC while wearing the armor.
                </Text>
              )}
              {strength !== undefined && (
                <Text fz='xs'>
                  <Text fz='xs' fw={600} span>
                    Strength:
                  </Text>{' '}
                  This is the Strength modifier at which you are strong enough to overcome some of the armor’s
                  penalties. If your Strength modifier is equal to or greater than this value, you no longer take the
                  armor’s check penalty, and you decrease the Speed penalty by 5 feet.
                </Text>
              )}
              {checkPenalty !== undefined && (
                <Text fz='xs'>
                  <Text fz='xs' fw={600} span>
                    Check Penalty:
                  </Text>{' '}
                  While wearing your armor, you take this penalty to Strength- and Dexterity-based skill checks, except
                  for those that have the attack trait. If you meet the armor’s Strength threshold, you don’t take this
                  penalty.
                </Text>
              )}
              {speedPenalty !== undefined && (
                <Text fz='xs'>
                  <Text fz='xs' fw={600} span>
                    Speed Penalty:
                  </Text>{' '}
                  While wearing a suit of armor, you take the penalty listed in this entry to your Speed, as well as to
                  any other movement types you have, such as a climb Speed or swim Speed, to a minimum Speed of 5 feet.
                  If you meet the armor’s Strength threshold, you reduce the penalty by 5 feet.
                </Text>
              )}
            </ScrollArea>
          </HoverCard.Dropdown>
        </HoverCard>
      </Paper>
    );
  }

  return (
    <>
      <Stack gap={0}>
        <>{runesSection}</>
        <>{materialSection}</>
        <>{upgradeSection}</>
        <>{attackAndDamageSection}</>
        <>{rangeAndReloadSection}</>
        <>{armorSection}</>
        <>{capacityAndUsageSection}</>
        <>{categoryAndGroupSection}</>
        <>{quantitySection}</>
        <>{healthSection}</>
      </Stack>
    </>
  );
}

// Battlezoo Monster Parts editor for a single inventory item. Renders
// only when the character has the `monster_parts` variant on and the
// item can carry runes (weapons / armor / shields / perception / skill
// items — same gate as the runes accordion). The panel:
//   * lets the player flip the item into monster-parts mode (mutually
//     exclusive with normal fundamental runes — when on, the runes
//     panel above still reads but `applyMonsterPartsToItem` overrides
//     the numeric values at compute time)
//   * captures the gp value of monster parts invested in refinement
//   * shows the derived refined item level and the bonuses unlocked
//     at that level
//
// State is stored at `invItem.item.meta_data.battlezoo` and persists on
// the character. Setting `enabled: false` returns the item to normal
// rune behavior with one click — no other state is lost.
function MonsterPartsPanel(props: {
  invItem: InventoryItem;
  onItemUpdate: (i: InventoryItem) => void;
}) {
  const theme = useMantineTheme();
  const character = useAtomValue(characterState);
  const { invItem, onItemUpdate } = props;
  const bz = invItem.item.meta_data?.battlezoo;
  const enabled = bz?.enabled === true;
  const value = bz?.refinement_value ?? 0;

  const category = monsterPartsCategoryFor(invItem.item);
  const tableLevel = levelFromValue(value, category);
  const charLevel = character?.level ?? 1;
  // Effective refined level is capped by character level — the rule
  // says you can't refine an item to a level above your own. The
  // player can still keep investing parts and the item will auto-level
  // when the character does.
  const refinedLevel = Math.min(tableLevel, charLevel);
  const nextLevelCost = valueForLevel(refinedLevel + 1, category);
  const remaining = nextLevelCost > value ? nextLevelCost - value : 0;
  const overInvested = tableLevel > charLevel;

  // Build the summary from the *effective* refined level so the
  // display always matches what's actually applied to the character.
  const summary = (() => {
    if (refinedLevel < 1) return '0 gp invested · no bonuses yet';
    const b = refinementBonuses(refinedLevel);
    const parts: string[] = [`Refined to lvl ${refinedLevel}`];
    if (category === 'weapon') {
      if (b.weaponItemBonus) parts.push(`+${b.weaponItemBonus} attack`);
      if (b.weaponDamageDice > 1) parts.push(`${b.weaponDamageDice} dice`);
      if (b.weaponImbuing) parts.push(`${b.weaponImbuing} imbuing slot${b.weaponImbuing === 1 ? '' : 's'}`);
    } else if (category === 'armor') {
      if (b.armorItemBonus) parts.push(`+${b.armorItemBonus} AC`);
      if (b.armorSaveBonus) parts.push(`+${b.armorSaveBonus} saves`);
      if (b.armorImbuing) parts.push(`${b.armorImbuing} imbuing slot${b.armorImbuing === 1 ? '' : 's'}`);
    } else if (category === 'shield') {
      if (b.shieldHardness) parts.push(`Hardness ${b.shieldHardness} · HP ${b.shieldHP} · BT ${b.shieldBT}`);
      if (b.shieldImbuing) parts.push(`1 imbuing slot`);
    } else if (category === 'perception') {
      if (b.perceptionBonus) parts.push(`+${b.perceptionBonus} Perception`);
      if (b.percSkillImbuing) parts.push(`1 imbuing slot`);
    } else if (category === 'skill') {
      if (b.skillBonus) parts.push(`+${b.skillBonus} to chosen skill`);
      if (b.percSkillImbuing) parts.push(`1 imbuing slot`);
    }
    return parts.join(' · ');
  })();

  // Imbuing slot count comes from the refinement tables (Tables 4A–4E).
  // Per the rule, an imbued property's level can never exceed the item's
  // refined level OR the character's level, whichever is lower. So we
  // cap any added property at that limit and use the cap when filtering
  // the picker so the player can't pick something they can't use.
  const imbuedLevelCap = refinedLevel; // already min(tableLevel, charLevel)
  const bonuses = refinementBonuses(refinedLevel);
  const slotCount = bonuses.imbuingSlotsFor(category);
  const dc = MAGIC_ITEM_DCS[refinedLevel] ?? null;

  // Look up the "Imbued Property" trait id from cache (filled by the
  // Battlezoo homebrew bundle's import). If the bundle isn't subscribed
  // the trait won't be present and the picker shows an empty list with
  // an explanatory message.
  const imbuedTraitId = useMemo(() => {
    const traits = getCachedContent<Trait>('trait');
    return traits.find((t) => t.name === 'Imbued Property')?.id;
  }, []);

  const appliedProperties = invItem.item.meta_data?.runes?.property ?? [];

  const update = (
    next: Partial<{
      enabled: boolean;
      refinement_value: number;
      category: 'weapon' | 'armor' | 'shield' | 'perception' | 'skill';
      skill_variable: string;
    }>,
  ) => {
    onItemUpdate({
      ...invItem,
      item: {
        ...invItem.item,
        meta_data: {
          ...invItem.item.meta_data!,
          battlezoo: {
            enabled: next.enabled ?? enabled,
            refinement_value: next.refinement_value ?? value,
            category: next.category ?? bz?.category,
            skill_variable: next.skill_variable ?? bz?.skill_variable,
          },
        },
      },
    });
  };

  // Show a category override picker when:
  //   - the item is not obviously a weapon / armor / shield (group =
  //     GENERAL or similar), so the user needs to specify, OR
  //   - the user has explicitly set a category in battlezoo state.
  // Always-visible categories: a hidden override is confusing, so any
  // monster-parts-enabled item shows the category picker so the player
  // can override if needed.
  const showCategoryPicker = enabled;
  const showSkillPicker = enabled && category === 'skill';

  // The panel only renders when isItemWithRunes is true, which already
  // implies meta_data exists. Use a non-null assertion to keep
  // TypeScript happy with the spread.
  const addImbuedProperty = (prop: { id: number; name: string }) => {
    const md = invItem.item.meta_data!;
    const existing = md.runes?.property ?? [];
    onItemUpdate({
      ...invItem,
      item: {
        ...invItem.item,
        meta_data: {
          ...md,
          runes: {
            ...(md.runes ?? {}),
            property: [...existing, { id: prop.id, name: prop.name }],
          },
        },
      },
    });
  };

  const removeImbuedProperty = (atIndex: number) => {
    const md = invItem.item.meta_data!;
    const existing = md.runes?.property ?? [];
    onItemUpdate({
      ...invItem,
      item: {
        ...invItem.item,
        meta_data: {
          ...md,
          runes: {
            ...(md.runes ?? {}),
            property: existing.filter((_: { name: string; id: number }, i: number) => i !== atIndex),
          },
        },
      },
    });
  };

  const openImbuedPicker = () => {
    selectContent<{ id: number; name: string }>(
      'item',
      (chosen) => {
        if (chosen?.id) addImbuedProperty({ id: chosen.id, name: chosen.name });
      },
      {
        overrideLabel: imbuedTraitId
          ? `Add Imbued Property (Lvl ≤ ${imbuedLevelCap})`
          : 'Add Imbued Property — Battlezoo bundle not loaded',
        // Only show items tagged with the Imbued Property trait and at
        // or below the cap. The Battlezoo bundle ships imbued
        // properties as items with group: 'RUNE' so the picker's normal
        // type='item' selection finds them automatically.
        filterFn: (option) => {
          if (!imbuedTraitId) return false;
          const traits = (option.traits ?? []) as number[];
          if (!traits.includes(imbuedTraitId)) return false;
          const lvl = typeof option.level === 'number' ? option.level : 0;
          return lvl <= imbuedLevelCap;
        },
      }
    );
  };

  return (
    <Accordion variant='separated' my={5}>
      <Accordion.Item value='battlezoo'>
        <Accordion.Control icon={getIconMap('1.0rem', theme.colors.gray[6])['RUNE']}>
          Battlezoo Monster Parts
        </Accordion.Control>
        <Accordion.Panel>
          <Stack gap={6}>
            <Group justify='space-between' wrap='nowrap'>
              <Text fz='sm' c='gray.2'>
                Use Monster Parts (replaces runes on this item)
              </Text>
              <Box>
                <Button
                  size='compact-xs'
                  variant={enabled ? 'filled' : 'default'}
                  color={enabled ? 'teal' : undefined}
                  onClick={() => update({ enabled: !enabled })}
                >
                  {enabled ? 'On' : 'Off'}
                </Button>
              </Box>
            </Group>
            {enabled && (
              <>
                {showCategoryPicker && (
                  <Group justify='space-between' wrap='nowrap'>
                    <Text fz='sm' c='gray.3'>
                      Category
                    </Text>
                    <Select
                      size='xs'
                      w={140}
                      value={category}
                      data={[
                        { value: 'weapon', label: 'Weapon' },
                        { value: 'armor', label: 'Armor' },
                        { value: 'shield', label: 'Shield' },
                        { value: 'perception', label: 'Perception Item' },
                        { value: 'skill', label: 'Skill Item' },
                      ]}
                      onChange={(v) => {
                        if (v) update({ category: v as 'weapon' | 'armor' | 'shield' | 'perception' | 'skill' });
                      }}
                    />
                  </Group>
                )}
                {showSkillPicker && (
                  <Group justify='space-between' wrap='nowrap'>
                    <Text fz='sm' c='gray.3'>
                      Skill
                    </Text>
                    <Select
                      size='xs'
                      w={140}
                      value={bz?.skill_variable ?? null}
                      placeholder='Pick a skill'
                      data={[
                        { value: 'SKILL_ACROBATICS', label: 'Acrobatics' },
                        { value: 'SKILL_ARCANA', label: 'Arcana' },
                        { value: 'SKILL_ATHLETICS', label: 'Athletics' },
                        { value: 'SKILL_CRAFTING', label: 'Crafting' },
                        { value: 'SKILL_DECEPTION', label: 'Deception' },
                        { value: 'SKILL_DIPLOMACY', label: 'Diplomacy' },
                        { value: 'SKILL_INTIMIDATION', label: 'Intimidation' },
                        { value: 'SKILL_MEDICINE', label: 'Medicine' },
                        { value: 'SKILL_NATURE', label: 'Nature' },
                        { value: 'SKILL_OCCULTISM', label: 'Occultism' },
                        { value: 'SKILL_PERFORMANCE', label: 'Performance' },
                        { value: 'SKILL_RELIGION', label: 'Religion' },
                        { value: 'SKILL_SOCIETY', label: 'Society' },
                        { value: 'SKILL_STEALTH', label: 'Stealth' },
                        { value: 'SKILL_SURVIVAL', label: 'Survival' },
                        { value: 'SKILL_THIEVERY', label: 'Thievery' },
                      ]}
                      onChange={(v) => {
                        if (v) update({ skill_variable: v });
                      }}
                    />
                  </Group>
                )}
                <Group justify='space-between' wrap='nowrap'>
                  <Text fz='sm' c='gray.3'>
                    Refinement value (gp of monster parts invested)
                  </Text>
                  <NumberInput
                    value={value}
                    onChange={(v) => update({ refinement_value: typeof v === 'number' ? v : 0 })}
                    min={0}
                    max={1000000}
                    step={10}
                    size='xs'
                    w={140}
                  />
                </Group>
                <Box pt={4}>
                  <Text fz='xs' c='gray.4'>{summary ?? '—'}</Text>
                  {remaining > 0 && (
                    <Text fz='xs' c='gray.5' fs='italic'>
                      {remaining} gp more to reach level {refinedLevel + 1}.
                    </Text>
                  )}
                  {dc !== null && refinedLevel > 0 && (
                    <Text fz='xs' c='gray.4' mt={2}>
                      Item DC <Text span fw={600}>{dc}</Text> for any spell effects from imbued properties (spell attack rolls and counteract checks use DC − 10 = <Text span fw={600}>{dc - 10}</Text>).
                    </Text>
                  )}
                  {overInvested && (
                    <Text fz='xs' c='yellow.6' fs='italic' mt={2}>
                      You've invested enough parts for level {tableLevel}, but your character is only level {charLevel}.
                      The item stays at level {charLevel} until you level up — the extra parts carry over automatically.
                    </Text>
                  )}
                </Box>

                <Divider my={4} />

                <Group justify='space-between' wrap='nowrap'>
                  <Text fz='sm' c='gray.2'>
                    Imbued properties ({appliedProperties.length}/{slotCount})
                  </Text>
                  <Button
                    size='compact-xs'
                    variant='default'
                    disabled={imbuedLevelCap < 1 || appliedProperties.length >= slotCount || !imbuedTraitId}
                    onClick={openImbuedPicker}
                  >
                    Add
                  </Button>
                </Group>
                {imbuedLevelCap < 1 && (
                  <Text fz='xs' c='gray.5' fs='italic'>
                    Refine the item to at least level 2 (weapon) or 5 (armor) / 4 (shield) / 3 (perception, skill item) to unlock an imbuing slot.
                  </Text>
                )}
                {!imbuedTraitId && enabled && (
                  <Text fz='xs' c='yellow.6' fs='italic'>
                    The "Imbued Property" trait isn't loaded — import the Battlezoo Bestiary homebrew bundle on the Homebrew page first.
                  </Text>
                )}
                {appliedProperties.length === 0 ? (
                  <Text fz='xs' c='gray.5' fs='italic'>
                    No imbued properties applied yet.
                  </Text>
                ) : (
                  <Stack gap={2}>
                    {appliedProperties.map((p, i) => (
                      <Group key={i} justify='space-between' wrap='nowrap'>
                        <Text fz='xs' c='gray.2'>{p.name}</Text>
                        <ActionIcon
                          size='xs'
                          variant='subtle'
                          color='red'
                          aria-label='Remove imbued property'
                          onClick={() => removeImbuedProperty(i)}
                        >
                          <IconTrashXFilled size='0.7rem' />
                        </ActionIcon>
                      </Group>
                    ))}
                  </Stack>
                )}

                <Text fz='xs' c='gray.5' fs='italic' mt={4}>
                  Per the rules, an item is built either with runes OR with monster parts, not both. Imbued properties stack across paths — the same property can be applied to a weapon multiple times via Magic / Might / Technique.
                </Text>
              </>
            )}
          </Stack>
        </Accordion.Panel>
      </Accordion.Item>
    </Accordion>
  );
}
