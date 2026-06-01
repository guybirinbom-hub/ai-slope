/**
 * wg4 character sheet — emits the markup defined in
 * wg4-mockups/sheet-main.html. No winbar (the codex window strip is
 * gone), .wg4-sheet-topbar (crest + name + tabs + LV + XP + menu),
 * .wg4-sheet-body (left rail × 6 cards + main column on the Main tab,
 * full-width panels on every other tab).
 *
 * State + mutation handlers are unchanged from the previous codex
 * sheet — only the render output is rewritten.
 */

import { LivingEntity, Character, ContentPackage, InventoryItem, AbilityBlock } from '@schemas/content';
import { isItemShield } from '@items/inv-utils';
import { handleUpdateItem, handleDeleteItem, handleMoveItem } from '@items/inv-handlers';
import { SetterOrUpdater } from '@utils/type-fixing';
import { useState, useEffect, Fragment } from 'react';
import { getVariable, setVariable } from '@variables/variable-manager';
import {
  VariableAttr,
  VariableListStr,
  VariableNum,
  VariableProf,
} from '@schemas/variables';
import {
  getFinalAcValue,
  getFinalHealthValue,
  getFinalProfValue,
  getProfValueParts,
  getVariableBreakdown,
} from '@variables/variable-helpers';
import { getAcParts } from '@items/armor-handler';
import { compileProficiencyType, labelToVariable } from '@variables/variable-utils';
import {
  CustomMode,
  getAllCustomModes,
  getModeToggleKey,
} from '@modes/custom-modes';
import { cloneDeep } from 'lodash-es';
import { makeRequest } from '@requests/request-manager';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchContentAll, getDefaultSources } from '@content/content-store';
import { useAtom } from 'jotai';
import { drawerState } from '@atoms/navAtoms';
import { confirmHealth, handleRest } from './entity-handler';
import { showNotification } from '@mantine/notifications';
import CompanionsPanel from './panels/CompanionsPanel';
import {
  CodexSpellsPanel,
  CodexInventoryPanel,
  CodexFeatsPanel,
  CodexActivitiesPanel,
  ActionGlyph,
  ActionStatCell,
  actionCostToGlyph,
} from './CodexPanels';
import { getCachedContent } from '@content/content-store';
import type { Spell } from '@schemas/content';
import { CodexNotesPanel } from './CodexNotesPanel';
import { CodexDetailsPanel } from './CodexDetailsPanel';
import ConditionsModesModal, { HARMFUL_CONDITIONS, ConditionDescription } from './ConditionsModesModal';
import { getAllConditions } from '@conditions/condition-handler';
import { useNavigate } from 'react-router-dom';
import { useCollapsedSections } from './useCollapsedSections';

type CodexTab =
  | 'main'
  | 'spells'
  | 'inventory'
  | 'feats'
  | 'companions'
  | 'notes'
  | 'details';

const TABS: { id: CodexTab; label: string }[] = [
  { id: 'main', label: 'Main' },
  { id: 'spells', label: 'Spells' },
  { id: 'inventory', label: 'Inventory' },
  { id: 'feats', label: 'Feats & Features' },
  { id: 'companions', label: 'Companions' },
  { id: 'notes', label: 'Notes' },
  { id: 'details', label: 'Details' },
];

const BASE_SKILLS: { name: string; var: string }[] = [
  { name: 'Acrobatics', var: 'SKILL_ACROBATICS' },
  { name: 'Arcana', var: 'SKILL_ARCANA' },
  { name: 'Athletics', var: 'SKILL_ATHLETICS' },
  { name: 'Crafting', var: 'SKILL_CRAFTING' },
  { name: 'Deception', var: 'SKILL_DECEPTION' },
  { name: 'Diplomacy', var: 'SKILL_DIPLOMACY' },
  { name: 'Intimidation', var: 'SKILL_INTIMIDATION' },
  { name: 'Medicine', var: 'SKILL_MEDICINE' },
  { name: 'Nature', var: 'SKILL_NATURE' },
  { name: 'Occultism', var: 'SKILL_OCCULTISM' },
  { name: 'Performance', var: 'SKILL_PERFORMANCE' },
  { name: 'Religion', var: 'SKILL_RELIGION' },
  { name: 'Society', var: 'SKILL_SOCIETY' },
  { name: 'Stealth', var: 'SKILL_STEALTH' },
  { name: 'Survival', var: 'SKILL_SURVIVAL' },
  { name: 'Thievery', var: 'SKILL_THIEVERY' },
];

const ABILITIES: { glyph: string; var: string }[] = [
  { glyph: 'Str', var: 'ATTRIBUTE_STR' },
  { glyph: 'Dex', var: 'ATTRIBUTE_DEX' },
  { glyph: 'Con', var: 'ATTRIBUTE_CON' },
  { glyph: 'Int', var: 'ATTRIBUTE_INT' },
  { glyph: 'Wis', var: 'ATTRIBUTE_WIS' },
  { glyph: 'Cha', var: 'ATTRIBUTE_CHA' },
];

function sign(n: number): string {
  return n >= 0 ? `+${n}` : `${n}`;
}

const XP_PER_LEVEL = 1000;

