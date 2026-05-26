import { characterState } from '@atoms/characterAtoms';
import { fetchContentAll, fetchContentPackage, getDefaultSources } from '@content/content-store';
import {
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
import { AbilityBlock, Creature, Trait } from '@schemas/content';
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
import { applyEquipmentPenalties, getBestArmor } from '@items/inv-utils';
import { applyConditions } from '@conditions/condition-handler';
import { modals } from '@mantine/modals';
import { selectContent } from '@common/select/SelectContent';
import { getEntityLevel } from '@utils/entity-utils';
import { IMPRINT_BG_COLOR, IMPRINT_BG_COLOR_HOVER, IMPRINT_BORDER_COLOR } from '@constants/data';
import { convertToSetEntity } from '@utils/type-fixing';
import { getFinalAcValue, getFinalHealthValue, getFinalProfValue } from '@variables/variable-helpers';
import { getAllSpeedVariables, getVariable } from '@variables/variable-manager';
import { labelToVariable } from '@variables/variable-utils';
import { getCachedContent } from '@content/content-store';
import { drawerState } from '@atoms/navAtoms';
import type { VariableAttr, VariableListStr } from '@schemas/variables';
import { sign } from '@utils/numbers';

import { ConditionPills } from '../sections/ConditionSection';
import SkillsActionsPanel from './SkillsActionsPanel';
import CreatureAbilitiesPanel from './CreatureAbilitiesPanel';
import InventoryPanel from './InventoryPanel';
import SpellsPanel from './SpellsPanel';
import NotesPanel from './NotesPanel';
import CreatureDetailsPanel from './CreatureDetailsPanel';

/* ───────────────────────────────────────────────────────────────────
 *  CompanionsPanel
 *  - 0 companions: centered Add Companion picker only
 *  - 1+ companions: pill switcher + outline "+ Add Companion" button
 *    on top, full sheet for the selected companion below. Every
 *    section of the sheet is its own custom collapsible (gold caret +
 *    caps label + optional hint text). Top stat sections render as
 *    cube grids matching the approved mockup. Heavier panels (Skills,
 *    Abilities, Inventory, Spells, Description, Notes) render the
 *    existing rich Mantine panel components inside the collapsible
 *    body so all the functionality keeps working.
 *
 *  Sheet is NOT wrapped in its own scroll container — the parent
 *  `.codex-tab-body` already does overflow-y:auto with min-height:0,
 *  so we just lay out children and let that scroll. (The previous
 *  pass wrapped everything in a fixed-height ScrollArea which left a
 *  big black gap below the content.)
 * ─────────────────────────────────────────────────────────────────── */

export default function CompanionsPanel(props: { panelHeight: number; panelWidth: number }) {
  const [character, setCharacter] = useAtom(characterState);
  const companions = character?.companions?.list ?? [];

  const [selectedIndex, setSelectedIndex] = useState(0);

  useEffect(() => {
    if (selectedIndex >= companions.length) {
      setSelectedIndex(Math.max(0, companions.length - 1));
    }
  }, [companions.length, selectedIndex]);

  // 0-companion empty state.
  if (companions.length === 0) {
    return (
      <Stack mt={40} gap={14} align='center' justify='center'>
        <Text ta='center' c='gray.2' fs='italic' fz='sm'>
          No companions found, want to add one?
        </Text>
        <AddCompanionSection />
      </Stack>
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
    <Stack gap={12} style={{ flex: 1, minHeight: 0 }}>
      {/* Switcher row — pills + Add button (matches mockup Option A) */}
      <Group
        wrap='nowrap'
        gap={8}
        px={4}
        py={4}
        style={{
          borderBottom: `1px solid ${IMPRINT_BORDER_COLOR}`,
          background: 'linear-gradient(180deg, rgba(176,84,47,.04) 0%, transparent 100%)',
        }}
      >
        <ScrollArea scrollbars='x' style={{ flex: 1, minWidth: 0 }} type='never'>
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

      <CompanionSheet
        key={`companion-sheet-${selectedIndex}-${selected.id}`}
        companion={selected}
        storeId={`COMPANION_${selectedIndex}`}
        panelWidth={props.panelWidth}
        panelHeight={props.panelHeight}
        updateCompanion={updateSelected}
        onRemove={removeSelected}
      />
    </Stack>
  );
}

/* ─── Switcher pill ──────────────────────────────────────────────── */

function CompanionPill(props: { companion: Creature; active: boolean; onClick: () => void }) {
  const [hovered, setHovered] = useState(false);
  return (
    <Box
      onClick={props.onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        padding: '4px 12px 4px 4px',
        borderRadius: 999,
        background: props.active
          ? 'rgba(201,161,59,.10)'
          : hovered
            ? IMPRINT_BG_COLOR_HOVER
            : IMPRINT_BG_COLOR,
        border: `1px solid ${props.active ? 'var(--gold-deep, #8a6f25)' : IMPRINT_BORDER_COLOR}`,
        boxShadow: props.active ? '0 0 0 1px var(--gold-deep, #8a6f25)' : 'none',
        color: props.active ? 'var(--ink, #ede4ce)' : 'var(--ink-dim, #c3b69a)',
        cursor: 'pointer',
        whiteSpace: 'nowrap',
        transition: 'all .15s',
      }}
    >
      <Box style={{ width: 26, height: 26, flex: '0 0 26px' }}>
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
        · Lv {getEntityLevel(props.companion)}
      </Text>
    </Box>
  );
}

/* ─── Add Companion button — wraps existing picker in a Popover ── */

function AddCompanionButton() {
  const [opened, setOpened] = useState(false);
  const [hovered, setHovered] = useState(false);
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
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '6px 14px',
            borderRadius: 999,
            background: hovered ? 'rgba(201,161,59,.08)' : 'transparent',
            border: `1px solid var(--gold-deep, #8a6f25)`,
            color: 'var(--gold-bright, #e8c557)',
            cursor: 'pointer',
            fontSize: 13,
            fontWeight: 600,
            whiteSpace: 'nowrap',
            transition: 'all .15s',
          }}
        >
          <IconPlus size='1rem' stroke={2} />
          <span>Add Companion</span>
        </Box>
      </Popover.Target>
      <Popover.Dropdown p={6} style={{ background: 'var(--bg-2, #1c1710)', border: `1px solid ${IMPRINT_BORDER_COLOR}` }}>
        <AddCompanionSection compact onAdded={() => setOpened(false)} />
      </Popover.Dropdown>
    </Popover>
  );
}

