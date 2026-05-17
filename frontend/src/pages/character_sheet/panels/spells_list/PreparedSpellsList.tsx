import BlurButton from '@common/BlurButton';
import { ActionIcon, Accordion, Badge, Box, Divider, Group, Paper, Stack, Text, Tooltip } from '@mantine/core';
import { getSpellStats } from '@spells/spell-handler';
import { CastingSource, LivingEntity, Spell, SpellInnateEntry, SpellListEntry, SpellSlot } from '@schemas/content';
import { rankNumber, sign } from '@utils/numbers';
import { toLabel } from '@utils/strings';
import { Dictionary } from 'node_modules/cypress/types/lodash';
import SpellListEntrySection from './SpellListEntrySection';
import { StatButton } from '@pages/character_builder/CharBuilderCreation';
import { drawerState } from '@atoms/navAtoms';
import { useAtom } from 'jotai';
import { SetterOrUpdater } from '@utils/type-fixing';
import { StoreID } from '@schemas/variables';
import { useMediaQuery } from '@mantine/hooks';
import { phoneQuery } from '@utils/mobile-responsive';
import ImprintButton from '@common/ImprintButton';
import { IconReplace, IconSquareRounded, IconSquareRoundedFilled } from '@tabler/icons-react';
import { isCantrip, isNormalSpell } from '@spells/spell-utils';
import { collectEntitySpellcasting } from '@content/collect-content';
import { getDefaultSources } from '@content/content-store';
import { selectContent } from '@common/select/SelectContent';

