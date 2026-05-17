/**
 * Codex-themed character sheet.
 *
 * Renders the codex-sheet-v5.html design as a React component, wired
 * up to the existing character data layer (useCharacter atom + the
 * variable system + the sub-panel components). Replaces the previous
 * SimpleGrid + SectionPanels layout used in CharacterSheetPage.
 *
 * Architecture:
 *  - `.topbar` with `.who` (crest+name+sub), `.tabs`, `.right` cluster
 *    (lv-chip, xp bar, menu).
 *  - `.body` is a 2-col grid: `.col.left` sidebar (Vitals, Speed,
 *    Hero Points, Saves+Perception, Conditions, Languages) + `.col.main`
 *    (Abilities+Skills, Pinned/Activities) for the "Main" tab.
 *  - Other tabs (Spells, Inventory, Feats, Companions, Notes, Details)
 *    render the existing sub-panel components from
 *    `pages/character_sheet/panels/`. Those use Mantine but pick up the
 *    codex aesthetic via the codex-bridge stylesheet.
 *
 * Data wiring:
 *  - HP: entity.hp_current / getFinalHealthValue('CHARACTER')
 *  - AC: getFinalAcValue('CHARACTER')
 *  - Class DC / Perception / saves / skills: displayFinalProfValue or
 *    getFinalProfValue
 *  - Attributes: getVariable<VariableAttr>('CHARACTER', 'ATTRIBUTE_*')
 *  - Proficiency rank letter (T/E/M/L): compileProficiencyType
 *  - Hero points: entity.hero_points (0-3)
 *  - Languages: getVariable<VariableListStr>('CHARACTER', 'LANGUAGES')
 *  - Conditions: entity.details.conditions
 */

import { LivingEntity, Character, ContentPackage } from '@schemas/content';
import { SetterOrUpdater } from '@utils/type-fixing';
import { useState } from 'react';
import { getVariable } from '@variables/variable-manager';
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
} from '@variables/variable-helpers';
import { compileProficiencyType } from '@variables/variable-utils';
import { useAtom } from 'jotai';
import { drawerState } from '@atoms/navAtoms';
import { confirmHealth } from './entity-handler';
import SpellsPanel from './panels/SpellsPanel';
import InventoryPanel from './panels/InventoryPanel';
import FeatsFeaturesPanel from './panels/FeatsFeaturesPanel';
import CompanionsPanel from './panels/CompanionsPanel';
import DetailsPanel from './panels/DetailsPanel';
import NotesPanel from './panels/NotesPanel';
import SkillsActionsPanel from './panels/SkillsActionsPanel';
import { useNavigate } from 'react-router-dom';

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

// The 16 base skills + the lore wildcard. Matches the codex-sheet-v5
// mockup's two-column skill ladder. Lore skills are rendered last as
// dynamic entries (since each character has different lores).
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

// XP thresholds per level in PF2e are 1000 per level. We just use that
// flat cap; the underlying engine reconciles when level changes anyway.
const XP_PER_LEVEL = 1000;

