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
import { useState, useEffect } from 'react';
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
import { confirmHealth, handleRest } from './entity-handler';
import { showNotification } from '@mantine/notifications';
import CompanionsPanel from './panels/CompanionsPanel';
// The legacy Mantine-based DetailsPanel / NotesPanel are no longer
// referenced — replaced by CodexDetailsPanel / CodexNotesPanel which
// render directly into the codex .body grid as two sibling .col divs.
// Keeping the panels/ files on disk for now; they ship 0 KB into the
// bundle once nothing imports them.
import { CodexSpellsPanel, CodexInventoryPanel, CodexFeatsPanel, CodexActivitiesPanel } from './CodexPanels';
import { CodexNotesPanel } from './CodexNotesPanel';
import { CodexDetailsPanel } from './CodexDetailsPanel';
import ConditionsModesModal, { HARMFUL_CONDITIONS, ConditionDescription } from './ConditionsModesModal';
import { getAllConditions } from '@conditions/condition-handler';
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
  // Sidebar action buttons — Modes / Campaign / Dice Roller. The
  // legacy CharacterSheetPage renders them as floating bottom-left
  // anchored buttons; we accept them as a render prop so the sheet's
  // sidebar can host them at the bottom instead.
  sidebarActions?: React.ReactNode;
}) {
  const { character, setCharacter, content } = props;
  const navigate = useNavigate();
  const [_drawer, openDrawer] = useAtom(drawerState);
  const [activeTab, setActiveTab] = useState<CodexTab>('main');

  // Global section collapse with smooth height animation. Strategy:
  //   1. To OPEN: set max-height to scrollHeight (animates from 0 → N),
  //      then after the transition set max-height: 'none' so future
  //      content size changes don't get clipped.
  //   2. To CLOSE: set max-height to the measured scrollHeight first
  //      (so the browser has a concrete value to animate from), force
  //      a reflow, then set max-height: 0 and add .collapsed class.
  //
  // Ignores clicks on nested interactive elements so editing HP,
  // clicking hero pips, pressing the + Add condition button, etc.
  // don't collapse the section under them.
  useEffect(() => {
    const handler = (e: Event) => {
      const t = e.target as HTMLElement;
      const title = t.closest('.sec-title');
      if (!title) return;
      if (
        t.closest(
          'input, button, textarea, select, a, .pip, .fp, .dot-pip, .x, .cond .x, [data-no-collapse]'
        )
      ) {
        return;
      }
      const sec = title.closest<HTMLElement>('.sec');
      if (!sec) return;
      const body = sec.querySelector<HTMLElement>(':scope > .sec-body');
      if (!body) return;

      const isCollapsed = sec.classList.contains('collapsed');
      if (isCollapsed) {
        // OPEN: animate 0 → measured height, then drop the cap.
        sec.classList.remove('collapsed');
        body.style.maxHeight = body.scrollHeight + 'px';
        const onEnd = () => {
          if (!sec.classList.contains('collapsed')) {
            body.style.maxHeight = 'none';
          }
          body.removeEventListener('transitionend', onEnd);
        };
        body.addEventListener('transitionend', onEnd);
      } else {
        // CLOSE: set explicit max-height first so the transition has
        // a concrete value to animate from, then force reflow + drop.
        body.style.maxHeight = body.scrollHeight + 'px';
        // Force reflow — read offsetHeight to flush layout.
        void body.offsetHeight;
        sec.classList.add('collapsed');
        body.style.maxHeight = '0px';
      }
    };
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, []);

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
  const spellDcStr = getFinalProfValue('CHARACTER', 'SPELL_DC', true);
  // When Class DC and Spell DC come out to the same number (very
  // common for casters whose key attribute drives both), collapse
  // the two tiles into one labeled "Class/Spell DC" so the vitals
  // grid doesn't repeat the same value side-by-side.
  const dcMerged = classDcStr === spellDcStr;
  // Spell attack — render the base + iterative penalties (-5 / -10).
  // PF2e's multi-attack penalty applies on the 2nd and 3rd action
  // in a turn; showing all three saves the player the mental math
  // when picking which Strike / spell-attack to take.
  const spellAtkRaw = getFinalProfValue('CHARACTER', 'SPELL_ATTACK');
  // getFinalProfValue returns e.g. "+11"; parse to apply penalties.
  const spellAtkBase = parseInt(spellAtkRaw, 10);
  const spellAtkStr = isNaN(spellAtkBase)
    ? spellAtkRaw
    : `${spellAtkBase >= 0 ? '+' : ''}${spellAtkBase}/${spellAtkBase - 5 >= 0 ? '+' : ''}${spellAtkBase - 5}/${spellAtkBase - 10 >= 0 ? '+' : ''}${spellAtkBase - 10}`;
  const perceptionStr = getFinalProfValue('CHARACTER', 'PERCEPTION');
  const speed = getVariable<VariableNum>('CHARACTER', 'SPEED')?.value ?? 25;
  // Show the spell tiles only when the character actually has
  // spellcasting (otherwise +0 / 10 is just noise).
  const hasSpellcasting =
    !!getVariable<VariableProf>('CHARACTER', 'SPELL_DC')?.value &&
    compileProficiencyType(getVariable<VariableProf>('CHARACTER', 'SPELL_DC')?.value) !== 'U';

  // Hero points (PF2e CRB caps at 3 — display as 3 diamond pips).
  const heroPoints = Math.max(
    0,
    Math.min(3, (character as { hero_points?: number } | null)?.hero_points ?? 0)
  );

  // Conditions list from the character entity.
  const conditions = character?.details?.conditions ?? [];

  // Languages — variable is LANGUAGE_NAMES (a string list). The
  // entries are already proper names ("Common", "Elven", "Sylvan"…)
  // so we render them as-is.
  const languages =
    getVariable<VariableListStr>('CHARACTER', 'LANGUAGE_NAMES')?.value ?? [];

  // Senses are split into precise / imprecise / vague variables in
  // the engine. We concatenate the unique non-default ones for the
  // display (NORMAL_VISION/HEARING/SMELL are universal defaults so
  // we skip them). Each chip is clickable — opens the matching
  // sense drawer by name.
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

  // Direct-set the XP value (from the click-to-edit input). Unlike
  // addXp this is a raw assignment — the user typed an exact number
  // and we trust it. We still clamp to >= 0 and walk into the next
  // level if the input overshoots the per-level cap so the level/xp
  // pair stays consistent.
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

  // Bump a condition's numeric value up or down. Conditions without a
  // value never call this — only the -/+ buttons rendered next to
  // value-bearing chips do. Clamps at 1 (going below removes the
  // condition entirely so the player doesn't get stuck with a stale
  // 0-value entry). The condition-handler's compiledConditions()
  // already re-derives cascading effects on the next recompile.
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

  // The Conditions + Modes modal opens from the vitals "+ add" chip
  // (and there's no separate Modes button anymore — modes are a tab
  // inside the same modal). Stored as local UI state so it doesn't
  // need to round-trip through the drawer system.
  const [cmModalOpen, setCmModalOpen] = useState(false);
  // Condition description popover state. Opened by clicking the chip
  // body in the vitals (separate from the +-/x controls).
  const [showCondDesc, setShowCondDesc] = useState<{ name: string; description: string } | null>(null);

  // ---- Render ----

  return (
    <div className='codex-root codex-sheet-root'>
      <div className='codex-sheet-page'>
        {/* ============================ WINBAR ============================
            Styled title-bar strip mimicking the codex design's window
            chrome. The functional min/max/close are still rendered by
            Electron's titleBarOverlay above this (32 px) — this strip
            is the labeled band right beneath it, showing brand on the
            left and character info in the center. No functional
            buttons inside; the OS overlay handles those. */}
        <div className='winbar'>
          <div className='title'>
            <span className='dot'></span>
            <span>
              <b>Wanderer's Codex</b> · Character Sheet
            </span>
          </div>
          <div className='center'>
            {character?.name || 'Unknown'}
            {ancestryName && (
              <>
                {' '}
                <b>·</b> {ancestryName}
              </>
            )}
            {className && (
              <>
                {' '}
                <b>·</b> {className}
              </>
            )}
            {level && (
              <>
                {' '}
                <b>·</b> Level {level}
              </>
            )}
          </div>
          <WinButtons />
        </div>

        {/* ============================ TOPBAR ============================ */}
        <div className='topbar'>
          <div className='who'>
            <div className='crest'>{initial}</div>
            <div className='label'>
              <div className='nm'>{character?.name?.toUpperCase() || 'UNNAMED'}</div>
              {/* Class line + inline Rest button — user explicitly
                  marked the position next to "ANCESTRY · CLASS" so the
                  Rest control rides shotgun on the same row instead of
                  hanging off to the right of the .who block. Same
                  handleRest flow — heals HP, refunds focus/spell slots,
                  refreshes daily-use items, drops Fatigued, decrements
                  Drained/Doomed. */}
              <div className='sub'>
                {ancestryName || '—'} <i>·</i> {className || '—'}
                <button
                  type='button'
                  className='rest-btn-compact'
                  title='Take a Rest (recover HP, refill slots, refresh daily items)'
                  onClick={() => {
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
                  }}
                >
                  <span className='rest-icon'>☾</span>
                  <span>Rest</span>
                </button>
              </div>
            </div>
          </div>

          <div
            className='tabs'
            onWheel={(e) => {
              // Convert vertical wheel motion to horizontal scroll on
              // the tab strip — mice with no horizontal-scroll wheel
              // still let the user reach off-screen tabs by scrolling
              // up/down. Only intercept when deltaY is the dominant
              // axis; if the user is using a trackpad or horizontal
              // mouse, leave their natural horizontal delta alone.
              const el = e.currentTarget;
              if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
                el.scrollLeft += e.deltaY;
              }
            }}
          >
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
                  <XpValueInput value={xp} onChange={setXp} />
                  {' / '}
                  {XP_PER_LEVEL}
                </span>
              </div>
              <div className='bar'>
                <div className='fill' style={{ width: `${xpPct}%` }}></div>
              </div>
            </div>
            <AddXpForm onAdd={addXp} />
            {/* Hamburger menu — opens the nav dropdown (Characters,
                Homebrew, Settings) + Edit in Builder shortcut. */}
            <CodexNavMenu characterId={props.characterId} navigate={navigate} />
          </div>
        </div>

        {/* ============================ BODY ============================ */}
        {/* The body modifier class re-templates the grid: Notes adds
            a middle 280px page list; Details swaps the right 1fr for
            a 320px origins/proficiencies rail. All other tabs keep
            the default 224px + 1fr grid from codex.css. */}
        <div
          className={`body${activeTab === 'notes' ? ' body--notes' : activeTab === 'details' ? ' body--details' : ''}`}
        >
          {/* ============ LEFT RAIL (persistent across all tabs) ============ */}
          <div className='col left'>
            {/* Vitals — 5 tiles: HP (span-2), Class DC, Spell DC, Armor,
                Spell Atk. Spell tiles only render when the character
                actually casts (avoids surfacing meaningless +0 / 10
                for non-casters). Layout matches the updated codex
                main mockup. */}
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
                  {/* Class DC + Spell DC — when they match (common for
                      casters), render one merged tile; otherwise two
                      separate tiles so the player sees the breakdown. */}
                  {hasSpellcasting && dcMerged ? (
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
                      <div className='label'>Class/Spell DC</div>
                      <div className='num'>{classDcStr}</div>
                    </div>
                  ) : (
                    <>
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
                      {hasSpellcasting && (
                        <div
                          className='vital'
                          style={{ cursor: 'pointer' }}
                          onClick={() =>
                            openDrawer({
                              type: 'stat-prof',
                              data: { id: 'CHARACTER', variableName: 'SPELL_DC', isDC: true },
                              extra: { addToHistory: true },
                            })
                          }
                        >
                          <div className='label'>Spell DC</div>
                          <div className='num'>{spellDcStr}</div>
                        </div>
                      )}
                    </>
                  )}
                  <div
                    className='vital'
                    style={{ cursor: 'pointer' }}
                    onClick={() => openDrawer({ type: 'stat-ac', data: { id: 'CHARACTER' }, extra: { addToHistory: true } })}
                  >
                    <div className='label'>Armor</div>
                    <div className='num'>{ac}</div>
                  </div>
                  {hasSpellcasting && (
                    <div
                      className='vital'
                      style={{ cursor: 'pointer' }}
                      title='Spell attack — base / MAP -5 / MAP -10'
                      onClick={() =>
                        openDrawer({
                          type: 'stat-prof',
                          data: { id: 'CHARACTER', variableName: 'SPELL_ATTACK' },
                          extra: { addToHistory: true },
                        })
                      }
                    >
                      <div className='label'>Spell Atk</div>
                      {/* 3-value iterative MAP display. Smaller font so
                          three signed numbers fit in the tile. */}
                      <div
                        className='num'
                        style={{
                          fontSize: 14,
                          letterSpacing: '.02em',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {spellAtkStr}
                      </div>
                    </div>
                  )}
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
                          style={{
                            fontSize: 11,
                            letterSpacing: '.04em',
                            paddingTop: 3,
                            display: 'flex',
                            flexWrap: 'wrap',
                            gap: 4,
                          }}
                        >
                          {sensesItems.length === 0 ? (
                            <span style={{ color: 'var(--ink-muted)' }}>—</span>
                          ) : (
                            sensesItems.map((s) => (
                              <span
                                key={s.raw}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  openDrawer({
                                    type: 'sense',
                                    data: { name: s.display, id: undefined },
                                    extra: { addToHistory: true },
                                  });
                                }}
                                style={{
                                  cursor: 'pointer',
                                  color: 'var(--ink)',
                                  borderBottom: '1px dotted var(--gold-deep)',
                                  paddingBottom: 1,
                                }}
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
                      {conditions.map((cond) => {
                        const hasValue = cond.value != null && cond.value > 0;
                        const harmful = HARMFUL_CONDITIONS.has(cond.name);
                        return (
                          <span
                            key={cond.name}
                            className={`cond${harmful ? ' harmful' : ''}`}
                            onClick={(e) => {
                              // Click the chip body (not -/+/x) → show
                              // full description in a small popover.
                              e.stopPropagation();
                              setShowCondDesc({
                                name: cond.name,
                                description: cond.description || '',
                              });
                            }}
                            style={{ cursor: 'pointer' }}
                            title='Click for full description'
                          >
                            {cond.name}
                            {hasValue && (
                              <>
                                <button
                                  type='button'
                                  className='step'
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    adjustConditionValue(cond.name, -1);
                                  }}
                                  aria-label='Decrease value'
                                  title='Decrease value (removes at 0)'
                                >
                                  −
                                </button>
                                <span className='val'>{cond.value}</span>
                                <button
                                  type='button'
                                  className='step'
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    adjustConditionValue(cond.name, +1);
                                  }}
                                  aria-label='Increase value'
                                  title='Increase value'
                                >
                                  +
                                </button>
                              </>
                            )}
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
                        );
                      })}
                      <span
                        className='cond add'
                        onClick={() => setCmModalOpen(true)}
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

                {/* Rest button moved to the topbar's .who block
                    (next to the character name). The old section
                    here was crowding the vitals column. */}

                {/* Sidebar action bar — Campaign / Dice. */}
                {props.sidebarActions && (
                  <div className='sidebar-actions'>{props.sidebarActions}</div>
                )}
              </div>

          {/* ============ MAIN (only on Main tab) ============ */}
          {activeTab === 'main' && (
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
                              <span className={`pf ${profLetter}`}>{profLetter}</span>
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

                {/* Favorites — quick-access to anything the player has
                    starred (feats, items, spells, actions, etc.) from
                    any drawer's bottom-left star button. Sits between
                    Abilities & Skills and Activities per request, so
                    it's at the top of the action-y portion of the
                    page. Hidden when no favorites yet to avoid clutter. */}
                <CodexFavorites
                  character={character}
                  setCharacter={setCharacter}
                  openDrawer={openDrawer as unknown as (next: unknown) => void}
                />

                {/* Activities — strikes (equipped weapons), universal/
                    exploration/downtime actions in three modes. Fully
                    codex-styled .act-grid / .act rows (no Mantine). */}
                <section className='sec'>
                  <div className='sec-title'>
                    <span className='lozenge'>⚔</span>
                    <span className='label'>Activities</span>
                    <span className='sub'>strikes &amp; actions in three modes</span>
                  </div>
                  <div className='sec-body'>
                    <CodexActivitiesPanel character={character} content={content} />
                  </div>
                </section>
              </div>
          )}

          {/* Non-main tabs: most panels render full-width inside
              .codex-tab-body, sitting next to the persistent left rail.
              Notes and Details are special — their mockups expect the
              .body grid to be 3-column (left + middle + right), so
              their codex panels return TWO sibling .col divs that
              slot directly into the body grid instead of being wrapped
              in .codex-tab-body. */}
          {activeTab !== 'main' && activeTab !== 'notes' && activeTab !== 'details' && (
            <div className='codex-tab-body'>
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
                <CompanionsPanel panelHeight={props.panelHeight} panelWidth={props.panelWidth} />
              )}
            </div>
          )}
          {activeTab === 'notes' && (
            <CodexNotesPanel
              character={character}
              setCharacter={setCharacter as unknown as SetterOrUpdater<LivingEntity | null>}
            />
          )}
          {activeTab === 'details' && (
            <CodexDetailsPanel
              character={character}
              setCharacter={setCharacter as unknown as SetterOrUpdater<LivingEntity | null>}
              content={content}
            />
          )}
        </div>
      </div>

      {/* Conditions + Modes modal — opens from the vitals "+ add"
          chip. Rendered at the sheet root so it floats above all
          tabs / drawers. */}
      <ConditionsModesModal
        opened={cmModalOpen}
        onClose={() => setCmModalOpen(false)}
        character={character}
        setCharacter={setCharacter}
        content={content}
      />

      {/* Condition description popover. Triggered by clicking a chip
          in the vitals condition row (not the -/+/x controls — those
          stop propagation). Reuses the same overlay styles as the
          modal's description popover for consistency. */}
      {showCondDesc && (
        <div
          className='cm-desc-overlay'
          onClick={() => setShowCondDesc(null)}
        >
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
 * Click-to-edit XP value. Displays the current XP in bold inline;
 * clicking it swaps for a number input that commits on blur or Enter.
 * The styling matches the surrounding `.xp .nums b` text so the
 * inline-edit experience is invisible — same font, same weight, same
 * width-ish (we cap the input width so the row layout doesn't jump
 * around as the user types).
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
 * Favorites — codex-styled quick-access section on the main tab.
 * Reads `meta_data.favorites` (saved via the drawer star button) and
 * renders each entry as a clickable row that reopens the source
 * drawer. Inv-items resolve through the inventory tree (including
 * nested containers); other types just reopen with `{id}`.
 *
 * Hidden when the favorites list is empty so it doesn't clutter the
 * page for new characters.
 */
function CodexFavorites(props: {
  character: Character | null;
  setCharacter: SetterOrUpdater<Character | null>;
  // The drawer-open atom setter. The strict type unifies poorly with
  // useAtom's inferred generic; we accept any callable here and trust
  // the call site to pass the right object shape.
  openDrawer: (next: unknown) => void;
}) {
  const { character, openDrawer } = props;
  const favs =
    (character?.meta_data as { favorites?: { type: string; id: number | string; name: string }[] } | undefined)
      ?.favorites ?? [];
  if (favs.length === 0) return null;
  return (
    <section className='sec'>
      <div className='sec-title'>
        <span className='lozenge'>★</span>
        <span className='label'>Favorites</span>
        <span className='sub'>
          <b>{favs.length}</b>
        </span>
      </div>
      <div className='sec-body'>
        <div className='act-grid'>
          {favs.map((fav) => (
            <div
              key={`${fav.type}-${fav.id}`}
              className='act'
              style={{ cursor: 'pointer' }}
              onClick={() => {
                if (fav.type === 'inv-item') {
                  // Resolve inv-item id back to the live InventoryItem.
                  // Walk containers too so an item inside a backpack
                  // still opens correctly.
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
                  type: fav.type as 'spell' | 'feat' | 'action' | 'item' | 'class-feature',
                  data: { id: fav.id },
                  extra: { addToHistory: true },
                });
              }}
            >
              <div className='nm'>{fav.name}</div>
              <div className='stat dim'>{labelizeFavType(fav.type)}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/** Human-readable label for a favorite's drawer type. Used as the
 *  trailing subtitle on each favorite row. */
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
    default: return type;
  }
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

/**
 * Custom min/max/close buttons for the codex winbar.
 *
 * Electron's titleBarOverlay is disabled in main.cjs so this codex-
 * styled strip is the only chrome at the top of the window. Each
 * button calls back into Electron through the wgElectron preload
 * bridge (window.wgElectron.window{Minimize,Maximize,Close}). The
 * outer .winbtns gets `-webkit-app-region: no-drag` from codex.css
 * so clicks don't get swallowed by the parent .winbar's drag region.
 *
 * The SVG paths match the codex mockup: dash for minimize, square
 * for maximize, X for close. On non-Electron environments
 * (window.wgElectron unavailable) the buttons are still rendered
 * but no-op gracefully.
 */
function WinButtons() {
  const w = (window as unknown as {
    wgElectron?: {
      windowMinimize?: () => void;
      windowMaximize?: () => void;
      windowClose?: () => void;
    };
  }).wgElectron;
  return (
    <div className='winbtns'>
      <div className='winbtn' title='Minimize' onClick={() => w?.windowMinimize?.()}>
        <svg viewBox='0 0 10 10'>
          <path d='M1 8 L9 8' />
        </svg>
      </div>
      <div className='winbtn' title='Maximize' onClick={() => w?.windowMaximize?.()}>
        <svg viewBox='0 0 10 10'>
          <path d='M1 1 L9 1 L9 9 L1 9 Z' />
        </svg>
      </div>
      <div className='winbtn close' title='Close' onClick={() => w?.windowClose?.()}>
        <svg viewBox='0 0 10 10'>
          <path d='M1 1 L9 9 M9 1 L1 9' />
        </svg>
      </div>
    </div>
  );
}

/**
 * Codex-styled hamburger menu in the topbar's right cluster.
 *
 * The visual shell is the codex `.menu` div (square gold-bordered
 * box with 3 horizontal lines). Mantine Menu.Target requires a ref-
 * forwarding element to inject its open/close click handler, but our
 * decorative div doesn't satisfy that — so we control the menu state
 * via useDisclosure and toggle it from a manual onClick. This is the
 * same pattern the import-character button uses on the Characters
 * page, where the Menu+Tooltip+ActionIcon double-wrapper broke
 * Mantine v9's automatic forwarding.
 *
 * The dropdown items navigate (no full reload) so route state stays
 * intact. Edit-in-Builder is the last entry — separated from the
 * nav items with a Divider since it's a sheet-specific shortcut
 * rather than a global navigation target.
 */
/**
 * Hamburger menu for the codex topbar's right cluster.
 *
 * Uses Mantine's UNCONTROLLED Menu mode. The previous controlled
 * implementation raced the Menu's clickOutsideEvent (which fires on
 * mousedown before our toggle ran on click), causing the menu to
 * reopen the moment the user tried to close it. Uncontrolled lets
 * Mantine own the open/close state — wrapping a Mantine `Box` (which
 * forwards refs cleanly to its DOM node) means Menu.Target can
 * inject its own click handler without us fighting it.
 *
 * The trigger keeps the codex `.menu` className so it visually
 * matches the design (gold-bordered square with 3 horizontal lines).
 */
/**
 * Hamburger nav menu — bare-metal native HTML implementation.
 *
 * The previous Mantine-based attempts (bare div / Box / UnstyledButton
 * / ActionIcon all wrapped in Menu.Target) all silently failed for
 * the user. Pressing the hamburger produced ZERO console output —
 * meaning the click event was never reaching the handler at all,
 * not even Mantine's internal one.
 *
 * Strategy here: zero Mantine wrapping for either the button or the
 * dropdown. Native `<button onClick>` (you can console.log it and
 * verify in DevTools); the dropdown is a positioned div inside a
 * relatively-positioned shell, closed via a document-level mousedown
 * listener. No ref forwarding, no clone, no portals, no transforms.
 * If THIS doesn't fire, the click is being eaten by an ancestor
 * (drag region, overlay) and we'll know exactly where to dig.
 */
function CodexNavMenu(props: {
  characterId: number;
  navigate: (path: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useState<HTMLDivElement | null>(null);
  // Track ref + outside-click listener.
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
    // ?tab=builder hint tells CharacterBuilderPage to open the
    // Builder step (not Home). Without it the user has to manually
    // click forward through Home → Builder every time.
    { label: 'Edit in Builder', path: `/builder/${props.characterId}?tab=builder`, divider: true },
  ];

  return (
    <div
      ref={containerRef}
      style={{ position: 'relative', display: 'flex', alignItems: 'center' }}
    >
      <button
        type='button'
        title='Menu'
        aria-label='Menu'
        aria-expanded={open}
        aria-haspopup='menu'
        onClick={(e) => {
          e.stopPropagation();
          // eslint-disable-next-line no-console
          console.log('[CodexNavMenu] hamburger clicked, open ->', !open);
          setOpen((o) => !o);
        }}
        style={{
          width: 38,
          height: 38,
          background: 'var(--bg-card)',
          border: '1px solid var(--rule-soft)',
          color: 'var(--gold)',
          cursor: 'pointer',
          padding: 0,
          display: 'grid',
          placeItems: 'center',
          // High z-index so nothing in the codex topbar covers it.
          position: 'relative',
          zIndex: 50,
        }}
      >
        <svg width={18} height={14} viewBox='0 0 18 14' aria-hidden='true'>
          <line x1='0' y1='1' x2='18' y2='1' stroke='currentColor' strokeWidth='1.6' />
          <line x1='0' y1='7' x2='18' y2='7' stroke='currentColor' strokeWidth='1.6' />
          <line x1='0' y1='13' x2='18' y2='13' stroke='currentColor' strokeWidth='1.6' />
        </svg>
      </button>
      {open && (
        <div
          role='menu'
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            right: 0,
            minWidth: 200,
            background: 'var(--bg-2)',
            border: '1px solid var(--rule)',
            boxShadow: '0 8px 20px rgba(0, 0, 0, 0.6)',
            zIndex: 9999,
            padding: '6px 0',
          }}
        >
          {items.map((item, i) => (
            <div key={item.path}>
              {item.divider && (
                <div
                  style={{
                    borderTop: '1px solid var(--rule-soft)',
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
                  color: 'var(--ink)',
                  fontFamily: "'Cormorant Garamond', serif",
                  fontSize: 14,
                  textAlign: 'left',
                  padding: '8px 14px',
                  cursor: 'pointer',
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.background =
                    'rgba(201, 161, 59, 0.10)';
                  (e.currentTarget as HTMLButtonElement).style.color =
                    'var(--gold-bright)';
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
                  (e.currentTarget as HTMLButtonElement).style.color = 'var(--ink)';
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
