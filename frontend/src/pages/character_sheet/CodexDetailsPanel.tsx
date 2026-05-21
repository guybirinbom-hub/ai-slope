/**
 * CodexDetailsPanel — replacement for the Mantine DetailsPanel inside
 * the codex character sheet. Renders the layout from
 * D:\Inst\codex-details.html:
 *
 *   .col.main.details-main  — dossier hero, vital statistics field
 *                              grid, dossier-text blocks (Appearance,
 *                              Personality, Beliefs, Alignment),
 *                              optional Organized Play tile grid.
 *   .col.right.details-right — origin cards (ancestry/heritage/
 *                              background/class), proficiency groups
 *                              (Attacks/Defenses/Spellcasting), trait
 *                              pills + size strip.
 *
 * Wired to the same character.details.info structure the legacy panel
 * used — every input writes back through a debounced setCharacter, so
 * saves keep going through the existing schema unchanged.
 *
 * Returns a React fragment with the two columns as siblings — the
 * parent CodexSheet body provides the .col.left rail and sets the
 * body--details grid override.
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

type DetailsInfo = NonNullable<NonNullable<Character['details']>['info']>;

export function CodexDetailsPanel(props: {
  character: Character | null;
  setCharacter: SetterOrUpdater<LivingEntity | null>;
  content: ContentPackage;
}) {
  const { character, setCharacter, content } = props;
  const [_drawer, openDrawer] = useAtom(drawerState);

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
  // Identity helpers
  // ============================================================
  const ancestryName = character?.details?.ancestry?.name ?? '';
  const backgroundName = character?.details?.background?.name ?? '';
  const className = character?.details?.class?.name ?? '';
  const level = character?.level ?? 1;
  const initial = (character?.name?.trim() || 'W')[0].toUpperCase();

  // ============================================================
  // Languages, ancestry traits, size — for the right rail
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

  // ============================================================
  // Proficiency groups
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

  // Detect whether the character has any spellcasting tradition with
  // a non-U proficiency. If not, we hide the entire Spellcasting prof
  // group to avoid showing a row of U pips on martial-only chars.
  const hasSpellcasting =
    profType('SPELL_DC') !== 'U' || profType('SPELL_ATTACK') !== 'U';

  // ============================================================
  // Rendering helpers
  // ============================================================
  // A small row in a .field cell — gold label above editable input.
  const Field = (p: {
    label: string;
    value: string | undefined;
    onChange: (v: string) => void;
    placeholder?: string;
  }) => (
    <div className='field'>
      <div className='field-lbl'>{p.label}</div>
      <div className='field-val'>
        <input
          type='text'
          value={p.value ?? ''}
          placeholder={p.placeholder ?? p.label}
          onChange={(e) => p.onChange(e.target.value)}
        />
      </div>
    </div>
  );

  // A multi-line dossier-text card — used for Appearance, Personality,
  // Beliefs, Alignment. Textarea uses the .dossier-text class so it
  // picks up the parchment-style background + gold focus border.
  const DossierText = (p: {
    value: string | undefined;
    onChange: (v: string) => void;
    placeholder: string;
    long?: boolean;
  }) => (
    <textarea
      className={`dossier-text${p.long ? ' long' : ''}`}
      value={p.value ?? ''}
      placeholder={p.placeholder}
      onChange={(e) => p.onChange(e.target.value)}
      spellCheck={false}
    />
  );

  // A row in the proficiency group — name on the left, dotted leader,
  // T/E/M/L/U tier chip, optional numeric value. Clicking opens the
  // stat-prof drawer so the user can audit the breakdown.
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
        className='prof-row'
        onClick={() =>
          openDrawer({
            type: 'stat-prof',
            data: { id: 'CHARACTER', variableName: p.variableName, isDC: p.isDC },
            extra: { addToHistory: true },
          })
        }
      >
        <span className='prof-k'>
          {p.label}
          {p.em && (
            <>
              {' '}
              <em>· {p.em}</em>
            </>
          )}
        </span>
        <span className='prof-leader'></span>
        <span className={`pf-tier ${tier}`}>{tier}</span>
        {val != null && <span className='pf-v'>{val}</span>}
      </div>
    );
  };

  return (
    <>
      {/* ============ MAIN — dossier ============ */}
      <div className='col main details-main'>
        {/* IDENTITY HERO */}
        <section className='sec dossier-hero'>
          <div className='dh-grid'>
            <div className='dh-portrait'>
              {character?.details?.image_url ? (
                <img src={character.details.image_url} alt={character?.name ?? ''} />
              ) : (
                <div className='dh-portrait-inner'>
                  <span className='dh-monogram'>{initial}</span>
                  <span className='dh-pose'>portrait</span>
                </div>
              )}
            </div>
            <div className='dh-id'>
              <div className='dh-eyebrow'>✦ Wanderer's Dossier ✦</div>
              <h2 className='dh-name'>{character?.name || 'Unnamed'}</h2>
              <div className='dh-sub'>
                {ancestryName || '—'} <i>·</i> {className || '—'}
                {' '}
                <i>·</i> Level <b>{level}</b>
              </div>
              <div className='dh-meta'>
                {info.pronouns && <span className='dh-pill'>{info.pronouns}</span>}
                {info.alignment && <span className='dh-pill'>{info.alignment}</span>}
                {info.faction && (
                  <span className='dh-pill'>
                    Faction · <b>{info.faction}</b>
                  </span>
                )}
                {info.ethnicity && <span className='dh-pill'>{info.ethnicity}</span>}
              </div>
            </div>
          </div>
        </section>

        {/* VITAL STATISTICS */}
        <section className='sec'>
          <div className='sec-title'>
            <span className='lozenge'>❡</span>
            <span className='label'>Vital Statistics</span>
            <span className='sub'>edit any field</span>
          </div>
          <div className='sec-body'>
            <div className='field-grid'>
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
        <section className='sec'>
          <div className='sec-title'>
            <span className='lozenge'>✦</span>
            <span className='label'>Appearance</span>
            <span className='sub'>portrait in prose</span>
          </div>
          <div className='sec-body'>
            <DossierText
              value={info.appearance}
              onChange={(v) => updateInfo({ appearance: v })}
              placeholder='Describe how your character looks — coat, hair, the marks of the road.'
            />
          </div>
        </section>

        {/* PERSONALITY */}
        <section className='sec'>
          <div className='sec-title'>
            <span className='lozenge'>❤</span>
            <span className='label'>Personality</span>
            <span className='sub'>disposition &amp; manners</span>
          </div>
          <div className='sec-body'>
            <DossierText
              value={info.personality}
              onChange={(v) => updateInfo({ personality: v })}
              placeholder='Quick to listen, slower to speak? Mock the gods at her peril? Capture the shape of how they move through the world.'
            />
          </div>
        </section>

        {/* BELIEFS & BONDS */}
        <section className='sec'>
          <div className='sec-title'>
            <span className='lozenge'>✠</span>
            <span className='label'>Beliefs &amp; Bonds</span>
            <span className='sub'>what they live by</span>
          </div>
          <div className='sec-body'>
            <div className='creeds'>
              <div className='creed'>
                <div className='creed-k'>Creed</div>
                <textarea
                  className='creed-v'
                  value={info.beliefs ?? ''}
                  placeholder='No song unfinished. No debt unpaid.'
                  onChange={(e) => updateInfo({ beliefs: e.target.value })}
                  spellCheck={false}
                />
              </div>
            </div>
          </div>
        </section>

        {/* ORGANIZED PLAY — only show if the character actually has an
            organized play id or has logged at least one adventure. */}
        {(info.organized_play_id || (info.organized_play_adventures?.length ?? 0) > 0) && (
          <section className='sec'>
            <div className='sec-title'>
              <span className='lozenge'>⚙</span>
              <span className='label'>Organized Play</span>
              <span className='sub'>society number, faction, fame</span>
            </div>
            <div className='sec-body'>
              <div className='op-grid'>
                <div className='op-cell'>
                  <div className='op-k'>Society #</div>
                  <div className='op-v'>
                    <input
                      type='text'
                      value={info.organized_play_id ?? ''}
                      placeholder='12345-2000'
                      onChange={(e) => updateInfo({ organized_play_id: e.target.value })}
                    />
                  </div>
                </div>
                <div className='op-cell'>
                  <div className='op-k'>Faction</div>
                  <div className='op-v'>
                    <input
                      type='text'
                      value={info.faction ?? ''}
                      placeholder='—'
                      onChange={(e) => updateInfo({ faction: e.target.value })}
                    />
                  </div>
                </div>
                <div className='op-cell'>
                  <div className='op-k'>Fame</div>
                  <div className='op-v'>
                    {info.reputation ?? 0} <em>· reputation</em>
                  </div>
                </div>
                <div className='op-cell'>
                  <div className='op-k'>Adventures</div>
                  <div className='op-v'>
                    {info.organized_play_adventures?.length ?? 0}
                  </div>
                </div>
              </div>
            </div>
          </section>
        )}
      </div>

      {/* ============ RIGHT — Origins, Proficiencies, Traits ============ */}
      <div className='col right details-right'>
        {/* ORIGINS */}
        <section className='sec'>
          <div className='sec-title'>
            <span className='lozenge'>✦</span>
            <span className='label'>Origins</span>
            <span className='sub'>three threads</span>
          </div>
          <div className='sec-body'>
            {character?.details?.ancestry && (
              <div
                className='origin-card'
                onClick={() =>
                  openDrawer({
                    type: 'ancestry',
                    data: { id: character.details?.ancestry?.id },
                    extra: { addToHistory: true },
                  })
                }
              >
                <div className='origin-sigil'>⚘</div>
                <div className='origin-body'>
                  <div className='origin-k'>Ancestry</div>
                  <div className='origin-v'>{ancestryName || '—'}</div>
                </div>
              </div>
            )}
            {character?.details?.background && (
              <div
                className='origin-card'
                onClick={() =>
                  openDrawer({
                    type: 'background',
                    data: { id: character.details?.background?.id },
                    extra: { addToHistory: true },
                  })
                }
              >
                <div className='origin-sigil'>♪</div>
                <div className='origin-body'>
                  <div className='origin-k'>Background</div>
                  <div className='origin-v'>{backgroundName || '—'}</div>
                </div>
              </div>
            )}
            {character?.details?.class && (
              <div
                className='origin-card'
                onClick={() =>
                  openDrawer({
                    type: 'class',
                    data: { id: character.details?.class?.id },
                    extra: { addToHistory: true },
                  })
                }
              >
                <div className='origin-sigil'>✜</div>
                <div className='origin-body'>
                  <div className='origin-k'>Class</div>
                  <div className='origin-v'>{className || '—'}</div>
                </div>
              </div>
            )}
          </div>
        </section>

        {/* PROFICIENCIES */}
        <section className='sec'>
          <div className='sec-title'>
            <span className='lozenge'>⚔</span>
            <span className='label'>Proficiencies</span>
            <span className='sub'>T · E · M · L</span>
          </div>
          <div className='sec-body'>
            <div className='prof-group'>
              <div className='prof-group-h'>Attacks</div>
              <ProfRow label='Simple Weapons' variableName='SIMPLE_WEAPONS' />
              <ProfRow label='Martial Weapons' variableName='MARTIAL_WEAPONS' />
              <ProfRow label='Advanced Weapons' variableName='ADVANCED_WEAPONS' />
              <ProfRow label='Unarmed' variableName='UNARMED_ATTACKS' />
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
            <div className='prof-group'>
              <div className='prof-group-h'>Defenses</div>
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
              <div className='prof-group'>
                <div className='prof-group-h'>Spellcasting</div>
                <ProfRow
                  label='Spell Attack'
                  variableName='SPELL_ATTACK'
                  showVal
                />
                <ProfRow
                  label='Spell DC'
                  variableName='SPELL_DC'
                  showVal
                  isDC
                />
              </div>
            )}
            <div className='prof-group'>
              <div className='prof-group-h'>Class</div>
              <ProfRow label='Class DC' variableName='CLASS_DC' showVal isDC />
              <ProfRow label='Perception' variableName='PERCEPTION' showVal />
            </div>
          </div>
        </section>

        {/* TRAITS & SIZE */}
        <section className='sec'>
          <div className='sec-title'>
            <span className='lozenge'>✤</span>
            <span className='label'>Traits &amp; Size</span>
          </div>
          <div className='sec-body'>
            <div className='details-trait-grid'>
              {ancestryTraits.map((t) => (
                <span
                  key={t?.id}
                  className='details-trait-pill'
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
                  className='details-trait-pill'
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
            <div className='size-strip'>
              <div className='size-box'>
                <div className='size-k'>Size</div>
                <div className='size-v'>{sizeLabel}</div>
                <div className='size-foot'>
                  {sizeLabel === 'Medium'
                    ? '5 ft × 5 ft · 1-square reach'
                    : sizeLabel === 'Small'
                      ? '5 ft × 5 ft · 1-square reach'
                      : sizeLabel === 'Large'
                        ? '10 ft × 10 ft · 2-square reach'
                        : ''}
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>
    </>
  );
}

export default CodexDetailsPanel;
