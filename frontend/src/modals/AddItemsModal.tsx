/**
 * Add Items modal — codex redesign.
 *
 * Table layout that matches D:/Inst/Popups (1).html → screens/codex-popups.html
 * Columns: LVL · ITEM · PRICE · ACTION (with BUY + GIVE buttons per row).
 * Header has + Custom Item + Bulk Add + close-X; footer has Close + Done with
 * a helper-text strip ("Buy deducts price from wallet · Give adds for free").
 *
 * The "Filters" button in the search row toggles an inline filter panel
 * (SelectContentFilters from @common/select). It REPLACES the table while
 * open — same modal, no second window. Previously this routed to a
 * separate selectContent() picker which the user (correctly) found
 * confusing; the panel now lives in-place like the SelectContent modal's
 * filter panel does.
 */

import { drawerState } from '@atoms/navAtoms';
import { fetchContentAll, getDefaultSources } from '@content/content-store';
import { Item } from '@schemas/content';
import { ContextModalProps } from '@mantine/modals';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useAtom } from 'jotai';
import * as JsSearch from 'js-search';
import { isItemVisible } from '@content/content-hidden';
import { labelToVariable } from '@variables/variable-utils';
import { priceToString } from '@items/currency-handler';
import SelectContentFilters, {
  ContentFilterState,
  DEFAULT_FILTER_STATE,
  TriStateMap,
  activeFilterCount,
} from '@common/select/SelectContentFilters';
import { passesItemGroupFilter } from '@common/select/filter-helpers';
import { CreateItemModal } from './CreateItemModal';

const NUM_PER_PAGE = 18;

// ── Item-relevant subset of the filter logic used inside SelectContentModal.
// Items don't care about spell ranges, cast time, spell traditions etc.,
// so this implementation only checks the fields that actually appear on
// items: level, rarity, availability, size, item group, traits, and the
// free-text fields (description / usage / hands / bulk / craftRequirements).
function triStateMatches<K>(map: TriStateMap<K>, value: K | undefined): boolean {
  if (map.size === 0) return true;
  if (value !== undefined && map.get(value) === 'exclude') return false;
  const hasInclude = [...map.values()].includes('include');
  if (hasInclude && (value === undefined || map.get(value) !== 'include')) return false;
  return true;
}

function applyItemFilterState(item: Item, state: ContentFilterState): boolean {
  const lvl = item.level ?? 0;
  if (lvl < state.levelMin || lvl > state.levelMax) return false;

  // Default rarity to COMMON, availability to STANDARD when null/absent —
  // most base items have these fields unset and PF2e treats absence as
  // the default value. Without this an active "Common include" chip
  // would silently drop most items.
  const rarity = (item.rarity ?? 'COMMON') as any;
  if (!triStateMatches(state.rarities, rarity)) return false;
  const availability = ((item as any).availability ?? 'STANDARD') as any;
  if (!triStateMatches(state.availabilities, availability)) return false;
  if (state.sizes.size > 0 && !triStateMatches(state.sizes, (item as any).size)) return false;
  // Item group: the 37 chip labels map to traits/usage, not the 7-value
  // `item.group` enum. Use the shared helper so this stays in lockstep
  // with the SelectContentModal version.
  if (state.itemGroups.size > 0 && !passesItemGroupFilter(item, state.itemGroups as Map<string, 'include' | 'exclude'>)) {
    return false;
  }

  if (state.traits.length > 0) {
    const traits = (item.traits ?? []) as number[];
    if (!state.traits.every((id) => traits.includes(id))) return false;
  }

  // Free-text substring filters — same field mapping as SelectContentModal
  // for items.
  const textChecks: Array<[keyof ContentFilterState, string]> = [
    ['description', 'description'],
    ['usage', 'usage'],
    ['hands', 'hands'],
    ['bulk', 'bulk'],
    ['craftRequirements', 'craft_requirements'],
  ];
  for (const [key, field] of textChecks) {
    const needle = String(state[key] ?? '').trim().toLowerCase();
    if (!needle) continue;
    const haystack = String((item as any)[field] ?? '').toLowerCase();
    if (!haystack.includes(needle)) return false;
  }
  return true;
}