export default function CodexSheet(props: {
  characterId: number;
  character: Character | null;
  setCharacter: SetterOrUpdater<Character | null>;
  content: ContentPackage;
  panelWidth: number;
  panelHeight: number;
  sidebarActions?: React.ReactNode;
}) {
  const { character, setCharacter, content } = props;
  const navigate = useNavigate();
  const [_drawer, openDrawer] = useAtom(drawerState);
  const [activeTab, setActiveTab] = useState<CodexTab>('main');
  const queryClient = useQueryClient();
  // Collapsible section headers — every <section className='sec'> below
  // is toggled via this hook, keyed by a stable per-section ID.
  const { isCollapsed, toggle: toggleCollapsed } = useCollapsedSections();

  useQuery({
    queryKey: ['prefetch-ability-blocks-for-sheet'],
    queryFn: () => fetchContentAll<AbilityBlock>('ability-block', getDefaultSources('INFO')),
    staleTime: 60 * 60 * 1000,
  });

  // ---- Derived data ----
  const initial = character?.name?.trim()?.[0]?.toUpperCase() || '?';
  const level = character?.level ?? 1;
  const xp = character?.experience ?? 0;
  const xpPct = Math.max(0, Math.min(100, (xp / XP_PER_LEVEL) * 100));

  const ancestryName = character?.details?.ancestry?.name ?? '';
  const className = character?.details?.class?.name ?? '';

  const keyAttribute =
    (
      getVariable<VariableProf>('CHARACTER', 'CLASS_DC')?.value as
        | { attribute?: string }
        | undefined
    )?.attribute ?? null;

  const maxHp = getFinalHealthValue('CHARACTER');
  let currentHp = character?.hp_current;
  if (currentHp === undefined || currentHp < 0) currentHp = maxHp;
  const tempHp = character?.hp_temp ?? 0;
  const hpPct = maxHp > 0 ? Math.max(0, Math.min(100, (currentHp / maxHp) * 100)) : 0;

  const ac = getFinalAcValue('CHARACTER');
  const classDcStr = getFinalProfValue('CHARACTER', 'CLASS_DC', true);
  const spellDcStr = getFinalProfValue('CHARACTER', 'SPELL_DC', true);
  const dcMerged = classDcStr === spellDcStr;
  const speed = getVariable<VariableNum>('CHARACTER', 'SPEED')?.value ?? 25;
  const hasSpellcasting =
    !!getVariable<VariableProf>('CHARACTER', 'SPELL_DC')?.value &&
    compileProficiencyType(getVariable<VariableProf>('CHARACTER', 'SPELL_DC')?.value) !== 'U';

  // Equipped shields — used only if we want to show a shield breakdown
  // chip somewhere. Not surfaced in the new vitals card (would clutter
  // the two-cell pair), but kept available via the resists drawer.
  const equippedShields = (character?.inventory?.items ?? []).filter(
    (i) => i.is_equipped && isItemShield(i.item)
  ) as InventoryItem[];
  const setEntity = setCharacter as unknown as SetterOrUpdater<LivingEntity | null>;
  const openShieldDrawer = (invItem: InventoryItem) => {
    openDrawer({
      type: 'inv-item',
      data: {
        storeID: 'CHARACTER',
        invItem,
        onItemUpdate: (next: InventoryItem) => handleUpdateItem(setEntity, next),
        onItemDelete: (next: InventoryItem) => handleDeleteItem(setEntity, next),
        onItemMove: (item: InventoryItem, container: InventoryItem | null) =>
          handleMoveItem(setEntity, item, container),
      },
      extra: { addToHistory: true },
    });
  };

  const heroPoints = Math.max(
    0,
    Math.min(3, (character as { hero_points?: number } | null)?.hero_points ?? 0)
  );

  const conditions = character?.details?.conditions ?? [];

  const activeModeKeys: string[] =
    (getVariable<VariableListStr>('CHARACTER', 'ACTIVE_MODES')?.value as
      | string[]
      | undefined) ?? [];
  const builtinModesAll: AbilityBlock[] = content?.abilityBlocks
    ? content.abilityBlocks.filter((b) => b.type === 'mode')
    : [];
  const customModesAll = getAllCustomModes(
    (character?.meta_data as { custom_modes?: CustomMode[] } | undefined)
      ?.custom_modes ?? []
  );
  const activeModes: { key: string; name: string; description: string }[] = activeModeKeys
    .map((key) => {
      const builtin = builtinModesAll.find(
        (b) => labelToVariable(b.name) === key
      );
      if (builtin) {
        return { key, name: builtin.name, description: builtin.description || '' };
      }
      const custom = customModesAll.find(
        (m: CustomMode) => getModeToggleKey(m) === key
      );
      if (custom) {
        const effectsList = (custom.effects ?? [])
          .map((e) => `${e.variable ?? ''} ${e.value ?? ''} (${e.type ?? 'untyped'})`)
          .filter((s) => s.trim())
          .join('\n');
        return {
          key,
          name: custom.name,
          description: effectsList || 'Custom mode (no effects defined)',
        };
      }
      return { key, name: key.replace(/_/g, ' '), description: '' };
    });

  const languages =
    getVariable<VariableListStr>('CHARACTER', 'LANGUAGE_NAMES')?.value ?? [];

  const sensesPrecise = getVariable<VariableListStr>('CHARACTER', 'SENSES_PRECISE')?.value ?? [];
  const sensesImprecise = getVariable<VariableListStr>('CHARACTER', 'SENSES_IMPRECISE')?.value ?? [];
  const sensesVague = getVariable<VariableListStr>('CHARACTER', 'SENSES_VAGUE')?.value ?? [];
  const formatSense = (s: string) =>
    s
      .toLowerCase()
      .split('_')
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');
  const sensesItems: { raw: string; display: string }[] = [
    ...sensesPrecise.filter((s) => s !== 'NORMAL_VISION'),
    ...sensesImprecise.filter((s) => s !== 'HEARING'),
    ...sensesVague.filter((s) => s !== 'SMELL'),
  ].map((raw) => ({ raw, display: formatSense(raw) }));

  const saves: { label: string; var: string }[] = [
    { label: 'Fortitude', var: 'SAVE_FORT' },
    { label: 'Reflex', var: 'SAVE_REFLEX' },
    { label: 'Will', var: 'SAVE_WILL' },
    { label: 'Perception', var: 'PERCEPTION' },
  ];

  // ---- Mutations ----

  const onHpChange = (next: string) => {
    if (!character) return;
    confirmHealth(next, maxHp, character, setCharacter as SetterOrUpdater<LivingEntity | null>);
  };

  const onTempHpChange = (next: number) => {
    setCharacter((c) =>
      c ? { ...c, hp_temp: Math.max(0, isNaN(next) ? 0 : next) } : c
    );
  };

  const setHeroPoints = (next: number) => {
    const clamped = Math.max(0, Math.min(3, next));
    setCharacter((c) => (c ? { ...c, hero_points: clamped } : c));
  };

  const addXp = (amount: number) => {
    if (!amount || isNaN(amount) || !character) return;
    let newXp = (character.experience ?? 0) + amount;
    let newLevel = character.level ?? 1;
    while (newXp >= XP_PER_LEVEL) {
      newXp -= XP_PER_LEVEL;
      newLevel += 1;
    }
    setCharacter((c) =>
      c ? { ...c, experience: Math.max(0, newXp), level: newLevel } : c
    );
  };

  const setXp = (raw: number) => {
    if (!character) return;
    if (isNaN(raw) || raw < 0) raw = 0;
    let newXp = raw;
    let newLevel = character.level ?? 1;
    while (newXp >= XP_PER_LEVEL) {
      newXp -= XP_PER_LEVEL;
      newLevel += 1;
    }
    setCharacter((c) =>
      c ? { ...c, experience: newXp, level: newLevel } : c
    );
  };

  const removeCondition = (name: string) => {
    setCharacter((c) =>
      c
        ? {
            ...c,
            details: {
              ...c.details,
              conditions: (c.details?.conditions ?? []).filter((cn) => cn.name !== name),
            },
          }
        : c
    );
  };

  const deactivateMode = (key: string) => {
    if (!character) return;
    const current =
      (getVariable<VariableListStr>('CHARACTER', 'ACTIVE_MODES')?.value as
        | string[]
        | undefined) ?? [];
    const next = current.filter((k) => k !== key);
    setVariable('CHARACTER', 'ACTIVE_MODES', next, 'Selected');
    const updatedCharacter = {
      ...character,
      meta_data: { ...character.meta_data, active_modes: cloneDeep(next) },
    };
    setCharacter(updatedCharacter);
    queryClient.setQueryData(['find-character', character.id], updatedCharacter);
    queryClient.setQueryData(['find-character', String(character.id)], updatedCharacter);
    makeRequest('update-character', {
      id: character.id,
      meta_data: { ...character.meta_data, active_modes: cloneDeep(next) },
    }).catch(() => {});
  };

  const adjustConditionValue = (name: string, delta: number) => {
    setCharacter((c) => {
      if (!c) return c;
      const list = c.details?.conditions ?? [];
      const idx = list.findIndex((cn) => cn.name === name);
      if (idx < 0) return c;
      const cur = list[idx].value ?? 1;
      const next = cur + delta;
      let nextList: typeof list;
      if (next < 1) {
        nextList = list.filter((_, i) => i !== idx);
      } else {
        nextList = list.slice();
        nextList[idx] = { ...nextList[idx], value: next };
      }
      return { ...c, details: { ...c.details, conditions: nextList } };
    });
  };

  const [cmModalOpen, setCmModalOpen] = useState(false);
  const [showCondDesc, setShowCondDesc] = useState<{ name: string; description: string } | null>(null);

  const onRest = () => {
    if (!character) return;
    handleRest(
      'CHARACTER',
      character as LivingEntity,
      setCharacter as unknown as SetterOrUpdater<LivingEntity | null>
    );
    showNotification({
      title: 'Rested',
      message: 'HP, spell slots, focus, and daily-use items refreshed.',
      autoClose: 1800,
    });
  };

  const openSenseDrawer = (s: { raw: string; display: string }) => {
    const all = (getCachedContent<AbilityBlock>('ability-block') ?? []).filter(
      (b) => b.type === 'sense'
    );
    const targetKey = labelToVariable(s.raw);
    const hit = all.find((b) => labelToVariable(b.name) === targetKey);
    if (hit) {
      openDrawer({ type: 'sense', data: { id: hit.id }, extra: { addToHistory: true } });
    } else {
      openDrawer({
        type: 'generic',
        data: {
          title: s.display,
          description: 'No description registered for this sense in the current content pack.',
        },
        extra: { addToHistory: true },
      });
    }
  };

  // Split skills + lores into 4 columns
  const lores = discoverLoreSkills();
  const allSkillEntries: { var: string; name: string; lore?: string }[] = [
    ...BASE_SKILLS.map((s) => ({ var: s.var, name: s.name })),
    ...lores.map((l) => ({ var: l.var, name: 'Lore', lore: l.topic })),
  ];
  const skillColumns: typeof allSkillEntries[] = [[], [], [], []];
  allSkillEntries.forEach((s, i) => {
    skillColumns[i % 4].push(s);
  });

  // ---- Render ----

  return (
    <div className='codex-root codex-sheet-root wg4'>
      <div className='codex-sheet-page'>
        {/* WINBAR — brand + character crumbs + window controls */}
        <div className='winbar'>
          <div className='brand'>
            <span className='mark'></span>
            <span className='name'>
              Wanderer's <em>Codex</em> · Character Sheet
            </span>
          </div>
          <div className='crumbs'>
            <b>{character?.name || 'Unnamed'}</b>
            {ancestryName && <> · {ancestryName}</>}
            {className && <> · {className}</>}
            {level != null && <> · Level {level}</>}
          </div>
          <div className='wbtns'>
            <WinButtons />
          </div>
        </div>

        {/* TOPBAR — matches design HTML structure exactly */}
        <div className='topbar'>
          <div className='who'>
            <div className='crest'>{initial}</div>
            <div className='label'>
              <div className='nm'>{character?.name || 'Unnamed'}</div>
              <div className='sub'>
                <a>{ancestryName || '—'}</a>
                <span className='dot'></span>
                <a>{className || '—'}</a>
                <button
                  type='button'
                  className='rest-btn'
                  title='Take a Rest (recover HP, refill slots, refresh daily items)'
                  onClick={onRest}
                >
                  <span>☾</span>
                  <span>Rest</span>
                </button>
              </div>
            </div>
          </div>

          <div className='tabs' role='tablist'>
            {TABS.map((t) => (
              <button
                key={t.id}
                type='button'
                role='tab'
                aria-selected={activeTab === t.id}
                className={`tab${activeTab === t.id ? ' on' : ''}`}
                onClick={() => setActiveTab(t.id)}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className='right'>
            <div className='lv-chip'>
              <span className='k'>Lv</span>
              <span className='v'>{level}</span>
            </div>
            <div className='xp'>
              <div className='row'>
                <span>XP</span>
                <span className='nums'>
                  <XpValueInput value={xp} onChange={setXp} /> / {XP_PER_LEVEL}
                </span>
              </div>
              <div className='bar'>
                <div className='fill' style={{ width: `${xpPct}%` }}></div>
              </div>
            </div>
            <AddXpForm onAdd={addXp} />
            <CodexNavMenu characterId={props.characterId} navigate={navigate} />
          </div>
        </div>

        {/* BODY — on the Notes tab the design uses a full-width
            sidebar + editor layout with NO vitals rail (per
            D:\Inst\wg4 reference). Every other tab keeps the
            persistent left rail. The Details tab uses a 3-col grid
            with the persistent left rail + dossier center + origins/
            proficiencies right rail. */}
        <div
          className={`body${
            activeTab === 'notes'
              ? ' body--notes'
              : activeTab === 'details'
                ? ' body--details'
                : ''
          }`}
        >
          {/* Notes tab renders its own 2-col layout directly inside
              .body — bypassing the .col.main wrapper so the body grid
              can lay the page-list sidebar + editor leaf side-by-side
              as direct children of .body.body--notes. */}
          {activeTab === 'notes' && (
            <CodexNotesPanel
              character={character}
              setCharacter={setCharacter as unknown as SetterOrUpdater<LivingEntity | null>}
            />
          )}
          {/* LEFT RAIL — persistent across every tab EXCEPT notes */}
          {activeTab !== 'notes' && (
          <aside className='col left'>
                {/* Vitals */}
                <section className={`sec${isCollapsed('vitals') ? ' collapsed' : ''}`}>
                  <div className='sec-title' onClick={() => toggleCollapsed('vitals')}>
                    <div className='label'>
                      <span className='lz'>♥</span>Vitals
                      <span className='sec-chevron'>▾</span>
                    </div>
                  </div>
                  <div className='sec-body hp-card vitals-body'>
                    <div className='hp-head'>
                      <div className='hp-num'>
                        <HpInput value={currentHp} onChange={onHpChange} />
                        <span className='sep'>/</span>
                        <span className='max'>{maxHp}</span>
                        <span className='lbl'>HP</span>
                      </div>
                      <div className='hp-temp' onClick={(e) => e.stopPropagation()}>
                        <div className='k'>Temp</div>
                        <div className={`v${tempHp ? '' : ' off'}`}>
                          <input
                            className='v-input'
                            type='number'
                            min={0}
                            value={tempHp || ''}
                            placeholder='—'
                            onChange={(e) => onTempHpChange(parseInt(e.target.value, 10))}
                          />
                        </div>
                      </div>
                    </div>
                    <div className='hpbar hp-bar'>
                      <div className='fill' style={{ width: `${hpPct}%` }}></div>
                    </div>
                    <a
                      className='resist-link'
                      onClick={() =>
                        openDrawer({
                          type: 'stat-resist-weak',
                          data: { id: 'CHARACTER' },
                          extra: { addToHistory: true },
                        })
                      }
                    >
                      Resistances &amp; Weaknesses
                    </a>
                    <div className='tiles vitals-pair'>
                      <div
                        className='tile pcell'
                        onClick={() =>
                          openDrawer({
                            type: 'stat-prof',
                            data: { id: 'CHARACTER', variableName: 'CLASS_DC', isDC: true },
                            extra: { addToHistory: true },
                          })
                        }
                      >
                        <div className='k'>
                          {dcMerged && hasSpellcasting ? 'Class/Spell DC' : 'Class DC'}
                        </div>
                        <div className='num v'>{classDcStr}</div>
                      </div>
                      <div
                        className='tile pcell'
                        onClick={() =>
                          openDrawer({
                            type: 'stat-ac',
                            data: { id: 'CHARACTER' },
                            extra: { addToHistory: true },
                          })
                        }
                      >
                        <div className='k'>Armor Class</div>
                        <div className='num v'>{ac}</div>
                      </div>
                      {hasSpellcasting && !dcMerged && (
                        <div
                          className='tile pcell'
                          onClick={() =>
                            openDrawer({
                              type: 'stat-prof',
                              data: { id: 'CHARACTER', variableName: 'SPELL_DC', isDC: true },
                              extra: { addToHistory: true },
                            })
                          }
                        >
                          <div className='k'>Spell DC</div>
                          <div className='num v'>{spellDcStr}</div>
                        </div>
                      )}
                      {hasSpellcasting && (
                        <div
                          className='tile pcell'
                          onClick={() =>
                            openDrawer({
                              type: 'stat-prof',
                              data: { id: 'CHARACTER', variableName: 'SPELL_ATTACK' },
                              extra: { addToHistory: true },
                            })
                          }
                        >
                          <div className='k'>Spell Atk</div>
                          <div className='num v'>{getFinalProfValue('CHARACTER', 'SPELL_ATTACK')}</div>
                        </div>
                      )}
                    </div>
                  </div>
                </section>

                {/* Speed & Senses */}
                <section className={`sec${isCollapsed('speed-senses') ? ' collapsed' : ''}`}>
                  <div className='sec-title' onClick={() => toggleCollapsed('speed-senses')}>
                    <div className='label'>
                      <span className='lz'>→</span>Speed &amp; Senses
                      <span className='sec-chevron'>▾</span>
                    </div>
                  </div>
                  <div className='sec-body'>
                    <div className='stat-strip ss-row'>
                      <div
                        className='item'
                        style={{ cursor: 'pointer' }}
                        onClick={() =>
                          openDrawer({
                            type: 'stat-speed',
                            data: { id: 'CHARACTER' },
                            extra: { addToHistory: true },
                          })
                        }
                      >
                        <div className='k'>Speed</div>
                        <div className='num v v-num'>
                          {speed}
                          <small> ft</small>
                        </div>
                      </div>
                      <div className='item'>
                        <div className='k'>Senses</div>
                        <div className='senses-row v-text'>
                          {sensesItems.length === 0 ? (
                            <span style={{ color: 'var(--wg4-ink-4)', fontStyle: 'italic' }}>—</span>
                          ) : (
                            sensesItems.map((s) => (
                              <span
                                key={s.raw}
                                className='chip'
                                onClick={() => openSenseDrawer(s)}
                                title={`Open ${s.display} description`}
                              >
                                {s.display}
                              </span>
                            ))
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </section>

                {/* Hero Points */}
                <section className={`sec${isCollapsed('hero-points') ? ' collapsed' : ''}`}>
                  <div className='sec-title' onClick={() => toggleCollapsed('hero-points')}>
                    <div className='label'>
                      <span className='lz'>◇</span>Hero Points
                      <span className='sec-chevron'>▾</span>
                    </div>
                  </div>
                  <div className='sec-body'>
                    <div className='hero hp-points'>
                      <div className='hero-pips hp-pips'>
                        {[0, 1, 2].map((i) => (
                          <span
                            key={i}
                            className={`pip hp-pip${i < heroPoints ? ' on' : ''}`}
                            onClick={() => {
                              if (i < heroPoints) setHeroPoints(i);
                              else setHeroPoints(i + 1);
                            }}
                          />
                        ))}
                      </div>
                      <div className='hero-count num hp-count'>
                        <b>{heroPoints}</b> / 3
                      </div>
                    </div>
                  </div>
                </section>

                {/* Saves & Perception */}
                <section className={`sec${isCollapsed('saves-perception') ? ' collapsed' : ''}`}>
                  <div className='sec-title' onClick={() => toggleCollapsed('saves-perception')}>
                    <div className='label'>
                      <span className='lz'>⊕</span>Saves &amp; Perception
                      <span className='sec-chevron'>▾</span>
                    </div>
                  </div>
                  <div className='sec-body'>
                    <div className='row-list'>
                      {saves.map((s) => {
                        const v = getVariable<VariableProf>('CHARACTER', s.var);
                        const profLetter = v ? compileProficiencyType(v.value) : 'U';
                        const value = getFinalProfValue('CHARACTER', s.var);
                        const hasConditionals = !!getProfValueParts(
                          'CHARACTER',
                          s.var
                        )?.hasConditionals;
                        return (
                          <div
                            key={s.var}
                            className='row'
                            onClick={() =>
                              openDrawer({
                                type: s.var === 'PERCEPTION' ? 'stat-perception' : 'stat-prof',
                                data: { id: 'CHARACTER', variableName: s.var },
                                extra: { addToHistory: true },
                              })
                            }
                          >
                            <div className='name'>
                              {s.label}
                              {hasConditionals && <span className='sub-note'>· conditional</span>}
                            </div>
                            <div className='prof' data-r={profLetter}>{profLetter}</div>
                            <div className='mod num'>{value}</div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </section>

                {/* Conditions */}
                <section className={`sec${isCollapsed('conditions') ? ' collapsed' : ''}`}>
                  <div className='sec-title' onClick={() => toggleCollapsed('conditions')}>
                    <div className='label'>
                      <span className='lz'>!</span>Conditions
                      <span className='sec-chevron'>▾</span>
                    </div>
                    <button
                      type='button'
                      className='add'
                      onClick={(e) => {
                        e.stopPropagation();
                        setCmModalOpen(true);
                      }}
                      title='Add condition or mode'
                    >
                      +
                    </button>
                  </div>
                  <div className='sec-body'>
                    <div className='cond-pills'>
                      {conditions.length === 0 && activeModes.length === 0 && (
                        <span className='cond-empty'>None</span>
                      )}
                      {activeModes.map((m) => (
                        <span
                          key={`mode-${m.key}`}
                          className='cond-pill'
                          title='Click for description, ✕ to deactivate'
                          onClick={() =>
                            setShowCondDesc({ name: m.name, description: m.description })
                          }
                        >
                          {m.name}
                          <button
                            type='button'
                            className='x'
                            onClick={(e) => {
                              e.stopPropagation();
                              deactivateMode(m.key);
                            }}
                          >
                            ×
                          </button>
                        </span>
                      ))}
                      {conditions.map((cond) => {
                        const hasValue = cond.value != null && cond.value > 0;
                        return (
                          <span
                            key={cond.name}
                            className='cond-pill'
                            onClick={() =>
                              setShowCondDesc({
                                name: cond.name,
                                description: cond.description || '',
                              })
                            }
                          >
                            {cond.name}
                            {hasValue && (
                              <>
                                <button
                                  type='button'
                                  className='pm'
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    adjustConditionValue(cond.name, -1);
                                  }}
                                >
                                  −
                                </button>
                                <span className='v-count'>{cond.value}</span>
                                <button
                                  type='button'
                                  className='pm'
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    adjustConditionValue(cond.name, 1);
                                  }}
                                >
                                  +
                                </button>
                              </>
                            )}
                            <button
                              type='button'
                              className='x'
                              onClick={(e) => {
                                e.stopPropagation();
                                removeCondition(cond.name);
                              }}
                            >
                              ×
                            </button>
                          </span>
                        );
                      })}
                    </div>
                  </div>
                </section>

                {/* Languages */}
                <section className={`sec${isCollapsed('languages') ? ' collapsed' : ''}`}>
                  <div className='sec-title' onClick={() => toggleCollapsed('languages')}>
                    <div className='label'>
                      <span className='lz'>¶</span>Languages
                      <span className='sec-chevron'>▾</span>
                    </div>
                  </div>
                  <div className='sec-body'>
                    <div className='lang-list'>
                      {languages.length === 0 ? (
                        <span style={{ color: 'var(--wg4-ink-4)', fontStyle: 'italic' }}>—</span>
                      ) : (
                        languages.map((l, i) => (
                          <Fragment key={l}>
                            {i > 0 && <span className='dot'>·</span>}
                            <span>{l}</span>
                          </Fragment>
                        ))
                      )}
                    </div>
                  </div>
                </section>

                {props.sidebarActions && (
                  <div className='sidebar-actions'>{props.sidebarActions}</div>
                )}
          </aside>
          )}

          {/* DETAILS TAB — render the dossier directly as a sibling of
              the left rail so the body--details 3-col grid lays
              .col.left + .col.main.codex-details + .col.right.codex-details-rail
              side-by-side. Skipping the .col.main wrapper avoids
              nesting the two dossier columns inside a single main
              cell. */}
          {activeTab === 'details' && (
            <CodexDetailsPanel
              character={character}
              setCharacter={setCharacter as unknown as SetterOrUpdater<LivingEntity | null>}
              content={content}
            />
          )}

          {/* MAIN COLUMN — content varies by tab; rail above is fixed.
              On notes tab, CodexNotesPanel was rendered above directly
              inside .body — skip the .col.main wrapper here so we
              don't end up with an empty main column that confuses the
              body--notes 2-col grid. Likewise on details tab we skip
              the main wrapper since CodexDetailsPanel renders its own
              .col.main.codex-details + .col.right.codex-details-rail
              pair as siblings of .col.left above. */}
          {activeTab !== 'notes' && activeTab !== 'details' && (
          <main className='col main'>
            {activeTab === 'main' && (
              <>
                {/* Abilities & Skills */}
                <section className={`sec${isCollapsed('abilities-skills') ? ' collapsed' : ''}`}>
                  <div className='sec-title' onClick={() => toggleCollapsed('abilities-skills')}>
                    <div className='label'>
                      <span className='lz'>α</span>Abilities &amp; Skills
                      <span className='sec-chevron'>▾</span>
                    </div>
                    <div className='as-legend' onClick={(e) => e.stopPropagation()}>
                      Key ·{' '}
                      <b>
                        {keyAttribute ? keyAttribute.replace('ATTRIBUTE_', '').slice(0, 3) : '—'}
                      </b>
                      <span className='ranks'>T E M L</span>
                    </div>
                  </div>
                  <div className='as-body'>
                    <div className='abilities'>
                      {ABILITIES.map((a) => {
                        const v = getVariable<VariableAttr>('CHARACTER', a.var);
                        const mod = v?.value?.value ?? 0;
                        const score = 10 + mod * 2;
                        const isKey = keyAttribute === a.var;
                        return (
                          <button
                            type='button'
                            key={a.var}
                            className={`ability${isKey ? ' key' : ''}`}
                            onClick={() =>
                              openDrawer({
                                type: 'stat-attr',
                                data: { id: 'CHARACTER', attributeName: a.var },
                                extra: { addToHistory: true },
                              })
                            }
                          >
                            <div className='k'>{a.glyph}</div>
                            <div className='num mod'>{sign(mod)}</div>
                            <div className='num score'>{score}</div>
                          </button>
                        );
                      })}
                    </div>
                    <div className='skills'>
                      {skillColumns.map((col, ci) => (
                        <div key={ci}>
                          {col.map((s) => {
                            const v = getVariable<VariableProf>('CHARACTER', s.var);
                            const profLetter = v ? compileProficiencyType(v.value) : 'U';
                            const value = getFinalProfValue('CHARACTER', s.var);
                            const isUntrained = profLetter === 'U';
                            return (
                              <div
                                key={s.var}
                                className='row'
                                onClick={() =>
                                  openDrawer({
                                    type: 'stat-prof',
                                    data: { id: 'CHARACTER', variableName: s.var },
                                    extra: { addToHistory: true },
                                  })
                                }
                              >
                                <div className='prof' data-r={profLetter}>{profLetter}</div>
                                <div className='name'>
                                  {s.name}
                                  {s.lore && (
                                    <span className='sub-note'>· {s.lore}</span>
                                  )}
                                </div>
                                <div className={`mod num${isUntrained ? ' u' : ''}`}>
                                  {value}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      ))}
                    </div>
                  </div>
                </section>

                {/* Pinned (favorites) — same rendering as before, just
                    inside the new column. CodexFavorites handles its own
                    empty state. */}
                <CodexFavorites
                  character={character}
                  setCharacter={setCharacter}
                  openDrawer={openDrawer as unknown as (next: unknown) => void}
                />

                {/* Activities */}
                <section className={`sec${isCollapsed('activities') ? ' collapsed' : ''}`}>
                  <div className='sec-title' onClick={() => toggleCollapsed('activities')}>
                    <div className='label'>
                      <span className='lz'>⧉</span>Activities
                      <span className='sec-chevron'>▾</span>
                    </div>
                    <span className='wg4-meta-link' onClick={(e) => e.stopPropagation()}>
                      Strikes &amp; actions in three modes
                      <span className='caret'> ›</span>
                    </span>
                  </div>
                  <div className='sec-body'>
                    <CodexActivitiesPanel character={character} content={content} />
                  </div>
                </section>
              </>
            )}

            {activeTab === 'spells' && (
              <CodexSpellsPanel
                characterId={props.characterId}
                character={character}
                setCharacter={setCharacter}
                content={content}
              />
            )}
            {activeTab === 'inventory' && (
              <CodexInventoryPanel
                characterId={props.characterId}
                character={character}
                setCharacter={setCharacter}
              />
            )}
            {activeTab === 'feats' && (
              <CodexFeatsPanel
                characterId={props.characterId}
                character={character}
                content={content}
              />
            )}
            {activeTab === 'companions' && (
              <CompanionsPanel
                panelHeight={props.panelHeight}
                panelWidth={props.panelWidth}
              />
            )}
            {/* (Notes panel moved above — rendered directly under .body
                so its 2-col layout becomes a sibling of the page-list
                sidebar, not nested inside .col.main.) */}
            {/* (Details panel also rendered above — as two siblings
                under .body so the body--details 3-col grid can lay
                the dossier center + right rail next to the left
                vitals rail.) */}
          </main>
          )}
        </div>
      </div>

      {/* Conditions + Modes modal */}
      <ConditionsModesModal
        opened={cmModalOpen}
        onClose={() => setCmModalOpen(false)}
        character={character}
        setCharacter={setCharacter}
        content={content}
      />

      {/* Condition description popover */}
      {showCondDesc && (
        <div className='cm-desc-overlay' onClick={() => setShowCondDesc(null)}>
          <div className='cm-desc-box' onClick={(e) => e.stopPropagation()}>
            <div className='cm-desc-head'>
              <span className='cm-desc-title'>{showCondDesc.name}</span>
              <button
                type='button'
                className='cm-close'
                onClick={() => setShowCondDesc(null)}
                aria-label='Close'
              >
                ✕
              </button>
            </div>
            <div className='cm-desc-body'>
              <ConditionDescription
                text={showCondDesc.description}
                conditions={getAllConditions()}
                onConditionClick={(c) =>
                  setShowCondDesc({ name: c.name, description: c.description })
                }
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// --- Helper sub-components -------------------------------------------------

/**
 * Inline-edit HP value. Renders the number; click swaps for an input.
 */
function HpInput(props: { value: number; onChange: (next: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(`${props.value}`);

  if (!editing) {
    return (
      <span
        className='cur'
        onClick={(e) => {
          e.stopPropagation();
          setDraft(`${props.value}`);
          setEditing(true);
        }}
        style={{ cursor: 'text' }}
      >
        {props.value}
      </span>
    );
  }
  return (
    <input
      autoFocus
      className='cur-input'
      type='text'
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        setEditing(false);
        props.onChange(draft);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          (e.target as HTMLInputElement).blur();
        }
        if (e.key === 'Escape') {
          setEditing(false);
        }
      }}
      onClick={(e) => e.stopPropagation()}
    />
  );
}

/**
 * Inline-edit XP value. Renders the number; click swaps for an input.
 */
function XpValueInput(props: { value: number; onChange: (next: number) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(`${props.value}`);
  if (!editing) {
    return (
      <b
        style={{ cursor: 'text' }}
        title='Click to edit XP'
        onClick={() => {
          setDraft(`${props.value}`);
          setEditing(true);
        }}
      >
        {props.value}
      </b>
    );
  }
  return (
    <input
      autoFocus
      type='number'
      min={0}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        setEditing(false);
        const n = parseInt(draft, 10);
        if (!isNaN(n)) props.onChange(n);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') setEditing(false);
      }}
      style={{
        width: 48,
        background: 'transparent',
        border: 0,
        outline: 0,
        color: 'inherit',
        font: 'inherit',
        fontWeight: 700,
        padding: 0,
      }}
    />
  );
}

/**
 * Tiny XP-add form rendered into the topbar's xp-ctl slot.
 */
function AddXpForm(props: { onAdd: (amount: number) => void }) {
  const [val, setVal] = useState('');
  return (
    <form
      className='xp-ctl'
      onSubmit={(e) => {
        e.preventDefault();
        const n = parseInt(val, 10);
        if (!isNaN(n) && n > 0) {
          props.onAdd(n);
          setVal('');
        }
      }}
      title='Add XP — type a number and press Enter'
    >
      <button type='submit'>+</button>
      <input
        type='number'
        min={0}
        placeholder='XP'
        value={val}
        onChange={(e) => setVal(e.target.value)}
        style={{
          width: 38,
          background: 'transparent',
          border: 0,
          outline: 0,
          color: 'inherit',
          font: 'inherit',
          padding: 0,
          textAlign: 'center',
        }}
      />
      <button type='submit'>▸</button>
    </form>
  );
}

/**
 * Favorites — wg4 Pinned section. Renders quick-access action cards
 * for any drawer the player has starred.
 */
function CodexFavorites(props: {
  character: Character | null;
  setCharacter: SetterOrUpdater<Character | null>;
  openDrawer: (next: unknown) => void;
}) {
  const { character, openDrawer } = props;
  const { isCollapsed, toggle: toggleCollapsed } = useCollapsedSections();
  const favs =
    (character?.meta_data as {
      favorites?: { type: string; id: number | string; name: string }[];
    } | undefined)?.favorites ?? [];
  if (favs.length === 0) return null;
  return (
    <section className={`sec${isCollapsed('pinned') ? ' collapsed' : ''}`}>
      <div className='sec-title' onClick={() => toggleCollapsed('pinned')}>
        <div className='label'>
          <span className='lz'>★</span>Pinned
          <span className='sec-chevron'>▾</span>
        </div>
        <span className='wg4-meta-link' onClick={(e) => e.stopPropagation()}>
          quick-access<span className='caret'> ›</span>
        </span>
      </div>
      <div className='sec-body'>
        <div className='wg4-grid-4' style={{ rowGap: 6 }}>
          {favs.map((fav) => {
            let glyph: ReturnType<typeof actionCostToGlyph> = null;
            let statContent: React.ReactNode = null;
            let statClass = 'muted';
            if (fav.type === 'action' || fav.type === 'class-feature' || fav.type === 'feat') {
              const ab = (getCachedContent<AbilityBlock>('ability-block') ?? []).find(
                (a) => a.id === Number(fav.id)
              );
              if (ab) {
                glyph = actionCostToGlyph(ab.actions ?? null);
                const stat = ActionStatCell({ action: ab, character });
                if (stat) {
                  statContent = stat;
                  statClass = '';
                }
              }
            } else if (fav.type === 'spell') {
              const sp = (getCachedContent<Spell>('spell') ?? []).find(
                (s) => s.id === Number(fav.id)
              );
              if (sp) {
                glyph = actionCostToGlyph(sp.cast ?? null);
                const range = sp.range || sp.area;
                if (range) {
                  statContent = (
                    <span>
                      {range}
                      {sp.defense && <small> {sp.defense}</small>}
                    </span>
                  );
                  statClass = '';
                }
              }
            }
            if (!statContent) {
              statContent = labelizeFavType(fav.type);
            }
            return (
              <div
                key={`${fav.type}-${fav.id}`}
                className='wg4-act-card'
                onClick={() => {
                  if (fav.type === 'inv-item') {
                    const flat: import('@schemas/content').InventoryItem[] = [];
                    for (const i of character?.inventory?.items ?? []) {
                      flat.push(i);
                      flat.push(...(i.container_contents ?? []));
                    }
                    const invItem = flat.find((i) => String(i.id) === String(fav.id));
                    if (!invItem) return;
                    openDrawer({
                      type: 'inv-item',
                      data: { invItem, storeID: 'CHARACTER' },
                      extra: { addToHistory: true },
                    });
                    return;
                  }
                  openDrawer({
                    type: fav.type as
                      | 'spell'
                      | 'feat'
                      | 'action'
                      | 'item'
                      | 'class-feature'
                      | 'condition',
                    data: { id: fav.id },
                    extra: { addToHistory: true },
                  });
                }}
              >
                <div className='left'>
                  <span className='ic'>{glyph ? <ActionGlyph cost={glyph} /> : null}</span>
                  <div className='info'>
                    <div className='name'>{fav.name}</div>
                  </div>
                </div>
                <div className='right'>
                  <div className={`r1 ${statClass}`}>{statContent}</div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function labelizeFavType(type: string): string {
  switch (type) {
    case 'spell': return 'Spell';
    case 'feat': return 'Feat';
    case 'action': return 'Action';
    case 'class-feature': return 'Feature';
    case 'inv-item': return 'Item';
    case 'item': return 'Item';
    case 'ancestry': return 'Ancestry';
    case 'background': return 'Background';
    case 'class': return 'Class';
    case 'creature': return 'Creature';
    case 'language': return 'Language';
    case 'sense': return 'Sense';
    case 'heritage': return 'Heritage';
    case 'physical-feature': return 'Feature';
    case 'condition': return 'Condition';
    case 'trait': return 'Trait';
    case 'archetype': return 'Archetype';
    case 'versatile-heritage': return 'Heritage';
    case 'class-archetype': return 'Class Archetype';
    default: return type;
  }
}

function discoverLoreSkills(): { var: string; topic: string }[] {
  try {
    const w = window as unknown as {
      __wgVariableStore?: { CHARACTER?: Record<string, unknown> };
    };
    const store = w.__wgVariableStore?.CHARACTER;
    if (!store) return [];
    return Object.keys(store)
      .filter((k) => k.startsWith('SKILL_LORE_') && k !== 'SKILL_LORE____')
      .sort()
      .map((k) => ({
        var: k,
        topic: k
          .replace('SKILL_LORE_', '')
          .toLowerCase()
          .split('_')
          .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
          .join(' '),
      }));
  } catch {
    return [];
  }
}

/**
 * Hamburger nav menu — native HTML implementation, opens a positioned
 * dropdown with quick links + Edit in Builder.
 */
/**
 * Three small dots (min / max / close) shown at the right end of the
 * winbar. Wire through Electron's preload bridge when available so
 * clicks actually minimize/maximize/close the OS window. Falls back
 * to no-ops in browser preview.
 */
function WinButtons() {
  const w = (
    window as unknown as {
      wgElectron?: {
        windowMinimize?: () => void;
        windowMaximize?: () => void;
        windowClose?: () => void;
      };
    }
  ).wgElectron;
  return (
    <>
      <button className='wbtn' aria-label='Minimize' onClick={() => w?.windowMinimize?.()} />
      <button className='wbtn' aria-label='Maximize' onClick={() => w?.windowMaximize?.()} />
      <button className='wbtn' aria-label='Close' onClick={() => w?.windowClose?.()} />
    </>
  );
}

function CodexNavMenu(props: { characterId: number; navigate: (path: string) => void }) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useState<HTMLDivElement | null>(null);
  const containerRef = (node: HTMLDivElement | null) => {
    wrapperRef[1](node);
  };
  useEffect(() => {
    const onDocMouseDown = (e: MouseEvent) => {
      const node = wrapperRef[0];
      if (!node) return;
      if (!node.contains(e.target as Node)) setOpen(false);
    };
    if (open) document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, [open, wrapperRef]);

  const items: { label: string; path: string; divider?: boolean }[] = [
    { label: 'Characters', path: '/characters' },
    { label: 'Homebrew', path: '/homebrew' },
    { label: 'Settings', path: '/account' },
    { label: 'Edit in Builder', path: `/builder/${props.characterId}?tab=builder`, divider: true },
  ];

  return (
    <div
      ref={containerRef}
      style={{ position: 'relative', display: 'flex', alignItems: 'center' }}
    >
      <button
        type='button'
        className='menu-btn'
        title='Menu'
        aria-label='Menu'
        aria-expanded={open}
        aria-haspopup='menu'
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
      >
        ≡
      </button>
      {open && (
        <div
          role='menu'
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            right: 0,
            minWidth: 200,
            background: 'var(--wg4-surface)',
            border: '1px solid var(--wg4-border)',
            borderRadius: 'var(--wg4-r-2)',
            boxShadow: 'var(--wg4-shadow-drawer)',
            zIndex: 9999,
            padding: '6px 0',
          }}
        >
          {items.map((item) => (
            <div key={item.path}>
              {item.divider && (
                <div
                  style={{
                    borderTop: '1px solid var(--wg4-border-soft)',
                    margin: '6px 0',
                  }}
                />
              )}
              <button
                type='button'
                onClick={() => {
                  setOpen(false);
                  props.navigate(item.path);
                }}
                style={{
                  display: 'block',
                  width: '100%',
                  background: 'transparent',
                  border: 0,
                  color: 'var(--wg4-ink)',
                  fontFamily: 'var(--wg4-font-sans)',
                  fontSize: 13,
                  textAlign: 'left',
                  padding: '8px 14px',
                  cursor: 'pointer',
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.background =
                    'var(--wg4-surface-hover)';
                  (e.currentTarget as HTMLButtonElement).style.color =
                    'var(--wg4-accent)';
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
                  (e.currentTarget as HTMLButtonElement).style.color = 'var(--wg4-ink)';
                }}
              >
                {item.label}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