/* ─── Custom collapsible section — gold caret + caps title + hint ── */

function CollapsibleSection(props: {
  title: string;
  hint?: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(props.defaultOpen ?? false);

  return (
    <Box
      style={{
        borderTop: `1px solid ${IMPRINT_BORDER_COLOR}`,
      }}
    >
      <Box
        onClick={() => setOpen((o) => !o)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '10px 4px',
          cursor: 'pointer',
          color: 'var(--ink, #ede4ce)',
          fontSize: 13,
          fontWeight: 600,
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          userSelect: 'none',
        }}
      >
        <IconChevronDown
          size='0.85rem'
          stroke={2.5}
          style={{
            color: 'var(--gold-bright, #e8c557)',
            transform: open ? 'rotate(0deg)' : 'rotate(-90deg)',
            transition: 'transform .15s',
          }}
        />
        <Box style={{ flex: 1 }}>{props.title}</Box>
        {props.hint && (
          <Text
            fz='xs'
            c='dimmed'
            style={{
              fontWeight: 400,
              textTransform: 'none',
              letterSpacing: 0,
            }}
          >
            {props.hint}
          </Text>
        )}
      </Box>
      {open && <Box style={{ padding: '4px 4px 14px' }}>{props.children}</Box>}
    </Box>
  );
}

/* ─── Cube cells ─────────────────────────────────────────────────── */

