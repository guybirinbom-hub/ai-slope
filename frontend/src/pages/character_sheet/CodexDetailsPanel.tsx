/**
 * CodexDetailsPanel — Details tab content for the codex character
 * sheet. Renders the dossier layout described in the wg4 reference
 * (D:\Inst\wg4\01-details1.png, 02-details1.png, 03-details1.png):
 *
 *   .col.main.codex-details        — Dossier hero (portrait + name +
 *                                    ELF · ROGUE · LEVEL 5 + chip
 *                                    pills), Vital Statistics field
 *                                    grid, Appearance, Personality,
 *                                    and Beliefs & Bonds (creed cell
 *                                    with rust left border).
 *   .col.right.codex-details-rail  — Origins (ancestry / background /
 *                                    class cards with sigil + label
 *                                    + value), Proficiencies (Attacks
 *                                    / Defenses / Spellcasting /
 *                                    Class with prof-letter badges),
 *                                    Traits & Size (trait pills row
 *                                    + size strip).
 *
 * Returns a React fragment with the two columns as siblings — the
 * parent CodexSheet body provides the .col.left rail and sets the
 * body--details 3-col grid. All field inputs write back through a
 * 200ms-debounced setCharacter so saves continue to flow through the
 * same character.details.info shape the legacy panel used.
 */

import { Character, ContentPackage, LivingEntity } from '@schemas/content';
import { drawerState } from '@atoms/navAtoms';
import { useAtom } from 'jotai';
import { useDebouncedState, useDidUpdate } from '@mantine/hooks';
import {
  getVariable,
  getAllAncestryTraitVariables,
  getAllWeaponGroupVariables,
  getAllWeaponVariables,
  getAllArmorGroupVariables,
  getAllArmorVariables,
} from '@variables/variable-manager';
import { compileProficiencyType, variableToLabel } from '@variables/variable-utils';
import { displayFinalProfValue } from '@variables/variable-display';
import {
  VariableListStr,
  VariableProf,
  VariableStr,
} from '@schemas/variables';
import { pluralize } from '@utils/strings';
import { SetterOrUpdater } from '@utils/type-fixing';
import { useMemo } from 'react';
import { useCollapsedSections } from './useCollapsedSections';

type DetailsInfo = NonNullable<NonNullable<Character['details']>['info']>;

