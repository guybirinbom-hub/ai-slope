import CodexLoadingOverlay from '@common/CodexLoadingOverlay';
import { characterState } from '@atoms/characterAtoms';
import { drawerState } from '@atoms/navAtoms';
import RichText from '@common/RichText';
import ResultWrapper from '@common/operations/results/ResultWrapper';
import { SelectContentButton, selectContent } from '@common/select/SelectContent';
import { IMPRINT_BG_COLOR_HOVER, IMPRINT_BORDER_COLOR } from '@constants/data';
import { fetchContent, fetchContentPackage, fetchContentSources, getDefaultSources } from '@content/content-store';
import { getIconFromContentType } from '@content/content-utils';
import { AncestryInitialOverview, convertAncestryOperationsIntoUI } from '@drawers/types/AncestryDrawer';
import { BackgroundInitialOverview, convertBackgroundOperationsIntoUI } from '@drawers/types/BackgroundDrawer';
import { ClassInitialOverview, convertClassOperationsIntoUI } from '@drawers/types/ClassDrawer';
import { Accordion, Badge, Box, Group, ScrollArea, Stack, Text } from '@mantine/core';
import { useHover, useInterval, useMediaQuery } from '@mantine/hooks';
import { getChoiceCounts, getPendingChoicesPerLevel } from '@operations/choice-count-tracker';
import { OperationResult } from '@schemas/operations';
import { ObjectWithUUID, convertKeyToBasePrefix, hasOperationSelection } from '@operations/operation-utils';
import { removeParentSelections } from '@operations/selection-tree';
import { IconHome, IconHammer, IconUser, IconPuzzle } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import {
  AbilityBlock,
  Ancestry,
  Background,
  Character,
  Class,
  ClassArchetype,
  ContentPackage,
  OperationCharacterResultPackage,
} from '@schemas/content';
import { OperationSelect } from '@schemas/operations';
import { VariableAttr, VariableProf } from '@schemas/variables';
import { displayFinalHealthValue, displayFinalProfValue } from '@variables/variable-display';
import { getAllSkillVariables, getVariable } from '@variables/variable-manager';
import { compileProficiencyType } from '@variables/variable-utils';
import { isEqual } from 'lodash-es';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAtom, useAtomValue } from 'jotai';
import { SetterOrUpdater } from '@utils/type-fixing';
import useCharacter from '@utils/use-character';
import { phoneQuery } from '@utils/mobile-responsive';
import { toLabel } from '@utils/strings';
import ImprintButton from '@common/ImprintButton';
import BuilderSpellPicks from './BuilderSpellPicks';
import DeepBackgroundForm from './DeepBackgroundForm';

// Determines how often to check for choice counts
const CHOICE_COUNT_INTERVAL = 1500;

// CodexChoice — replaces the Mantine `<Accordion.Item>` shell used by
// the per-level sub-sections (ancestry feats, class features, etc.).
// Visual contract is the `.choice` rule in wg4-builder.css.
//
// Single-open behaviour is controlled by the parent via `open` +
// `onToggle` — same model the Mantine Accordion used, just rewritten
// to drop the Mantine context. `bodyRef` is forwarded onto the
// expanded panel so `getChoiceCounts()` can DOM-walk for the pending
// pip count (same trick the legacy items used on Accordion.Panel).
function CodexChoice(props: {
  id?: string;
  open: boolean;
  onToggle: () => void;
  glyph: string;
  name: string;
  subtitle?: string;
  pending?: number;
  state?: 'required' | 'done' | 'warn';
  stateLabel?: string;
  children?: React.ReactNode;
  bodyRef?: React.Ref<HTMLDivElement>;
  outerRef?: React.Ref<HTMLDivElement>;
}) {
  const pending = props.pending ?? 0;
  return (
    <div
      className={`choice${props.open ? ' open' : ''}`}
      data-wg-name={props.id}
      ref={props.outerRef}
    >
      <div
        className='choice-head'
        onClick={props.onToggle}
        role='button'
        tabIndex={0}
      >
        <div className='ico'>
          <span>{props.glyph}</span>
        </div>
        <div className='nm'>
          {props.name}
          {props.subtitle && <small>{props.subtitle}</small>}
        </div>
        {pending > 0 ? (
          <div className='pending-pip' title={`${pending} pending choice${pending === 1 ? '' : 's'}`}>
            <span>{pending}</span>
          </div>
        ) : props.state ? (
          <div className={`ch-state ${props.state}`}>{props.stateLabel ?? ''}</div>
        ) : (
          <div />
        )}
        <div className='chev' />
      </div>
      {props.open && (
        <div className='choice-body' ref={props.bodyRef}>
          {props.children}
        </div>
      )}
    </div>
  );
}

export default function CharBuilderCreation(props: { characterId: number; pageHeight: number }) {
  const [doneLoading, setDoneLoading] = useState(false);

  const { data: content, isFetching } = useQuery({
    queryKey: [`find-content-${props.characterId}-for-char-builder-creation`, { characterId: props.characterId }],
    queryFn: async () => {
      // Prefetch content sources (to avoid multiple requests)
      await fetchContentSources(getDefaultSources('PAGE'));

      const content = await fetchContentPackage(getDefaultSources('PAGE'), {
        fetchSources: true,
        fetchCreatures: false,
      });
      return content;
    },
    refetchOnWindowFocus: false,
  });

  // Just load progress manually
  const [percentage, setPercentage] = useState(0);
  const interval = useInterval(() => setPercentage(percentage + 2), 50);
  useEffect(() => {
    interval.start();
    return interval.stop;
  }, []);

  // Loader pattern: keep <CodexLoadingOverlay> ALWAYS rendered so the
  // component stays mounted across the "fetching → content arrives →
  // EXECUTE_OPS finishes" transition. Its internal mount state +
  // `visible` prop manage the lock-and-tail dance.
  const loaderVisible = isFetching || !content || !doneLoading;
  return (
    <>
      <CodexLoadingOverlay visible={loaderVisible} />
      {content && (
        <div style={{ display: doneLoading ? undefined : 'none' }}>
          <CharBuilderCreationInner
            characterId={props.characterId}
            content={content}
            pageHeight={props.pageHeight}
            onFinishLoading={() => {
              interval.stop();
              setDoneLoading(true);
            }}
          />
        </div>
      )}
    </>
  );
}