function Cube(props: { label: string; value: React.ReactNode; gold?: boolean; small?: boolean }) {
  return (
    <Box
      style={{
        background: IMPRINT_BG_COLOR,
        border: `1px solid ${IMPRINT_BORDER_COLOR}`,
        borderRadius: 8,
        padding: '8px 10px',
        textAlign: 'center',
      }}
    >
      <Text
        fz='10px'
        c='dimmed'
        style={{ letterSpacing: '0.12em', textTransform: 'uppercase' }}
      >
        {props.label}
      </Text>
      <Text
        c={props.gold ? 'var(--gold-bright, #e8c557)' : 'var(--ink, #ede4ce)'}
        fw={700}
        ff='Cinzel, serif'
        style={{
          fontSize: props.small ? 14 : 18,
          lineHeight: 1.1,
          marginTop: 2,
        }}
      >
        {props.value}
      </Text>
    </Box>
  );
}

function AttrCube(props: { label: string; value: number; partial?: boolean }) {
  return (
    <Box
      style={{
        background: IMPRINT_BG_COLOR,
        border: `1px solid ${IMPRINT_BORDER_COLOR}`,
        borderRadius: 6,
        padding: '6px 4px',
        textAlign: 'center',
      }}
    >
      <Text
        fz='9px'
        c='dimmed'
        style={{ letterSpacing: '0.12em', textTransform: 'uppercase' }}
      >
        {props.label}
      </Text>
      <Text
        c='var(--ink, #ede4ce)'
        fw={700}
        ff='Cinzel, serif'
        td={props.partial ? 'underline' : undefined}
        style={{ fontSize: 16, lineHeight: 1.1, marginTop: 2 }}
      >
        {sign(props.value)}
      </Text>
    </Box>
  );
}

/* ─── Companion full sheet ──────────────────────────────────────── */