export function CodexDetailsPanel(props: {
  character: Character | null;
  setCharacter: SetterOrUpdater<LivingEntity | null>;
  content: ContentPackage;
}) {
  const { character, setCharacter, content } = props;
  const [_drawer, openDrawer] = useAtom(drawerState);
  // Collapsible dossier sections — every <section className='sec'> with
  // a cd-sec-title header is toggled via this hook.
  const { isCollapsed, toggle: toggleCollapsed } = useCollapsedSections();

  const info = (character?.details?.info ?? {}) as DetailsInfo;

  // ============================================================
  // Debounced save — every field writes here; we flush at 200ms.
  // ============================================================
  const [debouncedInfo, setDebouncedInfo] = useDebouncedState<DetailsInfo | null>(
    null,
    200
  );
  useDidUpdate(() => {
    if (!character || !debouncedInfo) return;
    setCharacter({
      ...character,
      details: { ...character.details, info: debouncedInfo },
    } as LivingEntity);
  }, [debouncedInfo]);
  const updateInfo = (patch: Partial<DetailsInfo>) => {
    setDebouncedInfo({ ...info, ...patch } as DetailsInfo);
  };

  // ============================================================
  // Identity helpers — name, ancestry/background/class labels.
  // ============================================================
  const ancestryName = character?.details?.ancestry?.name ?? '';
  const backgroundName = character?.details?.background?.name ?? '';
  const className = character?.details?.class?.name ?? '';
  const level = character?.level ?? 1;
  const initial = (character?.name?.trim() || 'W')[0].toUpperCase();

  // Heritage name is stored in the HERITAGE_NAMES list variable
  // (populated by operation-runner when the player picks a heritage
  // from the ancestry). We display the first entry as a sub-line on
  // the ancestry card in the right rail.
  const heritageNames =
    getVariable<VariableListStr>('CHARACTER', 'HERITAGE_NAMES')?.value ?? [];
  const heritageLabel = heritageNames[0]
    ? heritageNames[0]
        .split(' ')
        .map((w) => w.charAt(0) + w.slice(1).toLowerCase())
        .join(' ')
    : '';

  // ============================================================
  // Languages, ancestry traits, size — for the right rail.
  // ============================================================
  const languages = useMemo(() => {
    const ids = getVariable<VariableListStr>('CHARACTER', 'LANGUAGE_IDS')?.value ?? [];
    return ids
      .map((langId) => content.languages?.find((l) => `${l.id}` === langId))
      .filter(Boolean);
  }, [content.languages]);

  const ancestryTraits = useMemo(() => {
    return getAllAncestryTraitVariables('CHARACTER')
      .map((v) => content.traits?.find((t) => t.id === v.value))
      .filter(Boolean);
  }, [content.traits]);

  const size = (getVariable<VariableStr>('CHARACTER', 'SIZE')?.value ?? 'MEDIUM').toString();
  const sizeLabel = size.charAt(0).toUpperCase() + size.slice(1).toLowerCase();
  const sizeFoot =
    sizeLabel === 'Medium'
      ? '5 ft × 5 ft · 1-square reach'
      : sizeLabel === 'Small'
        ? '5 ft × 5 ft · 1-square reach'
        : sizeLabel === 'Large'
          ? '10 ft × 10 ft · 2-square reach'
          : sizeLabel === 'Huge'
            ? '15 ft × 15 ft · 3-square reach'
            : sizeLabel === 'Tiny'
              ? '2.5 ft × 2.5 ft · 0-square reach'
              : '';

  // ============================================================
  // Proficiency tier resolver — returns the T/E/M/L/U letter for a
  // CHARACTER variable. Used by the right-rail prof rows so each one
  // can light its prof-letter badge.
  // ============================================================
  const profType = (variableName: string): 'T' | 'E' | 'M' | 'L' | 'U' => {
    const v = getVariable<VariableProf>('CHARACTER', variableName)?.value;
    const t = compileProficiencyType(v);
    if (t === 'T' || t === 'E' || t === 'M' || t === 'L') return t;
    return 'U';
  };

  const weaponProfs = useMemo(
    () =>
      getAllWeaponVariables('CHARACTER').filter(
        (p) => compileProficiencyType(p.value) !== 'U'
      ),
    []
  );
  const weaponGroupProfs = useMemo(
    () =>
      getAllWeaponGroupVariables('CHARACTER').filter(
        (p) => compileProficiencyType(p.value) !== 'U'
      ),
    []
  );
  const armorProfs = useMemo(
    () =>
      getAllArmorVariables('CHARACTER').filter(
        (p) => compileProficiencyType(p.value) !== 'U'
      ),
    []
  );
  const armorGroupProfs = useMemo(
    () =>
      getAllArmorGroupVariables('CHARACTER').filter(
        (p) => compileProficiencyType(p.value) !== 'U'
      ),
    []
  );

  // Spellcasting only shows when the character actually has at least
  // one non-Untrained spell attack or DC proficiency.
  const hasSpellcasting =
    profType('SPELL_DC') !== 'U' || profType('SPELL_ATTACK') !== 'U';

  // ============================================================
  // Inline render helpers
  // ============================================================
  // A single vital-stats field — uppercase letter-spaced label on
  // top, italic Newsreader input below with hairline underline.
  const Field = (p: {
    label: string;
    value: string | undefined;
    onChange: (v: string) => void;
    placeholder?: string;
  }) => (
    <div className='cd-field'>
      <label className='cd-field-lbl'>{p.label}</label>
      <input
        className='cd-field-input'
        type='text'
        value={p.value ?? ''}
        placeholder={p.placeholder ?? '—'}
        onChange={(e) => p.onChange(e.target.value)}
      />
    </div>
  );

  // A row in a proficiency group — name on the left, tier badge on
  // the right, optional numeric value. Clicking opens the stat-prof
  // drawer so the user can audit the breakdown.
  const ProfRow = (p: {
    label: string;
    em?: string;
    variableName: string;
    showVal?: boolean;
    isDC?: boolean;
  }) => {
    const tier = profType(p.variableName);
    const val = p.showVal ? displayFinalProfValue('CHARACTER', p.variableName, p.isDC) : null;
    return (
      <div
        className='cd-prof-row'
        onClick={() =>
          openDrawer({
            type: 'stat-prof',
            data: { id: 'CHARACTER', variableName: p.variableName, isDC: p.isDC },
            extra: { addToHistory: true },
          })
        }
      >
        <span className='cd-prof-k'>
          {p.label}
          {p.em && (
            <>
              {' '}
              <em>· {p.em}</em>
            </>
          )}
        </span>
        {val != null && <span className='cd-prof-v num'>{val}</span>}
        <span className='prof' data-r={tier}>{tier}</span>
      </div>
    );
  };

  return (
    <>
      {/* ============ CENTER — Dossier ============ */}
      <div className='col main codex-details'>
        {/* IDENTITY HERO — portrait card + name + sub-line + chip pills */}
        <section className='sec cd-hero'>
          <div className='cd-hero-grid'>
            <div className='cd-portrait'>
              {character?.details?.image_url ? (
                <img
                  className='cd-portrait-img'
                  src={character.details.image_url}
                  alt={character?.name ?? ''}
                />
              ) : (
                <span className='cd-portrait-mono'>{initial}</span>
              )}
              <span className='cd-portrait-pose'>Portrait</span>
            </div>
            <div className='cd-id'>
              <div className='cd-eyebrow'>+ Wanderer's Dossier</div>
              <h2 className='cd-name'>{character?.name || 'Unnamed'}</h2>
              <div className='cd-sub'>
                {(ancestryName || '—').toUpperCase()}
                <i> · </i>
                {(className || '—').toUpperCase()}
                <i> · </i>
                LEVEL {level}
              </div>
              <div className='cd-chips'>
                {info.pronouns && <span className='cd-chip'>{info.pronouns}</span>}
                {info.alignment && <span className='cd-chip'>{info.alignment}</span>}
                {heritageLabel && <span className='cd-chip'>{heritageLabel}</span>}
              </div>
            </div>
          </div>
        </section>

        {/* VITAL STATISTICS */}
        <section className={`sec${isCollapsed('details-vital') ? ' collapsed' : ''}`}>
          <div className='sec-title cd-sec-title' onClick={() => toggleCollapsed('details-vital')}>
            <div className='label'>
              <span className='lz'>§</span>Vital Statistics
              <span className='sec-chevron'>▾</span>
            </div>
            <span className='cd-sec-sub' onClick={(e) => e.stopPropagation()}>edit any field</span>
          </div>
          <div className='sec-body cd-sec-body'>
            <div className='cd-field-grid'>
              <Field
                label='Age'
                value={info.age}
                placeholder='128 years'
                onChange={(v) => updateInfo({ age: v })}
              />
              <Field
                label='Height'
                value={info.height}
                placeholder={`5' 9"`}
                onChange={(v) => updateInfo({ height: v })}
              />
              <Field
                label='Weight'
                value={info.weight}
                placeholder='132 lbs'
                onChange={(v) => updateInfo({ weight: v })}
              />
              <Field
                label='Gender'
                value={info.gender}
                placeholder='—'
                onChange={(v) => updateInfo({ gender: v })}
              />
              <Field
                label='Pronouns'
                value={info.pronouns}
                placeholder='She / Her'
                onChange={(v) => updateInfo({ pronouns: v })}
              />
              <Field
                label='Ethnicity'
                value={info.ethnicity}
                placeholder='—'
                onChange={(v) => updateInfo({ ethnicity: v })}
              />
              <Field
                label='Nationality'
                value={info.nationality}
                placeholder='—'
                onChange={(v) => updateInfo({ nationality: v })}
              />
              <Field
                label='Birthplace'
                value={info.birthplace}
                placeholder='—'
                onChange={(v) => updateInfo({ birthplace: v })}
              />
              <Field
                label='Alignment'
                value={info.alignment}
                placeholder='Neutral Good'
                onChange={(v) => updateInfo({ alignment: v })}
              />
            </div>
          </div>
        </section>

        {/* APPEARANCE */}
        <section className={`sec${isCollapsed('details-appearance') ? ' collapsed' : ''}`}>
          <div className='sec-title cd-sec-title' onClick={() => toggleCollapsed('details-appearance')}>
            <div className='label'>
              <span className='lz'>✦</span>Appearance
              <span className='sec-chevron'>▾</span>
            </div>
            <span className='cd-sec-sub' onClick={(e) => e.stopPropagation()}>portrait in prose</span>
          </div>
          <div className='sec-body cd-sec-body'>
            <textarea
              className='cd-prose'
              value={info.appearance ?? ''}
              placeholder='Describe how your character looks — coat, hair, the marks of the road.'
              onChange={(e) => updateInfo({ appearance: e.target.value })}
              spellCheck={false}
            />
          </div>
        </section>

        {/* PERSONALITY */}
        <section className={`sec${isCollapsed('details-personality') ? ' collapsed' : ''}`}>
          <div className='sec-title cd-sec-title' onClick={() => toggleCollapsed('details-personality')}>
            <div className='label'>
              <span className='lz'>❤</span>Personality
              <span className='sec-chevron'>▾</span>
            </div>
            <span className='cd-sec-sub' onClick={(e) => e.stopPropagation()}>disposition &amp; manners</span>
          </div>
          <div className='sec-body cd-sec-body'>
            <textarea
              className='cd-prose'
              value={info.personality ?? ''}
              placeholder='Quick to listen, slower to speak? Mock the gods at her peril? Capture the shape of how they move through the world.'
              onChange={(e) => updateInfo({ personality: e.target.value })}
              spellCheck={false}
            />
          </div>
        </section>

        {/* BELIEFS & BONDS — creed cell with rust left border */}
        <section className={`sec${isCollapsed('details-beliefs') ? ' collapsed' : ''}`}>
          <div className='sec-title cd-sec-title' onClick={() => toggleCollapsed('details-beliefs')}>
            <div className='label'>
              <span className='lz'>✠</span>Beliefs &amp; Bonds
              <span className='sec-chevron'>▾</span>
            </div>
            <span className='cd-sec-sub' onClick={(e) => e.stopPropagation()}>what they live by</span>
          </div>
          <div className='sec-body cd-sec-body'>
            <div className='cd-creed'>
              <div className='cd-creed-k'>Creed</div>
              <textarea
                className='cd-creed-v'
                value={info.beliefs ?? ''}
                placeholder='No song unfinished. No debt unpaid.'
                onChange={(e) => updateInfo({ beliefs: e.target.value })}
                spellCheck={false}
              />
            </div>
          </div>
        </section>
      </div>

      {/* ============ RIGHT RAIL — Origins / Proficiencies / Traits ============ */}
      <aside className='col right codex-details-rail'>
        {/* ORIGINS */}
        <section className={`sec${isCollapsed('details-origins') ? ' collapsed' : ''}`}>
          <div className='sec-title cd-sec-title' onClick={() => toggleCollapsed('details-origins')}>
            <div className='label'>
              <span className='lz'>+</span>Origins
              <span className='sec-chevron'>▾</span>
            </div>
            <span className='cd-sec-sub' onClick={(e) => e.stopPropagation()}>three threads</span>
          </div>
          <div className='sec-body cd-sec-body'>
            <div className='cd-origin-list'>
              <div
                className='cd-origin-card'
                onClick={() =>
                  character?.details?.ancestry &&
                  openDrawer({
                    type: 'ancestry',
                    data: { id: character.details.ancestry.id },
                    extra: { addToHistory: true },
                  })
                }
              >
                <div className='cd-origin-icon'>⚓</div>
                <div className='cd-origin-body'>
                  <div className='cd-origin-k'>Ancestry</div>
                  <div className='cd-origin-v'>{ancestryName || '—'}</div>
                  {heritageLabel && (
                    <div className='cd-origin-sub'>heritage · {heritageLabel}</div>
                  )}
                </div>
              </div>
              <div
                className='cd-origin-card'
                onClick={() =>
                  character?.details?.background &&
                  openDrawer({
                    type: 'background',
                    data: { id: character.details.background.id },
                    extra: { addToHistory: true },
                  })
                }
              >
                <div className='cd-origin-icon'>♪</div>
                <div className='cd-origin-body'>
                  <div className='cd-origin-k'>Background</div>
                  <div className='cd-origin-v'>{backgroundName || '—'}</div>
                </div>
              </div>
              <div
                className='cd-origin-card'
                onClick={() =>
                  character?.details?.class &&
                  openDrawer({
                    type: 'class',
                    data: { id: character.details.class.id },
                    extra: { addToHistory: true },
                  })
                }
              >
                <div className='cd-origin-icon'>❖</div>
                <div className='cd-origin-body'>
                  <div className='cd-origin-k'>Class</div>
                  <div className='cd-origin-v'>{className || '—'}</div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* PROFICIENCIES */}
        <section className={`sec${isCollapsed('details-prof') ? ' collapsed' : ''}`}>
          <div className='sec-title cd-sec-title' onClick={() => toggleCollapsed('details-prof')}>
            <div className='label'>
              <span className='lz'>✕</span>Proficiencies
              <span className='sec-chevron'>▾</span>
            </div>
            <span className='cd-sec-sub' onClick={(e) => e.stopPropagation()}>T · E · M · L</span>
          </div>
          <div className='sec-body cd-sec-body'>
            <div className='cd-prof-group'>
              <div className='cd-prof-group-h'>Attacks</div>
              <ProfRow label='Simple Weapons' variableName='SIMPLE_WEAPONS' />
              <ProfRow label='Martial Weapons' variableName='MARTIAL_WEAPONS' />
              <ProfRow label='Advanced Weapons' variableName='ADVANCED_WEAPONS' />
              <ProfRow label='Unarmed Attacks' variableName='UNARMED_ATTACKS' />
              {weaponProfs.map((w) => (
                <ProfRow
                  key={w.name}
                  label={pluralize(variableToLabel(w))}
                  variableName={w.name}
                />
              ))}
              {weaponGroupProfs.map((w) => (
                <ProfRow
                  key={w.name}
                  label={variableToLabel(w)}
                  variableName={w.name}
                />
              ))}
            </div>
            <div className='cd-prof-group'>
              <div className='cd-prof-group-h'>Defenses</div>
              <ProfRow label='Unarmored' variableName='UNARMORED_DEFENSE' />
              <ProfRow label='Light Armor' variableName='LIGHT_ARMOR' />
              <ProfRow label='Medium Armor' variableName='MEDIUM_ARMOR' />
              <ProfRow label='Heavy Armor' variableName='HEAVY_ARMOR' />
              {armorProfs.map((a) => (
                <ProfRow
                  key={a.name}
                  label={variableToLabel(a)}
                  variableName={a.name}
                />
              ))}
              {armorGroupProfs.map((a) => (
                <ProfRow
                  key={a.name}
                  label={variableToLabel(a)}
                  variableName={a.name}
                />
              ))}
            </div>
            {hasSpellcasting && (
              <div className='cd-prof-group'>
                <div className='cd-prof-group-h'>Spellcasting</div>
                <ProfRow label='Spell Attack' variableName='SPELL_ATTACK' showVal />
                <ProfRow label='Spell DC' variableName='SPELL_DC' showVal isDC />
              </div>
            )}
            <div className='cd-prof-group'>
              <div className='cd-prof-group-h'>Class</div>
              <ProfRow label='Class DC' variableName='CLASS_DC' showVal isDC />
              <ProfRow label='Perception' variableName='PERCEPTION' showVal />
            </div>
          </div>
        </section>

        {/* TRAITS & SIZE */}
        <section className={`sec${isCollapsed('details-traits') ? ' collapsed' : ''}`}>
          <div className='sec-title cd-sec-title' onClick={() => toggleCollapsed('details-traits')}>
            <div className='label'>
              <span className='lz'>+</span>Traits &amp; Size
              <span className='sec-chevron'>▾</span>
            </div>
          </div>
          <div className='sec-body cd-sec-body'>
            <div className='cd-trait-row'>
              {ancestryTraits.map((t) => (
                <span
                  key={`trait-${t?.id}`}
                  className='cd-trait-pill'
                  onClick={() =>
                    openDrawer({
                      type: 'trait',
                      data: { id: t?.id },
                      extra: { addToHistory: true },
                    })
                  }
                >
                  {t?.name}
                </span>
              ))}
              {languages.map((l) => (
                <span
                  key={`lang-${l?.id}`}
                  className='cd-trait-pill'
                  onClick={() =>
                    openDrawer({
                      type: 'language',
                      data: { id: l?.id },
                      extra: { addToHistory: true },
                    })
                  }
                >
                  {l?.name}
                </span>
              ))}
            </div>
            <div className='cd-size'>
              <div className='cd-size-k'>Size</div>
              <div className='cd-size-v'>{sizeLabel}</div>
              {sizeFoot && <div className='cd-size-foot'>{sizeFoot}</div>}
            </div>
          </div>
        </section>
      </aside>
    </>
  );
}

export default CodexDetailsPanel;