export function CharBuilderCreationInner(props: {
  characterId: number;
  content: ContentPackage;
  pageHeight: number;
  onFinishLoading: () => void;
}) {
  const isPhone = useMediaQuery(phoneQuery());

  const { character, setCharacter, results } = useCharacter(props.characterId, {
    type: 'EXECUTE_OPS',
    data: {
      content: props.content,
      context: 'CHARACTER-BUILDER',
      onFinishLoading: props.onFinishLoading,
    },
  });

  // selectedLevel drives which level's options appear in the main
  // column. Defaults to the character's current level and snaps to it
  // whenever the character's level changes. .lv chips set it.
  const [selectedLevel, setSelectedLevel] = useState<number>(character?.level ?? 1);
  useEffect(() => {
    setSelectedLevel(character?.level ?? 1);
  }, [character?.level]);

  const maxLevel = 20;
  const currentLevel = character?.level ?? 1;

  // Per-level pending choice counts. Recomputed only when the operation
  // results identity changes (executeOperations always returns a new
  // package object) so the .lv chip strip can paint complete /
  // incomplete / future without DOM-walking each level.
  const pendingPerLevel = useMemo(() => getPendingChoicesPerLevel(results), [results]);

  // Topbar fields (character crest + ancestry/class label).
  const initial = (character?.name?.trim() || 'W')[0]?.toUpperCase() ?? 'W';
  const ancestryName = character?.details?.ancestry?.name ?? '—';
  const className = character?.details?.class?.name ?? '—';

  // ── PERF: memoize the read-from-store derived blocks (attributes,
  // vitals, skills, saves, weapon/armor proficiency) on `results`.
  // The variable store only mutates inside executeOperations, and
  // results identity changes IFF the ops pipeline finished. Without
  // these memos, every setCharacter call (level chip click, accordion
  // toggle, etc.) caused us to re-read & re-clone ~30 variables in
  // render (skills column alone: 18 rows × 5-7 getVariable calls).
  const attributesBlock = useMemo(
    () => (
      <div className='ab-grid'>
        {(
          [
            { vn: 'ATTRIBUTE_STR', label: 'Str' },
            { vn: 'ATTRIBUTE_DEX', label: 'Dex' },
            { vn: 'ATTRIBUTE_CON', label: 'Con' },
            { vn: 'ATTRIBUTE_INT', label: 'Int' },
            { vn: 'ATTRIBUTE_WIS', label: 'Wis' },
            { vn: 'ATTRIBUTE_CHA', label: 'Cha' },
          ] as const
        ).map(({ vn, label }) => {
          const v = getVariable<VariableAttr>('CHARACTER', vn);
          const mod = v?.value?.value ?? 0;
          const score = 10 + mod * 2;
          const sign = mod >= 0 ? '+' : '';
          return (
            <div key={vn} className='ab'>
              <div className='glyph'>{label}</div>
              <div className='mod'>
                {sign}
                {mod}
              </div>
              <div className='score'>{score}</div>
            </div>
          );
        })}
      </div>
    ),
    [results]
  );

  const vitalsBlock = useMemo(
    () => (
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
        <div className='hp-card'>
          <div className='lbl'>HP Max</div>
          <div className='v'>{displayFinalHealthValue('CHARACTER')}</div>
        </div>
        <div className='hp-card'>
          <div className='lbl'>Class DC</div>
          <div className='v'>{displayFinalProfValue('CHARACTER', 'CLASS_DC', true)}</div>
        </div>
        <div className='hp-card'>
          <div className='lbl'>Perception</div>
          <div className='v'>{displayFinalProfValue('CHARACTER', 'PERCEPTION')}</div>
        </div>
        <div className='hp-card'>
          <div className='lbl'>Spell DC</div>
          <div className='v'>{displayFinalProfValue('CHARACTER', 'SPELL_DC', true)}</div>
        </div>
      </div>
    ),
    [results]
  );

  const skillsBlock = useMemo(
    () => (
      <div className='sk-list'>
        {getAllSkillVariables('CHARACTER').map((sk) => {
          const profLetter = compileProficiencyType(sk.value);
          const value = displayFinalProfValue('CHARACTER', sk.name);
          const nm = toLabel(sk.name.replace(/^SKILL_/, '').replace(/_/g, ' '));
          return (
            <div key={sk.name} className='sk'>
              <span className={`pf-chip ${profLetter}`}>{profLetter}</span>
              <span className='nm'>{nm}</span>
              <span className='v'>{value}</span>
            </div>
          );
        })}
      </div>
    ),
    [results]
  );

  const savesBlock = useMemo(
    () => (
      <div className='sk-list'>
        {(
          [
            { vn: 'SAVE_FORT', label: 'Fortitude' },
            { vn: 'SAVE_REFLEX', label: 'Reflex' },
            { vn: 'SAVE_WILL', label: 'Will' },
            { vn: 'PERCEPTION', label: 'Perception' },
          ] as const
        ).map(({ vn, label }) => {
          const v = getVariable<VariableProf>('CHARACTER', vn);
          const profLetter = compileProficiencyType(v?.value);
          const value = displayFinalProfValue('CHARACTER', vn);
          return (
            <div key={vn} className='sk'>
              <span className={`pf-chip ${profLetter}`}>{profLetter}</span>
              <span className='nm'>{label}</span>
              <span className='v'>{value}</span>
            </div>
          );
        })}
      </div>
    ),
    [results]
  );

  const weaponArmorBlock = useMemo(
    () => (
      <div className='sk-list'>
        {(
          [
            { vn: 'SIMPLE_WEAPONS', label: 'Simple weapons' },
            { vn: 'MARTIAL_WEAPONS', label: 'Martial weapons' },
            { vn: 'ADVANCED_WEAPONS', label: 'Advanced weapons' },
            { vn: 'UNARMED_ATTACKS', label: 'Unarmed' },
            { vn: 'LIGHT_ARMOR', label: 'Light armor' },
            { vn: 'MEDIUM_ARMOR', label: 'Medium armor' },
            { vn: 'HEAVY_ARMOR', label: 'Heavy armor' },
            { vn: 'UNARMORED_DEFENSE', label: 'Unarmored' },
          ] as const
        ).map(({ vn, label }) => {
          const v = getVariable<VariableProf>('CHARACTER', vn);
          if (!v) return null;
          const profLetter = compileProficiencyType(v.value);
          const value = displayFinalProfValue('CHARACTER', vn);
          return (
            <div key={vn} className='sk'>
              <span className={`pf-chip ${profLetter}`}>{profLetter}</span>
              <span className='nm'>{label}</span>
              <span className='v'>{value}</span>
            </div>
          );
        })}
      </div>
    ),
    [results]
  );

  // The single LevelSection rendered in .col.main — pulled out so we
  // can pass it through a Mantine Accordion (LevelSection wraps its
  // content in Accordion.Item, so we need the Accordion shell with a
  // value matching the section's level).
  //
  // PERF: useMemo on [selectedLevel, content, results] so that
  // re-renders driven by unrelated characterState changes (e.g.
  // typing in topbar) don't reconstruct the LevelSection JSX or
  // defeat its React.memo bailout.
  const mainLevelItem = useMemo(
    () => (
      <LevelSection
        key={selectedLevel}
        level={selectedLevel}
        opened={true}
        content={props.content}
        operationResults={results}
      />
    ),
    [selectedLevel, props.content, results]
  );

  return (
    <>
      {/* CharacterBuilderPage wraps this in `.wg4 .codex-builder-page`
          + its own .winbar / .topbar (crest + Home/Build/Sheet nav +
          hamburger). The decorative Sources/Ancestry/Class/Skills/
          Feats crumb strip has been removed — its buttons didn't
          actually route anywhere. */}
        {/* Level chip strip — 20 chips + prev/next arrows. */}
        <div className='levels'>
          <span className='lab'>
            Level <b>{currentLevel}</b> / {maxLevel}
          </span>
          <button
            type='button'
            className='nav-arrow'
            title='Prev'
            onClick={() => setSelectedLevel(Math.max(0, selectedLevel - 1))}
          >
            ‹
          </button>
          <div className='lv-track'>
            {Array.from({ length: maxLevel }, (_, i) => i + 1).map((lvl) => {
              // Chip state:
              //   `on`         — selected level (solid black emblem)
              //   future (no class) — past character.level, can't edit yet
              //   `incomplete` — has unresolved choices (amber dot + tint)
              //   `complete`   — every pending pick made (rust accent + dot)
              // Order matters: selection wins over completion paint so the
              // user can tell which level they're on even if it's done.
              let cls: 'on' | 'complete' | 'incomplete' | '' = '';
              if (lvl === selectedLevel) cls = 'on';
              else if (lvl > currentLevel) cls = '';
              else if ((pendingPerLevel[lvl] ?? 0) > 0) cls = 'incomplete';
              else cls = 'complete';
              return (
                <div
                  key={lvl}
                  className={`lv ${cls}`.trim()}
                  onClick={() => setSelectedLevel(lvl)}
                  role='button'
                  tabIndex={0}
                >
                  {lvl}
                </div>
              );
            })}
          </div>
          <button
            type='button'
            className='nav-arrow'
            title='Next'
            onClick={() => setSelectedLevel(Math.min(maxLevel, selectedLevel + 1))}
          >
            ›
          </button>
        </div>

        <div className='builder-body'>
          {/* LEFT — Origin / Attributes / Vitals */}
          <div className='col left'>
            <div>
              <div className='sec-title compact'>
                <div className='lozenge'>✦</div>
                <div className='label'>Origin</div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div
                  className='origin'
                  onClick={() => {
                    selectContent<Ancestry>(
                      'ancestry',
                      (option) => {
                        const selections = removeParentSelections(
                          'ancestry',
                          character?.operation_data?.selections
                        );
                        setCharacter((prev) =>
                          prev
                            ? {
                                ...prev,
                                details: { ...prev.details, ancestry: option },
                                operation_data: { ...prev.operation_data, selections },
                              }
                            : prev
                        );
                      },
                      { selectedId: character?.details?.ancestry?.id }
                    );
                  }}
                >
                  <div className='ic'>A</div>
                  <div>
                    <div className='nm'>Ancestry</div>
                    <div className='v'>{character?.details?.ancestry?.name ?? '— Choose —'}</div>
                  </div>
                </div>
                <div
                  className='origin'
                  onClick={() => {
                    selectContent<Background>(
                      'background',
                      (option) => {
                        const selections = removeParentSelections(
                          'background',
                          character?.operation_data?.selections
                        );
                        setCharacter((prev) =>
                          prev
                            ? {
                                ...prev,
                                details: { ...prev.details, background: option },
                                operation_data: { ...prev.operation_data, selections },
                              }
                            : prev
                        );
                      },
                      { selectedId: character?.details?.background?.id }
                    );
                  }}
                >
                  <div className='ic'>B</div>
                  <div>
                    <div className='nm'>Background</div>
                    <div className='v'>{character?.details?.background?.name ?? '— Choose —'}</div>
                  </div>
                </div>
                <div
                  className='origin'
                  onClick={() => {
                    selectContent<Class>(
                      'class',
                      (option) => {
                        let selections = removeParentSelections('class_', character?.operation_data?.selections);
                        if (!character?.variants?.dual_class) {
                          selections = removeParentSelections('class-feature', selections);
                        }
                        setCharacter((prev) =>
                          prev
                            ? {
                                ...prev,
                                details: {
                                  ...prev.details,
                                  class: option,
                                  class_archetype: undefined,
                                },
                                operation_data: { ...prev.operation_data, selections },
                              }
                            : prev
                        );
                      },
                      { selectedId: character?.details?.class?.id }
                    );
                  }}
                >
                  <div className='ic'>C</div>
                  <div>
                    <div className='nm'>Class</div>
                    <div className='v'>{character?.details?.class?.name ?? '— Choose —'}</div>
                  </div>
                </div>
              </div>
            </div>

            <div>
              <div className='sec-title compact'>
                <div className='lozenge'>+</div>
                <div className='label'>Attributes</div>
              </div>
              {attributesBlock}
            </div>

            <div>
              <div className='sec-title compact'>
                <div className='lozenge'>♥</div>
                <div className='label'>Vitals</div>
              </div>
              {vitalsBlock}
            </div>
          </div>

          {/* MAIN — level focus. Shows ONLY the selectedLevel's choice
              cards, expanded. The chip strip above swaps which level is
              displayed. */}
          <div className='col main'>
            <div>
              <div className='level-head'>
                <div className='level-emblem'>
                  <span className='num'>{selectedLevel}</span>
                </div>
                <div className='meta'>
                  <div className='eyebrow'>The Chronicle · Level {selectedLevel}</div>
                  <div className='lede'>
                    Pick what your wanderer learns at this level. Some choices are auto-granted by class; others are
                    yours to make.
                  </div>
                </div>
              </div>
              <ScrollArea h={props.pageHeight - 120} type={isPhone ? 'never' : undefined} scrollbars='y'>
                <div className='choice-list'>{mainLevelItem}</div>
              </ScrollArea>
            </div>
          </div>

          {/* RIGHT — codex Skill Proficiency / Saves & Perception /
              Weapon & Armor. Mirrors the mockup's compact .sk-list
              rail; uses getAllSkillVariables + displayFinalProfValue
              + compileProficiencyType for the data so values stay
              in lockstep with the character sheet.

              Each block is useMemo'd on `results` (see top of this
              component) so flipping a level chip / opening a choice
              card doesn't re-walk the variable store. */}
          <div className='col right'>
            <div>
              <div className='sec-title compact'>
                <div className='lozenge'>+</div>
                <div className='label'>Skill Proficiency</div>
                <div className='sub'>T E M L</div>
              </div>
              {skillsBlock}
            </div>

            <div>
              <div className='sec-title compact'>
                <div className='lozenge'>+</div>
                <div className='label'>Saves &amp; Perception</div>
              </div>
              {savesBlock}
            </div>

            <div>
              <div className='sec-title compact'>
                <div className='lozenge'>X</div>
                <div className='label'>Weapon &amp; Armor</div>
              </div>
              {weaponArmorBlock}
            </div>
          </div>
        </div>
    </>
  );
}

