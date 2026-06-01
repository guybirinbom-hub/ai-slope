/**
 * CodexNotesPanel — replacement for the Mantine NotesPanel inside the
 * codex character sheet. Renders the layout from
 * D:\Inst\codex-notes-shell.html:
 *
 *   .col.main.notes-pages   — page list (search + scrollable list +
 *                              add-page button)
 *   .col.right.notes-editor — toolbar + parchment .leaf around the
 *                              existing RichTextInput
 *
 * Wired to the same character.notes.pages structure the legacy panel
 * used, so saves go through the existing schema unchanged.
 *
 * Returns a React fragment with the two columns as siblings — the
 * parent CodexSheet body provides the .col.left rail and sets the
 * body--notes grid override.
 */

import { Character, LivingEntity } from '@schemas/content';
import RichTextInput from '@common/rich_text_input/RichTextInput';
import { GUIDE_BLUE } from '@constants/data';
import { useDebouncedState, useDidUpdate } from '@mantine/hooks';
import { openContextModal } from '@mantine/modals';
import { JSONContent } from '@tiptap/react';
import { Title } from '@mantine/core';
import { cloneDeep } from 'lodash-es';
import { useMemo, useState } from 'react';
import { SetterOrUpdater } from '@utils/type-fixing';

type NotePage = {
  name: string;
  icon: string;
  color: string;
  shared?: boolean;
  contents: JSONContent | null;
};