function CompanionSheet(props: {
  companion: Creature;
  storeId: string;
  panelWidth: number;
  panelHeight: number;
  updateCompanion: (creature: Creature) => void;
  onRemove: () => void;
}) {
  const STORE_ID = props.storeId;

  const [creature, setCreature] = useState<Creature | null>(() => cloneDeep(props.companion));
  const [loading, setLoading] = useState(true);
  const [_drawer, openDrawer] = useAtom(drawerState);

  // Debounced upstream push so HP / conditions / inventory edits land
  // in character.companions.list.
  const [debouncedCreature] = useDebouncedValue(creature, 150);
  useDidUpdate(() => {
    if (debouncedCreature) props.updateCompanion(debouncedCreature);
  }, [debouncedCreature]);

  // Content for the heavier sub-panels (Inventory needs items, Skills
  // needs traits, etc.). Cached for 5 minutes so re-mounts on switcher
  // change don't re-fetch.
  const { data: content } = useQuery({
    queryKey: ['companion-sheet-content'],
    queryFn: () =>
      fetchContentPackage(getDefaultSources('INFO'), {
        fetchSources: false,
        fetchCreatures: false,
      }),
    staleTime: 5 * 60 * 1000,
  });

  // Operation pipeline — mirrors CreatureDrawerContent. Populates the
  // per-companion variable store so the cube grids (AC, saves,
  // perception, attrs, speeds) read real computed values, and so the
  // sub-panels (Skills, Inventory, etc.) work normally.
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
      <Box pt={40} ta='center'>
        <Loader type='bars' />
      </Box>
    );
  }

  const setEntity = convertToSetEntity(setCreature);

  // ── Read computed values for the cube grid ────────────────────────
  const armor = getBestArmor(STORE_ID, creature.inventory)?.item;
  const ac = getFinalAcValue(STORE_ID, armor);
  const fort = getFinalProfValue(STORE_ID, 'SAVE_FORT');
  const ref = getFinalProfValue(STORE_ID, 'SAVE_REFLEX');
  const will = getFinalProfValue(STORE_ID, 'SAVE_WILL');
  const perception = getFinalProfValue(STORE_ID, 'PERCEPTION');
  const maxHp = getFinalHealthValue(STORE_ID);
  const currentHp = creature.hp_current ?? maxHp;
  const tempHp = creature.hp_temp ?? 0;
  const hpFrac = maxHp > 0 ? Math.max(0, Math.min(1, currentHp / maxHp)) : 0;

  // Attributes (mockup order: Str/Dex/Con/Int/Wis/Cha)
  const attrs: { label: string; value: number; partial: boolean }[] = (
    [
      { label: 'STR', var: 'ATTRIBUTE_STR' },
      { label: 'DEX', var: 'ATTRIBUTE_DEX' },
      { label: 'CON', var: 'ATTRIBUTE_CON' },
      { label: 'INT', var: 'ATTRIBUTE_INT' },
      { label: 'WIS', var: 'ATTRIBUTE_WIS' },
      { label: 'CHA', var: 'ATTRIBUTE_CHA' },
    ] as const
  ).map((a) => {
    const v = getVariable<VariableAttr>(STORE_ID, a.var);
    return {
      label: a.label,
      value: v?.value.value ?? 0,
      partial: v?.value.partial ?? false,
    };
  });

  // Speeds + senses for the Senses & Speed section.
  const speedVars = getAllSpeedVariables(STORE_ID);
  const speeds = speedVars
    .map((v) => ({ name: v.name, value: (v.value as number) ?? 0 }))
    .filter((s) => s.value > 0);

  const formatSense = (s: string) =>
    s
      .toLowerCase()
      .split('_')
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');
  const sensesPrecise = ((getVariable<VariableListStr>(STORE_ID, 'SENSES_PRECISE')?.value ?? []) as string[])
    .filter((s: string) => s !== 'NORMAL_VISION');
  const sensesImprecise = ((getVariable<VariableListStr>(STORE_ID, 'SENSES_IMPRECISE')?.value ?? []) as string[])
    .filter((s: string) => s !== 'HEARING');
  const sensesVague = ((getVariable<VariableListStr>(STORE_ID, 'SENSES_VAGUE')?.value ?? []) as string[])
    .filter((s: string) => s !== 'SMELL');
  const allSenses = [...sensesPrecise, ...sensesImprecise, ...sensesVague];

  const openSense = (raw: string) => {
    // Resolve the sense's variable-name to its ability-block id and
    // open the standard sense drawer. Falls back to the generic
    // drawer when no content row exists (homebrew, removed bundles).
    // Both sides need labelToVariable: SENSES_PRECISE stores the raw
    // operation payload ("low-light vision") not the canonical
    // upper-underscored form, so comparing labelToVariable(b.name)
    // against the raw string never matched.
    const senseBlocks = (getCachedContent<AbilityBlock>('ability-block') ?? []).filter(
      (b) => b.type === 'sense'
    );
    const targetKey = labelToVariable(raw);
    const hit = senseBlocks.find((b) => labelToVariable(b.name) === targetKey);
    if (hit) {
      openDrawer({ type: 'sense', data: { id: hit.id }, extra: { addToHistory: true } });
    } else {
      openDrawer({
        type: 'generic',
        data: {
          title: formatSense(raw),
          description: 'No description registered for this sense in the current content pack.',
        },
        extra: { addToHistory: true },
      });
    }
  };

  // Helpers (parses "+9" / "-2" / "0" → number for cube display)
  const profNum = (s: string | number | undefined) => {
    if (typeof s === 'number') return s;
    const n = parseInt(String(s ?? '').replace(/^\+/, ''));
    return isNaN(n) ? 0 : n;
  };

  return (
    <Stack gap={0} style={{ flex: 1, minHeight: 0 }}>
      {/* Header row */}
      <Group
        justify='space-between'
        wrap='nowrap'
        py={8}
        px={4}
        style={{ borderBottom: `1px solid ${IMPRINT_BORDER_COLOR}` }}
      >
        <Group wrap='nowrap' gap={12}>
          <Box style={{ width: 58, height: 58 }}>
            <DisplayIcon
              strValue={creature.details?.image_url ?? 'icon|||avatar|||#373A40'}
              width={58}
              iconStyles={{ objectFit: 'contain', height: 58 }}
            />
          </Box>
          <Box>
            <Title order={3} style={{ fontFamily: 'Cinzel, serif' }}>
              {creature.name}
            </Title>
            <Text c='dimmed' fz='xs' style={{ letterSpacing: '0.04em' }}>
              {determineCompanionType(creature) || 'Creature'}{' '}
              <span style={{ color: 'var(--gold, #c9a13b)' }}>·</span> Level{' '}
              {getEntityLevel(creature)}
            </Text>
          </Box>
        </Group>
        <Tooltip label='Delete Companion'>
          <ActionIcon variant='subtle' color='red' onClick={props.onRemove} aria-label='Delete Companion'>
            <IconTrash size='1.1rem' />
          </ActionIcon>
        </Tooltip>
      </Group>

      {/* Health & Conditions */}
      <CollapsibleSection
        title='Health & Conditions'
        defaultOpen
        hint={`${currentHp} / ${maxHp} HP${tempHp > 0 ? `  +${tempHp} temp` : ''}`}
      >
        <Stack gap={8}>
          {/* HP bar */}
          <Group
            wrap='nowrap'
            gap={10}
            style={{
              background: IMPRINT_BG_COLOR,
              border: `1px solid ${IMPRINT_BORDER_COLOR}`,
              borderRadius: 8,
              padding: '8px 12px',
            }}
          >
            <Text fz='11px' c='dimmed' style={{ letterSpacing: '0.12em', textTransform: 'uppercase' }}>
              HP
            </Text>
            <Text fw={700} ff='Cinzel, serif' fz='md' c='var(--ink, #ede4ce)'>
              {currentHp}
            </Text>
            <Box
              style={{
                flex: 1,
                height: 8,
                background: 'rgba(0,0,0,.4)',
                borderRadius: 4,
                overflow: 'hidden',
                border: `1px solid ${IMPRINT_BORDER_COLOR}`,
              }}
            >
              <Box
                style={{
                  height: '100%',
                  width: `${hpFrac * 100}%`,
                  background: 'linear-gradient(90deg, #6b8e23, #94a85b)',
                  transition: 'width .25s',
                }}
              />
            </Box>
            <Text fw={700} ff='Cinzel, serif' fz='md' c='var(--ink-dim, #c3b69a)'>
              {maxHp}
            </Text>
          </Group>
          {/* Conditions row */}
          <Box>
            <ConditionPills id={STORE_ID} entity={creature} setEntity={setEntity} />
          </Box>
        </Stack>
      </CollapsibleSection>

      {/* Defenses — 6-cube grid */}
      <CollapsibleSection
        title='Defenses'
        defaultOpen
        hint={`AC ${ac} · Fort ${fort} · Ref ${ref} · Will ${will}`}
      >
        <Box style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
          <Cube label='AC' value={ac} gold />
          <Cube label='Fortitude' value={sign(profNum(fort))} />
          <Cube label='Reflex' value={sign(profNum(ref))} />
          <Cube label='Will' value={sign(profNum(will))} />
          <Cube label='Perception' value={sign(profNum(perception))} />
          <Cube
            label='Speed'
            value={speeds.length > 0 ? `${speeds[0].value} ft` : '—'}
            small
          />
        </Box>
      </CollapsibleSection>

      {/* Attributes — 6-cube grid */}
      <CollapsibleSection title='Attributes' defaultOpen>
        <Box style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 6 }}>
          {attrs.map((a) => (
            <AttrCube key={a.label} label={a.label} value={a.value} partial={a.partial} />
          ))}
        </Box>
      </CollapsibleSection>

      {/* Senses & Speed */}
      <CollapsibleSection title='Senses & Speed' defaultOpen>
        <Box style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          <Box>
            <Text fz='11px' c='dimmed' mb={4} style={{ letterSpacing: '0.12em', textTransform: 'uppercase' }}>
              Senses
            </Text>
            {allSenses.length === 0 ? (
              <Text fz='xs' c='dimmed'>
                —
              </Text>
            ) : (
              <Group gap={6} wrap='wrap'>
                {allSenses.map((s) => (
                  <Text
                    key={s}
                    fz='xs'
                    span
                    onClick={() => openSense(s)}
                    style={{
                      cursor: 'pointer',
                      color: 'var(--ink, #ede4ce)',
                      borderBottom: '1px dotted var(--gold-deep, #8a6f25)',
                      paddingBottom: 1,
                    }}
                    title={`Open ${formatSense(s)} description`}
                  >
                    {formatSense(s)}
                  </Text>
                ))}
              </Group>
            )}
          </Box>
          <Box>
            <Text fz='11px' c='dimmed' mb={4} style={{ letterSpacing: '0.12em', textTransform: 'uppercase' }}>
              Speeds
            </Text>
            {speeds.length === 0 ? (
              <Text fz='xs' c='dimmed'>
                —
              </Text>
            ) : (
              <Stack gap={2}>
                {speeds.map((sp) => (
                  <Group key={sp.name} justify='space-between' gap={6}>
                    <Text fz='xs' c='var(--ink-dim, #c3b69a)'>
                      {labelize(sp.name)}
                    </Text>
                    <Text fz='xs' c='var(--ink, #ede4ce)' fw={600}>
                      {sp.value} ft
                    </Text>
                  </Group>
                ))}
              </Stack>
            )}
          </Box>
        </Box>
      </CollapsibleSection>

      {/* Heavier panels — wrapped in custom collapsibles so the user can
          fold them away. Default closed for the rich panels to keep
          the initial view focused on stats. */}
      <CollapsibleSection title='Skills & Actions'>
        <SkillsActionsPanel
          id={STORE_ID}
          entity={creature}
          setEntity={setEntity}
          content={content}
          panelHeight={600}
          panelWidth={props.panelWidth}
        />
      </CollapsibleSection>

      <CollapsibleSection title='Abilities'>
        <CreatureAbilitiesPanel
          id={STORE_ID}
          content={content}
          panelHeight={600}
          panelWidth={props.panelWidth}
          creature={creature}
          setCreature={setCreature}
        />
      </CollapsibleSection>

      <CollapsibleSection title='Inventory'>
        <InventoryPanel
          id={STORE_ID}
          entity={creature}
          setEntity={setEntity}
          content={content}
          panelHeight={600}
          panelWidth={props.panelWidth}
        />
      </CollapsibleSection>

      <CollapsibleSection title='Spells'>
        <SpellsPanel
          id={STORE_ID}
          entity={creature}
          setEntity={setEntity}
          panelHeight={600}
          panelWidth={props.panelWidth}
        />
      </CollapsibleSection>

      <CollapsibleSection title='Description & Details'>
        <CreatureDetailsPanel
          id={STORE_ID}
          creature={creature}
          content={content}
          panelHeight={600}
          panelWidth={props.panelWidth}
        />
      </CollapsibleSection>

      <CollapsibleSection title='Notes'>
        <NotesPanel
          panelHeight={600}
          panelWidth={props.panelWidth}
          entity={creature}
          setEntity={setEntity}
        />
      </CollapsibleSection>
    </Stack>
  );
}

