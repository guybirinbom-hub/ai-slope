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
import { IconPlus, IconTrash, IconPencil, IconLayoutList } from '@tabler/icons-react';
import { cloneDeep, flattenDeep } from 'lodash-es';
import { executeOperations } from '@operations/operations.main';
import { collectEntityAbilityBlocks } from '@content/collect-content';
import RichText from '@common/RichText';
import { Wg4 } from '@common/wg4/primitives';
import { addExtraItems, checkBulkLimit } from '@items/inv-handlers';
import {
  applyEquipmentPenalties,
  getBestArmor,
  isItemWeapon,
  isItemRangedWeapon,
  isHandwrapsOfMightyBlows,
  getEquippedHandwrapsRunes,
  applyHandwrapsToUnarmed,
} from '@items/inv-utils';
import { getWeaponStats, parseOtherDamage } from '@items/weapon-handler';
import { applyConditions } from '@conditions/condition-handler';
import { modals } from '@mantine/modals';
import { selectContent } from '@common/select/SelectContent';
import { getEntityLevel } from '@utils/entity-utils';
import { IMPRINT_BG_COLOR, IMPRINT_BORDER_COLOR } from '@constants/data';
import { convertToSetEntity } from '@utils/type-fixing';
import { getFinalAcValue, getFinalHealthValue, getFinalProfValue } from '@variables/variable-helpers';
import { getAllSkillVariables, getAllSpeedVariables, getVariable } from '@variables/variable-manager';
import { compileProficiencyType, labelToVariable, variableToLabel } from '@variables/variable-utils';
import { getCachedContent, getContentFast } from '@content/content-store';
import { drawerState } from '@atoms/navAtoms';
import type { VariableAttr, VariableListStr } from '@schemas/variables';
import { sign } from '@utils/numbers';

import { ConditionPills } from '../sections/ConditionSection';
// Configuration panels — rendered only in the companion's "Edit" mode
// (see CompanionSheet). The default view is the clean Version B stat
// block; Edit swaps in these full editors so the player can actually
// configure the companion (attacks/inventory, spells, abilities,
// details, notes).
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
 *    on top, then the selected companion as a single PF2e-style stat
 *    block ("Version B" — proposals/companion-mockup.html #view-b).
 *    One parchment card: header, trait ribbon, then reading-flow stat
 *    lines (Perception/senses, trained Skills, attribute strip,
 *    AC/saves, HP, Speed, Conditions), Melee/Ranged strikes, and a
 *    compact Abilities list. Abilities are paragraph cards (name +
 *    action glyph + serif description) that open the standard action
 *    drawer on click. No heavy interactive sub-panels — the whole
 *    companion reads at a glance like a bestiary entry.
 *
 *  Sheet is NOT wrapped in its own scroll container — the parent
 *  `.codex-tab-body` already does overflow-y:auto with min-height:0,
 *  so we just lay out children and let that scroll.
 * ─────────────────────────────────────────────────────────────────── */

// Generic companion "build scaffolding" — auto-granted chassis features
// whose only effect is to plumb stats the stat block already shows as
// numbers (proficiencies, attributes, skills). They're build-time
// bookkeeping ("things the player chooses for the companion"), not
// abilities the creature *does*, so the stat block hides them.
//
// Attribute Boosts / Skill Increase / feat slots are class-features that
// collectEntityAbilityBlocks' `filterBasicClassFeatures` already drops;
// the entries below are the FEAT-type plumbing it doesn't reach, shared
// across companion types (eidolon chassis + animal-companion advancement).
// Anything literally named "… Advancement" is also treated as scaffolding
// via a regex at the call site, which covers Mature/Nimble/Savage/
// Specialized advancement and any homebrew advancement line.
const COMPANION_SCAFFOLDING_NAMES = new Set([
  'eidolon skills',
  'eidolon advancement',
  'attribute boosts',
  'ability boosts',
  'skill increase',
]);

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
    <Stack className='codex-companion-tab' gap={12} style={{ flex: 1, minHeight: 0 }}>
      {/* Sticky management bar — switch between companions + add a new
          one. Sticky to the top of the scrolling tab body so it stays
          reachable while the stat block scrolls under it. */}
      <div className='cmp-switchbar'>
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
      </div>

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
  return (
    <button
      type='button'
      className={props.active ? 'cmp-pill active' : 'cmp-pill'}
      onClick={props.onClick}
    >
      <span className='cmp-pill-av'>
        <DisplayIcon
          strValue={props.companion.details?.image_url ?? 'icon|||avatar|||#373A40'}
          width={24}
          iconStyles={{ objectFit: 'contain', height: 24 }}
        />
      </span>
      <span className='cmp-pill-nm'>{props.companion.name}</span>
      <span className='cmp-pill-lv'>Lv {getEntityLevel(props.companion)}</span>
    </button>
  );
}