export function StatButton(props: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  darkVersion?: boolean;
}) {
  return (
    <Box>
      <ImprintButton
        disabled={props.disabled}
        size='compact-lg'
        styles={{
          root: {
            border: `1px solid ${IMPRINT_BORDER_COLOR}`,
          },
          inner: {
            width: '100%',
          },
          label: {
            width: '100%',
          },
        }}
        fullWidth
        onClick={props.onClick}
      >
        <Group w='100%' justify='space-between' wrap='nowrap'>
          {props.children}
        </Group>
      </ImprintButton>
    </Box>
  );
}

function LevelSectionInner(props: {
  level: number;
  opened: boolean;
  content: ContentPackage;
  operationResults: OperationCharacterResultPackage | null;
}) {
  const [subSectionValue, setSubSectionValue] = useState<string | null>(null);
  const [, setCharacter] = useAtom(characterState);

  // PERF: stable callback identity so the AncestrySectionAccordionItem /
  // ClassFeatureAccordionItem children (which take this as a prop) don't
  // see a new function every render. setCharacter is stable (jotai
  // setter), so deps can be empty.
  const saveSelectionChange = useCallback((path: string, value: string) => {
    setCharacter((prev) => {
      if (!prev) return prev;
      const newSelections = { ...prev.operation_data?.selections };
      if (!value) {
        delete newSelections[path];
      } else {
        newSelections[path] = `${value}`;
      }
      return {
        ...prev,
        operation_data: {
          ...prev.operation_data,
          selections: newSelections,
        },
      };
    });
  }, [setCharacter]);

  if (
    props.operationResults?.ancestrySectionResults.length === 0 &&
    props.operationResults?.classFeatureResults.length === 0
  ) {
    if (props.level === 0) {
      return (
        <div className='start-hint'>Select an ancestry, background, and class to get started.</div>
      );
    } else {
      return null;
    }
  }

  // ── Level 0 still uses the legacy Mantine InitialStatsLevelSection
  //    (Ancestry / Background / Class / Books / Items / Custom items).
  if (props.level === 0) {
    return (
      <InitialStatsLevelSection
        content={props.content}
        operationResults={props.operationResults}
        onSaveChanges={saveSelectionChange}
      />
    );
  }

  // ── Level 1+: flat list of codex .choice cards.
  const toggle = (id: string) => setSubSectionValue((prev) => (prev === id ? null : id));
  return (
    <div>
      {props.operationResults?.ancestrySectionResults.map(
        (r: { baseSource: AbilityBlock; baseResults: OperationResult[] }, index: number) =>
          r.baseSource.level === props.level && (
            <AncestrySectionAccordionItem
              key={`a-${index}`}
              id={`ancestry-section-${index}`}
              section={r.baseSource}
              results={r.baseResults}
              onSaveChanges={saveSelectionChange}
              opened={subSectionValue === `ancestry-section-${index}`}
              onToggle={() => toggle(`ancestry-section-${index}`)}
            />
          )
      )}
      {props.operationResults?.classFeatureResults.map(
        (r: { baseSource: AbilityBlock; baseResults: OperationResult[] }, index: number) =>
          r.baseSource.level === props.level && (
            <ClassFeatureAccordionItem
              key={`c-${index}`}
              id={`class-feature-${index}`}
              feature={r.baseSource}
              results={r.baseResults}
              onSaveChanges={saveSelectionChange}
              opened={subSectionValue === `class-feature-${index}`}
              onToggle={() => toggle(`class-feature-${index}`)}
            />
          )
      )}
      {/* Per-level spell picks. Spellcasters get their L1 picks
          surfaced HERE (in the Level 1 section, next to the
          Spellcasting class feature), not under Initial Stats. */}
      <BuilderSpellPicks level={props.level} />
    </div>
  );
}