export default function PreparedSpellsList(props: {
  id: StoreID;
  entity: LivingEntity | null;
  setEntity: SetterOrUpdater<LivingEntity | null>;
  //
  index: string;
  source?: CastingSource;
  spellIds: number[];
  allSpells: Spell[];
  extra: {
    charData: {
      slots: SpellSlot[];
      list: SpellListEntry[];
      focus: {
        spell_id: number;
        source: string;
        rank: number | undefined;
      }[];
      innate: SpellInnateEntry[];
      sources: CastingSource[];
    };
    slots?: SpellSlot[];
    innates?: SpellInnateEntry[];
  };
  hasFilters: boolean;
  openManageSpells?: (
    source: string,
    type: 'SLOTS-ONLY' | 'SLOTS-AND-LIST' | 'LIST-ONLY',
    filter?: {
      traditions?: string[];
      rank_min?: number;
      rank_max?: number;
    }
  ) => void;
  slots: Dictionary<
    {
      spell: Spell | undefined;
      rank: number;
      source: string;
      spell_id?: number;
      exhausted?: boolean;
      color?: string;
    }[]
  > | null;
  castSpell: (cast: boolean, spell: Spell) => void;
}) {
  const isPhone = useMediaQuery(phoneQuery());

  const { slots, castSpell } = props;
  const [_drawer, openDrawer] = useAtom(drawerState);

  // Find the absolute index in entity.spells.slots that corresponds to
  // the N-th slot displayed under this source+rank header. We can't match
  // by spell_id because the same spell can be prepared into multiple
  // slots — we need the exact slot the player clicked. The display order
  // in `slots[rank]` mirrors the order in `entity.spells.slots`
  // (groupBy is order-preserving), so the display index uniquely
  // identifies the slot within its (source, rank) group.
  const findAbsoluteSlotIdx = (
    allSlots: SpellSlot[],
    rank: string,
    displayIdx: number
  ) => {
    const sourceName = props.source?.name;
    const rankNum = parseInt(rank);
    let matchCount = 0;
    for (let i = 0; i < allSlots.length; i++) {
      const s = allSlots[i];
      if (s.source === sourceName && s.rank === rankNum) {
        if (matchCount === displayIdx) return i;
        matchCount++;
      }
    }
    return -1;
  };

  // Flip the `exhausted` flag on the N-th slot of the given source+rank.
  const toggleSlotExhausted = (rank: string, displayIdx: number) => {
    props.setEntity((c) => {
      if (!c) return c;
      const allSlots = collectEntitySpellcasting(props.id, c).slots;
      const targetIdx = findAbsoluteSlotIdx(allSlots, rank, displayIdx);
      if (targetIdx === -1) return c;
      const newSlots = [...allSlots];
      newSlots[targetIdx] = { ...newSlots[targetIdx], exhausted: !newSlots[targetIdx].exhausted };
      return {
        ...c,
        spells: {
          ...(c.spells ?? { slots: [], list: [], focus_point_current: 0, innate_casts: [] }),
          slots: newSlots,
        },
      };
    });
  };

  // Write a specific spell into the N-th slot of the given source+rank.
  // Used by the replace flow: picker → assignSlotSpell. Also resets
  // `exhausted` so the new spell starts available regardless of what
  // the previous one's state was.
  const assignSlotSpell = (rank: string, displayIdx: number, spellId: number) => {
    props.setEntity((c) => {
      if (!c) return c;
      const allSlots = collectEntitySpellcasting(props.id, c).slots;
      const targetIdx = findAbsoluteSlotIdx(allSlots, rank, displayIdx);
      if (targetIdx === -1) return c;
      const newSlots = [...allSlots];
      newSlots[targetIdx] = { ...newSlots[targetIdx], spell_id: spellId, exhausted: false };
      return {
        ...c,
        spells: {
          ...(c.spells ?? { slots: [], list: [], focus_point_current: 0, innate_casts: [] }),
          slots: newSlots,
        },
      };
    });
  };

  // Open a spell picker pre-filtered to spells that could legally be
  // prepared in this slot, then write the chosen spell into the slot.
  //
  // For PREPARED-LIST casters (wizard, magus): the player only knows
  // the spells in their spellbook (the entries in `charData.list` for
  // this source). We render those as the picker's options, filtered to
  // rank ≤ slot rank so heightened casting is supported.
  //
  // For PREPARED-TRADITION casters (cleric, druid): the player can
  // prepare any spell of the tradition. We hand off to the standard
  // `selectContent` with tradition + rank constraints — same machinery
  // the "Manage" modal uses for its Add-Spell button.
  //
  // We deliberately don't filter for `slot.spell` — passing the slot's
  // current spell is fine, the user can re-pick the same one as a no-op
  // (the picker treats it as a fresh selection).
  const handleReplace = (rank: string, displayIdx: number) => {
    const rankNum = parseInt(rank);
    const tradition = props.source!.tradition.toLowerCase();
    const isListBased = props.source!.type === 'PREPARED-LIST';

    if (isListBased) {
      const spellbookSpells = props.extra.charData.list
        .filter((e) => e.source === props.source!.name && e.rank <= rankNum)
        .map((e) => props.allSpells.find((s) => s.id === e.spell_id))
        .filter((s): s is Spell => !!s);

      selectContent<Spell>(
        'spell',
        (option) => assignSlotSpell(rank, displayIdx, option.id),
        {
          overrideOptions: spellbookSpells,
          overrideLabel: 'Replace Spell',
        }
      );
    } else {
      selectContent<Spell>(
        'spell',
        (option) => assignSlotSpell(rank, displayIdx, option.id),
        {
          overrideLabel: 'Replace Spell',
          filterFn: (spellRec) => isNormalSpell(spellRec as Spell),
          advancedPresetFilters: {
            type: 'spell',
            spell_type: 'NORMAL',
            traditions: [tradition],
            rank_min: 0,
            rank_max: rankNum,
            content_sources: getDefaultSources('PAGE'),
          },
        }
      );
    }
  };

  const highestRank = Object.keys(slots || {}).reduce((acc, rank) => (parseInt(rank) > acc ? parseInt(rank) : acc), 0);
  // If there are no spells to display, and there are filters, return null
  if (props.hasFilters && slots && Object.keys(slots).filter((rank) => slots[rank].find((s) => s.spell)).length === 0) {
    return null;
  }

  const spellStats = getSpellStats(props.id, null, props.source!.tradition, props.source!.attribute);

  return (
    <Accordion.Item value={props.index} data-wg-name={props.index.toLowerCase()}>
      <Accordion.Control h={40}>
        <Group wrap='nowrap' justify='space-between' gap={0}>
          <Text c='gray.2' fw={700} fz='sm'>
            {toLabel(props.source!.name)} Spells
          </Text>

          <Box mr={10}>
            <ImprintButton
              radius='xl'
              size='xs'
              fw={500}
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
                props.openManageSpells?.(
                  props.source!.name,
                  props.source!.type === 'PREPARED-LIST' ? 'SLOTS-AND-LIST' : 'SLOTS-ONLY',
                  {
                    traditions: [props.source!.tradition.toLowerCase()],
                    rank_min: 0,
                    rank_max: highestRank,
                  }
                );
              }}
            >
              Manage
            </ImprintButton>
          </Box>
        </Group>
      </Accordion.Control>
      <Accordion.Panel
        styles={{
          content: {
            padding: 0,
          },
        }}
      >
        <Stack gap={0}>
          {/* <Divider color='dark.6' /> */}
          <Accordion
            px={10}
            pb={5}
            variant='separated'
            multiple
            defaultValue={[]}
            styles={{
              label: {
                paddingTop: 5,
                paddingBottom: 5,
              },
              control: {
                paddingLeft: 13,
                paddingRight: 13,
              },
              item: {
                marginTop: 0,
                marginBottom: 5,
              },
            }}
          >
            <Group wrap='nowrap' mb='sm'>
              <StatButton
                onClick={() => {
                  openDrawer({
                    type: 'stat-prof',
                    data: { id: props.id, variableName: 'SPELL_ATTACK' },
                    extra: { addToHistory: true },
                  });
                }}
              >
                <Group wrap='nowrap' gap={10}>
                  <Text fw={600} c='gray.2' fz='sm' span>
                    Spell Attack
                  </Text>
                  <Text c='gray.2' fz='sm' span>
                    {sign(spellStats.spell_attack.total[0])}
                    {!isPhone &&
                      ` / ${sign(spellStats.spell_attack.total[1])} /
                    ${sign(spellStats.spell_attack.total[2])}`}
                  </Text>
                </Group>
              </StatButton>
              <StatButton
                onClick={() => {
                  openDrawer({
                    type: 'stat-prof',
                    data: { id: props.id, variableName: 'SPELL_DC', isDC: true },
                    extra: { addToHistory: true },
                  });
                }}
              >
                <Group wrap='nowrap' gap={10}>
                  <Text fw={600} c='gray.2' fz='sm' span>
                    Spell DC
                  </Text>
                  <Text c='gray.2' fz='sm' span>
                    {spellStats.spell_dc.total}
                  </Text>
                </Group>
              </StatButton>
            </Group>
            {slots &&
              Object.keys(slots)
                .filter((rank) =>
                  slots[rank].length > 0 && props.hasFilters ? slots[rank].find((s) => s.spell) : true
                )
                .map((rank, index) => (
                  <div key={index} data-wg-name={`rank-group-${index}`}>
                    <Group wrap='nowrap' justify='space-between' gap={0}>
                      <Text c='gray.2' fw={700} fz='sm'>
                        {rank === '0' ? 'Cantrips' : `${rankNumber(parseInt(rank))}`}
                      </Text>
                      <Badge mr='sm' variant='outline' color='gray.5' size='sm'>
                        <Text c='gray.2' span inherit>
                          {props.hasFilters ? slots[rank].filter((s) => s.spell).length : slots[rank].length}
                        </Text>
                      </Badge>
                    </Group>
                    <Divider my={5} />
                    <Stack gap={5} mb={5}>
                      {slots[rank].map((slot, index) => {
                        // Cantrips are never exhausted on cast (refresh per
                        // round) and empty slots have nothing to toggle.
                        const canToggle = !!slot.spell && !isCantrip(slot.spell);
                        const entry = (
                          <SpellListEntrySection
                            key={index}
                            id={props.id}
                            entity={props.entity}
                            spell={slot.spell}
                            exhausted={!!slot.exhausted}
                            tradition={props.source!.tradition}
                            attribute={props.source!.attribute}
                            onCastSpell={(cast: boolean) => {
                              if (slot.spell) castSpell(cast, slot.spell);
                            }}
                            onOpenManageSpells={() => {
                              props.openManageSpells?.(
                                props.source!.name,
                                props.source!.type === 'PREPARED-LIST' ? 'SLOTS-AND-LIST' : 'SLOTS-ONLY',
                                {
                                  traditions: [props.source!.tradition.toLowerCase()],
                                  rank_min: 0,
                                  rank_max: parseInt(rank),
                                }
                              );
                            }}
                            hasFilters={props.hasFilters}
                          />
                        );
                        if (!canToggle) {
                          return entry;
                        }
                        return (
                          <Group key={index} wrap='nowrap' gap={6} align='center'>
                            <Box style={{ flex: 1, minWidth: 0 }}>{entry}</Box>
                            <Tooltip
                              label={slot.exhausted ? 'Mark as available' : 'Mark as used'}
                              withinPortal
                              openDelay={400}
                            >
                              <ActionIcon
                                variant='subtle'
                                color='gray.1'
                                size='sm'
                                radius='xl'
                                aria-label={slot.exhausted ? 'Slot used' : 'Slot available'}
                                style={{ opacity: 0.85 }}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  e.preventDefault();
                                  toggleSlotExhausted(rank, index);
                                }}
                              >
                                {slot.exhausted ? (
                                  <IconSquareRoundedFilled size='1rem' />
                                ) : (
                                  <IconSquareRounded size='1rem' />
                                )}
                              </ActionIcon>
                            </Tooltip>
                            {/* Replace: opens a spell picker filtered to
                                spells that could legally be prepared in this
                                slot, and writes the chosen spell straight in
                                — no unprepare-then-pick round-trip. Shown on
                                every non-cantrip prepared slot (the parent
                                `PreparedSpellsList` is itself only mounted
                                for `source.type` starting with `PREPARED-`,
                                so spontaneous/innate/focus casters never see
                                this button. Cantrips are excluded inside
                                `canToggle` since they auto-fill from the
                                repertoire and have nothing to replace.) */}
                            <Tooltip label='Replace spell' withinPortal openDelay={400}>
                              <ActionIcon
                                variant='subtle'
                                color='gray.1'
                                size='sm'
                                radius='xl'
                                aria-label='Replace prepared spell'
                                style={{ opacity: 0.85 }}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  e.preventDefault();
                                  handleReplace(rank, index);
                                }}
                              >
                                <IconReplace size='1rem' />
                              </ActionIcon>
                            </Tooltip>
                          </Group>
                        );
                      })}
                    </Stack>
                  </div>
                ))}
          </Accordion>
        </Stack>
      </Accordion.Panel>
    </Accordion.Item>
  );
}
