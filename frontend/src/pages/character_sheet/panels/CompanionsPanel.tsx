import { characterState } from '@atoms/characterAtoms';
import { fetchContentAll, fetchContentPackage, getDefaultSources } from '@content/content-store';
import {
  Accordion,
  ActionIcon,
  Box,
  Group,
  Loader,
  Popover,
  ScrollArea,
  Select,
  Stack,
  Text,
  Title,
  Tooltip,
} from '@mantine/core';
import { useDebouncedValue, useDidUpdate, useMediaQuery } from '@mantine/hooks';
import { useQuery } from '@tanstack/react-query';
import { Creature, Trait } from '@schemas/content';
import { findCreatureTraits, determineCompanionType } from '@utils/creature';
import { phoneQuery } from '@utils/mobile-responsive';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useAtom } from 'jotai';
import { confirmHealth } from '../entity-handler';
import { DisplayIcon } from '@common/IconDisplay';
import { IconChevronDown, IconPlus, IconTrash } from '@tabler/icons-react';
import { cloneDeep } from 'lodash-es';
import { executeOperations } from '@operations/operations.main';
import { addExtraItems, checkBulkLimit } from '@items/inv-handlers';
import { applyEquipmentPenalties } from '@items/inv-utils';
import { applyConditions } from '@conditions/condition-handler';
import { modals } from '@mantine/modals';
import { selectContent } from '@common/select/SelectContent';
import { getEntityLevel } from '@utils/entity-utils';
import { IMPRINT_BG_COLOR, IMPRINT_BG_COLOR_HOVER, IMPRINT_BORDER_COLOR } from '@constants/data';
import { convertToSetEntity } from '@utils/type-fixing';
import { getFinalHealthValue } from '@variables/variable-helpers';

import HealthSection from '../sections/HealthSection';
import ArmorSection from '../sections/ArmorSection';
import AttributeSection from '../sections/AttributeSection';
import { AltSpeedSection } from '../sections/SpeedSection';
import CreatureAbilitiesPanel from './CreatureAbilitiesPanel';
import SkillsActionsPanel from './SkillsActionsPanel';
import InventoryPanel from './InventoryPanel';
import SpellsPanel from './SpellsPanel';
import NotesPanel from './NotesPanel';
import CreatureDetailsPanel from './CreatureDetailsPanel';

// ─── Companion panel ─────────────────────────────────────────────────
// One full sheet per companion, switched via gold pill switcher at the
// top. Each section of the sheet is independently collapsible (multi-
// open accordion). Zero-companion case shows only the Add picker; 1+
// case shows pills + Add + the selected companion's full sheet.