// PERF: React.memo so LevelSection only re-renders when its props
// actually change. Without this, every characterState mutation (rapid
// typing in topbar fields, hp tick, etc.) re-renders the entire feature
// tree because the parent CharBuilderCreationInner re-renders on the
// undebounced character atom subscription.
const LevelSection = memo(LevelSectionInner);

/**
 * Handle class archetype selection
 */
function handleClassArchetypeSelection(
  _character: Character | null,
  setCharacter: SetterOrUpdater<Character | null>,
  class_: Class,
  recordT: '1' | '2'
) {
  fetchContent<ClassArchetype>('class-archetype', {
    class_id: class_.id,
    content_sources: getDefaultSources('PAGE'),
  }).then((options) => {
    if (options.length > 0) {
      selectContent<ClassArchetype>(
        'class-archetype',
        (option) => {
          if (option.id === -999) {
            return;
          }

          setCharacter((prev) => {
            if (!prev) return prev;
            return {
              ...prev,
              details: {
                ...(prev.details ?? {}),
                class_archetype: recordT === '1' ? option : prev.details?.class_archetype,
                class_archetype_2: recordT === '2' ? option : prev.details?.class_archetype_2,
              },
            };
          });
        },
        {
          selectedId: -1,
          description: (
            <Text fz='sm'>
              This class supports optional class archetypes that reshape its core mechanics. Would you like to select
              one?
            </Text>
          ),
          overrideOptions: [
            {
              id: -999,
              class_id: class_.id,
              name: '— Base Class (No Archetype)',
            },
            ...options,
          ],
        }
      );
    }
  });
}
// Keep around — referenced by external pages if/when ClassDrawer wires
// to it. Silences "unused" warnings.
void handleClassArchetypeSelection;

function ClassFeatureAccordionItem(props: {
  id: string;
  feature: AbilityBlock;
  results: OperationResult[];
  onSaveChanges: (path: string, value: string) => void;
  opened: boolean;
  onToggle: () => void;
}) {
  const featureChoiceCountRef = useRef<HTMLDivElement>(null);
  const [featureChoiceCounts, setFeatureChoiceCounts] = useState<{
    current: number;
    max: number;
  }>({
    current: 0,
    max: 0,
  });

  useEffect(() => {
    const intervalId = setInterval(() => {
      if (featureChoiceCountRef.current) {
        const choiceCounts = getChoiceCounts(featureChoiceCountRef.current);
        if (!isEqual(choiceCounts, featureChoiceCounts)) setFeatureChoiceCounts(choiceCounts);
      }
    }, CHOICE_COUNT_INTERVAL);
    return () => clearInterval(intervalId);
  }, [props.results]);

  const pending = Math.max(0, featureChoiceCounts.max - featureChoiceCounts.current);

  return (
    <CodexChoice
      id={props.feature.name}
      open={props.opened}
      onToggle={props.onToggle}
      glyph={'✪'}
      name={props.feature.name}
      pending={pending}
      state={pending === 0 && featureChoiceCounts.max > 0 ? 'done' : undefined}
      stateLabel={'Done'}
      bodyRef={featureChoiceCountRef}
    >
      <Stack gap={5}>
        <RichText ta='justify' store='CHARACTER'>
          {props.feature.description}
        </RichText>
        <DisplayOperationResult
          source={undefined}
          level={props.feature.level ?? 0}
          results={props.results}
          onChange={(path, value) => {
            props.onSaveChanges(`${convertKeyToBasePrefix('classFeatureResults', props.feature.id)}_${path}`, value);
          }}
        />
      </Stack>
    </CodexChoice>
  );
}