export default function CodexSheet(props: {
  characterId: number;
  character: Character | null;
  setCharacter: SetterOrUpdater<Character | null>;
  content: ContentPackage;
  panelWidth: number;
  panelHeight: number;
}) {
  const { character, setCharacter, content } = props;
  const navigate = useNavigate();
  const [_drawer, openDrawer] = useAtom(drawerState);
  const [activeTab, setActiveTab] = useState<CodexTab>('main');

  // ---- Derived data ----
  const initial = character?.name?.trim()?.[0]?.toUpperCase() || '?';
  const level = character?.level ?? 1;
  const xp = character?.experience ?? 0;
  const xpPct = Math.max(0, Math.min(100, (xp / XP_PER_LEVEL) * 100));

  const ancestryName = character?.details?.ancestry?.name ?? '';
  const className = character?.details?.class?.name ?? '';

  // The keyspell attribute on the class (e.g., CHA for bard, INT for wizard).
  // Used to highlight the key ability tile with a gold glow.
  const keyAttribute =
    (
      getVariable<VariableProf>('CHARACTER', 'CLASS_DC')?.value as
        | { attribute?: string }
        | undefined
    )?.attribute ?? null;

  // HP — three values: current (mutable), max (computed), temp (mutable).
  const maxHp = getFinalHealthValue('CHARACTER');
  let currentHp = character?.hp_current;
  if (currentHp === undefined || currentHp < 0) currentHp = maxHp;
  const tempHp = character?.hp_temp ?? 0;
  const hpPct = maxHp > 0 ? Math.max(0, Math.min(100, (currentHp / maxHp) * 100)) : 0;

  const ac = getFinalAcValue('CHARACTER');
  const classDcStr = getFinalProfValue('CHARACTER', 'CLASS_DC', true);
  const perceptionStr = getFinalProfValue('CHARACTER', 'PERCEPTION');
  const speed = getVariable<VariableNum>('CHARACTER', 'SPEED')?.value ?? 25;

  // Hero points (PF2e CRB caps at 3 — display as 3 diamond pips).
  const heroPoints = Math.max(
    0,
    Math.min(3, (character as { hero_points?: number } | null)?.hero_points ?? 0)
  );

  // Conditions list from the character entity.
  const conditions = character?.details?.conditions ?? [];

  // Languages from variables.
  const languages = getVariable<VariableListStr>('CHARACTER', 'LANGUAGES')?.value ?? [];

  // Senses (currently just low-light/darkvision flags lumped together — the
  // engine doesn't expose a clean enum for this. Worst case we render '—'.)
  const sensesVar = getVariable<VariableListStr>('CHARACTER', 'SENSES');
  const senses =
    sensesVar?.value && sensesVar.value.length > 0 ? sensesVar.value.join(', ') : '—';

  // Saves + perception list (used in the sidebar Save&Perception section).
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
      c
        ? {
            ...c,
            hp_temp: Math.max(0, isNaN(next) ? 0 : next),
          }
        : c
    );
  };

  const setHeroPoints = (next: number) => {
    const clamped = Math.max(0, Math.min(3, next));
    setCharacter((c) =>
      c
        ? {
            ...c,
            hero_points: clamped,
          }
        : c
    );
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

  // ---- Render ----

  return (
    <div className='codex-root codex-sheet-root'>
      <div className='codex-sheet-page'>
        {/* ============================ TOPBAR ============================ */}
        <div className='topbar'>
          <div className='who'>
            <div className='crest'>{initial}</div>
            <div className='label'>
              <div className='nm'>{character?.name?.toUpperCase() || 'UNNAMED'}</div>
              <div className='sub'>
                {ancestryName || '—'} <i>·</i> {className || '—'}
              </div>
            </div>
          </div>

          <div className='tabs'>
            {TABS.map((t) => (
              <div
                key={t.id}
                className={`tab ${activeTab === t.id ? 'on' : ''}`}
                onClick={() => setActiveTab(t.id)}
              >
                {t.label}
              </div>
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
                  <b>{xp}</b> / {XP_PER_LEVEL}
                </span>
              </div>
              <div className='bar'>
                <div className='fill' style={{ width: `${xpPct}%` }}></div>
              </div>
            </div>
            <AddXpForm onAdd={addXp} />
            <div className='menu' title='Edit in Builder' onClick={() => navigate(`/builder/${props.characterId}`)}>
              <div className='lines'>
                <span></span>
                <span></span>
                <span></span>
              </div>
            </div>
          </div>
        </div>

        {/* ============================ BODY ============================ */}
        <div className='body'>
          {activeTab === 'main' ? (
            <>
              {/* ============ LEFT RAIL ============ */}
              <div className='col left'>
                {/* Vitals */}
                <section className='sec'>
                  <div className='sec-title compact'>
                    <span className='lozenge'>♥</span>
                    <span className='label'>Vitals</span>
                  </div>
                  <div className='sec-body'>
                    <div className='vitals'>
                      <div
                        className='vital hp span2'
                        style={{ cursor: 'pointer' }}
                        onClick={() => openDrawer({ type: 'stat-hp', data: { id: 'CHARACTER' }, extra: { addToHistory: true } })}
                      >
                        <div className='hp-row'>
                          <div>
                            <div className='label'>Hit Points</div>
                            <div className='num'>
                              <HpInput value={currentHp} onChange={onHpChange} />
                              {' '}
                              <small>/ {maxHp}</small>
                            </div>
                          </div>
                          <div
                            className='temp-hp'
                            title='Temporary HP'
                            onClick={(e) => e.stopPropagation()}
                          >
                            <div className='label'>Temp</div>
                            <div className='v'>
                              <input
                                type='number'
                                min={0}
                                value={tempHp}
                                onChange={(e) => onTempHpChange(parseInt(e.target.value, 10))}
                              />
                            </div>
                          </div>
                        </div>
                        <div className='hpbar'>
                          <div className='fill' style={{ right: `${100 - hpPct}%` }}></div>
                        </div>
                      </div>
                      <div
                        className='vital'
                        style={{ cursor: 'pointer' }}
                        onClick={() => openDrawer({ type: 'stat-ac', data: { id: 'CHARACTER' }, extra: { addToHistory: true } })}
                      >
                        <div className='label'>Armor</div>
                        <div className='num'>{ac}</div>
                      </div>
                      <div
                        className='vital'
                        style={{ cursor: 'pointer' }}
                        onClick={() =>
                          openDrawer({
                            type: 'stat-prof',
                            data: { id: 'CHARACTER', variableName: 'CLASS_DC', isDC: true },
                            extra: { addToHistory: true },
                          })
                        }
                      >
                        <div className='label'>Class DC</div>
                        <div className='num'>{classDcStr}</div>
                      </div>
                    </div>
                  </div>
                </section>

                {/* Speed & Senses */}
                <section className='sec'>
                  <div className='sec-title compact'>
                    <span className='lozenge'>➤</span>
                    <span className='label'>Speed &amp; Senses</span>
                  </div>
                  <div className='sec-body'>
                    <div className='stat-strip'>
                      <div
                        style={{ cursor: 'pointer' }}
                        onClick={() => openDrawer({ type: 'stat-speed', data: { id: 'CHARACTER' }, extra: { addToHistory: true } })}
                      >
                        <div className='k'>Speed</div>
                        <div className='v'>
                          {speed} <small>ft</small>
                        </div>
                      </div>
                      <div>
                        <div className='k'>Senses</div>
                        <div
                          className='v'
                          style={{ fontSize: 11, letterSpacing: '.12em', paddingTop: 3 }}
                        >
                          {senses}
                        </div>
                      </div>
                    </div>
                  </div>
                </section>

                {/* Hero Points */}
                <section className='sec'>
                  <div className='sec-title compact'>
                    <span className='lozenge'>★</span>
                    <span className='label'>Hero Points</span>
                    <span className='sub'>
                      <b>{heroPoints}</b> / 3
                    </span>
                  </div>
                  <div className='sec-body'>
                    <div className='hero-card'>
                      <div className='pips'>
                        {[0, 1, 2].map((i) => (
                          <div
                            key={i}
                            className={i < heroPoints ? 'pip full' : 'pip'}
                            onClick={() => {
                              // Clicking a full pip drops to its index;
                              // clicking an empty pip fills up through it.
                              if (i < heroPoints) setHeroPoints(i);
                              else setHeroPoints(i + 1);
                            }}
                          ></div>
                        ))}
                      </div>
                    </div>
                  </div>
                </section>

                {/* Saves + Perception */}
                <section className='sec'>
                  <div className='sec-title compact'>
                    <span className='lozenge'>✠</span>
                    <span className='label'>Saves &amp; Perception</span>
                  </div>
                  <div className='sec-body'>
                    {saves.map((s) => {
                      const v = getVariable<VariableProf>('CHARACTER', s.var);
                      const profLetter = v ? compileProficiencyType(v.value) : 'U';
                      const value = getFinalProfValue('CHARACTER', s.var);
                      const profDisplay =
                        profLetter === 'U'
                          ? 'untrained'
                          : profLetter === 'T'
                            ? 'trained'
                            : profLetter === 'E'
                              ? 'expert'
                              : profLetter === 'M'
                                ? 'master'
                                : 'legendary';
                      return (
                        <div
                          key={s.var}
                          className='save-row'
                          style={{ cursor: 'pointer' }}
                          onClick={() =>
                            openDrawer({
                              type: s.var === 'PERCEPTION' ? 'stat-perception' : 'stat-prof',
                              data: { id: 'CHARACTER', variableName: s.var },
                              extra: { addToHistory: true },
                            })
                          }
                        >
                          <span className='lbl'>{s.label}</span>
                          <span className='prof'>{profDisplay}</span>
                          <span className='val'>{value}</span>
                        </div>
                      );
                    })}
                  </div>
                </section>

                {/* Conditions */}
                <section className='sec'>
                  <div className='sec-title compact'>
                    <span className='lozenge'>✤</span>
                    <span className='label'>Conditions</span>
                    {conditions.length > 0 && (
                      <span className='sub'>
                        <b>{conditions.length}</b> active
                      </span>
                    )}
                  </div>
                  <div className='sec-body'>
                    <div className='cond-row'>
                      {conditions.map((cond) => (
                        <span key={cond.name} className='cond'>
                          {cond.name}
                          {cond.value != null && cond.value > 0 ? ` ${cond.value}` : ''}
                          <span
                            className='x'
                            onClick={(e) => {
                              e.stopPropagation();
                              removeCondition(cond.name);
                            }}
                          >
                            ✕
                          </span>
                        </span>
                      ))}
                      <span
                        className='cond add'
                        onClick={() =>
                          openDrawer({
                            type: 'condition',
                            data: { id: 'CHARACTER' },
                            extra: { addToHistory: true },
                          })
                        }
                        style={{ cursor: 'pointer' }}
                      >
                        + add
                      </span>
                    </div>
                  </div>
                </section>

                {/* Languages */}
                <section className='sec'>
                  <div className='sec-title compact'>
                    <span className='lozenge'>❡</span>
                    <span className='label'>Languages</span>
                  </div>
                  <div className='sec-body'>
                    <div className='lang-list'>
                      {languages.length > 0 ? (
                        languages.map((l) => (
                          <span key={l} className='lang'>
                            {l}
                          </span>
                        ))
                      ) : (
                        <span style={{ color: 'var(--ink-muted)', fontStyle: 'italic', fontSize: 12 }}>
                          None
                        </span>
                      )}
                    </div>
                  </div>
                </section>
              </div>

              {/* ============ MAIN ============ */}
              <div className='col main'>
                {/* Abilities & Skills */}
                <section className='sec'>
                  <div className='sec-title'>
                    <span className='lozenge'>✦</span>
                    <span className='label'>Abilities &amp; Skills</span>
                    <span className='sub'>
                      Key ·{' '}
                      <b>
                        {keyAttribute ? keyAttribute.replace('ATTRIBUTE_', '').slice(0, 3) : '—'}
                      </b>{' '}
                      · T E M L
                    </span>
                  </div>
                  <div className='sec-body'>
                    <div className='ab-sk'>
                      <div className='abilities'>
                        {ABILITIES.map((a) => {
                          const v = getVariable<VariableAttr>('CHARACTER', a.var);
                          const mod = v?.value?.value ?? 0;
                          const score = 10 + mod * 2;
                          const isKey = keyAttribute === a.var;
                          return (
                            <div
                              key={a.var}
                              className={`ab ${isKey ? 'key' : ''}`}
                              style={{ cursor: 'pointer' }}
                              onClick={() =>
                                openDrawer({
                                  type: 'stat-attr',
                                  data: { id: 'CHARACTER', variableName: a.var },
                                  extra: { addToHistory: true },
                                })
                              }
                            >
                              <div className='glyph'>{a.glyph}</div>
                              <div className='mod'>{sign(mod)}</div>
                              <div className='score'>{score}</div>
                            </div>
                          );
                        })}
                      </div>
                      <div className='skills'>
                        {BASE_SKILLS.map((s) => {
                          const v = getVariable<VariableProf>('CHARACTER', s.var);
                          const profLetter = v ? compileProficiencyType(v.value) : 'U';
                          const value = getFinalProfValue('CHARACTER', s.var);
                          return (
                            <div
                              key={s.var}
                              className='sk'
                              style={{ cursor: 'pointer' }}
                              onClick={() =>
                                openDrawer({
                                  type: 'stat-prof',
                                  data: { id: 'CHARACTER', variableName: s.var },
                                  extra: { addToHistory: true },
                                })
                              }
                            >
                              <span className={`pf ${profLetter}`}>{profLetter !== 'U' ? profLetter : ' '}</span>
                              <span className='nm'>{s.name}</span>
                              <span className='leader'></span>
                              <span className='v'>{value}</span>
                            </div>
                          );
                        })}
                        {/* Lore skills — discover dynamically from variables.
                            Lore variable names look like SKILL_LORE_<TOPIC>. */}
                        {discoverLoreSkills().map((lore) => {
                          const v = getVariable<VariableProf>('CHARACTER', lore.var);
                          const profLetter = v ? compileProficiencyType(v.value) : 'U';
                          const value = getFinalProfValue('CHARACTER', lore.var);
                          return (
                            <div
                              key={lore.var}
                              className='sk'
                              style={{ cursor: 'pointer' }}
                              onClick={() =>
                                openDrawer({
                                  type: 'stat-prof',
                                  data: { id: 'CHARACTER', variableName: lore.var },
                                  extra: { addToHistory: true },
                                })
                              }
                            >
                              <span className={`pf ${profLetter}`}>{profLetter}</span>
                              <span className='nm'>
                                Lore <em>· {lore.topic}</em>
                              </span>
                              <span className='leader'></span>
                              <span className='v'>{value}</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </section>

                {/* Skills & Actions panel from the existing engine.
                    Surfaces strikes / actions / activities — wired to
                    the real character data. The codex bridge themes
                    its Mantine internals so it visually fits the page. */}
                <section className='sec'>
                  <div className='sec-title'>
                    <span className='lozenge'>⚔</span>
                    <span className='label'>Actions &amp; Activities</span>
                    <span className='sub'>strikes · actions · modes</span>
                  </div>
                  <div className='sec-body codex-embed'>
                    <SkillsActionsPanel
                      id='CHARACTER'
                      panelHeight={props.panelHeight}
                      panelWidth={props.panelWidth}
                      content={content}
                      entity={character}
                      setEntity={setCharacter as unknown as SetterOrUpdater<LivingEntity | null>}
                    />
                  </div>
                </section>
              </div>
            </>
          ) : (
            // Non-main tabs: render the existing sub-panel components
            // full-width inside .codex-tab-body. They use Mantine but
            // are rethemed by the codex-bridge.css overrides.
            <div className='codex-tab-body'>
              {activeTab === 'spells' && (
                <SpellsPanel
                  id='CHARACTER'
                  panelHeight={props.panelHeight}
                  panelWidth={props.panelWidth}
                  entity={character}
                  setEntity={setCharacter as unknown as SetterOrUpdater<LivingEntity | null>}
                />
              )}
              {activeTab === 'inventory' && (
                <InventoryPanel
                  id='CHARACTER'
                  panelHeight={props.panelHeight}
                  panelWidth={props.panelWidth}
                  content={content}
                  entity={character}
                  setEntity={setCharacter as unknown as SetterOrUpdater<LivingEntity | null>}
                />
              )}
              {activeTab === 'feats' && (
                <FeatsFeaturesPanel panelHeight={props.panelHeight} panelWidth={props.panelWidth} />
              )}
              {activeTab === 'companions' && (
                <CompanionsPanel panelHeight={props.panelHeight} panelWidth={props.panelWidth} />
              )}
              {activeTab === 'notes' && (
                <NotesPanel
                  panelHeight={props.panelHeight}
                  panelWidth={props.panelWidth}
                  entity={character}
                  setEntity={setCharacter as unknown as SetterOrUpdater<LivingEntity | null>}
                />
              )}
              {activeTab === 'details' && (
                <DetailsPanel
                  content={content}
                  panelHeight={props.panelHeight}
                  panelWidth={props.panelWidth}
                />
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// --- Helper sub-components -------------------------------------------------

/**
 * HP value input wrapped to look like the codex .vital.hp .num.
 * Renders as a non-editable display by default; clicking turns it
 * into an inline input. The parent handles confirmHealth via onChange.
 */
function HpInput(props: { value: number; onChange: (next: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(`${props.value}`);

  if (!editing) {
    return (
      <span
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
      style={{
        width: 60,
        background: 'transparent',
        border: 0,
        outline: 0,
        color: 'inherit',
        font: 'inherit',
        padding: 0,
      }}
      onClick={(e) => e.stopPropagation()}
    />
  );
}

/**
 * XP add form: small inline input + submit button. The codex aesthetic
 * is a thin gold-rule rectangle; styled by .add-xp in codex.css.
 */
function AddXpForm(props: { onAdd: (amount: number) => void }) {
  const [val, setVal] = useState('');
  return (
    <form
      className='add-xp'
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
      <span className='glyph'>+</span>
      <input
        type='number'
        min={0}
        placeholder='XP'
        value={val}
        onChange={(e) => setVal(e.target.value)}
      />
      <button type='submit' title='Add to total'>
        ▸
      </button>
    </form>
  );
}

/**
 * Pull lore skills from the variable store. Each character can have
 * arbitrarily many — we scan for variable names starting with
 * SKILL_LORE_ and humanize the topic suffix.
 *
 * The variable manager doesn't expose a list method, so we cheat: peek
 * at the global store's window-exposed handle if available, else fall
 * back to empty. The result is sorted alphabetically.
 */
function discoverLoreSkills(): { var: string; topic: string }[] {
  try {
    // The variable system stores everything under a per-id store. Try
    // calling getVariable with each candidate name from the known
    // skill seed list, but for lore we don't know the names ahead of
    // time. Use the underlying map if exposed.
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