export default function AddItemsModal({
  context,
  id,
  innerProps,
}: ContextModalProps<{
  onAddItem: (item: Item, type: 'GIVE' | 'BUY' | 'FORMULA') => void;
  options?: { zIndex?: number };
}>) {
  const [searchQuery, setSearchQuery] = useState('');
  const [activePage, setPage] = useState(1);
  const [_drawer, openDrawer] = useAtom(drawerState);

  // Inline filter panel state. Replaces the table when open. See the
  // applyItemFilterState pipeline below for the actual filter pass.
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filterState, setFilterState] = useState<ContentFilterState>(() => ({
    ...DEFAULT_FILTER_STATE,
  }));
  // "Find a filter" query — lives here instead of inside
  // SelectContentFilters so the modal's top search bar can host it
  // while the filter panel is open. Cleared when the panel closes.
  const [filterSearchQuery, setFilterSearchQuery] = useState('');

  // "+ Custom Item" opens a CreateItemModal; on complete the freshly
  // built item is handed straight to the inventory via GIVE.
  const [customItemOpen, setCustomItemOpen] = useState(false);

  const { data: rawItems, isFetching } = useQuery({
    queryKey: [`find-items-add-items`],
    queryFn: async () => {
      return (await fetchContentAll<Item>('item', getDefaultSources('PAGE'))).filter((item) =>
        isItemVisible('CHARACTER', item)
      );
    },
  });

  const search = useRef(new JsSearch.Search('id'));
  useEffect(() => {
    if (!rawItems) return;
    search.current.addIndex('name');
    search.current.addIndex('group');
    search.current.addDocuments(rawItems);
  }, [rawItems]);

  // Largest level among loaded items — feeds the level slider's upper
  // bound so the user can't drag past the actual data.
  const itemMaxLevel = useMemo(() => {
    if (!rawItems || rawItems.length === 0) return 25;
    return rawItems.reduce((m, it) => Math.max(m, it.level ?? 0), 0);
  }, [rawItems]);

  const allFilteredItems = (
    (searchQuery.trim() ? (search.current?.search(searchQuery.trim()) as Item[] | undefined) : (rawItems ?? [])) ?? []
  )
    .filter((item) => applyItemFilterState(item, filterState))
    .sort((a, b) => {
      if (a.level === b.level) return a.name.localeCompare(b.name);
      return a.level - b.level;
    });

  // Reset to page 1 whenever the result set could change underneath us
  // (text search, raw item load, or any filter chip toggle).
  useEffect(() => {
    setPage(1);
  }, [searchQuery, rawItems, filterState]);

  // Clear the in-panel filter-name search whenever the panel closes,
  // so the next open shows the full filter list — not stale state
  // from the user's previous session inside the panel.
  useEffect(() => {
    if (!filtersOpen) setFilterSearchQuery('');
  }, [filtersOpen]);

  const handleAddItem = (item: Item, type: 'GIVE' | 'BUY' | 'FORMULA') => {
    const baseItem = item.meta_data?.base_item
      ? rawItems?.find((i) => labelToVariable(i.name) === labelToVariable(item.meta_data!.base_item!))
      : undefined;

    const injectedItem = {
      ...item,
      meta_data: item.meta_data
        ? {
            ...item.meta_data,
            base_item_content: baseItem,
          }
        : null,
    };

    innerProps.onAddItem(injectedItem as Item, type);
  };

  const totalCount = allFilteredItems.length;
  const totalPages = Math.max(1, Math.ceil(totalCount / NUM_PER_PAGE));
  const pageItems = allFilteredItems.slice((activePage - 1) * NUM_PER_PAGE, activePage * NUM_PER_PAGE);
  const fromIndex = totalCount === 0 ? 0 : (activePage - 1) * NUM_PER_PAGE + 1;
  const toIndex = Math.min(activePage * NUM_PER_PAGE, totalCount);

  // Number of active (non-default) filter dimensions — shown after the
  // Filters button label as "(N)" to make the active count visible at a
  // glance.
  const filterCount = activeFilterCount(filterState, 'item');

  // Format the price for a row. Walks the meta_data.price object and
  // converts to "12 gp" / "3 sp" / "5 cp" via the shared helper. Falls
  // back to "—" when the item has no price (most magic items have a
  // listed price; quest items / story items often don't).
  const fmtPrice = (item: Item): { value: string; unit: string } => {
    const raw = item.price;
    if (!raw) return { value: '—', unit: '' };
    const num = {
      cp: typeof raw.cp === 'string' ? Number(raw.cp) || 0 : raw.cp,
      sp: typeof raw.sp === 'string' ? Number(raw.sp) || 0 : raw.sp,
      gp: typeof raw.gp === 'string' ? Number(raw.gp) || 0 : raw.gp,
      pp: typeof raw.pp === 'string' ? Number(raw.pp) || 0 : raw.pp,
    };
    const s = priceToString(num);
    if (s === '—') return { value: '—', unit: '' };
    const m = s.match(/^([\d.,]+)\s*([a-z]+)?$/i);
    if (m) return { value: m[1], unit: m[2] ?? '' };
    return { value: s, unit: '' };
  };

  const subtitleFor = (item: Item): string | null => {
    const usage = item.usage?.replace(/-/g, ' ');
    const group = item.group?.toLowerCase();
    return usage || group || null;
  };

  return (
    <div className='codex-add-items'>
      <div className='cai-header'>
        <div className='cai-title'>✦ Add Items</div>
        <div className='cai-header-actions'>
          <button type='button' className='cai-chip-btn' onClick={() => setCustomItemOpen(true)}>+ Custom Item</button>
          <button
            type='button'
            className='cai-x'
            onClick={() => context.closeModal(id)}
            aria-label='Close'
          >
            ✕
          </button>
        </div>
      </div>

      {/* Search row. Bound to `searchQuery` (items) when the filter
          panel is closed, and to `filterSearchQuery` (filter-name
          search) while it's open — same input slot, different
          purpose, so the user doesn't lose visual continuity when
          they toggle Filters. */}
      <div className='cai-search-row'>
        <div className='cai-search'>
          <span className='cai-search-icon' aria-hidden='true' />
          <input
            type='text'
            placeholder={filtersOpen ? 'Find a filter — e.g. "rank", "tradition", "size"…' : 'Search items by name…'}
            value={filtersOpen ? filterSearchQuery : searchQuery}
            onChange={(e) => (filtersOpen ? setFilterSearchQuery(e.target.value) : setSearchQuery(e.target.value))}
            autoFocus
          />
        </div>
        <button
          type='button'
          className={`cai-filters-btn${filtersOpen ? ' on' : ''}`}
          onClick={() => setFiltersOpen((v) => !v)}
        >
          ⚙ Filters{filterCount > 0 ? ` (${filterCount})` : ''}
          <span className='cai-filters-caret' aria-hidden='true'>{filtersOpen ? '▴' : '▾'}</span>
        </button>
      </div>

      {/* Body: filter panel when filtersOpen, table otherwise. The .cai-body
          wrapper is the flex:1 region that fills whatever vertical space the
          modal frame gives us — this is what kills the dead space the user
          was seeing under the pager when the modal was taller than the
          rows. */}
      <div className='cai-body'>
        {filtersOpen ? (
          <div className='cai-filter-panel'>
            <SelectContentFilters
              type='item'
              state={filterState}
              onChange={setFilterState}
              maxLevel={itemMaxLevel}
              // Hoist the "find a filter" query up so the modal's top
              // search bar can host it. The in-panel search input is
              // hidden in this mode; the Reset / Apply buttons move
              // into the modal footer (see footer block below).
              searchQuery={filterSearchQuery}
              onSearchQueryChange={setFilterSearchQuery}
              hideSearchInput
            />
          </div>
        ) : (
          <>
            <div className='cai-table'>
              <div className='cai-thead'>
                <div className='cai-col-lvl'>Lvl</div>
                <div className='cai-col-item'>Item</div>
                <div className='cai-col-price'>Price</div>
                <div className='cai-col-action'>Action</div>
              </div>
              <div className='cai-tbody'>
                {isFetching && pageItems.length === 0 && (
                  <div className='cai-empty'>Loading items…</div>
                )}
                {!isFetching && pageItems.length === 0 && (
                  <div className='cai-empty'>
                    {searchQuery.trim()
                      ? `No items match "${searchQuery.trim()}".`
                      : filterCount > 0
                      ? 'No items match the current filters.'
                      : 'No items available.'}
                  </div>
                )}
                {pageItems.map((item) => {
                  const price = fmtPrice(item);
                  const subtitle = subtitleFor(item);
                  return (
                    <div
                      key={item.id}
                      className='cai-row'
                      onClick={() =>
                        openDrawer({
                          type: 'item',
                          // Open the preview ABOVE this browse modal (z 1100) so the
                          // description is readable while shopping (was z 1000, behind).
                          data: { id: item.id, zIndex: 1600 },
                          extra: { addToHistory: true },
                        })
                      }
                    >
                      <div className='cai-col-lvl cai-lvl'>{item.level ?? 0}</div>
                      <div className='cai-col-item cai-name'>
                        {item.name}
                        {subtitle && <em className='cai-sub'>{subtitle}</em>}
                      </div>
                      <div className='cai-col-price cai-price'>
                        {price.value}
                        {price.unit && <span className='cai-unit'>{price.unit}</span>}
                      </div>
                      <div className='cai-col-action cai-action'>
                        <button
                          type='button'
                          className='cai-btn cai-buy'
                          onClick={(e) => {
                            e.stopPropagation();
                            handleAddItem(item, 'BUY');
                          }}
                        >
                          Buy
                        </button>
                        <button
                          type='button'
                          className='cai-btn cai-give'
                          onClick={(e) => {
                            e.stopPropagation();
                            handleAddItem(item, 'GIVE');
                          }}
                        >
                          Give
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className='cai-pager'>
              <button
                type='button'
                className='cai-pg-nav'
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={activePage <= 1}
                aria-label='Previous'
              >
                ‹
              </button>
              {/* Pager — show a wide window of 7 buttons around the
                  current page, plus first/last with `…` gaps. Same
                  algorithm lives in SelectContent.tsx's SpellPickerShell
                  to keep both pickers in sync. */}
              {(() => {
                const WINDOW = 7;
                const out: (number | '…')[] = [];
                if (totalPages <= WINDOW + 2) {
                  for (let p = 1; p <= totalPages; p++) out.push(p);
                } else {
                  let start = activePage - Math.floor(WINDOW / 2);
                  let end = activePage + Math.floor(WINDOW / 2);
                  if (start < 1) { end += 1 - start; start = 1; }
                  if (end > totalPages) { start -= end - totalPages; end = totalPages; }
                  start = Math.max(1, start);
                  end = Math.min(totalPages, end);
                  if (start > 1) {
                    out.push(1);
                    if (start > 2) out.push('…');
                  }
                  for (let p = start; p <= end; p++) out.push(p);
                  if (end < totalPages) {
                    if (end < totalPages - 1) out.push('…');
                    out.push(totalPages);
                  }
                }
                return out.map((p, i) =>
                  p === '…' ? (
                    <span key={`gap${i}`} className='cai-pg-gap'>
                      …
                    </span>
                  ) : (
                    <button
                      key={p}
                      type='button'
                      className={`cai-pg${p === activePage ? ' on' : ''}`}
                      onClick={() => setPage(p)}
                    >
                      {p}
                    </button>
                  )
                );
              })()}
              <button
                type='button'
                className='cai-pg-nav'
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={activePage >= totalPages}
                aria-label='Next'
              >
                ›
              </button>
            </div>
            <div className='cai-count'>
              Showing {fromIndex} – {toIndex} of <b>{totalCount.toLocaleString()}</b> items
            </div>
          </>
        )}
      </div>

      {/* Footer. Buttons swap between Close/Done (table mode) and
          Reset/Apply (filter-panel mode) so the user has a single,
          unambiguous action strip — no duplicate "Reset / Apply"
          pair inside the filter body. */}
      <div className='cai-footer'>
        <div className='cai-foot-hint'>
          {filtersOpen ? (
            <>
              <b>Reset</b> clears every filter <i>·</i> <b>Apply</b> returns to the item list
            </>
          ) : (
            <>
              <b>Buy</b> deducts price from wallet <i>·</i> <b>Give</b> adds for free
            </>
          )}
        </div>
        <div className='cai-foot-actions'>
          {filtersOpen ? (
            <>
              <button
                type='button'
                className='cai-btn cai-foot-close'
                onClick={() => setFilterState({ ...DEFAULT_FILTER_STATE })}
              >
                Reset
              </button>
              <button
                type='button'
                className='cai-btn cai-foot-done'
                onClick={() => setFiltersOpen(false)}
              >
                Apply
              </button>
            </>
          ) : (
            <>
              <button
                type='button'
                className='cai-btn cai-foot-close'
                onClick={() => context.closeModal(id)}
              >
                Close
              </button>
              <button
                type='button'
                className='cai-btn cai-foot-done'
                onClick={() => context.closeModal(id)}
              >
                Done
              </button>
            </>
          )}
        </div>
      </div>

      {/* Custom item builder — opened by the "+ Custom Item" header
          chip. On complete, the freshly built item is GIVEN to the
          inventory (free, no wallet deduction) and the builder closes.
          zIndex sits above this modal (1100) + drawers (1000). */}
      <CreateItemModal
        opened={customItemOpen}
        zIndex={1300}
        onComplete={(item) => {
          handleAddItem(item, 'GIVE');
          setCustomItemOpen(false);
        }}
        onCancel={() => setCustomItemOpen(false)}
      />
    </div>
  );
}