// Turn "SPEED_FLY" → "Fly", "SPEED" → "Land" (the unprefixed base speed).
function labelize(varName: string) {
  if (varName === 'SPEED') return 'Land';
  return varName
    .replace(/^SPEED_/, '')
    .toLowerCase()
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/* ─── Add Companion picker (used by empty state + Add button popover)
       Same Type→Creature flow as before — kept to preserve the wired-
       up filterFn + select-content escape hatch for "any creature". */

function AddCompanionSection(props: { onAdded?: () => void; compact?: boolean } = {}) {
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

  // `compact` (popover variant) drops the pill background + "Add"
  // label so the dropdown reads as a tight inline pair of selects.
  // The empty-state variant keeps the soft pill chrome.
  const Wrap = (children: React.ReactNode) =>
    props.compact ? (
      <Group gap={0} align='center' wrap='nowrap'>
        {children}
      </Group>
    ) : (
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
          {children}
        </Group>
      </Box>
    );

  return Wrap(
    <>
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
              selectContent<Creature>(
                'creature',
                (option) => {
                  if (!option) return;
                  pushCompanion(option);
                },
                {
                  showButton: true,
                  zIndex: 400,
                  filterFn: (c) => c.level !== -100,
                }
              );
              setSelectedType(null);
            } else {
              setSelectedType(parseInt(`${value ?? -1}`));
            }
          }}
          w={props.compact ? (isPhone ? 110 : 130) : isPhone ? 120 : 150}
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
          w={props.compact ? (isPhone ? 110 : 130) : isPhone ? 120 : 150}
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
    </>
  );
}