export default function CompanionsPanel(props: { panelHeight: number; panelWidth: number }) {
  const [character, setCharacter] = useAtom(characterState);
  const companions = character?.companions?.list ?? [];

  const [selectedIndex, setSelectedIndex] = useState(0);

  // If the selected companion gets removed (or the list shrinks), snap
  // selection back into range so we don't try to render undefined.
  useEffect(() => {
    if (selectedIndex >= companions.length) {
      setSelectedIndex(Math.max(0, companions.length - 1));
    }
  }, [companions.length, selectedIndex]);

  // ── Zero-companion empty state ─────────────────────────────────────
  if (companions.length === 0) {
    return (
      <ScrollArea p={8} style={{ height: props.panelHeight - 50 }}>
        <Stack mt={40} gap={14} align='center' justify='center'>
          <Text ta='center' c='gray.2' fs='italic' fz='sm'>
            No companions found, want to add one?
          </Text>
          <AddCompanionSection />
        </Stack>
      </ScrollArea>
    );
  }

  const selected = companions[selectedIndex] ?? companions[0];

  const updateSelected = (next: Creature) => {
    setCharacter((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        companions: {
          ...(prev.companions ?? {}),
          list: (prev.companions?.list ?? []).map((c, i) => (i === selectedIndex ? next : c)),
        },
      };
    });
  };

  const removeSelected = () => {
    modals.openConfirmModal({
      id: 'remove-companion',
      title: <Title order={4}>Delete Companion</Title>,
      children: (
        <Text size='sm'>
          Are you sure you want to delete "{selected.name}"? This action cannot be undone.
        </Text>
      ),
      labels: { confirm: 'Confirm', cancel: 'Cancel' },
      onCancel: () => {},
      onConfirm: () => {
        setCharacter((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            companions: {
              ...(prev.companions ?? {}),
              list: (prev.companions?.list ?? []).filter((_, i) => i !== selectedIndex),
            },
          };
        });
        setSelectedIndex(0);
      },
    });
  };

  return (
    <Stack h={props.panelHeight} gap={0}>
      {/* Switcher row */}
      <Group
        wrap='nowrap'
        gap={8}
        px={8}
        py={6}
        style={{
          borderBottom: `1px solid ${IMPRINT_BORDER_COLOR}`,
          background: 'linear-gradient(180deg, rgba(201,161,59,.04) 0%, transparent 100%)',
        }}
      >
        <ScrollArea scrollbars='x' style={{ flex: 1, minWidth: 0 }}>
          <Group gap={6} wrap='nowrap'>
            {companions.map((c, i) => (
              <CompanionPill
                key={i}
                companion={c}
                active={i === selectedIndex}
                onClick={() => setSelectedIndex(i)}
              />
            ))}
          </Group>
        </ScrollArea>
        <AddCompanionButton />
      </Group>

      {/* Selected companion sheet */}
      <Box style={{ flex: 1, minHeight: 0 }}>
        <ScrollArea h={props.panelHeight - 52} p={10}>
          <CompanionSheet
            key={`companion-sheet-${selectedIndex}-${selected.id}`}
            companion={selected}
            storeId={`COMPANION_${selectedIndex}`}
            panelWidth={props.panelWidth}
            panelHeight={props.panelHeight}
            updateCompanion={updateSelected}
            onRemove={removeSelected}
          />
        </ScrollArea>
      </Box>
    </Stack>
  );
}

// ─── Pill in the switcher row ────────────────────────────────────────
function CompanionPill(props: { companion: Creature; active: boolean; onClick: () => void }) {
  return (
    <Box
      onClick={props.onClick}
      style={() => ({
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        padding: '4px 12px 4px 4px',
        borderRadius: 999,
        background: props.active ? 'rgba(201,161,59,.10)' : IMPRINT_BG_COLOR,
        border: `1px solid ${props.active ? 'var(--gold-deep, #8a6f25)' : IMPRINT_BORDER_COLOR}`,
        boxShadow: props.active ? '0 0 0 1px var(--gold-deep, #8a6f25)' : 'none',
        color: props.active ? 'var(--ink, #ede4ce)' : 'var(--ink-dim, #c3b69a)',
        cursor: 'pointer',
        whiteSpace: 'nowrap',
        transition: 'all .15s',
      })}
      onMouseEnter={(e) => {
        if (!props.active) {
          (e.currentTarget as HTMLDivElement).style.background = IMPRINT_BG_COLOR_HOVER;
        }
      }}
      onMouseLeave={(e) => {
        if (!props.active) {
          (e.currentTarget as HTMLDivElement).style.background = IMPRINT_BG_COLOR;
        }
      }}
    >
      <Box w={26} h={26} style={{ flex: '0 0 26px' }}>
        <DisplayIcon
          strValue={props.companion.details?.image_url ?? 'icon|||avatar|||#373A40'}
          width={26}
          iconStyles={{ objectFit: 'contain', height: 26 }}
        />
      </Box>
      <Text fz='sm' fw={500} span>
        {props.companion.name}
      </Text>
      <Text fz='xs' c='dimmed' span>
        Lv {getEntityLevel(props.companion)}
      </Text>
    </Box>
  );
}

