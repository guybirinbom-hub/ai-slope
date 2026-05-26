import CodexLoadingOverlay from '@common/CodexLoadingOverlay';
import { characterState } from '@atoms/characterAtoms';
import { sessionState } from '@atoms/supabaseAtoms';
import { getCachedPublicUser, getPublicUser } from '@auth/user-manager';
import { CHARACTER_SLOT_CAP } from '@constants/data';
import { resetContentStore } from '@content/content-store';
import exportToJSON from '@export/export-to-json';
import exportToPDF from '@export/export-to-pdf';
import { importFromFTC } from '@import/ftc/import-from-ftc';
import importFromGUIDECHAR from '@import/guidechar/import-from-guidechar';
import importFromJSON from '@import/json/import-from-json';
import PathbuilderInputModal from '@import/pathbuilder/PathbuilderInputModal';
import { importFromPathbuilder } from '@import/pathbuilder/import-from-pathbuilder';
import {
  ActionIcon,
  Box,
  Button,
  FileButton,
  Menu,
  Text,
  Title,
  VisuallyHidden,
} from '@mantine/core';
import { useForceUpdate } from '@mantine/hooks';
import { modals } from '@mantine/modals';
import { hideNotification, showNotification } from '@mantine/notifications';
import { makeRequest } from '@requests/request-manager';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Character } from '@schemas/content';
import { isPlayable } from '@utils/character';
import { getAllBackgroundImages } from '@utils/background-images';
import { setPageTitle } from '@utils/document-change';
import { hasPatreonAccess } from '@utils/patreon';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { useAtom, useAtomValue } from 'jotai';

/**
 * /characters — the Codex roster page.
 *
 * Layout is a near 1:1 of design/screens/codex-list.html: slim winbar
 * + brand header + hero strip + toolbar (search / segmented filter /
 * view toggle / sort / new-character) + a 3-column card grid. Cards
 * use the parchment/gold codex aesthetic — no Mantine components for
 * the visual chrome. We still keep Mantine for things that have
 * meaningful interactive behavior (Menu for the per-card overflow,
 * FileButton for hidden imports, modal Confirm) — those are
 * structurally invisible chrome, not part of the design language.
 */
