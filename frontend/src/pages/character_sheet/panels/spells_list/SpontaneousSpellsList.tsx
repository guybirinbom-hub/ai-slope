import BlurButton from '@common/BlurButton';
import { collectEntitySpellcasting } from '@content/collect-content';
import { Accordion, Badge, Box, Divider, Group, Paper, Stack, Text, Title } from '@mantine/core';
import { modals } from '@mantine/modals';
import { getSpellStats } from '@spells/spell-handler';
import {
  CastingSource,
  Character,
  LivingEntity,
  Spell,
  SpellInnateEntry,
  SpellListEntry,
  SpellSectionType,
  SpellSlot,
} from '@schemas/content';
import { rankNumber, sign } from '@utils/numbers';
import { toLabel } from '@utils/strings';
import { Dictionary } from 'node_modules/cypress/types/lodash';
import { useAtom } from 'jotai';
import { SetterOrUpdater } from '@utils/type-fixing';
import { SpellSlotSelect } from '../SpellsPanel';
import SpellListEntrySection from './SpellListEntrySection';
import { StatButton } from '@pages/character_builder/CharBuilderCreation';
import { drawerState } from '@atoms/navAtoms';
import { StoreID } from '@schemas/variables';
import { useMediaQuery } from '@mantine/hooks';
import { phoneQuery } from '@utils/mobile-responsive';
import ImprintButton from '@common/ImprintButton';