// ─── Add Companion button — uses a Popover to host the existing
// AddCompanionSection picker, so the same Type→Creature flow keeps
// working without duplicating logic.
function AddCompanionButton() {
  const [opened, setOpened] = useState(false);
  return (
    <Popover
      opened={opened}
      onChange={setOpened}
      position='bottom-end'
      withArrow
      shadow='md'
      zIndex={400}
    >
      <Popover.Target>
        <Box
          onClick={() => setOpened((o) => !o)}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '6px 14px',
            borderRadius: 999,
            background: 'transparent',
            border: `1px solid var(--gold-deep, #8a6f25)`,
            color: 'var(--gold-bright, #e8c557)',
            cursor: 'pointer',
            fontSize: 13,
            fontWeight: 600,
            whiteSpace: 'nowrap',
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLDivElement).style.background = 'rgba(201,161,59,.08)';
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLDivElement).style.background = 'transparent';
          }}
        >
          <IconPlus size='1rem' stroke={2} />
          <span>Add Companion</span>
        </Box>
      </Popover.Target>
      <Popover.Dropdown p={8}>
        <AddCompanionSection onAdded={() => setOpened(false)} />
      </Popover.Dropdown>
    </Popover>
  );
}

// ─── Companion full sheet — header + collapsible sections ────────────
function CompanionSheet(props: {
  companion: Creature;
  storeId: string;
  panelWidth: number;
  panelHeight: number;
  updateCompanion: (creature: Creature) => void;
  onRemove: () => void;
}) {
  const STORE_ID = props.storeId;

  // Local working copy. Switching companions remounts via the parent's
  // `key`, so we don't need to keep prev/next in sync inside this
  // component — initial mount handles the swap.
  const [creature, setCreature] = useState<Creature | null>(() => cloneDeep(props.companion));
  const [loading, setLoading] = useState(true);
  const [openSections, setOpenSections] = useState<string[]>([
    'health',
    'defenses',
    'attributes',
    'senses-speed',
  ]);

  // Push debounced local-creature changes back upstream so the
  // companion list in `character.companions.list` stays in sync.
  const [debouncedCreature] = useDebouncedValue(creature, 150);
  useDidUpdate(() => {
    if (debouncedCreature) props.updateCompanion(debouncedCreature);
  }, [debouncedCreature]);

  // Content needed by the heavier panels (Inventory, Spells, Skills).
  const { data: content } = useQuery({
    queryKey: ['companion-sheet-content'],
    queryFn: () =>
      fetchContentPackage(getDefaultSources('INFO'), {
        fetchSources: false,
        fetchCreatures: false,
      }),
    staleTime: 5 * 60 * 1000,
  });

  // Run the same operation pipeline the CreatureDrawer runs so all of
  // the variable-store-backed sub-panels (AC, saves, attributes,
  // skills, abilities, inventory bulk, etc.) have populated values.
  const executingOperations = useRef(false);
  useEffect(() => {
    if (!creature || !content || executingOperations.current) return;
    executingOperations.current = true;
    executeOperations({
      type: 'CREATURE',
      data: {
        id: STORE_ID,
        creature,
        content,
      },
    }).then(() => {
      addExtraItems(STORE_ID, content.items, creature, convertToSetEntity(setCreature));
      checkBulkLimit(STORE_ID, creature, convertToSetEntity(setCreature), true);
      applyEquipmentPenalties(STORE_ID, creature);
      applyConditions(STORE_ID, creature.details?.conditions ?? []);

      if (creature.meta_data?.reset_hp !== false) {
        const handleRestHP = () => {
          const maxHealth = getFinalHealthValue(STORE_ID);
          confirmHealth(`${maxHealth}`, maxHealth, creature, convertToSetEntity(setCreature));
        };
        handleRestHP();
        setTimeout(handleRestHP, 1000);
      } else {
        const maxHealth = getFinalHealthValue(STORE_ID);
        confirmHealth(`${creature.hp_current}`, maxHealth, creature, convertToSetEntity(setCreature));
      }

      executingOperations.current = false;
      setTimeout(() => setLoading(false), 100);
    });
  }, [creature, content, STORE_ID]);

  if (loading || !creature || !content) {
    return (
      <Box pt={60} ta='center'>
        <Loader type='bars' />
      </Box>
    );
  }

  const setEntity = convertToSetEntity(setCreature);

  return (
    <Stack gap={12}>
      {/* Header — avatar / name / type / delete */}
      <Group justify='space-between' wrap='nowrap'>
        <Group wrap='nowrap' gap={12}>
          <Box w={56}>
            <DisplayIcon
              strValue={creature.details?.image_url ?? 'icon|||avatar|||#373A40'}
              width={56}
              iconStyles={{ objectFit: 'contain', height: 56 }}
            />
          </Box>
          <Box>
            <Title order={3}>{creature.name}</Title>
            <Text c='dimmed' fz='xs'>
              {determineCompanionType(creature) || 'Creature'} · Level {getEntityLevel(creature)}
            </Text>
          </Box>
        </Group>
        <Tooltip label='Delete Companion'>
          <ActionIcon variant='subtle' color='red' onClick={props.onRemove} aria-label='Delete Companion'>
            <IconTrash size='1.1rem' />
          </ActionIcon>
        </Tooltip>
      </Group>

      <Accordion
        multiple
        value={openSections}
        onChange={setOpenSections}
        variant='separated'
        radius='md'
        chevron={<IconChevronDown size='1rem' />}
        styles={{
          item: {
            backgroundColor: IMPRINT_BG_COLOR,
            border: `1px solid ${IMPRINT_BORDER_COLOR}`,
          },
          control: { padding: '10px 14px' },
          label: {
            fontSize: 13,
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
          },
          chevron: { color: 'var(--gold-bright, #e8c557)' },
          content: { padding: '0 10px 10px' },
        }}
      >
        <Accordion.Item value='health'>
          <Accordion.Control>Health &amp; Conditions</Accordion.Control>
          <Accordion.Panel>
            <HealthSection id={STORE_ID} entity={creature} setEntity={setEntity} />
          </Accordion.Panel>
        </Accordion.Item>

        <Accordion.Item value='defenses'>
          <Accordion.Control>Defenses</Accordion.Control>
          <Accordion.Panel>
            <ArmorSection id={STORE_ID} entity={creature} setEntity={setEntity} />
          </Accordion.Panel>
        </Accordion.Item>

        <Accordion.Item value='attributes'>
          <Accordion.Control>Attributes</Accordion.Control>
          <Accordion.Panel>
            <AttributeSection id={STORE_ID} entity={creature} setEntity={setEntity} />
          </Accordion.Panel>
        </Accordion.Item>

        <Accordion.Item value='senses-speed'>
          <Accordion.Control>Senses &amp; Speed</Accordion.Control>
          <Accordion.Panel>
            <AltSpeedSection id={STORE_ID} entity={creature} setEntity={setEntity} />
          </Accordion.Panel>
        </Accordion.Item>

        <Accordion.Item value='skills'>
          <Accordion.Control>Skills &amp; Actions</Accordion.Control>
          <Accordion.Panel>
            <SkillsActionsPanel
              id={STORE_ID}
              entity={creature}
              setEntity={setEntity}
              content={content}
              panelHeight={500}
              panelWidth={props.panelWidth}
            />
          </Accordion.Panel>
        </Accordion.Item>

        <Accordion.Item value='abilities'>
          <Accordion.Control>Abilities</Accordion.Control>
          <Accordion.Panel>
            <CreatureAbilitiesPanel
              id={STORE_ID}
              content={content}
              panelHeight={500}
              panelWidth={props.panelWidth}
              creature={creature}
              setCreature={setCreature}
            />
          </Accordion.Panel>
        </Accordion.Item>

        <Accordion.Item value='inventory'>
          <Accordion.Control>Inventory</Accordion.Control>
          <Accordion.Panel>
            <InventoryPanel
              id={STORE_ID}
              entity={creature}
              setEntity={setEntity}
              content={content}
              panelHeight={500}
              panelWidth={props.panelWidth}
            />
          </Accordion.Panel>
        </Accordion.Item>

        <Accordion.Item value='spells'>
          <Accordion.Control>Spells</Accordion.Control>
          <Accordion.Panel>
            <SpellsPanel
              id={STORE_ID}
              entity={creature}
              setEntity={setEntity}
              panelHeight={500}
              panelWidth={props.panelWidth}
            />
          </Accordion.Panel>
        </Accordion.Item>

        <Accordion.Item value='details'>
          <Accordion.Control>Description &amp; Details</Accordion.Control>
          <Accordion.Panel>
            <CreatureDetailsPanel
              id={STORE_ID}
              creature={creature}
              content={content}
              panelHeight={500}
              panelWidth={props.panelWidth}
            />
          </Accordion.Panel>
        </Accordion.Item>

        <Accordion.Item value='notes'>
          <Accordion.Control>Notes</Accordion.Control>
          <Accordion.Panel>
            <NotesPanel
              panelHeight={500}
              panelWidth={props.panelWidth}
              entity={creature}
              setEntity={setEntity}
            />
          </Accordion.Panel>
        </Accordion.Item>
      </Accordion>
    </Stack>
  );
}