function AncestrySectionAccordionItem(props: {
  id: string;
  section: AbilityBlock;
  results: OperationResult[];
  onSaveChanges: (path: string, value: string) => void;
  opened: boolean;
  onToggle: () => void;
}) {
  const featureChoiceCountRef = useRef<HTMLDivElement>(null);
  const [featureChoiceCounts, setFeatureChoiceCounts] = useState<{
    current: number;
    max: number;
  }>({
    current: 0,
    max: 0,
  });

  useEffect(() => {
    const intervalId = setInterval(() => {
      if (featureChoiceCountRef.current) {
        const choiceCounts = getChoiceCounts(featureChoiceCountRef.current);
        if (!isEqual(choiceCounts, featureChoiceCounts)) setFeatureChoiceCounts(choiceCounts);
      }
    }, CHOICE_COUNT_INTERVAL);
    return () => clearInterval(intervalId);
  }, [props.results]);

  const pending = Math.max(0, featureChoiceCounts.max - featureChoiceCounts.current);

  return (
    <CodexChoice
      id={props.section.name}
      open={props.opened}
      onToggle={props.onToggle}
      glyph={'❦'}
      name={props.section.name}
      pending={pending}
      state={pending === 0 && featureChoiceCounts.max > 0 ? 'done' : undefined}
      stateLabel={'Done'}
      bodyRef={featureChoiceCountRef}
    >
      <Stack gap={5}>
        <RichText ta='justify' store='CHARACTER'>
          {props.section.description}
        </RichText>
        <DisplayOperationResult
          source={undefined}
          level={props.section.level ?? 0}
          results={props.results}
          onChange={(path, value) => {
            props.onSaveChanges(
              `${convertKeyToBasePrefix('ancestrySectionResults', props.section.id)}_${path}`,
              value
            );
          }}
        />
      </Stack>
    </CodexChoice>
  );
}

function InitialStatsLevelSection(props: {
  content: ContentPackage;
  operationResults: OperationCharacterResultPackage | null;
  onSaveChanges: (path: string, value: string) => void;
}) {
  const [subSectionValue, setSubSectionValue] = useState<string | null>(null);
  const [character] = useAtom(characterState);

  const class_ = props.content.classes.find((class_) => class_.id === character?.details?.class?.id);
  const class_2 = props.content.classes.find((class_) => class_.id === character?.details?.class_2?.id);
  const ancestry = props.content.ancestries.find((ancestry) => ancestry.id === character?.details?.ancestry?.id);
  const background = props.content.backgrounds.find(
    (background) => background.id === character?.details?.background?.id
  );

  if (!props.operationResults) return null;

  const hasOperationResults = (
    data: {
      baseSource: any;
      baseResults: OperationResult[];
    }[]
  ) => {
    if (data.length === 0) return false;
    for (const r of data) {
      for (const result of r.baseResults) {
        if (result) return true;
      }
    }
    return false;
  };

  return (
    <Accordion
      variant='separated'
      value={subSectionValue}
      onChange={setSubSectionValue}
      styles={{
        label: { paddingTop: 5, paddingBottom: 5 },
      }}
    >
      <AncestryAccordionItem
        ancestry={ancestry}
        content={props.content}
        operationResults={props.operationResults}
        onSaveChanges={(path, value) => {
          props.onSaveChanges(path, value);
        }}
        opened={subSectionValue === 'ancestry'}
      />

      <BackgroundAccordionItem
        background={background}
        operationResults={props.operationResults}
        onSaveChanges={(path, value) => {
          props.onSaveChanges(path, value);
        }}
        opened={subSectionValue === 'background'}
      />

      <ClassAccordionItem
        class_={class_}
        operationResults={props.operationResults}
        onSaveChanges={(path, value) => {
          props.onSaveChanges(path, value);
        }}
        opened={subSectionValue === 'class'}
      />

      {class_2 && (
        <ClassAccordionItem
          class_={class_2}
          operationResults={props.operationResults}
          onSaveChanges={(path, value) => {
            props.onSaveChanges(path, value);
          }}
          opened={subSectionValue === 'class_2'}
          isClass2
        />
      )}

      {hasOperationResults(props.operationResults.contentSourceResults) && (
        <BooksAccordionItem
          operationResults={props.operationResults}
          onSaveChanges={(path, value) => {
            props.onSaveChanges(path, value);
          }}
          opened={subSectionValue === 'books'}
        />
      )}
      {hasOperationResults(props.operationResults.itemResults) && (
        <ItemsAccordionItem
          operationResults={props.operationResults}
          onSaveChanges={(path, value) => {
            props.onSaveChanges(path, value);
          }}
          opened={subSectionValue === 'items'}
        />
      )}
      {props.operationResults.characterResults.length > 0 && (
        <CustomAccordionItem
          operationResults={props.operationResults}
          onSaveChanges={(path, value) => {
            props.onSaveChanges(path, value);
          }}
          opened={subSectionValue === 'custom'}
        />
      )}
    </Accordion>
  );
}