export default function SpontaneousSpellsList(props: {
  id: StoreID;
  entity: LivingEntity | null;
  setEntity: SetterOrUpdater<LivingEntity | null>;
  //
  index: string;
  source?: CastingSource;
  spellIds: number[];
  allSpells: Spell[];
  type: SpellSectionType;
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
  spells: Dictionary<Spell[]>;
}) {
  const isPhone = useMediaQuery(phoneQuery());

  const { slots, castSpell, spells, setEntity } = props;
  const [_drawer, openDrawer] = useAtom(drawerState);

  // Signature spells (PF2e CRB p.298) are a spontaneous-caster mechanic.
  // We expose the right-click toggle for every SPONTANEOUS-REPERTOIRE
  // source — that's the data shape that carries a repertoire (a curated
  // list of known spells). Prepared/innate/focus/etc. lists are handled
  // by their own panel components and never call this code path.
  const canMarkSignature = props.source?.type === 'SPONTANEOUS-REPERTOIRE';

  // Helper: look up whether a given spell is currently the signature
  // spell for its source. We match by spell_id + source — not by rank,
  // since the player toggles the spell itself; rank is implied by where
  // it sits in the repertoire.
  const isSignatureSpell = (spellId: number): boolean => {
    const list = props.entity?.spells?.list ?? [];
    return !!list.find(
      (e) => e.spell_id === spellId && e.source === props.source?.name && e.signature === true
    );
  };

  // Apply the signature toggle directly — no confirmation. Only
  // called from the wrapped toggleSignature below; do NOT wire to
  // the right-click menu directly (the user explicitly asked for a
  // confirm step before signature spells toggle, since the right-
  // click menu sits right next to the spell row and is easy to
  // fat-finger).
  const applySignatureToggle = (spell: Spell) => {
    setEntity((c) => {
      if (!c) return c;
      const sourceName = props.source!.name;
      const list = c.spells?.list ?? [];
      const entryIdx = list.findIndex((e) => e.spell_id === spell.id && e.source === sourceName);
      if (entryIdx === -1) return c;

      const isCurrentlySignature = !!list[entryIdx].signature;
      const rank = list[entryIdx].rank;
      const turningOn = !isCurrentlySignature;

      const newList = list.map((e, i) => {
        if (i === entryIdx) {
          return { ...e, signature: turningOn };
        }
        // 1-per-rank enforcement: clear any other signature at the same
        // (source, rank) when we're enabling this one.
        if (turningOn && e.source === sourceName && e.rank === rank && e.signature) {
          return { ...e, signature: false };
        }
        return e;
      });

      return {
        ...c,
        spells: {
          ...(c.spells ?? { slots: [], list: [], focus_point_current: 0, innate_casts: [] }),
          list: newList,
        },
      };
    });
  };

  // Confirmed signature toggle. Opens a confirm modal that names the
  // spell + explains the consequence (clears any other signature at
  // the same rank). Both ON and OFF directions ask, so an accidental
  // right-click can't strip a signature either.
  const toggleSignature = (spell: Spell) => {
    const sourceName = props.source!.name;
    const list = props.entity?.spells?.list ?? [];
    const entry = list.find((e) => e.spell_id === spell.id && e.source === sourceName);
    if (!entry) return;
    const turningOn = !entry.signature;
    const otherAtSameRank = turningOn
      ? list.find(
          (e) =>
            e.source === sourceName &&
            e.rank === entry.rank &&
            e.signature &&
            e.spell_id !== spell.id
        )
      : undefined;
    const otherName = otherAtSameRank
      ? props.allSpells.find((s) => s.id === otherAtSameRank.spell_id)?.name ?? null
      : null;
    modals.openConfirmModal({
      title: (
        <Title order={4}>
          {turningOn ? 'Make Signature Spell?' : 'Remove Signature Status?'}
        </Title>
      ),
      children: turningOn ? (
        <Stack gap={6}>
          <Text size='sm'>
            Mark <b>{spell.name}</b> as your signature spell at rank {entry.rank}? Signature spells automatically
            heighten to any rank-{entry.rank}-or-higher slot you cast them from.
          </Text>
          {otherName && (
            <Text size='xs' c='dimmed'>
              This will replace your current rank-{entry.rank} signature spell, <b>{otherName}</b>.
            </Text>
          )}
        </Stack>
      ) : (
        <Text size='sm'>
          Remove <b>{spell.name}</b> as your signature spell? It will no longer auto-heighten in higher slots.
        </Text>
      ),
      labels: {
        confirm: turningOn ? 'Make signature' : 'Remove signature',
        cancel: 'Cancel',
      },
      onConfirm: () => applySignatureToggle(spell),
    });
  };

  const highestRank = Object.keys(slots || {}).reduce((acc, rank) => (parseInt(rank) > acc ? parseInt(rank) : acc), 0);
  // If there are no spells to display, and there are filters, return null
  if (props.hasFilters && spells && !Object.keys(spells).find((rank) => spells[rank].length > 0)) {
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
                props.openManageSpells?.(props.source!.name, 'LIST-ONLY', {
                  traditions: [props.source!.tradition.toLowerCase()],
                  rank_min: 0,
                  rank_max: highestRank,
                });
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
                .filter((rank) => slots[rank] && slots[rank].length > 0)
                .map((rank, index) => (
                  <div key={index} data-wg-name={`rank-group-${index}`}>
                    <Group wrap='nowrap' justify='space-between' gap={0}>
                      <Group wrap='nowrap'>
                        <Text c='gray.2' fw={700} fz='sm' miw={30}>
                          {rank === '0' ? 'Cantrips' : `${rankNumber(parseInt(rank))}`}
                        </Text>
                        {rank !== '0' && (
                          <SpellSlotSelect
                            text='Spell Slots'
                            current={slots[rank].filter((slot) => `${slot.rank}` === rank && slot.exhausted).length}
                            max={slots[rank].filter((slot) => `${slot.rank}` === rank).length}
                            onChange={(v) => {
                              props.setEntity((c) => {
                                if (!c) return c;

                                let count = 0;
                                const slots = collectEntitySpellcasting(props.id, c).slots;
                                for (const slot of slots) {
                                  if (slot.rank === parseInt(rank) && slot.source === props.source?.name) {
                                    slot.exhausted = count < v;
                                    count++;
                                  }
                                }

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
                            }}
                          />
                        )}
                      </Group>
                      <Badge mr='sm' variant='outline' color='gray.5' size='sm'>
                        <Text c='gray.2' span inherit>
                          {spells[rank]?.length ?? 0}
                        </Text>
                      </Badge>
                    </Group>
                    <Divider my={5} />
                    <Stack gap={5} mb={5}>
                      {spells[rank]?.map((spell, index) => (
                        <SpellListEntrySection
                          key={index}
                          id={props.id}
                          entity={props.entity}
                          spell={spell}
                          exhausted={!slots[rank].find((s) => !s.exhausted)}
                          tradition={props.source!.tradition}
                          attribute={props.source!.attribute}
                          onCastSpell={(cast: boolean) => {
                            castSpell(cast, spell);
                          }}
                          onOpenManageSpells={() => {
                            props.openManageSpells?.(
                              props.source!.name,
                              props.source!.type === 'PREPARED-LIST' ? 'SLOTS-AND-LIST' : 'SLOTS-ONLY',
                              {
                                traditions: [props.source!.tradition.toLowerCase()],
                              }
                            );
                          }}
                          hasFilters={props.hasFilters}
                          // Signature-spell wiring: only enabled for
                          // SPONTANEOUS-REPERTOIRE sources (see above).
                          // The component itself skips cantrips/rituals
                          // even when the flag is on, so we don't need
                          // to check that here.
                          canMarkSignature={canMarkSignature}
                          isSignature={canMarkSignature && isSignatureSpell(spell.id)}
                          onToggleSignature={() => toggleSignature(spell)}
                        />
                      ))}
                      {(!spells[rank] || spells[rank].length === 0) && (
                        <Text c='gray.3' fz='sm' fs='italic' ta='center' py={5}>
                          No spells known
                        </Text>
                      )}
                    </Stack>
                  </div>
                ))}
          </Accordion>
        </Stack>
      </Accordion.Panel>
    </Accordion.Item>
  );
}