// ─── Add Companion picker (re-used by empty state + topbar button) ───
// Identical to the previous in-panel inline picker. `onAdded` lets the
// Popover-wrapped variant close itself after a selection lands.
function AddCompanionSection(props: { onAdded?: () => void } = {}) {
  const [_character, setCharacter] = useAtom(characterState);
  const [selectedType, setSelectedType] = useState<number | null>(null);
  const isPhone = useMediaQuery(phoneQuery());

  const { data } = useQuery({
    queryKey: [`get-companions-data`],
    queryFn: async () => {
      const traits = await fetchContentAll<Trait>('trait', getDefaultSources('PAGE'));
      const creatures = await fetchContentAll<Creature>('creature', getDefaultSources('PAGE'));
      return { traits, creatures };
    },
  });

  const selectionTypes = useMemo(() => {
    return (
      data?.traits
        ?.filter((t) => t.meta_data?.companion_type_trait)
        .sort((a, b) => a.name.localeCompare(b.name)) ?? []
    );
  }, [data]);

  const creatureOptions = useMemo(() => {
    return (
      data?.creatures
        ?.filter((c) => findCreatureTraits(c).includes(selectedType ?? -1))
        .sort((a, b) => a.name.localeCompare(b.name)) ?? []
    );
  }, [data, selectedType]);

  const pushCompanion = (creature: Creature) => {
    setCharacter((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        companions: {
          ...(prev.companions ?? {}),
          list: [...(prev.companions?.list ?? []), creature],
        },
      };
    });
    props.onAdded?.();
  };

  return (
    <Box
      p='xs'
      style={(t) => ({
        backgroundColor: IMPRINT_BG_COLOR,
        borderRadius: t.radius.xl,
      })}
    >
      <Group gap={0} align='center' justify='center'>
        <Text c='gray.2' mx={10}>
          Add
        </Text>
        <Select
          variant='filled'
          size='sm'
          placeholder='Companion'
          data={[
            ...selectionTypes.map((t) => ({ value: `${t.id}`, label: t.name })),
            { value: '-10', label: 'Creature' },
          ]}
          value={selectedType ? `${selectedType}` : null}
          onChange={(value) => {
            if (value === '-10') {
              // Select any creature
              selectContent<Creature>(
                'creature',
                (option) => {
                  if (!option) return;
                  pushCompanion(option);
                },
                {
                  showButton: true,
                  zIndex: 400,
                  // Hide companions
                  filterFn: (c) => c.level !== -100,
                }
              );
              setSelectedType(null);
            } else {
              setSelectedType(parseInt(`${value ?? -1}`));
            }
          }}
          w={isPhone ? 120 : 150}
          styles={() => ({
            input: {
              borderTopRightRadius: 0,
              borderBottomRightRadius: 0,
              '--input-placeholder-color': 'var(--mantine-color-gray-6)',
              backgroundColor: IMPRINT_BG_COLOR,
              borderColor: IMPRINT_BORDER_COLOR,
            },
          })}
        />
        <Select
          variant='filled'
          size='sm'
          placeholder='Type'
          disabled={!selectedType || selectedType === -1}
          data={creatureOptions.map((c) => ({ value: `${c.id}`, label: c.name }))}
          onChange={(value) => {
            if (!value) return;
            const creature = creatureOptions.find((c) => c.id === parseInt(`${value}`));
            if (!creature) return;
            pushCompanion(creature);
            setSelectedType(null);
          }}
          value={''}
          w={isPhone ? 120 : 150}
          styles={() => ({
            input: {
              borderTopLeftRadius: 0,
              borderBottomLeftRadius: 0,
              '--input-placeholder-color': 'var(--mantine-color-gray-6)',
              backgroundColor: IMPRINT_BG_COLOR,
              borderColor: IMPRINT_BORDER_COLOR,
            },
          })}
        />
      </Group>
    </Box>
  );
}