function AncestryAccordionItem(props: {
  ancestry?: Ancestry;
  content: ContentPackage;
  operationResults: OperationCharacterResultPackage;
  onSaveChanges: (path: string, value: string) => void;
  opened: boolean;
}) {
  const [character, setCharacter] = useAtom(characterState);
  const [_drawer, openDrawer] = useAtom(drawerState);
  const { hovered, ref } = useHover();

  const choiceCountRef = useRef<HTMLDivElement>(null);
  const [choiceCounts, setChoiceCounts] = useState<{
    current: number;
    max: number;
  }>({
    current: 0,
    max: 0,
  });

  useEffect(() => {
    const intervalId = setInterval(() => {
      if (choiceCountRef.current) {
        const newChoiceCounts = getChoiceCounts(choiceCountRef.current);
        if (!isEqual(newChoiceCounts, choiceCounts)) setChoiceCounts(newChoiceCounts);
      }
    }, CHOICE_COUNT_INTERVAL);
    return () => clearInterval(intervalId);
  }, [props.operationResults]);

  // Only display the operation results that aren't already displayed in the ancestry overview
  const physicalFeatures = (props.content.abilityBlocks ?? []).filter((block) => block.type === 'physical-feature');
  const senses = (props.content.abilityBlocks ?? []).filter((block) => block.type === 'sense');
  const languages = (props.content.languages ?? []).sort((a, b) => a.name.localeCompare(b.name));
  const heritages = (props.content.abilityBlocks ?? []).filter(
    (block) => block.type === 'heritage' && block.traits?.includes(props.ancestry?.trait_id ?? -1)
  );
  let ancestryOperationResults = props.operationResults?.ancestryResults ?? [];
  const ancestryInitialOverviewDisplay = props.ancestry
    ? convertAncestryOperationsIntoUI(
        props.ancestry,
        physicalFeatures,
        senses,
        languages,
        'READ/WRITE',
        props.operationResults?.ancestryResults ?? [],
        [character, setCharacter],
        openDrawer
      )
    : null;
  if (ancestryInitialOverviewDisplay) {
    let displayRecords: {
      ui: React.ReactNode;
      operation: OperationSelect | null;
    }[] = [];
    for (const value of Object.values(ancestryInitialOverviewDisplay)) {
      if (Array.isArray(value)) {
        displayRecords = [...displayRecords, ...value];
      } else {
        displayRecords.push(value);
      }
    }

    ancestryOperationResults = ancestryOperationResults.filter((result: OperationResult) => {
      return !displayRecords.find(
        (record) => result?.selection?.id !== undefined && record.operation?.id === result?.selection?.id
      );
    });
  }

  return (
    <Accordion.Item
      value='ancestry'
      ref={ref}
      style={{
        backgroundColor: hovered && !props.opened ? IMPRINT_BG_COLOR_HOVER : undefined,
      }}
      mt={3}
    >
      <Accordion.Control disabled={!props.ancestry} icon={getIconFromContentType('ancestry', '1rem')}>
        <Group gap={5}>
          <Box>Ancestry</Box>
          {choiceCounts.max - choiceCounts.current > 0 && (
            <Badge variant='filled'>{choiceCounts.max - choiceCounts.current}</Badge>
          )}
        </Group>
      </Accordion.Control>
      <Accordion.Panel ref={choiceCountRef}>
        <Stack gap={5}>
          <Box>
            {props.ancestry && (
              <AncestryInitialOverview
                ancestry={props.ancestry}
                physicalFeatures={physicalFeatures}
                senses={senses}
                languages={languages}
                heritages={heritages}
                mode='READ/WRITE'
                operationResults={props.operationResults.ancestryResults}
              />
            )}
          </Box>

          <Box>
            <DisplayOperationResult
              source={undefined}
              level={1}
              results={ancestryOperationResults}
              onChange={(path, value) => {
                props.onSaveChanges(`${convertKeyToBasePrefix('ancestryResults')}_${path}`, value);
              }}
            />
          </Box>
        </Stack>
      </Accordion.Panel>
    </Accordion.Item>
  );
}

function BackgroundAccordionItem(props: {
  background?: Background;
  operationResults: OperationCharacterResultPackage;
  onSaveChanges: (path: string, value: string) => void;
  opened: boolean;
}) {
  const [character, setCharacter] = useAtom(characterState);
  const [_drawer, openDrawer] = useAtom(drawerState);
  const { hovered, ref } = useHover();

  const choiceCountRef = useRef<HTMLDivElement>(null);
  const [choiceCounts, setChoiceCounts] = useState<{
    current: number;
    max: number;
  }>({
    current: 0,
    max: 0,
  });

  useEffect(() => {
    const intervalId = setInterval(() => {
      if (choiceCountRef.current) {
        const newChoiceCounts = getChoiceCounts(choiceCountRef.current);
        if (!isEqual(newChoiceCounts, choiceCounts)) setChoiceCounts(newChoiceCounts);
      }
    }, CHOICE_COUNT_INTERVAL);
    return () => clearInterval(intervalId);
  }, [props.operationResults]);

  let backgroundOperationResults = props.operationResults?.backgroundResults ?? [];
  const backgroundInitialOverviewDisplay = props.background
    ? convertBackgroundOperationsIntoUI(
        props.background,
        'READ/WRITE',
        props.operationResults?.backgroundResults ?? [],
        [character, setCharacter],
        openDrawer
      )
    : null;
  if (backgroundInitialOverviewDisplay) {
    let displayRecords: {
      ui: React.ReactNode;
      operation: OperationSelect | null;
    }[] = [];
    for (const value of Object.values(backgroundInitialOverviewDisplay)) {
      if (Array.isArray(value)) {
        displayRecords = [...displayRecords, ...value];
      } else {
        displayRecords.push(value);
      }
    }

    backgroundOperationResults = backgroundOperationResults.filter((result: OperationResult) => {
      return !displayRecords.find(
        (record) => result?.selection?.id !== undefined && record.operation?.id === result?.selection?.id
      );
    });
  }

  const isDeepBackground = !!character?.variants?.deep_background;

  return (
    <Accordion.Item
      value='background'
      ref={ref}
      style={{
        backgroundColor: hovered && !props.opened ? IMPRINT_BG_COLOR_HOVER : undefined,
      }}
      mt={3}
    >
      <Accordion.Control
        disabled={!isDeepBackground && !props.background}
        icon={getIconFromContentType('background', '1rem')}
      >
        <Group gap={5}>
          <Box>Background{isDeepBackground ? ' (Deep)' : ''}</Box>
          {choiceCounts.max - choiceCounts.current > 0 && (
            <Badge variant='filled'>{choiceCounts.max - choiceCounts.current}</Badge>
          )}
        </Group>
      </Accordion.Control>
      <Accordion.Panel ref={choiceCountRef}>
        {isDeepBackground ? (
          <DeepBackgroundForm />
        ) : (
          <Stack gap={5}>
            <Box>
              {props.background && (
                <BackgroundInitialOverview
                  background={props.background}
                  mode='READ/WRITE'
                  operationResults={props.operationResults.backgroundResults}
                />
              )}
            </Box>

            <Box>
              <DisplayOperationResult
                source={undefined}
                level={1}
                results={backgroundOperationResults}
                onChange={(path, value) => {
                  props.onSaveChanges(`${convertKeyToBasePrefix('backgroundResults')}_${path}`, value);
                }}
              />
            </Box>
          </Stack>
        )}
      </Accordion.Panel>
    </Accordion.Item>
  );
}

