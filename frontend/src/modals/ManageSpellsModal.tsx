import { drawerState } from '@atoms/navAtoms';
import { SelectContentButton, SpellSelectionOption, selectContent } from '@common/select/SelectContent';
import { EDIT_MODAL_HEIGHT, IMPRINT_BG_COLOR } from '@constants/data';
import { collectEntitySpellcasting } from '@content/collect-content';
import { isSpellVisible } from '@content/content-hidden';
import { fetchContentAll, getDefaultSources } from '@content/content-store';
import {
  Box,
  Button,
  Divider,
  Grid,
  Group,
  LoadingOverlay,
  Modal,
  ScrollArea,
  Stack,
  Text,
  TextInput,
  Title,
  useMantineTheme,
  useMantineColorScheme,
} from '@mantine/core';
import { isCantrip, isNormalSpell, isRitual } from '@spells/spell-utils';
import { IconPlus, IconSearch } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { LivingEntity, Spell, SpellSlot, SpellSlotRecord } from '@schemas/content';
import { StoreID } from '@schemas/variables';
import { rankNumber } from '@utils/numbers';
import { toLabel } from '@utils/strings';
import { isTruthy } from '@utils/type-fixing';
import useRefresh from '@utils/use-refresh';
import * as JsSearch from 'js-search';
import { groupBy } from 'lodash-es';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useAtom } from 'jotai';
import { SetterOrUpdater } from '@utils/type-fixing';

