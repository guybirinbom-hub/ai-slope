/**
 * Conditions + Modes modal.
 *
 * Two tabs:
 *   Conditions — every official PF2e condition. Rows are clickable
 *                to select; conditions that take a value show a
 *                1/2/3/4 row inline. Bottom "Add Condition" commits.
 *                A row's name is clickable to open its full
 *                description in an overlay; harmful conditions get
 *                a red tint so the player can scan severity fast.
 *
 *   Modes      — built-in (engine-granted) modes plus the user's
 *                own custom modes. Custom modes are split into
 *                global (every character) and character-scoped
 *                (only this one). The "Create Mode" button at the
 *                top of the Modes tab opens an inline editor; the
 *                same editor is reachable from Settings → Modes.
 *
 * Auto-effects: when a condition lands in `character.details.conditions`,
 * use-character.tsx's debounced recompile calls applyConditions to
 * push the right status / circumstance penalties into the variable
 * store. For modes, the same recompile calls applyCustomModes() which
 * walks the active list and pushes addVariableBonus for each effect.
 */

import { Condition, AbilityBlock, ContentPackage, Character } from '@schemas/content';
import { SetterOrUpdater } from '@utils/type-fixing';
import { getAllConditions } from '@conditions/condition-handler';
import {
  CustomMode,
  CustomModeEffect,
  getAllCustomModes,
  getGlobalCustomModes,
  getModeToggleKey,
  setGlobalCustomModes,
  MODE_TARGET_GROUPS,
  targetLabelForVariable,
} from '@modes/custom-modes';
import { useMemo, useState } from 'react';
import { getVariable, setVariable } from '@variables/variable-manager';
import { VariableListStr } from '@schemas/variables';
import { labelToVariable } from '@variables/variable-utils';
import { cloneDeep } from 'lodash-es';

type Tab = 'conditions' | 'modes';

// Hand-picked roster of "this is a debuff" PF2e conditions. Used to
// tint chips red so the player can read severity at a glance. Neutral
// detection / attitude conditions (Concealed, Friendly, Helpful,
// Quickened, Hidden, Invisible, Observed, Undetected, Unnoticed,
// Fascinated as a state-not-debuff, Indifferent) deliberately omitted.
export const HARMFUL_CONDITIONS = new Set([
  'Blinded',
  'Clumsy',
  'Confused',
  'Controlled',
  'Dazzled',
  'Deafened',
  'Doomed',
  'Drained',
  'Dying',
  'Encumbered',
  'Enfeebled',
  'Fatigued',
  'Fleeing',
  'Frightened',
  'Grabbed',
  'Hostile',
  'Immobilized',
  'Off-guard',
  'Paralyzed',
  'Persistent Damage',
  'Petrified',
  'Prone',
  'Restrained',
  'Sickened',
  'Slowed',
  'Stunned',
  'Stupefied',
  'Unconscious',
  'Unfriendly',
  'Wounded',
  'Glitching',
  'Suppressed',
  // Helpful state for non-creatures but harmful for objects; on a PC
  // it can only land via spell — treat as harmful in UI.
  'Broken',
]);