export function CodexNotesPanel(props: {
  character: Character | null;
  setCharacter: SetterOrUpdater<LivingEntity | null>;
}) {
  const { character, setCharacter } = props;

  // Default starter page — copied from the legacy NotesPanel so a
  // character with no notes data still has something to edit.
  const defaultPage: NotePage = useMemo(
    () => ({
      name: 'Notes',
      icon: 'notebook',
      color: character?.details?.sheet_theme?.color || GUIDE_BLUE,
      contents: null,
    }),
    [character?.details?.sheet_theme?.color]
  );

  const pages: NotePage[] = (character?.notes?.pages as NotePage[] | undefined) ?? [cloneDeep(defaultPage)];

  const [activeIndex, setActiveIndex] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');

  // Debounce content edits the same way the legacy panel did so
  // typing doesn't fire a setCharacter on every keystroke.
  const [debouncedJson, setDebouncedJson] = useDebouncedState<{
    index: number;
    json: JSONContent;
  } | null>(null, 500);

  useDidUpdate(() => {
    if (!character || !debouncedJson) return;
    const newPages = cloneDeep(pages);
    if (!newPages[debouncedJson.index]) return;
    newPages[debouncedJson.index].contents = debouncedJson.json;
    setCharacter({
      ...character,
      notes: { ...character.notes, pages: newPages },
    } as LivingEntity);
  }, [debouncedJson]);

  const updatePage = (index: number, patch: Partial<NotePage>) => {
    if (!character) return;
    const newPages = cloneDeep(pages);
    if (!newPages[index]) return;
    newPages[index] = { ...newPages[index], ...patch };
    setCharacter({
      ...character,
      notes: { ...character.notes, pages: newPages },
    } as LivingEntity);
  };

  const addPage = () => {
    if (!character) return;
    const newPages = cloneDeep(pages);
    newPages.push(cloneDeep(defaultPage));
    setCharacter({
      ...character,
      notes: { ...character.notes, pages: newPages },
    } as LivingEntity);
    setActiveIndex(newPages.length - 1);
  };

  const openPageSettings = (index: number) => {
    if (!character) return;
    const page = pages[index];
    if (!page) return;
    openContextModal({
      modal: 'updateNotePage',
      title: <Title order={3}>Update Page</Title>,
      innerProps: {
        page,
        isInCampaign: !!character.campaign_id,
        onUpdate: (name: string, icon: string, color: string, shared: boolean) => {
          updatePage(index, { name, icon, color, shared });
        },
        onDelete: () => {
          if (!character) return;
          const newPages = cloneDeep(pages);
          newPages.splice(index, 1);
          setCharacter({
            ...character,
            notes: { ...character.notes, pages: newPages.length ? newPages : [cloneDeep(defaultPage)] },
          } as LivingEntity);
          setActiveIndex(0);
        },
      },
    });
  };

  // Filter the visible page rows by search query.
  const filteredIndices = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return pages.map((_, i) => i);
    return pages
      .map((p, i) => ({ name: (p.name || '').toLowerCase(), i }))
      .filter((x) => x.name.includes(q))
      .map((x) => x.i);
  }, [pages, searchQuery]);

  const activePage = pages[activeIndex] ?? null;

  // ============================================================
  // Render two sibling columns — the parent .body owns the grid.
  // ============================================================
  return (
    <>
      {/* ============ MAIN — Notes page list ============ */}
      <div className='col main notes-pages'>
        <div className='notes-side-head'>
          <div className='ic'>
            <svg viewBox='0 0 24 24' xmlns='http://www.w3.org/2000/svg'>
              <path
                d='M4 4 H11 Q12 4 12 5 V21 Q12 20 11 20 H4 Z M20 4 H13 Q12 4 12 5 V21 Q12 20 13 20 H20 Z'
                fill='none'
                stroke='currentColor'
                strokeWidth='1.6'
              />
            </svg>
          </div>
          <div className='label'>Notes</div>
          <div className='count'>
            <b>{pages.length}</b> page{pages.length === 1 ? '' : 's'}
          </div>
        </div>

        <label className='notes-search'>
          <input
            type='text'
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder='Search pages…'
          />
        </label>

        <div className='notes-list'>
          {filteredIndices.length === 0 && (
            <div
              style={{
                padding: '20px 18px',
                color: 'var(--ink-muted)',
                fontStyle: 'italic',
                fontSize: 12,
              }}
            >
              No pages match "{searchQuery.trim()}"
            </div>
          )}
          {filteredIndices.map((i) => {
            const p = pages[i];
            if (!p) return null;
            return (
              <div
                key={i}
                className={`np${i === activeIndex ? ' on' : ''}`}
                onClick={() => setActiveIndex(i)}
                role='button'
                tabIndex={0}
                title='Click to open · double-click to rename'
                onDoubleClick={() => openPageSettings(i)}
              >
                <div className='np-ic'>▤</div>
                <div className='np-body'>
                  <div className='np-nm'>{p.name || 'Untitled page'}</div>
                  <div className='np-sub'>
                    {p.shared ? 'shared with party' : 'private'}
                  </div>
                </div>
                <div className='np-meta'>{i === activeIndex ? 'Open' : ''}</div>
              </div>
            );
          })}
        </div>

        <div className='notes-side-foot'>
          <button type='button' className='np-add' onClick={addPage}>
            <span className='plus'>+</span>
            Add Page
          </button>
        </div>
      </div>

      {/* ============ RIGHT — Notes editor ============ */}
      <div className='col right notes-editor'>
        <div className='notes-toolbar'>
          {/* The RichTextInput ships its own TipTap toolbar inside
              the leaf — this strip just hosts the page-level metadata
              (saved indicator + page settings gear). */}
          <div></div>
          <div className='tb-end'>
            <div className='save-state'>
              <span className='dot'></span>
              Auto-saving
            </div>
            <div
              className='gear'
              role='button'
              tabIndex={0}
              title='Page settings (rename / icon / colour / delete)'
              onClick={() => openPageSettings(activeIndex)}
            >
              <svg viewBox='0 0 24 24' xmlns='http://www.w3.org/2000/svg'>
                <circle cx='12' cy='12' r='3.4' fill='none' stroke='currentColor' strokeWidth='1.6' />
                <path
                  d='M12 3 V6 M12 18 V21 M3 12 H6 M18 12 H21 M5.5 5.5 L7.7 7.7 M16.3 16.3 L18.5 18.5 M5.5 18.5 L7.7 16.3 M16.3 7.7 L18.5 5.5'
                  stroke='currentColor'
                  strokeWidth='1.6'
                  strokeLinecap='round'
                />
              </svg>
            </div>
          </div>
        </div>

        <div className='notes-stage'>
          {activePage ? (
            <div className='leaf'>
              {/* Four visible rust L-shaped corner brackets per design.
                  Top-left/top-right are ::before/::after pseudo-elements
                  (defined in CSS); bottom-left/bottom-right are DOM
                  spans because a single element only supports two
                  pseudo-element corners. */}
              <span className='leaf-corner leaf-corner-tl' />
              <span className='leaf-corner leaf-corner-tr' />
              <span className='leaf-corner leaf-corner-bl' />
              <span className='leaf-corner leaf-corner-br' />
              <span className='leaf-margin' />

              <div className='leaf-head'>
                <input
                  type='text'
                  className='leaf-title'
                  value={activePage.name}
                  placeholder='Untitled page'
                  onChange={(e) => updatePage(activeIndex, { name: e.target.value })}
                />
                <div className='leaf-stamp'>
                  <span>
                    <b>Page {activeIndex + 1}</b> of {pages.length}
                  </span>
                  <span className='dim'>
                    {activePage.shared ? 'shared with party' : 'private codex'}
                  </span>
                </div>
              </div>

              <div className='leaf-body'>
                <RichTextInput
                  placeholder='Begin your page. Sketch a list, mark a passage, or simply start typing. The parchment will keep your words.'
                  value={activePage.contents}
                  onChange={(_text, json) => {
                    setDebouncedJson({ index: activeIndex, json });
                  }}
                  height={520}
                  hasColorOptions={true}
                />
              </div>

              <div className='leaf-pagenum'>
                page <b>{activeIndex + 1}</b> of <b>{pages.length}</b>
              </div>
            </div>
          ) : (
            <div className='notes-empty'>No page selected.</div>
          )}
        </div>
      </div>
    </>
  );
}

export default CodexNotesPanel;