export function Component() {
  setPageTitle(`Characters`);
  const session = useAtomValue(sessionState);

  const { data, isLoading, refetch } = useQuery({
    queryKey: [`find-character`],
    queryFn: async () => {
      return await makeRequest<Character[]>('find-character', {
        user_id: session?.user.id,
      });
    },
    enabled: !!session,
  });

  const [_character, setCharacter] = useAtom(characterState);
  const navigate = useNavigate();

  const [searchQuery, setSearchQuery] = useState('');
  // Segmented filter: 'all' | 'active' | 'archived'. Matches the codex
  // .seg row. "Archived" maps to characters whose meta_data flags them
  // out of active play — we just check `meta_data.archived` here; the
  // backend doesn't enforce it.
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'archived'>('all');

  const [loadingImportCharacter, setLoadingImportCharacter] = useState(false);
  const [loadingCreateCharacter, setLoadingCreateCharacter] = useState(false);
  const [loadingCreateRandomCharacter, setLoadingCreateRandomCharacter] = useState(false);

  // The new + import row at the right end of the hero toolbar is a
  // simple set of dropdown-style buttons; we control opened state to
  // dodge the Mantine v9 ref-forwarding quirks we hit before.
  const [importMenuOpened, setImportMenuOpened] = useState(false);

  const jsonImportRef = useRef<HTMLButtonElement>(null);
  const guidecharImportRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [openedPathbuilderModal, setOpenedPathbuilderModal] = useState(false);

  const forceUpdate = useForceUpdate();

  // Press '/' anywhere on the page to jump focus to the search input —
  // codex-list.html shows the "/" keycap chip, this wires it up.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const tag = (document.activeElement as HTMLElement)?.tagName ?? '';
      if (e.key === '/' && tag !== 'INPUT' && tag !== 'TEXTAREA') {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  useEffect(() => {
    setCharacter(null);
    resetContentStore();
    getPublicUser().then((user) => {
      if (user) forceUpdate();
    });
  }, []);

  const handleCreateCharacter = async () => {
    setLoadingCreateCharacter(true);
    const character = await createCharacter();
    if (character) navigate(`/builder/${character.id}`);
    setLoadingCreateCharacter(false);
  };

  const reachedCharacterLimit =
    (data?.length ?? 0) >= CHARACTER_SLOT_CAP && !hasPatreonAccess(getCachedPublicUser(), 2);

  // Tiered portrait color — picked from the character id so the same
  // character keeps the same portrait tier across renders. Mirrors the
  // codex t1-t5 portrait palette (red, sage, plum, sapphire, mint).
  const portraitTier = (id: number): 't1' | 't2' | 't3' | 't4' | 't5' => {
    const tiers = ['t1', 't2', 't3', 't4', 't5'] as const;
    return tiers[id % 5];
  };

  const getSearchStr = (character: Character) =>
    JSON.stringify({
      _: character.name,
      __: character.details?.ancestry?.name,
      ___: character.details?.class?.name,
      ____: character.details?.background?.name,
      _____: character.details?.info,
    }).toLowerCase();

  const characters =
    data
      ?.filter((c) => {
        if (!getSearchStr(c).includes(searchQuery.toLowerCase())) return false;
        const archived = !!(c.meta_data as Record<string, unknown> | undefined)?.archived;
        if (statusFilter === 'active') return !archived;
        if (statusFilter === 'archived') return archived;
        return true;
      })
      .sort((a, b) => a.name.localeCompare(b.name)) ?? [];

  const activeCount = (data ?? []).filter(
    (c) => !((c.meta_data as Record<string, unknown> | undefined)?.archived)
  ).length;

  return (
    <div className='codex-root wg4'>
      {/* Fullscreen codex loader during the create-character API call.
          Without this, clicking "Forge a New Hero" produces no visible
          response for 5-15 seconds while the upsert + post-create
          navigate runs — users assumed the app froze. The card text
          flips to "Inscribing…" but on the slow path the user never
          sees it because they already scrolled away from the card. */}
      <CodexLoadingOverlay
        visible={loadingCreateCharacter}
        tailMs={0}
      />
      {/* Styled winbar — owns the window drag region + min/max/close
          buttons (Electron's native titleBarOverlay is disabled, see
          electron/main.cjs). */}
      <div className='winbar'>
        <div className='title'>
          <span className='dot'></span>
          <span>
            <b>Wanderer's Codex</b> · Atlas
          </span>
        </div>
        <div className='center'>All your wanderers, in one tome</div>
        <CharactersWinButtons />
      </div>

      <div className='app-header'>
        <div className='brand-line'>
          <span className='sigil'>❦</span>
          <span className='bn'>Wanderer's Codex</span>
        </div>
        <CharactersNavMenu navigate={navigate} />
      </div>

      <div className='hero'>
        <div>
          <div className='eyebrow'>Volume I · The Roster</div>
          <h1>YOUR WANDERERS</h1>
          <div className='lede'>
            {(data ?? []).length === 0
              ? "An empty tome — turn the page and inscribe your first hero."
              : `${(data ?? []).length} ${(data ?? []).length === 1 ? 'soul' : 'souls'} under your stewardship` +
                (activeCount > 0 && activeCount !== (data ?? []).length
                  ? ` — ${activeCount} ${activeCount === 1 ? 'is' : 'are'} in active campaigns.`
                  : '.')}
          </div>
        </div>
      </div>

      <div className='toolbar'>
        <div className='search-strip'>
          <input
            ref={searchRef}
            type='text'
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setSearchQuery('');
                searchRef.current?.blur();
              }
            }}
            placeholder='Search name, ancestry, class, party, feat…'
          />
          <span className='kbd'>/</span>
        </div>
        <div className='seg'>
          <span className={statusFilter === 'all' ? 'on' : ''} onClick={() => setStatusFilter('all')}>
            All
          </span>
          <span
            className={statusFilter === 'active' ? 'on' : ''}
            onClick={() => setStatusFilter('active')}
          >
            Active
          </span>
          <span
            className={statusFilter === 'archived' ? 'on' : ''}
            onClick={() => setStatusFilter('archived')}
          >
            Archived
          </span>
        </div>
        {/* Grid-only view; alphabetical-only sort. The toolbar's
            view-toggle + sort buttons were removed because the user
            doesn't need them — table view was never implemented and
            sort was always alphabetical anyway. */}
        <Menu
          shadow='md'
          width={240}
          opened={importMenuOpened}
          onClose={() => setImportMenuOpened(false)}
          withinPortal
        >
          <Menu.Target>
            <div
              className='iconbtn primary'
              title='New character'
              onClick={() => setImportMenuOpened((o) => !o)}
              style={{ cursor: reachedCharacterLimit ? 'not-allowed' : 'pointer', opacity: reachedCharacterLimit ? 0.5 : 1 }}
            >
              <svg viewBox='0 0 16 16'>
                <path
                  d='M8 2 L8 14 M2 8 L14 8'
                  stroke='currentColor'
                  strokeWidth={2}
                  strokeLinecap='round'
                />
              </svg>
            </div>
          </Menu.Target>
          <Menu.Dropdown>
            <Menu.Label>Begin a new wanderer</Menu.Label>
            <Menu.Item
              onClick={() => {
                setImportMenuOpened(false);
                handleCreateCharacter();
              }}
            >
              Forge from blank
            </Menu.Item>
            <Menu.Item
              onClick={async () => {
                setImportMenuOpened(false);
                setLoadingCreateRandomCharacter(true);
                showNotification({
                  id: 'create-random-character',
                  title: 'Rolling fate…',
                  message: 'Spinning up a random character. This may take a minute.',
                  autoClose: false,
                  withCloseButton: false,
                  loading: true,
                });
                const character = await importFromFTC({
                  version: '1.0',
                  data: {
                    name: 'RANDOM',
                    class: 'RANDOM',
                    background: 'RANDOM',
                    ancestry: 'RANDOM',
                    level: Math.floor(Math.random() * 20) + 1,
                    content_sources: 'ALL',
                    selections: 'RANDOM',
                    items: [],
                    spells: [],
                    conditions: [],
                  },
                });
                hideNotification('create-random-character');
                if (character) navigate(`/sheet/${character.id}`);
                setLoadingCreateRandomCharacter(false);
              }}
            >
              Roll a random hero
            </Menu.Item>
            <Menu.Divider />
            <Menu.Label>Import existing</Menu.Label>
            <Menu.Item
              onClick={() => {
                setImportMenuOpened(false);
                jsonImportRef.current?.click();
              }}
            >
              From JSON file
            </Menu.Item>
            <Menu.Item
              onClick={() => {
                setImportMenuOpened(false);
                setOpenedPathbuilderModal(true);
              }}
            >
              From Pathbuilder
            </Menu.Item>
            <Menu.Item
              onClick={() => {
                setImportMenuOpened(false);
                guidecharImportRef.current?.click();
              }}
            >
              From .guidechar
            </Menu.Item>
          </Menu.Dropdown>
        </Menu>
      </div>

      {/* Hidden file inputs that the import-menu items trigger. */}
      <VisuallyHidden>
        <FileButton
          onChange={async (file) => {
            if (!file) return;
            setLoadingImportCharacter(true);
            await importFromJSON(file);
            refetch();
            setLoadingImportCharacter(false);
          }}
          accept='application/JSON'
        >
          {(props) => (
            <Button ref={jsonImportRef} {...props}>
              Import from JSON
            </Button>
          )}
        </FileButton>
        <FileButton
          onChange={async (file) => {
            if (!file) return;
            setLoadingImportCharacter(true);
            await importFromGUIDECHAR(file);
            refetch();
            setLoadingImportCharacter(false);
          }}
          accept='.guidechar'
        >
          {(props) => (
            <Button ref={guidecharImportRef} {...props}>
              Import from GUIDECHAR
            </Button>
          )}
        </FileButton>
      </VisuallyHidden>
      <PathbuilderInputModal
        open={openedPathbuilderModal}
        onConfirm={async (pathbuilderId) => {
          setOpenedPathbuilderModal(false);
          setLoadingImportCharacter(true);
          await importFromPathbuilder(pathbuilderId);
          refetch();
          setLoadingImportCharacter(false);
        }}
        onClose={() => setOpenedPathbuilderModal(false)}
      />

      <div className='grid'>
        {isLoading && (
          <div style={{ gridColumn: '1 / -1', padding: '40px 0', textAlign: 'center', color: 'var(--ink-muted)', fontFamily: "'Cormorant Garamond', serif", fontStyle: 'italic' }}>
            Gathering wanderers…
          </div>
        )}

        {!isLoading &&
          characters.map((character) => (
            <CharacterCard
              key={character.id}
              character={character}
              portraitTier={portraitTier(character.id)}
              navigate={navigate}
              onRefetch={() => refetch()}
              reachedCharacterLimit={reachedCharacterLimit}
            />
          ))}

        {/* The "forge a new hero" card at the end of the grid. Mirrors
            codex-list.html's .card.add. */}
        {!isLoading && !reachedCharacterLimit && (
          <div
            className='ch-card add'
            onClick={() => handleCreateCharacter()}
            role='button'
            tabIndex={0}
          >
            <div>
              <div className='plus'>
                <span>+</span>
              </div>
              <div className='t'>{loadingCreateCharacter ? 'Inscribing…' : 'Forge a New Hero'}</div>
              <div className='s'>Begin from a blank page, or let the dice decide your fate.</div>
              <div className='actions'>
                <span
                  className='mini-btn'
                  onClick={(e) => {
                    e.stopPropagation();
                    handleCreateCharacter();
                  }}
                >
                  Quick start
                </span>
                <span
                  className='mini-btn'
                  onClick={(e) => {
                    e.stopPropagation();
                    handleCreateCharacter();
                  }}
                >
                  Builder
                </span>
                <span
                  className='mini-btn'
                  onClick={(e) => {
                    e.stopPropagation();
                    jsonImportRef.current?.click();
                  }}
                >
                  Import
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Empty states */}
        {!isLoading && characters.length === 0 && searchQuery.trim() && (
          <div style={{ gridColumn: '1 / -1', padding: '40px 0', textAlign: 'center', color: 'var(--ink-muted)', fontFamily: "'Cormorant Garamond', serif", fontStyle: 'italic' }}>
            No wanderers match “{searchQuery.trim()}”.
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Single card in the roster grid. Codex aesthetic — portrait + name +
 * descriptor row + 3-stat strip + footer with played-when / hero
 * pips / open arrow. Clicking the card navigates to the sheet;
 * clicking the overflow menu (a small dot row inside the card foot)
 * opens copy/export/delete actions.
 *
 * We pull what's possible from the saved character without loading
 * the full operations engine (HP max, AC, and spell DC are computed
 * stats — we surface `hp_current` / `meta_data.hp_max` when present
 * and otherwise show a dash. The sheet renders the live numbers.)
 */
function CharacterCard(props: {
  character: Character;
  portraitTier: 't1' | 't2' | 't3' | 't4' | 't5';
  navigate: ReturnType<typeof useNavigate>;
  onRefetch: () => void;
  reachedCharacterLimit: boolean;
}) {
  const { character, portraitTier, navigate, onRefetch, reachedCharacterLimit } = props;
  const queryClient = useQueryClient();
  const [menuOpened, setMenuOpened] = useState(false);
  const [loading, setLoading] = useState(false);
  // Right-click context menu state. `null` when closed; { x, y } in
  // viewport coords when open. Rendered as a fixed-position div so it
  // floats over the card grid without affecting layout. We close it
  // on document-level mousedown (anywhere outside the menu), on
  // Escape, and after any item action completes.
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null);
  const ctxRef = useRef<HTMLDivElement | null>(null);

  const playable = isPlayable(character);
  const archived = !!(character.meta_data as Record<string, unknown> | undefined)?.archived;
  const initial = character.name?.trim()?.[0]?.toUpperCase() || '?';

  // Close the right-click menu when the user clicks elsewhere or
  // presses Escape. Re-attach on every open so the listener is fresh.
  useEffect(() => {
    if (!ctxMenu) return;
    const onDown = (e: MouseEvent) => {
      if (ctxRef.current && !ctxRef.current.contains(e.target as Node)) setCtxMenu(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setCtxMenu(null);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [ctxMenu]);

  // After the menu mounts, measure it and clamp the position so it
  // never spills past the right or bottom viewport edges. Runs in a
  // layout effect so the correction lands before the browser paints —
  // user never sees the menu in the wrong spot. We only adjust if
  // overflowing; the requested cursor position is honored otherwise.
  useLayoutEffect(() => {
    if (!ctxMenu || !ctxRef.current) return;
    const rect = ctxRef.current.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const pad = 8; // breathing room from edge
    let nx = ctxMenu.x;
    let ny = ctxMenu.y;
    if (nx + rect.width > vw - pad) nx = Math.max(pad, vw - rect.width - pad);
    if (ny + rect.height > vh - pad) ny = Math.max(pad, vh - rect.height - pad);
    if (nx !== ctxMenu.x || ny !== ctxMenu.y) {
      setCtxMenu({ x: nx, y: ny });
    }
  }, [ctxMenu]);

  // hp_current is stored; hp_max sometimes is, sometimes computed.
  // Treat strings or missing as unknown and show a dash.
  const hpMaxRaw = (character as unknown as { hp_max?: number | string }).hp_max;
  const hpMax = typeof hpMaxRaw === 'number' ? hpMaxRaw : undefined;
  const hpCurrent = character.hp_current ?? undefined;
  const hpPct =
    hpMax && hpCurrent != null ? Math.max(0, Math.min(100, (hpCurrent / hpMax) * 100)) : null;
  const hpFillClass = hpPct == null ? 'full' : hpPct >= 75 ? 'full' : hpPct >= 35 ? 'warn' : '';

  // Hero points as 3 diamond pips. character.hero_points clamps to 3.
  const heroPoints = Math.max(
    0,
    Math.min(3, (character as unknown as { hero_points?: number }).hero_points ?? 0)
  );

  const ancestry = character.details?.ancestry?.name ?? '—';
  const className = character.details?.class?.name ?? '—';
  const background = character.details?.background?.name ?? '—';

  const openConfirmDeleteModal = () =>
    modals.openConfirmModal({
      title: <Title order={4}>Delete Character</Title>,
      children: (
        <>
          <Text size='sm'>
            Are you sure you want to delete <em>{character.name}</em>?
          </Text>
          <Text size='sm'>They'll be gone for a very, very long time.</Text>
        </>
      ),
      labels: { confirm: 'Delete', cancel: 'Cancel' },
      onConfirm: async () => {
        await deleteCharacter(character);
        queryClient.refetchQueries({ queryKey: ['find-character'] });
      },
    });

  return (
    <div
      className='ch-card'
      onClick={() => {
        if (!playable) return;
        navigate(`/sheet/${character.id}`);
      }}
      onContextMenu={(e) => {
        // Right-click anywhere on the card opens the quick-action
        // menu (Export/Archive for active; Export/Make Active/Delete
        // for archived). Suppress the browser's default menu so it
        // doesn't fight ours.
        e.preventDefault();
        e.stopPropagation();
        setCtxMenu({ x: e.clientX, y: e.clientY });
      }}
      style={{ opacity: loading ? 0.5 : 1, pointerEvents: loading ? 'none' : 'auto' }}
    >
      <span className='corners-tr'></span>
      <span className='corners-bl'></span>
      <span className={archived ? 'ribbon archived' : playable ? 'ribbon' : 'ribbon unfinished'}>
        {archived ? 'Archived' : playable ? 'Active' : 'Unfinished'}
      </span>

      <div className={`portrait ${portraitTier}`}>
        {initial}
        <div className='level'>{character.level ?? 1}</div>
      </div>

      <div className='ch-info'>
        <div className='nm'>
          {character.name?.toUpperCase() || 'UNNAMED'}
          {background && background !== '—' && <em>, {background}</em>}
        </div>
        <div className='descriptor'>
          {ancestry}
          <i>·</i>
          {className}
          {playable ? null : (
            <>
              <i>·</i>In progress
            </>
          )}
        </div>
        <div className='ch-stats'>
          <div>
            <div className='k'>HP</div>
            <div className={`v ${hpPct != null && hpPct < 75 ? 'crim' : ''}`}>
              {hpCurrent ?? '—'}
              {hpMax ? <small>/{hpMax}</small> : null}
            </div>
            {hpPct != null && (
              <div className='ch-hp-bar'>
                <div
                  className={`fill ${hpFillClass}`}
                  style={{ right: `${100 - hpPct}%` }}
                ></div>
              </div>
            )}
          </div>
          <div>
            <div className='k'>Lvl</div>
            <div className='v'>{character.level ?? 1}</div>
          </div>
          <div>
            <div className='k'>Class</div>
            <div className='v gold' style={{ fontSize: 12, letterSpacing: '.04em' }}>
              {className.length > 10 ? className.slice(0, 10) + '…' : className}
            </div>
          </div>
        </div>
      </div>

      <div className='ch-foot'>
        <div className='l'>
          {/* Hero-point pip strip only — the raw `#<id>` we used to
              show here was the internal database row id, which is
              meaningless to the user (and confusing — they thought it
              was a level or roster number). Dropped per request. */}
          {heroPoints > 0 ? (
            <span style={{ color: 'var(--ink-dim)' }}>
              Hero
              <span className='ch-hp-mini'>
                {[0, 1, 2].map((i) => (
                  <span key={i} className={i < heroPoints ? 'pip full' : 'pip'}></span>
                ))}
              </span>
            </span>
          ) : (
            // Keep an empty span so the flex row's spacing stays
            // identical whether or not the hero-point chip is shown.
            <span />
          )}
        </div>
        <Menu
          shadow='md'
          width={210}
          opened={menuOpened}
          onClose={() => setMenuOpened(false)}
          withinPortal
        >
          <Menu.Target>
            <span
              className='open'
              onClick={(e) => {
                e.stopPropagation();
                setMenuOpened((o) => !o);
              }}
              style={{ cursor: 'pointer' }}
            >
              ⋯
            </span>
          </Menu.Target>
          <Menu.Dropdown>
            <Menu.Item
              onClick={(e) => {
                e.stopPropagation();
                navigate(`/builder/${character.id}`);
              }}
            >
              {playable ? 'Edit in Builder' : 'Continue Building'}
            </Menu.Item>
            <Menu.Item
              disabled={reachedCharacterLimit}
              onClick={async (e) => {
                e.stopPropagation();
                await createCharacterCopy(character);
                onRefetch();
              }}
            >
              Create copy
            </Menu.Item>
            <Menu.Item
              onClick={(e) => {
                e.stopPropagation();
                window.open(`/stat-block/character/${character.id}`, '_blank');
              }}
            >
              Open stat block
            </Menu.Item>
            <Menu.Item
              onClick={async (e) => {
                e.stopPropagation();
                setLoading(true);
                await exportToJSON(character);
                setLoading(false);
              }}
            >
              Export to JSON
            </Menu.Item>
            <Menu.Item
              onClick={async (e) => {
                e.stopPropagation();
                setLoading(true);
                await exportToPDF(character);
                setLoading(false);
              }}
            >
              Export to PDF
            </Menu.Item>
            <Menu.Divider />
            <Menu.Item
              color='red'
              onClick={(e) => {
                e.stopPropagation();
                openConfirmDeleteModal();
              }}
            >
              Delete
            </Menu.Item>
          </Menu.Dropdown>
        </Menu>
        <span
          className='open'
          onClick={(e) => {
            e.stopPropagation();
            if (playable) navigate(`/sheet/${character.id}`);
            else navigate(`/builder/${character.id}`);
          }}
        >
          {playable ? 'Open' : 'Continue'}
        </span>
      </div>

      {/* Right-click context menu. Portaled to document.body — if we
          rendered inside `.ch-card`, the hover-state `transform:
          translateY(-1px)` on the card would re-parent fixed-position
          coordinates to the card itself, and the menu would jump
          around as the hover flickers between card and menu. The
          portal puts it as a sibling of <App> with no transformed
          ancestor, so `position: fixed` anchors to the viewport like
          it should.

          Item set depends on whether the character is archived:
            active   → Export to JSON, Archive
            archived → Export to JSON, Make Active, Delete
          (Edit-in-builder, copy, stat block, PDF still live in the
          ⋯ overflow menu — this is the quick-action subset only.) */}
      {ctxMenu && createPortal(
        <div
          ref={ctxRef}
          role='menu'
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
          style={{
            position: 'fixed',
            left: ctxMenu.x,
            top: ctxMenu.y,
            minWidth: 180,
            background: 'var(--bg-card)',
            border: '1px solid var(--rule-soft)',
            boxShadow: '0 8px 24px rgba(0,0,0,.35)',
            padding: '4px 0',
            zIndex: 10000,
            fontFamily: 'inherit',
            color: 'var(--ink)',
          }}
        >
          <button
            type='button'
            onClick={async (e) => {
              e.stopPropagation();
              setCtxMenu(null);
              setLoading(true);
              await exportToJSON(character);
              setLoading(false);
            }}
            style={ctxItemStyle}
          >
            Export to JSON
          </button>
          {archived ? (
            <>
              <button
                type='button'
                onClick={async (e) => {
                  e.stopPropagation();
                  setCtxMenu(null);
                  setLoading(true);
                  await setCharacterArchived(character, false);
                  setLoading(false);
                  onRefetch();
                }}
                style={ctxItemStyle}
              >
                Make Active
              </button>
              <div style={ctxDividerStyle} />
              <button
                type='button'
                onClick={(e) => {
                  e.stopPropagation();
                  setCtxMenu(null);
                  openConfirmDeleteModal();
                }}
                style={{ ...ctxItemStyle, color: 'var(--accent-crimson, #b34a4a)' }}
              >
                Delete
              </button>
            </>
          ) : (
            <button
              type='button'
              onClick={async (e) => {
                e.stopPropagation();
                setCtxMenu(null);
                setLoading(true);
                await setCharacterArchived(character, true);
                setLoading(false);
                onRefetch();
              }}
              style={ctxItemStyle}
            >
              Archive
            </button>
          )}
        </div>,
        document.body
      )}
    </div>
  );
}

// Native-button styling for the right-click menu items. Kept as
// module-level constants so each item doesn't allocate a fresh object
// every render. `as const` keeps TS happy about literal-string values
// like 'block' and 'transparent' fitting CSSProperties.
const ctxItemStyle = {
  display: 'block',
  width: '100%',
  textAlign: 'left',
  padding: '8px 14px',
  background: 'transparent',
  border: 'none',
  color: 'inherit',
  font: 'inherit',
  cursor: 'pointer',
} as const;
const ctxDividerStyle = {
  height: 1,
  background: 'var(--rule-soft)',
  margin: '4px 0',
} as const;

async function createCharacter() {
  const images = getAllBackgroundImages();
  const randomImageUrl = images[Math.floor(Math.random() * images.length)]?.url;

  const result = await makeRequest<Character>('create-character', {
    meta_data: { reset_hp: true },
    details: { background_image_url: randomImageUrl },
  });
  return result;
}

/**
 * Toggle a character's archived flag. The "archived" state lives in
 * `meta_data.archived` — there's no dedicated column; the segmented
 * filter on the toolbar reads the same field. We merge instead of
 * replacing `meta_data` so we don't clobber other fields like
 * `reset_hp`, `dice_history`, etc.
 *
 * Shows a transient notification while the request is in flight so
 * the user knows the action took.
 */
async function setCharacterArchived(character: Character, archived: boolean) {
  const verb = archived ? 'Archiving' : 'Restoring';
  const notifId = `archive-character-${character.id}`;
  showNotification({
    id: notifId,
    title: `${verb} "${character.name}"`,
    message: 'Please wait…',
    autoClose: false,
    withCloseButton: false,
    loading: true,
  });
  const prevMeta = (character.meta_data ?? {}) as Record<string, unknown>;
  await makeRequest('update-character', {
    id: character.id,
    meta_data: { ...prevMeta, archived },
  });
  hideNotification(notifId);
  showNotification({
    title: archived ? 'Archived' : 'Made active',
    message: archived
      ? `"${character.name}" has been moved to the archive.`
      : `"${character.name}" is active again.`,
    autoClose: 2500,
  });
}

async function deleteCharacter(character: Character) {
  showNotification({
    id: `delete-character-${character.id}`,
    title: `Deleting "${character.name}"`,
    message: 'Please wait…',
    autoClose: false,
    withCloseButton: false,
    loading: true,
  });

  const result = await makeRequest('delete-content', {
    id: character.id,
    type: 'character',
  });

  hideNotification(`delete-character-${character.id}`);
  return result;
}

async function createCharacterCopy(character: Character) {
  showNotification({
    id: `copy-character-${character.id}`,
    title: `Creating copy of "${character.name}"`,
    message: 'Please wait…',
    autoClose: false,
    withCloseButton: false,
    loading: true,
  });

  const copy = {
    ...character,
    id: undefined,
    name: `(Copy) ${character.name}`,
    roll_history: undefined,
  };

  const result = await makeRequest<Character>('create-character', copy);
  hideNotification(`copy-character-${character.id}`);
  return result;
}

// Bare-metal hamburger nav menu (matches CodexSheet's CodexNavMenu).
// No Mantine Menu — native button + manually rendered dropdown so
// clicks definitely fire (Mantine's wrappers silently failed for
// the user across four attempts).
function CharactersNavMenu(props: { navigate: (path: string) => void }) {
  const [open, setOpen] = useState(false);
  const [ref, setRef] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const onDocMouseDown = (e: MouseEvent) => {
      if (ref && !ref.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, [open, ref]);

  const items = [
    { label: 'Characters', path: '/characters' },
    { label: 'Homebrew', path: '/homebrew' },
    { label: 'Settings', path: '/account' },
  ];

  return (
    <div ref={setRef} style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
      <button
        type='button'
        title='Open menu'
        aria-label='Menu'
        aria-expanded={open}
        aria-haspopup='menu'
        onClick={(e) => {
          e.stopPropagation();
          // eslint-disable-next-line no-console
          console.log('[CharactersNavMenu] clicked, open ->', !open);
          setOpen((o) => !o);
        }}
        style={{
          width: 40,
          height: 40,
          background: 'var(--bg-card)',
          border: '1px solid var(--rule-soft)',
          color: 'var(--gold)',
          cursor: 'pointer',
          padding: 0,
          display: 'grid',
          placeItems: 'center',
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
            minWidth: 180,
            background: 'var(--bg-2)',
            border: '1px solid var(--rule)',
            boxShadow: '0 8px 20px rgba(0, 0, 0, 0.6)',
            zIndex: 9999,
            padding: '6px 0',
          }}
        >
          {items.map((item) => (
            <button
              key={item.path}
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
                (e.currentTarget as HTMLButtonElement).style.color = 'var(--gold-bright)';
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
                (e.currentTarget as HTMLButtonElement).style.color = 'var(--ink)';
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// Custom min/max/close for the characters-list .winbar. Same wiring
// as CodexSheet's WinButtons — calls Electron via the wgElectron
// preload bridge. Kept inline here so the routes don't have to share
// a component file just for three svg buttons.
function CharactersWinButtons() {
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