function ClassAccordionItem(props: {
  class_?: Class;
  operationResults: OperationCharacterResultPackage;
  onSaveChanges: (path: string, value: string) => void;
  opened: boolean;
  isClass2?: boolean;
}) {
  const [character, setCharacter] = useAtom(characterState);
  const { hovered, ref } = useHover();

  const choiceCountRef = useRef<HTMLDivElement>(null);
  const [choiceCounts, setChoiceCounts] = useState<{
    current: number;
    max: number;
  }>({
    current: 0,
    max: 0,
  });

  useEffect(() => {
    const intervalId = setInterval(() => {
      if (choiceCountRef.current) {
        const newChoiceCounts = getChoiceCounts(choiceCountRef.current);
        if (!isEqual(newChoiceCounts, choiceCounts)) setChoiceCounts(newChoiceCounts);
      }
    }, CHOICE_COUNT_INTERVAL);
    return () => clearInterval(intervalId);
  }, [props.operationResults]);

  let classOperationResults =
    (props.isClass2 ? props.operationResults?.class2Results : props.operationResults?.classResults) ?? [];
  const classInitialOverviewDisplay = props.class_
    ? convertClassOperationsIntoUI(
        props.class_,
        'READ/WRITE',
        (props.isClass2 ? props.operationResults?.class2Results : props.operationResults?.classResults) ?? [],
        [character, setCharacter],
        props.isClass2
      )
    : null;
  if (classInitialOverviewDisplay) {
    let displayRecords: {
      ui: React.ReactNode;
      operation: OperationSelect | null;
    }[] = [];
    for (const value of Object.values(classInitialOverviewDisplay)) {
      if (Array.isArray(value)) {
        displayRecords = [...displayRecords, ...value];
      } else {
        displayRecords.push(value);
      }
    }

    classOperationResults = classOperationResults.filter((result: OperationResult) => {
      return !displayRecords.find(
        (record) => result?.selection?.id !== undefined && record.operation?.id === result?.selection?.id
      );
    });
  }

  return (
    <Accordion.Item
      value={props.isClass2 ? 'class_2' : 'class'}
      ref={ref}
      style={{
        backgroundColor: hovered && !props.opened ? IMPRINT_BG_COLOR_HOVER : undefined,
      }}
      mt={3}
    >
      <Accordion.Control disabled={!props.class_} icon={getIconFromContentType('class', '1rem')}>
        <Group gap={5}>
          <Box>Class {props.isClass2 ? '2' : ''}</Box>
          {choiceCounts.max - choiceCounts.current > 0 && (
            <Badge variant='filled'>{choiceCounts.max - choiceCounts.current}</Badge>
          )}
        </Group>
      </Accordion.Control>
      <Accordion.Panel ref={choiceCountRef}>
        <Stack gap={5}>
          <Box>
            {props.class_ && (
              <ClassInitialOverview
                class_={props.class_}
                mode='READ/WRITE'
                operationResults={
                  props.isClass2 ? props.operationResults?.class2Results : props.operationResults?.classResults
                }
                isClass2={props.isClass2}
              />
            )}
          </Box>

          <Box>
            <DisplayOperationResult
              source={undefined}
              level={1}
              results={classOperationResults}
              onChange={(path, value) => {
                props.onSaveChanges(
                  `${props.isClass2 ? convertKeyToBasePrefix('class2Results') : convertKeyToBasePrefix('classResults')}_${path}`,
                  value
                );
              }}
            />
          </Box>
        </Stack>
      </Accordion.Panel>
    </Accordion.Item>
  );
}

function BooksAccordionItem(props: {
  operationResults: OperationCharacterResultPackage;
  onSaveChanges: (path: string, value: string) => void;
  opened: boolean;
}) {
  const { hovered, ref } = useHover();

  const character = useAtomValue(characterState);

  const choiceCountRef = useRef<HTMLDivElement>(null);
  const [choiceCounts, setChoiceCounts] = useState<{
    current: number;
    max: number;
  }>({
    current: 0,
    max: 0,
  });

  useEffect(() => {
    const intervalId = setInterval(() => {
      if (choiceCountRef.current) {
        const newChoiceCounts = getChoiceCounts(choiceCountRef.current);
        if (!isEqual(newChoiceCounts, choiceCounts)) setChoiceCounts(newChoiceCounts);
      }
    }, CHOICE_COUNT_INTERVAL);
    return () => clearInterval(intervalId);
  }, [props.operationResults]);

  return (
    <Accordion.Item
      value='books'
      ref={ref}
      style={{
        backgroundColor: hovered && !props.opened ? IMPRINT_BG_COLOR_HOVER : undefined,
      }}
      mt={3}
    >
      <Accordion.Control icon={getIconFromContentType('content-source', '1rem')}>
        <Group gap={5}>
          <Box>Books</Box>
          {choiceCounts.max - choiceCounts.current > 0 && (
            <Badge variant='filled'>{choiceCounts.max - choiceCounts.current}</Badge>
          )}
        </Group>
      </Accordion.Control>
      <Accordion.Panel ref={choiceCountRef}>
        {props.operationResults.contentSourceResults.map((s, index) => (
          <DisplayOperationResult
            key={index}
            source={{
              ...s.baseSource,
              _select_uuid: `${s.baseSource.id}`,
              _content_type: 'content-source',
            }}
            level={character?.level ?? 1}
            results={s.baseResults}
            onChange={(path, value) => {
              props.onSaveChanges(`${convertKeyToBasePrefix('contentSourceResults', s.baseSource.id)}_${path}`, value);
            }}
          />
        ))}
      </Accordion.Panel>
    </Accordion.Item>
  );
}

function ItemsAccordionItem(props: {
  operationResults: OperationCharacterResultPackage;
  onSaveChanges: (path: string, value: string) => void;
  opened: boolean;
}) {
  const { hovered, ref } = useHover();

  const choiceCountRef = useRef<HTMLDivElement>(null);
  const [choiceCounts, setChoiceCounts] = useState<{
    current: number;
    max: number;
  }>({
    current: 0,
    max: 0,
  });

  useEffect(() => {
    const intervalId = setInterval(() => {
      if (choiceCountRef.current) {
        const newChoiceCounts = getChoiceCounts(choiceCountRef.current);
        if (!isEqual(newChoiceCounts, choiceCounts)) setChoiceCounts(newChoiceCounts);
      }
    }, CHOICE_COUNT_INTERVAL);
    return () => clearInterval(intervalId);
  }, [props.operationResults]);

  return (
    <Accordion.Item
      value='items'
      ref={ref}
      style={{
        backgroundColor: hovered && !props.opened ? IMPRINT_BG_COLOR_HOVER : undefined,
      }}
      mt={3}
    >
      <Accordion.Control icon={getIconFromContentType('item', '1rem')}>
        <Group gap={5}>
          <Box>Items</Box>
          {choiceCounts.max - choiceCounts.current > 0 && (
            <Badge variant='filled'>{choiceCounts.max - choiceCounts.current}</Badge>
          )}
        </Group>
      </Accordion.Control>
      <Accordion.Panel ref={choiceCountRef}>
        {props.operationResults.itemResults.map((s, index) => (
          <DisplayOperationResult
            key={index}
            source={{
              ...s.baseSource,
              _select_uuid: `${s.baseSource.id}`,
              _content_type: 'item',
            }}
            level={s.baseSource.level}
            results={s.baseResults}
            onChange={(path, value) => {
              props.onSaveChanges(`${convertKeyToBasePrefix('itemResults', s.baseSource.id)}_${path}`, value);
            }}
          />
        ))}
      </Accordion.Panel>
    </Accordion.Item>
  );
}