export default function ConditionsModesModal(props: {
  opened: boolean;
  onClose: () => void;
  character: Character | null;
  setCharacter: SetterOrUpdater<Character | null>;
  content: ContentPackage;
}) {
  const { opened, onClose, character, setCharacter, content } = props;
  const [tab, setTab] = useState<Tab>('conditions');
  const [search, setSearch] = useState('');
  // Selected row in the Conditions tab — `null` until the user picks.
  const [selected, setSelected] = useState<{ name: string; value?: number } | null>(null);
  // Description popover state. Either a Condition (from the
  // conditions tab) or an inline {name, description} for a built-in /
  // custom mode. Closed when null.
  const [showDesc, setShowDesc] = useState<{ name: string; description: string } | null>(null);
  // Create / edit Mode editor state. When set, the Modes tab shows
  // the form instead of the list. `null` means we're back at the
  // list; an object means edit-in-progress.
  const [editingMode, setEditingMode] = useState<CustomMode | null>(null);

  const allConditions = useMemo(
    () => getAllConditions().filter((c) => c.for_creature),
    []
  );

  const currentConditions = character?.details?.conditions ?? [];
  const hasCondition = (name: string) =>
    currentConditions.some((c) => c.name.toLowerCase() === name.toLowerCase());

  // Built-in (engine-granted) modes — driven by MODE_IDS, which is
  // populated by operations during recompile. Computed every render
  // (no useMemo) because MODE_IDS is in the variable store, not in
  // props — a useMemo over [content] would never re-fire when a feat
  // that grants modes finishes processing.
  const givenModeIds =
    getVariable<VariableListStr>('CHARACTER', 'MODE_IDS')?.value || [];
  const builtinModes: AbilityBlock[] = content
    ? content.abilityBlocks.filter(
        (block) => block.type === 'mode' && givenModeIds.includes(block.id + '')
      )
    : [];

  // Custom (user-created) modes — global + character-scoped.
  const charCustomModes =
    (character?.meta_data as { custom_modes?: CustomMode[] } | undefined)
      ?.custom_modes ?? [];
  const customModes = getAllCustomModes(charCustomModes);

  const activeModes = (getVariable<VariableListStr>('CHARACTER', 'ACTIVE_MODES')?.value || []) as string[];
  const isBuiltinModeActive = (mode: AbilityBlock) =>
    activeModes.includes(labelToVariable(mode.name));
  const isCustomModeActive = (mode: CustomMode) =>
    activeModes.includes(getModeToggleKey(mode));

  // ---- Mutators ----

  const addSelectedCondition = () => {
    if (!selected) return;
    const found = allConditions.find((c) => c.name === selected.name);
    if (!found) return;
    setCharacter((c) => {
      if (!c) return c;
      const existing = c.details?.conditions ?? [];
      const idx = existing.findIndex(
        (x) => x.name.toLowerCase() === found.name.toLowerCase()
      );
      const nextEntry: Condition = {
        ...found,
        value:
          found.value !== undefined ? selected.value ?? found.value : undefined,
      };
      let nextList: Condition[];
      if (idx >= 0) {
        nextList = existing.slice();
        nextList[idx] = nextEntry;
      } else {
        nextList = [...existing, nextEntry];
      }
      return { ...c, details: { ...c.details, conditions: nextList } };
    });
    setSelected(null);
    onClose();
  };

  const toggleBuiltinMode = (mode: AbilityBlock) => {
    const modeName = labelToVariable(mode.name);
    let next = getVariable<VariableListStr>('CHARACTER', 'ACTIVE_MODES')?.value || [];
    if (next.includes(modeName)) next = next.filter((m) => m !== modeName);
    else next = [...next, modeName];
    setVariable('CHARACTER', 'ACTIVE_MODES', next, 'Selected');
    setCharacter((prev) =>
      prev ? { ...prev, meta_data: { ...prev.meta_data, active_modes: cloneDeep(next) } } : null
    );
  };

  const toggleCustomMode = (mode: CustomMode) => {
    const key = getModeToggleKey(mode);
    let next = getVariable<VariableListStr>('CHARACTER', 'ACTIVE_MODES')?.value || [];
    if (next.includes(key)) next = next.filter((m) => m !== key);
    else next = [...next, key];
    setVariable('CHARACTER', 'ACTIVE_MODES', next, 'Selected');
    setCharacter((prev) =>
      prev ? { ...prev, meta_data: { ...prev.meta_data, active_modes: cloneDeep(next) } } : null
    );
  };

  // Save (create or update) a custom mode. Routes to the right store
  // based on scope. Character-scoped goes onto meta_data.custom_modes;
  // global goes to localStorage via setGlobalCustomModes.
  const saveCustomMode = (mode: CustomMode) => {
    if (mode.scope === 'global') {
      const list = getGlobalCustomModes();
      const idx = list.findIndex((m) => m.id === mode.id);
      const next = idx >= 0 ? list.map((m) => (m.id === mode.id ? mode : m)) : [...list, mode];
      setGlobalCustomModes(next);
      // Bump character state so the modal re-renders even though the
      // change is in localStorage, not the character.
      setCharacter((prev) => (prev ? { ...prev } : null));
    } else {
      setCharacter((c) => {
        if (!c) return c;
        const cur =
          (c.meta_data as { custom_modes?: CustomMode[] } | undefined)?.custom_modes ?? [];
        const idx = cur.findIndex((m) => m.id === mode.id);
        const next =
          idx >= 0 ? cur.map((m) => (m.id === mode.id ? mode : m)) : [...cur, mode];
        return { ...c, meta_data: { ...c.meta_data, custom_modes: next } };
      });
    }
    setEditingMode(null);
  };

  const deleteCustomMode = (mode: CustomMode) => {
    if (mode.scope === 'global') {
      setGlobalCustomModes(getGlobalCustomModes().filter((m) => m.id !== mode.id));
      setCharacter((prev) => (prev ? { ...prev } : null));
    } else {
      setCharacter((c) => {
        if (!c) return c;
        const cur =
          (c.meta_data as { custom_modes?: CustomMode[] } | undefined)?.custom_modes ?? [];
        return {
          ...c,
          meta_data: { ...c.meta_data, custom_modes: cur.filter((m) => m.id !== mode.id) },
        };
      });
    }
  };

  if (!opened) return null;

  // Filtered roster for the active tab — search is applied to the
  // visible list, not the underlying state.
  const q = search.trim().toLowerCase();
  const filteredConditions = q
    ? allConditions.filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          (c.description ?? '').toLowerCase().includes(q)
      )
    : allConditions;
  const filteredBuiltin = q
    ? builtinModes.filter(
        (m) =>
          m.name.toLowerCase().includes(q) ||
          (m.description ?? '').toLowerCase().includes(q)
      )
    : builtinModes;
  const filteredCustom = q
    ? customModes.filter(
        (m) =>
          m.name.toLowerCase().includes(q) ||
          (m.description ?? '').toLowerCase().includes(q)
      )
    : customModes;

  return (
    <div
      className='cm-modal-overlay'
      onClick={onClose}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div
        className='cm-modal'
        onClick={(e) => e.stopPropagation()}
        role='dialog'
        aria-modal='true'
      >
        <div className='cm-tabs'>
          <button
            type='button'
            className={`cm-tab${tab === 'conditions' ? ' on' : ''}`}
            onClick={() => {
              setTab('conditions');
              setEditingMode(null);
              setSearch('');
            }}
          >
            Conditions
          </button>
          <button
            type='button'
            className={`cm-tab${tab === 'modes' ? ' on' : ''}`}
            onClick={() => {
              setTab('modes');
              setEditingMode(null);
              setSearch('');
            }}
          >
            Modes
          </button>
          <button type='button' className='cm-close' onClick={onClose} aria-label='Close'>
            ✕
          </button>
        </div>

        {/* Search bar — hidden while the create/edit mode form is open
            since that has its own input fields and a search would be
            confusing. */}
        {!editingMode && (
          <div className='cm-search-strip'>
            <input
              className='cm-search'
              type='text'
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={tab === 'conditions' ? 'Search conditions…' : 'Search modes…'}
              autoFocus
            />
            {tab === 'modes' && (
              <button
                type='button'
                className='cm-create-btn'
                onClick={() =>
                  setEditingMode({
                    id: crypto.randomUUID(),
                    name: '',
                    description: '',
                    effects: [],
                    scope: 'character',
                  })
                }
              >
                + Create Mode
              </button>
            )}
          </div>
        )}

        <div className='cm-body'>
          {tab === 'conditions' ? (
            <ConditionsList
              all={filteredConditions}
              selected={selected}
              setSelected={setSelected}
              hasCondition={hasCondition}
              onShowDesc={(c) => setShowDesc({ name: c.name, description: c.description })}
            />
          ) : editingMode ? (
            <ModeEditor
              mode={editingMode}
              onCancel={() => setEditingMode(null)}
              onSave={saveCustomMode}
            />
          ) : (
            <ModesList
              builtin={filteredBuiltin}
              custom={filteredCustom}
              isBuiltinActive={isBuiltinModeActive}
              isCustomActive={isCustomModeActive}
              onToggleBuiltin={toggleBuiltinMode}
              onToggleCustom={toggleCustomMode}
              onEditCustom={setEditingMode}
              onDeleteCustom={deleteCustomMode}
              onShowDesc={(name, description) => setShowDesc({ name, description })}
            />
          )}
        </div>

        {tab === 'conditions' && !editingMode && (
          <div className='cm-footer'>
            <div className='cm-foot-hint'>
              {selected
                ? `${selected.name}${selected.value ? ` ${selected.value}` : ''}`
                : 'Select a condition above.'}
            </div>
            <button
              type='button'
              className='cm-add-btn'
              disabled={!selected}
              onClick={addSelectedCondition}
            >
              Add Condition
            </button>
          </div>
        )}
      </div>

      {/* Description overlay. Clicking outside closes; the inner box
          stops propagation. Sits on top of the modal but inside the
          same overlay div so the parent's onClick (close) doesn't
          fire when the user clicks inside the description box. */}
      {showDesc && (
        <div
          className='cm-desc-overlay'
          onClick={(e) => {
            e.stopPropagation();
            setShowDesc(null);
          }}
        >
          <div className='cm-desc-box' onClick={(e) => e.stopPropagation()}>
            <div className='cm-desc-head'>
              <span className='cm-desc-title'>{showDesc.name}</span>
              <button
                type='button'
                className='cm-close'
                onClick={() => setShowDesc(null)}
                aria-label='Close'
              >
                ✕
              </button>
            </div>
            <div className='cm-desc-body'>
              <ConditionDescription
                text={showDesc.description}
                conditions={allConditions}
                onConditionClick={(c) =>
                  setShowDesc({ name: c.name, description: c.description })
                }
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ConditionsList(props: {
  all: Condition[];
  selected: { name: string; value?: number } | null;
  setSelected: (s: { name: string; value?: number } | null) => void;
  hasCondition: (name: string) => boolean;
  onShowDesc: (c: Condition) => void;
}) {
  const { all, selected, setSelected, hasCondition, onShowDesc } = props;
  if (all.length === 0) {
    return <div className='cm-empty'>No conditions match.</div>;
  }
  return (
    <div className='cm-cond-list'>
      {all.map((c) => {
        const hasValue = c.value !== undefined;
        const isSelected = selected?.name === c.name;
        const already = hasCondition(c.name);
        const harmful = HARMFUL_CONDITIONS.has(c.name);
        return (
          <div
            key={c.name}
            className={`cm-cond-row${isSelected ? ' selected' : ''}${already ? ' already' : ''}${harmful ? ' harmful' : ''}`}
            onClick={() =>
              setSelected({
                name: c.name,
                value: hasValue ? selected?.value ?? 1 : undefined,
              })
            }
          >
            <div className='cm-cond-head'>
              <span
                className='cm-cond-name'
                onClick={(e) => {
                  e.stopPropagation();
                  onShowDesc(c);
                }}
                title='Click for full description'
              >
                {c.name}
              </span>
              {already && <span className='cm-cond-already'>active</span>}
              {hasValue && (
                <div className='cm-cond-vals' onClick={(e) => e.stopPropagation()}>
                  {[1, 2, 3, 4].map((v) => (
                    <button
                      type='button'
                      key={v}
                      className={`cm-cond-val${isSelected && selected?.value === v ? ' on' : ''}`}
                      onClick={() => setSelected({ name: c.name, value: v })}
                    >
                      {v}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ModesList(props: {
  builtin: AbilityBlock[];
  custom: CustomMode[];
  isBuiltinActive: (mode: AbilityBlock) => boolean;
  isCustomActive: (mode: CustomMode) => boolean;
  onToggleBuiltin: (mode: AbilityBlock) => void;
  onToggleCustom: (mode: CustomMode) => void;
  onEditCustom: (mode: CustomMode) => void;
  onDeleteCustom: (mode: CustomMode) => void;
  onShowDesc: (name: string, description: string) => void;
}) {
  const {
    builtin,
    custom,
    isBuiltinActive,
    isCustomActive,
    onToggleBuiltin,
    onToggleCustom,
    onEditCustom,
    onDeleteCustom,
    onShowDesc,
  } = props;
  if (builtin.length === 0 && custom.length === 0) {
    return (
      <div className='cm-empty'>
        No modes yet. Class features or feats that grant modes will appear
        here; you can also create your own with the "+ Create Mode" button.
      </div>
    );
  }
  return (
    <div className='cm-cond-list'>
      {builtin.map((m) => {
        const on = isBuiltinActive(m);
        return (
          <div key={'b-' + m.id} className={`cm-cond-row${on ? ' selected' : ''}`}>
            <div className='cm-cond-head'>
              <span
                className='cm-cond-name'
                onClick={() => onShowDesc(m.name, m.description ?? '')}
                title='Click for full description'
              >
                {m.name}
              </span>
              <button
                type='button'
                className={`cm-mode-toggle${on ? ' on' : ''}`}
                onClick={() => onToggleBuiltin(m)}
              >
                {on ? 'Disable' : 'Enable'}
              </button>
            </div>
          </div>
        );
      })}
      {custom.map((m) => {
        const on = isCustomActive(m);
        return (
          <div key={'c-' + m.id} className={`cm-cond-row${on ? ' selected' : ''}`}>
            <div className='cm-cond-head'>
              <span
                className='cm-cond-name'
                onClick={() => onShowDesc(m.name, customModeDescription(m))}
                title='Click for full description'
              >
                {m.name}
                <span className='cm-cond-scope'>
                  {m.scope === 'global' ? 'every char' : 'this char'}
                </span>
              </span>
              <button
                type='button'
                className='cm-mode-edit'
                onClick={() => onEditCustom(m)}
                title='Edit mode'
              >
                ✎
              </button>
              <button
                type='button'
                className='cm-mode-edit danger'
                onClick={() => {
                  if (confirm(`Delete "${m.name}"?`)) onDeleteCustom(m);
                }}
                title='Delete mode'
              >
                ✕
              </button>
              <button
                type='button'
                className={`cm-mode-toggle${on ? ' on' : ''}`}
                onClick={() => onToggleCustom(m)}
              >
                {on ? 'Disable' : 'Enable'}
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Render a custom mode's description plus a human-readable summary
 *  of its effects, for the description overlay. */
function customModeDescription(m: CustomMode): string {
  const eff = m.effects.length
    ? m.effects
        .map(
          (e) =>
            `${e.value >= 0 ? '+' : ''}${e.value} ${targetLabelForVariable(e.variable)}${
              e.type && e.type !== 'untyped' ? ` (${e.type})` : ''
            }`
        )
        .join(', ')
    : 'No effects';
  return `${m.description || '(no description)'}\n\nEffects: ${eff}`;
}

// ─── ModeEditor ───────────────────────────────────────────────────────

export function ModeEditor(props: {
  mode: CustomMode;
  onCancel: () => void;
  onSave: (mode: CustomMode) => void;
}) {
  // Local form state so edits don't fire-and-recompile on every
  // keystroke. We commit via onSave only when the user hits Save.
  const [name, setName] = useState(props.mode.name);
  const [description, setDescription] = useState(props.mode.description);
  const [scope, setScope] = useState<'global' | 'character'>(
    props.mode.scope ?? 'character'
  );
  const [effects, setEffects] = useState<CustomModeEffect[]>(
    props.mode.effects.length ? cloneDeep(props.mode.effects) : []
  );

  const addEffect = () =>
    setEffects((es) => [...es, { variable: 'AC_BONUS', value: 1, type: 'status' }]);
  const removeEffect = (idx: number) =>
    setEffects((es) => es.filter((_, i) => i !== idx));
  const updateEffect = (idx: number, patch: Partial<CustomModeEffect>) =>
    setEffects((es) => es.map((e, i) => (i === idx ? { ...e, ...patch } : e)));

  const commit = () => {
    if (!name.trim()) return;
    props.onSave({
      id: props.mode.id,
      name: name.trim(),
      description: description.trim(),
      effects: effects.filter((e) => e.variable && Number.isFinite(e.value)),
      scope,
    });
  };

  return (
    <div className='cm-editor'>
      <div className='cm-editor-row'>
        <label>Name</label>
        <input
          type='text'
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder='Battle Rage'
          autoFocus
        />
      </div>
      <div className='cm-editor-row'>
        <label>Description</label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
          placeholder='Optional note shown when you click the mode.'
        />
      </div>
      <div className='cm-editor-row'>
        <label>Scope</label>
        <div className='cm-scope-toggle'>
          <button
            type='button'
            className={`cm-scope-btn${scope === 'character' ? ' on' : ''}`}
            onClick={() => setScope('character')}
          >
            This character only
          </button>
          <button
            type='button'
            className={`cm-scope-btn${scope === 'global' ? ' on' : ''}`}
            onClick={() => setScope('global')}
          >
            Every character
          </button>
        </div>
      </div>

      <div className='cm-editor-effects'>
        <div className='cm-editor-effects-head'>
          <span>Effects (active while enabled)</span>
          <button type='button' className='cm-mini-btn' onClick={addEffect}>
            + Add effect
          </button>
        </div>
        {effects.length === 0 && (
          <div className='cm-empty' style={{ padding: '14px 0' }}>
            No effects. Add one to make this mode do something.
          </div>
        )}
        {effects.map((eff, i) => (
          <div key={i} className='cm-effect-row'>
            <select
              value={eff.variable}
              onChange={(e) => updateEffect(i, { variable: e.target.value })}
            >
              {MODE_TARGET_GROUPS.map((g) => (
                <optgroup key={g.label} label={g.label}>
                  {g.targets.map((t) => (
                    <option key={t.variable} value={t.variable}>
                      {t.label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            <input
              type='number'
              value={eff.value}
              onChange={(e) =>
                updateEffect(i, { value: parseInt(e.target.value || '0', 10) })
              }
              step={1}
              className='cm-effect-val'
            />
            <select
              value={eff.type ?? 'status'}
              onChange={(e) =>
                updateEffect(i, { type: e.target.value as CustomModeEffect['type'] })
              }
            >
              <option value='status'>status</option>
              <option value='circumstance'>circumstance</option>
              <option value='item'>item</option>
              <option value='untyped'>untyped</option>
            </select>
            <button
              type='button'
              className='cm-mini-btn danger'
              onClick={() => removeEffect(i)}
              aria-label='Remove effect'
            >
              ✕
            </button>
          </div>
        ))}
      </div>

      <div className='cm-editor-footer'>
        <button type='button' className='cm-mini-btn' onClick={props.onCancel}>
          Cancel
        </button>
        <button
          type='button'
          className='cm-add-btn'
          onClick={commit}
          disabled={!name.trim()}
        >
          Save Mode
        </button>
      </div>
    </div>
  );
}

// ─── ConditionDescription ─────────────────────────────────────────────
//
// Renders a condition's description text, but rewrites every mention
// of another official condition into a clickable link. So "Confused"'s
// text contains "you are off-guard" — and clicking "off-guard" opens
// the Off-guard description.
//
// The regex is built once from the conditions list, sorted longest-first
// so multi-word names (e.g. "Off-guard", "Persistent Damage") match
// before any shorter substring would. Word boundaries on each side
// avoid mid-word matches like "drained" inside "ungrained".

const _regexEscape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function ConditionDescription(props: {
  text: string;
  conditions: Condition[];
  onConditionClick: (c: Condition) => void;
}) {
  const { text, conditions, onConditionClick } = props;
  // Build the regex from a sorted-longest-first list so "Off-guard"
  // matches before "Off". Use a Map for the back-lookup, case-
  // insensitive since the text can vary case ("Off-guard" vs
  // "off-guard").
  const { regex, byKey } = useMemo(() => {
    const sorted = [...conditions].sort((a, b) => b.name.length - a.name.length);
    const map = new Map<string, Condition>();
    for (const c of sorted) map.set(c.name.toLowerCase(), c);
    const pattern = sorted.map((c) => _regexEscape(c.name)).join('|');
    return {
      regex: new RegExp(`\\b(${pattern})\\b`, 'gi'),
      byKey: map,
    };
  }, [conditions]);

  // Walk the text once, splitting into alternating literal/link nodes.
  const parts: React.ReactNode[] = [];
  let lastIdx = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  // Reset lastIndex because the regex was reused.
  regex.lastIndex = 0;
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIdx) {
      parts.push(text.slice(lastIdx, match.index));
    }
    const matched = match[0];
    const cond = byKey.get(matched.toLowerCase());
    if (cond) {
      parts.push(
        <span
          key={`m${key++}`}
          className='cm-cond-link'
          onClick={(e) => {
            e.stopPropagation();
            onConditionClick(cond);
          }}
        >
          {matched}
        </span>
      );
    } else {
      parts.push(matched);
    }
    lastIdx = match.index + matched.length;
  }
  if (lastIdx < text.length) parts.push(text.slice(lastIdx));
  return <>{parts}</>;
}