export default function ManageSpellsModal(props: {
  id: StoreID;
  entity: LivingEntity | null;
  setEntity: SetterOrUpdater<LivingEntity | null>;
  //
  opened: boolean;
  onClose: () => void;
  source: string;
  type: 'SLOTS-ONLY' | 'SLOTS-AND-LIST' | 'LIST-ONLY';
  filter?: {
    traditions?: string[];
    rank_min?: number;
    rank_max?: number;
  };
  zIndex?: number;
}) {
  const isRituals = props.source === 'RITUALS';

  const [searchQuery, setSearchQuery] = useState('');
  const [_drawer, openDrawer] = useAtom(drawerState);

  const { data: allRawSpells, isFetching } = useQuery({
    queryKey: [`find-spells-in-manage-spells-modal`, { entityId: props.entity?.id, source: props.source }],
    queryFn: async () => {
      return (await fetchContentAll<Spell>('spell', getDefaultSources('PAGE'))).filter((spell) =>
        isSpellVisible(props.id, spell)
      );
    },
  });

  // Filter options based on search query
  const search = useRef(new JsSearch.Search('id'));
  useEffect(() => {
    if (!allRawSpells) return;
    search.current.addIndex('name');
    search.current.addIndex('description');
    search.current.addIndex('duration');
    search.current.addIndex('targets');
    search.current.addIndex('area');
    search.current.addIndex('range');
    search.current.addIndex('requirements');
    search.current.addIndex('trigger');
    search.current.addIndex('cost');
    search.current.addIndex('defense');
    search.current.addDocuments(allRawSpells);
  }, [allRawSpells]);

  const charData = useMemo(() => {
    if (!props.entity) return null;
    return collectEntitySpellcasting(props.id, props.entity);
  }, [props.entity]);

  const allFilteredSpells =
    (searchQuery.trim() ? (search.current?.search(searchQuery.trim()) as Spell[] | undefined) : (allRawSpells ?? [])) ??
    [];

  const spells = useMemo(() => {
    const filteredSpells = charData?.list
      .map((entry) => {
        const foundSpell = allFilteredSpells.find(
          (spell) => spell.id === entry.spell_id && entry.source === props.source
        );
        if (!foundSpell) return null;
        return {
          ...foundSpell,
          rank: entry.rank,
        } as Spell;
      })
      .filter(isTruthy)
      .filter((spell) => (isRituals ? isRitual(spell!) : isNormalSpell(spell!)))
      .sort((a, b) => {
        if (a!.rank === 0 && b!.rank === 0) {
          return a!.name.localeCompare(b!.name);
        } else if (a!.rank === 0) {
          return -1;
        } else if (b!.rank === 0) {
          return 1;
        } else {
          return a!.rank - b!.rank;
        }
      });
    return filteredSpells;
  }, [charData, allFilteredSpells]);

  const slots = useMemo(() => {
    return groupBy(charData?.slots, 'rank');
  }, [charData]);

  return (
    <Modal
      opened={props.opened}
      onClose={props.onClose}
      title={<Title order={3}>Manage {isRituals ? 'Rituals' : `Spells - ${toLabel(props.source)}`}</Title>}
      // Tag the body with a marker class so codex-bridge.css can flex
      // the body + the inner Stack to fill the modal frame, killing the
      // dead-space gap the user was seeing under short spell lists.
      classNames={{ body: 'codex-manage-spells-body' }}
      // Unified with the other codex popups (Add Items, Add Spell).
      // 1500px wide matches the design footprint. The body grows
      // tall enough for the spellbook + add-spell button without
      // scrolling pinching against the page.
      size={1500}
      keepMounted={false}
      zIndex={props.zIndex}
    >
      <Stack
        // The inline flex layout works WITH the .codex-manage-spells-body
        // CSS rules — the body is set to display:flex, so this Stack
        // flex-grows to fill the modal. Without `minHeight: 0` the inner
        // ScrollArea would push its parent past the modal frame.
        style={{ position: 'relative', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}
        mx={10}
        className='codex-manage-spells-stack'
      >
        {/* All three `type` modes now collapse to the spellbook list.
            The SlotsSection grid (the "SELECT SPELL" buttons per slot)
            was removed at the user's request — slot-filling lives on
            the spell page now via the gold "+ Prepare X-Rank Spell"
            buttons, so the manage modal only manages the spellbook
            itself (add / remove / re-rank known spells). */}
        {props.type === 'LIST-ONLY' ? (
          <ListSection
            id={props.id}
            entity={props.entity}
            setEntity={props.setEntity}
            selectRank
            spells={spells ?? []}
            source={props.source}
            searchQuery={searchQuery}
            filter={props.filter}
            setSearchQuery={(val) => {
              setSearchQuery(val);
            }}
          />
        ) : props.type === 'SLOTS-AND-LIST' ? (
          <ListSection
            id={props.id}
            entity={props.entity}
            setEntity={props.setEntity}
            spells={spells ?? []}
            source={props.source}
            searchQuery={searchQuery}
            filter={props.filter}
            setSearchQuery={(val) => {
              setSearchQuery(val);
            }}
          />
        ) : (
          <>
            <LoadingOverlay visible={isFetching} />
            <ListSection
              id={props.id}
              entity={props.entity}
              setEntity={props.setEntity}
              spells={spells ?? []}
              source={props.source}
              searchQuery={searchQuery}
              filter={props.filter}
              setSearchQuery={(val) => {
                setSearchQuery(val);
              }}
            />
          </>
        )}
      </Stack>
    </Modal>
  );
}

const SlotsSection = (props: {
  id: StoreID;
  entity: LivingEntity | null;
  setEntity: SetterOrUpdater<LivingEntity | null>;
  //
  slots: Record<string, SpellSlotRecord[]>;
  spells?: Spell[];
  source: string;
  filter?: {
    traditions?: string[];
    rank_min?: number;
    rank_max?: number;
  };
}) => {
  const theme = useMantineTheme();
  const [_drawer, openDrawer] = useAtom(drawerState);
  const [displaySlots, refreshSlots] = useRefresh();

  const { slots } = props;
  // Filter the slots to only show the slots for the source
  const slotsForSource = Object.keys(slots).reduce(
    (acc, key) => {
      const slots = props.slots[key].filter((slot) => slot.source === props.source);
      if (slots.length > 0) {
        acc[key] = slots;
      }
      return acc;
    },
    {} as Record<string, SpellSlotRecord[]>
  );

  return (
    <ScrollArea pr={14} h={`calc(min(80dvh, ${EDIT_MODAL_HEIGHT}px))`} scrollbars='y'>
      <Stack gap={10}>
        {Object.keys(slotsForSource).map((rank, index) => (
          <Box key={index} data-wg-name={`rank-${rank}`}>
            <Text size='md' pl={5}>
              {rank === '0' ? 'Cantrips' : `${rankNumber(parseInt(rank))}`}
            </Text>
            <Divider pt={0} pb={10} />
            {displaySlots && (
              <Group key={index} gap={10}>
                {slotsForSource[rank].map((slot, index) => (
                  <Box key={index}>
                    <SelectContentButton
                      type='spell'
                      onClick={(spell) => {
                        props.setEntity((c) => {
                          if (!c) return c;
                          let slots = collectEntitySpellcasting(props.id, c).slots;
                          slots = slots.map((s) => {
                            if (s.id === slot.id) {
                              return {
                                ...s,
                                spell_id: spell.id,
                              };
                            } else {
                              return s;
                            }
                          });

                          return {
                            ...c,
                            spells: {
                              ...(c.spells ?? {
                                slots: [],
                                list: [],
                                focus_point_current: 0,
                                innate_casts: [],
                              }),
                              slots: slots,
                            },
                          };
                        });
                        //refreshSlots();
                      }}
                      onClear={() => {
                        props.setEntity((c) => {
                          if (!c) return c;
                          let slots = collectEntitySpellcasting(props.id, c).slots;
                          slots = slots.map((s) => {
                            if (s.id === slot.id) {
                              return {
                                ...s,
                                spell_id: undefined,
                              };
                            } else {
                              return s;
                            }
                          });

                          return {
                            ...c,
                            spells: {
                              ...(c.spells ?? {
                                slots: [],
                                list: [],
                                focus_point_current: 0,
                                innate_casts: [],
                              }),
                              slots: slots,
                            },
                          };
                        });
                        //refreshSlots();
                      }}
                      selectedId={slot.spell_id === -1 ? undefined : slot.spell_id}
                      options={{
                        showButton: true,
                        overrideOptions: props.spells,
                        filterFn: (spell: Spell) => {
                          // const foundSpell =
                          //   props.spells !== undefined
                          //     ? props.spells.find((s) => s.id === spell.id)
                          //     : undefined;
                          // if (props.spells !== undefined && !foundSpell) return false;

                          if (rank === '0') {
                            return isNormalSpell(spell) && isCantrip(spell);
                          } else {
                            return isNormalSpell(spell) && spell.rank <= parseInt(rank) && !isCantrip(spell);
                          }
                        },
                        advancedPresetFilters: props.spells
                          ? undefined
                          : {
                              type: 'spell',
                              spell_type: 'NORMAL',
                              traditions: props.filter?.traditions,
                              rank_min: props.filter?.rank_min,
                              rank_max: props.filter?.rank_max,
                              content_sources: getDefaultSources('PAGE'),
                            },
                      }}
                    />
                  </Box>
                ))}
              </Group>
            )}
          </Box>
        ))}
      </Stack>
    </ScrollArea>
  );
};

const ListSection = (props: {
  id: StoreID;
  entity: LivingEntity | null;
  setEntity: SetterOrUpdater<LivingEntity | null>;
  //
  selectRank?: boolean;
  spells: Spell[];
  source: string;
  searchQuery: string;
  setSearchQuery: (val: string) => void;
  filter?: {
    traditions?: string[];
    rank_min?: number;
    rank_max?: number;
  };
}) => {
  const isRituals = props.source === 'RITUALS';

  const theme = useMantineTheme();
  const { colorScheme } = useMantineColorScheme();
  const [_drawer, openDrawer] = useAtom(drawerState);

  const [rankSelectSpell, setRankSelectSpell] = useState<Spell | null>(null);

  const addSpell = (option: Spell, rank: number) => {
    props.setEntity((c) => {
      if (!c) return c;

      const existing = c.spells?.list ?? [];
      // Idempotent add: if a repertoire entry already exists for the
      // same (spell, rank, source) tuple, do nothing. Two cases this
      // protects against:
      //   - The picker fires onClick twice (rapid double-click, React
      //     StrictMode dev-mount, etc.) — we'd otherwise insert two
      //     identical entries that render as two rows in the spells
      //     panel.
      //   - The player forgets the spell is already in their repertoire
      //     and re-picks it from the search modal.
      // We still allow the same spell at *different* ranks, since PF2e
      // spontaneous repertoires support that explicitly (heightening
      // without the signature feature).
      const alreadyPresent = existing.some(
        (e) => e.spell_id === option.id && e.rank === rank && e.source === props.source
      );
      if (alreadyPresent) return c;

      const list = [
        ...existing,
        {
          spell_id: option.id,
          rank: rank, //option.rank,
          source: props.source,
        },
      ];

      return {
        ...c,
        spells: {
          ...(c.spells ?? {
            slots: [],
            list: [],
            focus_point_current: 0,
            innate_casts: [],
          }),
          list: list,
        },
      };
    });
  };

  return (
    <Box style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <SelectSpellRankModal
        spell={rankSelectSpell}
        onConfirm={(spell, rank) => {
          if (spell && rank) {
            addSpell(spell, rank);
          }
          setRankSelectSpell(null);
        }}
      />
      <Group style={{ flex: '0 0 auto' }}>
        <TextInput
          style={{ flex: 1 }}
          leftSection={<IconSearch size='0.9rem' />}
          placeholder={`Search ${isRituals ? 'ritual' : 'spell'} list`}
          defaultValue={props.searchQuery}
          onChange={(e) => props.setSearchQuery(e.target.value)}
          styles={{
            input: {
              backgroundColor: IMPRINT_BG_COLOR,
              borderColor: props.searchQuery.trim().length > 0 ? theme.colors['guide'][8] : undefined,
            },
          }}
        />
        <Button
          color='dark.6'
          style={{ borderColor: theme.colors.dark[4] }}
          radius='md'
          fw={500}
          rightSection={<IconPlus size='1.0rem' />}
          onClick={() => {
            selectContent<Spell>(
              'spell',
              (option) => {
                if (option.rank === 0 || option.rank === 10 || isRitual(option)) {
                  addSpell(option, option.rank);
                } else {
                  if (props.selectRank) {
                    setRankSelectSpell(option);
                  } else {
                    addSpell(option, option.rank);
                  }
                }
              },
              {
                showButton: true,
                overrideLabel: `Add ${isRituals ? 'Ritual' : 'Spell'}`,
                // The ManageSpells parent opens at zIndex 500 (set by
                // its caller in CodexPanels). Without an explicit
                // zIndex here, selectContent defaults to 499 and the
                // Add Spell modal renders BEHIND its parent — the
                // user can see it flash on but can't click any
                // option. Bumping above 500 puts it on top.
                zIndex: 600,

                filterFn: (spellRec: Record<string, any>) => {
                  const s = spellRec as Spell;
                  if (isRituals) {
                    return isRitual(s);
                  } else {
                    return isNormalSpell(s);
                  }
                },
                advancedPresetFilters: {
                  type: 'spell',
                  spell_type: isRituals ? 'RITUAL' : 'NORMAL',
                  traditions: props.filter?.traditions,
                  rank_min: props.filter?.rank_min,
                  rank_max: props.filter?.rank_max,
                  content_sources: getDefaultSources('PAGE'),
                },
              }
            );
          }}
        >
          Add {isRituals ? 'Ritual' : 'Spell'}
        </Button>
      </Group>
      {/* flex:1 lets the spell list fill the modal — replaces the old
          fixed calc() height that was leaving big dead space under short
          lists. scrollbars='y' keeps the horizontal scrollbar off. */}
      <ScrollArea style={{ flex: 1, minHeight: 0, marginTop: 10 }} scrollbars='y'>
        <Stack gap={0}>
          {props.spells.map((spell, index) => (
            <SpellSelectionOption
              key={index}
              spell={spell}
              onClick={(spell) => {
                openDrawer({ type: 'spell', data: { spell: spell, entity: props.entity } });
              }}
              onDelete={(spellId) => {
                props.setEntity((c) => {
                  if (!c) return c;

                  const list = (c.spells?.list ?? []).filter((entry) => {
                    return !(entry.spell_id === spellId && entry.rank === spell.rank && entry.source === props.source);
                  });

                  // Cascade: any prepared slot at this source that
                  // referenced the deleted spell is now stranded
                  // (slot.spell_id points at a spell no longer in the
                  // spellbook). Clear those slots so they become
                  // available-to-fill again. Spontaneous casters cast
                  // via rank-only slot matching so they're unaffected
                  // — but the filter is safe to run for them too
                  // since their slots never carry a spell_id.
                  const slots = (c.spells?.slots ?? []).map((s) =>
                    s.source === props.source && s.spell_id === spellId
                      ? { ...s, spell_id: undefined, exhausted: false }
                      : s
                  );

                  return {
                    ...c,
                    spells: {
                      ...(c.spells ?? {
                        slots: [],
                        list: [],
                        focus_point_current: 0,
                        innate_casts: [],
                      }),
                      list,
                      slots,
                    },
                  };
                });
              }}
              showButton={false}
              hideTraits={true}
              includeOptions={true}
            />
          ))}
          {props.spells.length === 0 && (
            <Text c='gray.3' fz='sm' fs='italic' ta='center' pt={20}>
              No {isRituals ? 'rituals' : 'spells'} found
            </Text>
          )}
        </Stack>
      </ScrollArea>
    </Box>
  );
};

const SelectSpellRankModal = (props: {
  spell: Spell | null;
  onConfirm: (spell: Spell | null, rank: number | null) => void;
}) => {
  const getRankOptions = (X: number): number[] => Array.from({ length: 11 - X }, (_, i) => X + i);

  return (
    <Modal
      opened={!!props.spell}
      onClose={() => props.onConfirm(null, null)}
      title={<Title order={3}>Select {props.spell?.name}'s Rank</Title>}
      zIndex={1000}
    >
      <Stack gap={10}>
        {props.spell &&
          getRankOptions(props.spell.rank).map((rank) => (
            <Button
              key={rank}
              onClick={() => {
                props.onConfirm(props.spell, rank);
              }}
              variant='light'
              fullWidth
            >
              {rankNumber(rank)}
            </Button>
          ))}
      </Stack>
    </Modal>
  );
};