function CustomAccordionItem(props: {
  operationResults: OperationCharacterResultPackage;
  onSaveChanges: (path: string, value: string) => void;
  opened: boolean;
}) {
  const { hovered, ref } = useHover();

  const character = useAtomValue(characterState);

  const choiceCountRef = useRef<HTMLDivElement>(null);
  const [choiceCounts, setChoiceCounts] = useState<{
    current: number;
    max: number;
  }>({
    current: 0,
    max: 0,
  });

  useEffect(() => {
    const intervalId = setInterval(() => {
      if (choiceCountRef.current) {
        const newChoiceCounts = getChoiceCounts(choiceCountRef.current);
        if (!isEqual(newChoiceCounts, choiceCounts)) setChoiceCounts(newChoiceCounts);
      }
    }, CHOICE_COUNT_INTERVAL);
    return () => clearInterval(intervalId);
  }, [props.operationResults]);

  const selections = props.operationResults.characterResults.filter((result) => hasOperationSelection(result));

  return (
    <Accordion.Item
      value='custom'
      ref={ref}
      style={{
        backgroundColor: hovered && !props.opened ? IMPRINT_BG_COLOR_HOVER : undefined,
      }}
      mt={3}
    >
      <Accordion.Control icon={<IconPuzzle size='1rem' />}>
        <Group gap={5}>
          <Box>Custom</Box>
          {choiceCounts.max - choiceCounts.current > 0 && (
            <Badge variant='filled'>{choiceCounts.max - choiceCounts.current}</Badge>
          )}
        </Group>
      </Accordion.Control>
      <Accordion.Panel ref={choiceCountRef}>
        <DisplayOperationResult
          source={undefined}
          level={character?.level ?? 1}
          results={props.operationResults.characterResults}
          onChange={(path, value) => {
            props.onSaveChanges(`${convertKeyToBasePrefix('characterResults')}_${path}`, value);
          }}
        />
        {selections.length === 0 && (
          <Text c='gray.6' fz='sm' ta='center' fs='italic'>
            No selections found for the {props.operationResults.characterResults.length} executed operation(s).
          </Text>
        )}
      </Accordion.Panel>
    </Accordion.Item>
  );
}

//////////////////////////////////////////

export function DisplayOperationResult(props: {
  source?: ObjectWithUUID;
  level?: number;
  results: OperationResult[];
  onChange: (path: string, value: string) => void;
}) {
  const selections = props.results.filter((result) => hasOperationSelection(result));
  // Synchronous record of attribute picks made among THESE sibling boosts this
  // render-session, keyed by selection id. Lets a second boost drop an
  // attribute the instant a sibling takes it, before the async operation
  // recompile catches up (the gap that let a fast click pick it twice).
  const [recentPicks, setRecentPicks] = useState<Record<string, string>>({});
  if (selections.length === 0) return null;

  // What attribute each sibling boost currently holds: prefer the live local
  // pick, fall back to the recomputed selection for picks made before mount.
  const heldBy: Record<string, string | undefined> = {};
  for (const r of selections) {
    const sid = r?.selection?.id ?? '';
    const src = r?.result?.source as { variable?: string; _select_uuid?: string } | undefined;
    heldBy[sid] = recentPicks[sid] !== undefined ? recentPicks[sid] : (src?.variable ?? src?._select_uuid);
  }

  return (
    <ResultWrapper label={`From ${props.source?.name ?? 'Unknown'}`} disabled={!props.source}>
      <Stack gap={10}>
        {selections.map((result, i) => {
          const sid = result?.selection?.id ?? '';
          // Attributes held by the OTHER boosts in this set (exclude self).
          const excludeAttrs = new Set<string>();
          for (const [osid, attr] of Object.entries(heldBy)) {
            if (osid === sid) continue;
            if (attr && attr.startsWith('ATTRIBUTE_')) excludeAttrs.add(attr);
          }
          return (
          <Stack key={i} gap={10}>
            {result?.selection && (
              <OperationResultSelector
                result={result}
                level={props.level}
                excludeAttrs={excludeAttrs}
                onChange={(path, value) => {
                  // Record this pick synchronously so the sibling selectors
                  // re-render with it excluded immediately (path is the bare
                  // selection id for these top-level boosts).
                  if (path === sid) {
                    setRecentPicks((prev) => ({ ...prev, [sid]: value }));
                  }
                  props.onChange(path, value);
                }}
              />
            )}
            {result?.result?.results && result.result.results.length > 0 && (
              <DisplayOperationResult
                source={result.result.source}
                level={props.level}
                results={result.result.results}
                onChange={(path, value) => {
                  let selectionUUID = result.selection?.id ?? '';
                  let resultUUID = result.result?.source?._select_uuid ?? '';

                  let newPath = path;
                  if (resultUUID) newPath = `${resultUUID}_${newPath}`;
                  if (selectionUUID) newPath = `${selectionUUID}_${newPath}`;
                  props.onChange(newPath, value);
                }}
              />
            )}
          </Stack>
          );
        })}
      </Stack>
    </ResultWrapper>
  );
}

function OperationResultSelector(props: {
  result: OperationResult;
  level?: number;
  excludeAttrs?: Set<string>;
  onChange: (path: string, value: string) => void;
}) {
  // Drop attribute options already taken by SIBLING boosts in the same set
  // (PF2e: you can't boost the same attribute twice in one set). excludeAttrs
  // is computed live by the parent from picks made THIS render — before the
  // async operation recompile lands — which is what closes the race that let a
  // fast double-click pick the same attribute twice. Filtered attribute
  // options carry the attribute's variable name (e.g. "ATTRIBUTE_STR").
  const exclude = props.excludeAttrs;
  const overrideOptions = (props.result?.selection?.options ?? [])
    .filter((option) => {
      if (!exclude || exclude.size === 0) return true;
      const oo = option as { variable?: string; _select_uuid?: string };
      return !exclude.has(oo.variable ?? oo._select_uuid ?? '');
    })
    .map((option) => ({
      ...option,
      _source_level: props.level,
    }));
  return (
    <SelectContentButton
      type={
        (props.result?.selection?.options ?? []).length > 0
          ? (props.result?.selection?.options[0]._content_type ?? 'ability-block')
          : 'ability-block'
      }
      onClick={(option) => {
        props.onChange(props.result!.selection?.id ?? '', option._select_uuid);
      }}
      onClear={() => {
        props.onChange(props.result!.selection?.id ?? '', '');
      }}
      selectedId={props.result!.result?.source?.id}
      options={{
        overrideOptions,
        overrideLabel: props.result?.selection?.title || 'Select an Option',
        abilityBlockType:
          (props.result?.selection?.options ?? []).length > 0 ? props.result?.selection?.options[0].type : undefined,
        skillAdjustment: props.result?.selection?.skillAdjustment,
      }}
    />
  );
}