/* ─── Add Companion button — wraps existing picker in a Popover ── */

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
        <button type='button' className='cmp-add' onClick={() => setOpened((o) => !o)}>
          <IconPlus size='1rem' stroke={2.2} />
          <span>Add Companion</span>
        </button>
      </Popover.Target>
      <Popover.Dropdown
        className='cmp-add-pop'
        p={8}
      >
        <AddCompanionSection compact onAdded={() => setOpened(false)} />
      </Popover.Dropdown>
    </Popover>
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
  // View vs configure. Default = the clean Version B stat block; Edit
  // swaps in the full configuration panels so the player can choose the
  // companion's attacks/inventory, spells, abilities, details and notes.
  const [editMode, setEditMode] = useState(false);

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

  // ── Companion type → adaptive display flags ───────────────────────
  // determineCompanionType returns the companion-type trait name
  // verbatim ("Animal Companion", "Familiar", "Eidolon", "Construct")
  // or "Creature" as a fallback. Match case-insensitively since the
  // exact casing comes from content rows that may vary by bundle.
  // These flags only gate DISPLAY — the stat-computation pipeline
  // (executeOperations / the variable store) is untouched.
  const companionType = determineCompanionType(creature) || 'Creature';
  const companionTypeLc = companionType.toLowerCase();
  const isFamiliar = companionTypeLc.includes('familiar');
  const isEidolon = companionTypeLc.includes('eidolon');

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

  // ── Trait ribbon ──────────────────────────────────────────────────
  // Resolve the creature's giveTrait operations to Trait rows so the
  // ribbon shows real names. The size trait (Tiny..Gargantuan) is
  // highlighted with `.size`; everything else renders plain.
  const SIZE_TRAIT_NAMES = new Set([
    'tiny',
    'small',
    'medium',
    'large',
    'huge',
    'gargantuan',
  ]);
  const traitRows = getContentFast<Trait>('trait', findCreatureTraits(creature)).sort((a, b) => {
    // Size first (so the highlighted chip leads, matching the mockup).
    const aSize = SIZE_TRAIT_NAMES.has(a.name.toLowerCase());
    const bSize = SIZE_TRAIT_NAMES.has(b.name.toLowerCase());
    if (aSize !== bSize) return aSize ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  // ── Inline trained skills ─────────────────────────────────────────
  // Same source the SkillsActionsPanel uses (getAllSkillVariables),
  // limited to skills the creature is actually trained in (proficiency
  // above Untrained) so the line stays compact. getFinalProfValue gives
  // the plain "+N" string for inline display.
  const skillRows = getAllSkillVariables(STORE_ID)
    .filter((skill) => skill.name !== 'SKILL_LORE____')
    .filter((skill) => compileProficiencyType(skill.value) !== 'U')
    .map((skill) => ({
      name: variableToLabel(skill),
      mod: getFinalProfValue(STORE_ID, skill.name),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  // ── Strikes ───────────────────────────────────────────────────────
  // Mirror SkillsActionsPanel.weaponAttacks: equipped weapons, with
  // Handwraps of Mighty Blows folded into unarmed attacks, run through
  // getWeaponStats. Split into Melee / Ranged for the stat-block subs.
  const wrapsRunes = getEquippedHandwrapsRunes(creature.inventory);
  const strikeItems = (creature.inventory?.items ?? [])
    .filter(
      (invItem) =>
        invItem.is_equipped &&
        isItemWeapon(invItem.item) &&
        !isHandwrapsOfMightyBlows(invItem.item)
    )
    .map((invItem) => applyHandwrapsToUnarmed(invItem.item, wrapsRunes))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((item) => {
      const stats = getWeaponStats(STORE_ID, item);
      const traitNames = getContentFast<Trait>('trait', item.traits ?? [])
        .map((t) => t.name.toLowerCase())
        .filter((n) => n.length > 0);
      if (isItemRangedWeapon(item)) {
        if (item.meta_data?.range) traitNames.push(`range ${item.meta_data.range} ft`);
        if (item.meta_data?.reload)
          traitNames.push(`reload ${String(item.meta_data.reload).replace(/reload/i, '').trim()}`);
      }
      const bonus = stats.damage.bonus.total > 0 ? ` + ${stats.damage.bonus.total}` : '';
      const damage = `${stats.damage.dice}${stats.damage.die}${bonus}`;
      return {
        ranged: isItemRangedWeapon(item),
        name: item.name,
        toHit: stats.attack_bonus.total[0],
        traits: traitNames,
        damageDice: damage,
        damageType: stats.damage.damageType,
        damageOther: parseOtherDamage(stats.damage.other).join(''),
        damageExtra: stats.damage.extra ? ` + ${stats.damage.extra}` : '',
      };
    });
  const meleeStrikes = strikeItems.filter((s) => !s.ranged);
  const rangedStrikes = strikeItems.filter((s) => s.ranged);

  // ── Abilities (compact) ───────────────────────────────────────────
  // Every ability block the creature has, flattened across the collected
  // buckets (base + added + any feats/features granted via operations),
  // deduped by id, then sorted by level → name for clean stat-block
  // reading order.
  //
  // We deliberately DROP the companion "build scaffolding" — the generic
  // chassis features that only plumb stats the block already shows (see
  // COMPANION_SCAFFOLDING_NAMES). `filterBasicClassFeatures` removes the
  // class-feature plumbing (Attribute Boosts, Skill Increase, feat slots);
  // the name/`Advancement` predicate removes the feat-type plumbing
  // (Eidolon Advancement/Skills, Mature/Nimble/Savage/Specialized
  // Advancement). Real granted abilities — Spirit Touch, Hidden Watcher,
  // Support, a familiar's chosen abilities — all survive.
  const isBuildScaffolding = (ab: AbilityBlock) => {
    const n = ab.name.trim().toLowerCase();
    return /\badvancement\b/.test(n) || COMPANION_SCAFFOLDING_NAMES.has(n);
  };
  const abilityBlocks = (() => {
    const all = flattenDeep(
      Object.values(
        collectEntityAbilityBlocks(STORE_ID, creature, content.abilityBlocks, {
          filterBasicClassFeatures: true,
        })
      )
    ) as AbilityBlock[];
    const seen = new Set<number>();
    const out: AbilityBlock[] = [];
    for (const ab of all) {
      if (!ab || seen.has(ab.id) || isBuildScaffolding(ab)) continue;
      seen.add(ab.id);
      out.push(ab);
    }
    return out.sort(
      (a, b) => (a.level ?? 0) - (b.level ?? 0) || a.name.localeCompare(b.name)
    );
  })();

  const renderStrike = (s: (typeof strikeItems)[number], i: number) => (
    <div className='cmp-strike' key={`${s.name}-${i}`}>
      <span className='lab'>{'◆'} {s.name}</span> <span className='acc'>{sign(s.toHit)}</span>{' '}
      {s.traits.length > 0 && <span className='traits'>({s.traits.join(', ')})</span>}
      {s.traits.length > 0 ? ', ' : ' '}
      <b>Damage</b> <span className='mono'>{s.damageDice}</span> {s.damageType}
      {s.damageOther}
      {s.damageExtra}
    </div>
  );

  return (
    <div className='codex-companion'>
      {/* ═══ PF2e-style stat block ═══ */}
      <div className='cmp-block'>
        {/* Header — portrait + italic name + rust level tag + delete */}
        <div className='cmp-head'>
          <div className='cmp-head-l'>
            <div className='cmp-portrait'>
              <DisplayIcon
                strValue={creature.details?.image_url ?? 'icon|||avatar|||#373A40'}
                width={46}
                iconStyles={{ objectFit: 'contain', height: 46 }}
              />
            </div>
            <h2 className='cmp-name'>{creature.name}</h2>
          </div>
          <div className='cmp-head-r'>
            <span className='cmp-lvtag'>
              {companionType} · Level {getEntityLevel(creature)}
            </span>
            <Tooltip label={editMode ? 'Back to stat block' : 'Edit / configure companion'}>
              <button
                type='button'
                className={editMode ? 'cmp-edit active' : 'cmp-edit'}
                onClick={() => setEditMode((e) => !e)}
                aria-label={editMode ? 'Back to stat block' : 'Edit companion'}
              >
                {editMode ? <IconLayoutList size='0.85rem' /> : <IconPencil size='0.85rem' />}
                <span>{editMode ? 'Done' : 'Edit'}</span>
              </button>
            </Tooltip>
            <Tooltip label='Delete Companion'>
              <ActionIcon
                className='cmp-del'
                variant='transparent'
                onClick={props.onRemove}
                aria-label='Delete Companion'
              >
                <IconTrash size='1rem' />
              </ActionIcon>
            </Tooltip>
          </div>
        </div>

        {/* ── Stat-block view (default) ──────────────────────────── */}
        {!editMode && (
          <>
        {/* Trait ribbon — size highlighted */}
        {traitRows.length > 0 && (
          <div className='cmp-traits'>
            {traitRows.map((t) => (
              <span
                key={t.id}
                className={
                  SIZE_TRAIT_NAMES.has(t.name.toLowerCase()) ? 'cmp-trait size' : 'cmp-trait'
                }
              >
                {t.name}
              </span>
            ))}
          </div>
        )}

        {/* Reading-flow stat lines */}
        <div className='cmp-body'>
          {/* Perception + senses */}
          <div className='cmp-line'>
            <span className='key'>Perception</span>
            <span className='acc'>{getFinalProfValue(STORE_ID, 'PERCEPTION')}</span>
            {allSenses.length > 0 && (
              <>
                <span className='sep'>·</span>
                {allSenses.map((s, i) => (
                  <span key={s}>
                    {i > 0 && ', '}
                    <span
                      className='cmp-sense'
                      onClick={() => openSense(s)}
                      title={`Open ${formatSense(s)} description`}
                    >
                      {formatSense(s)}
                    </span>
                  </span>
                ))}
              </>
            )}
          </div>

          {/* Skills (trained), inline mods */}
          {skillRows.length > 0 && (
            <div className='cmp-line'>
              <span className='key'>Skills</span>
              {skillRows.map((sk, i) => (
                <span key={sk.name} className='cmp-skill'>
                  {i > 0 && <span className='sep'>·</span>}
                  {sk.name} <span className='acc'>{sk.mod}</span>{' '}
                </span>
              ))}
            </div>
          )}

          {/* 6-attribute strip — hidden when every modifier reads +0
              (familiars have no ability mods; eidolons share the
              summoner's and compute to 0 in this per-companion store).
              Showing six "+0" cubes for those reads as broken. */}
          {attrs.some((a) => a.value !== 0) && (
            <div className='cmp-attrs'>
              {attrs.map((a) => (
                <div className='cmp-attr' key={a.label}>
                  <div className='k'>{a.label}</div>
                  <div className={a.partial ? 'v partial' : 'v'}>{sign(a.value)}</div>
                </div>
              ))}
            </div>
          )}

          {/* AC / Fort / Ref / Will. Saves always render (meaningful for
              every type). AC only renders when > 0 — a familiar with no
              armor proficiency computes AC 0, and "AC 0" reads as broken. */}
          <div className='cmp-line'>
            {ac > 0 && (
              <>
                <span className='key'>AC</span>
                <span className='num'>{ac}</span>
                <span className='sep'>·</span>
              </>
            )}
            <span className={ac > 0 ? 'key inline' : 'key'}>Fort</span>
            <span className='acc'>{fort}</span>
            <span className='sep'>·</span>
            <span className='key inline'>Ref</span>
            <span className='acc'>{ref}</span>
            <span className='sep'>·</span>
            <span className='key inline'>Will</span>
            <span className='acc'>{will}</span>
          </div>

          {/* HP — editable current + / max when the creature has its
              own pool. When maxHp <= 0, "0 / 0" reads as broken, so:
                • Eidolon → italic note that it shares the summoner's HP
                • anything else → "HP —" (no editable input). */}
          <div className='cmp-line'>
            <span className='key'>HP</span>
            {maxHp > 0 ? (
              <>
                <input
                  className='cmp-hp-input'
                  type='number'
                  value={currentHp}
                  aria-label='Current HP'
                  onChange={(e) => confirmHealth(e.currentTarget.value, maxHp, creature, setEntity)}
                />
                <span className='num'> / {maxHp}</span>
                {tempHp > 0 && (
                  <>
                    <span className='sep'>·</span>
                    <span className='num'>{tempHp}</span> <span className='muted'>temp</span>
                  </>
                )}
              </>
            ) : isEidolon ? (
              <>
                <span className='num'>—</span>
                <span className='sep'>·</span>
                <span className='muted' style={{ fontStyle: 'italic' }}>
                  shares summoner's Hit Points
                </span>
              </>
            ) : (
              <span className='num'>—</span>
            )}
          </div>

          {/* Speed — land + extras. Only rendered when the creature has
              at least one speed > 0 (speeds is pre-filtered to > 0). */}
          {speeds.length > 0 && (
            <div className='cmp-line'>
              <span className='key'>Speed</span>
              {speeds.map((sp, i) => (
                <span key={sp.name}>
                  {i > 0 && <span className='sep'>·</span>}
                  {labelize(sp.name) !== 'Land' && (
                    <span className='muted'>{labelize(sp.name)} </span>
                  )}
                  <span className='num'>{sp.value} feet</span>{' '}
                </span>
              ))}
            </div>
          )}

          {/* Conditions — kept editable on its own line */}
          <div className='cmp-line'>
            <span className='key'>Conditions</span>
            <span className='cmp-cond-wrap'>
              <ConditionPills id={STORE_ID} entity={creature} setEntity={setEntity} />
            </span>
          </div>

          {/* Strikes — equipped weapons + unarmed (Handwraps runes
              folded in), split Melee / Ranged. */}
          {meleeStrikes.length > 0 && (
            <>
              <div className='cmp-sub'>Melee</div>
              {meleeStrikes.map(renderStrike)}
            </>
          )}
          {rangedStrikes.length > 0 && (
            <>
              <div className='cmp-sub'>Ranged</div>
              {rangedStrikes.map(renderStrike)}
            </>
          )}

          {/* Abilities — compact paragraph cards. Click opens the
              standard action drawer (full text, traits, links). */}
          {abilityBlocks.length > 0 && (
            <>
              <div className='cmp-sub'>Abilities</div>
              {abilityBlocks.map((ability, i) => (
                <div
                  className='cmp-ability'
                  key={`${ability.id}-${i}`}
                  onClick={() =>
                    openDrawer({
                      type: 'action',
                      data: { action: ability },
                      extra: { addToHistory: true },
                    })
                  }
                >
                  <div className='nm'>
                    <span>{ability.name}</span>
                    {ability.actions && (
                      <span className='act'>
                        <Wg4.ActionGlyph cost={ability.actions} size={16} />
                      </span>
                    )}
                  </div>
                  {ability.description && (
                    <div className='txt'>
                      <RichText store={STORE_ID} fz={13} c='var(--wg4-ink-2)'>
                        {ability.description}
                      </RichText>
                    </div>
                  )}
                </div>
              ))}
            </>
          )}
        </div>
          </>
        )}

        {/* ── Configure view ─────────────────────────────────────────
            The full editors, shown only on demand. This is where the
            player chooses the companion's attacks/inventory, spells,
            abilities, details and notes (and resolves any build
            choices). Kept out of the default view so the stat block
            stays clean. */}
        {editMode && (
          <div className='cmp-edit-body'>
            <CompanionSection label='Skills & Actions'>
              <SkillsActionsPanel
                id={STORE_ID}
                entity={creature}
                setEntity={setEntity}
                content={content}
                panelHeight={600}
                panelWidth={props.panelWidth}
              />
            </CompanionSection>

            <CompanionSection label='Abilities'>
              <CreatureAbilitiesPanel
                id={STORE_ID}
                content={content}
                panelHeight={600}
                panelWidth={props.panelWidth}
                creature={creature}
                setCreature={setCreature}
              />
            </CompanionSection>

            <CompanionSection label='Inventory & Attacks'>
              <InventoryPanel
                id={STORE_ID}
                entity={creature}
                setEntity={setEntity}
                content={content}
                panelHeight={600}
                panelWidth={props.panelWidth}
              />
            </CompanionSection>

            <CompanionSection label='Spells'>
              <SpellsPanel
                id={STORE_ID}
                entity={creature}
                setEntity={setEntity}
                panelHeight={600}
                panelWidth={props.panelWidth}
              />
            </CompanionSection>

            <CompanionSection label='Description & Details'>
              <CreatureDetailsPanel
                id={STORE_ID}
                creature={creature}
                content={content}
                panelHeight={600}
                panelWidth={props.panelWidth}
              />
            </CompanionSection>

            <CompanionSection label='Notes'>
              <NotesPanel
                panelHeight={600}
                panelWidth={props.panelWidth}
                entity={creature}
                setEntity={setEntity}
              />
            </CompanionSection>
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── Edit-mode section divider — italic-serif label + hairline rule,
       matching the wg4 stat-block look. Wraps each configuration panel. */
function CompanionSection(props: { label: string; children: React.ReactNode }) {
  return (
    <>
      <div className='cmp-section-h'>
        <span className='lbl'>{props.label}</span>
        <span className='rule' />
      </div>
      <div className='cmp-section-body'>{props.children}</div>
    </>
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
