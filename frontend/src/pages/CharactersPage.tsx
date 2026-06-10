import CodexLoadingOverlay from '@common/CodexLoadingOverlay';
import { characterState } from '@atoms/characterAtoms';
import { sessionState } from '@atoms/supabaseAtoms';
import { getCachedPublicUser, getPublicUser } from '@auth/user-manager';
import { CHARACTER_SLOT_CAP } from '@constants/data';
import { resetContentStore } from '@content/content-store';
import exportToJSON from '@export/export-to-json';
import exportToPDF from '@export/export-to-pdf';
import importFromGUIDECHAR from '@import/guidechar/import-from-guidechar';
import importFromJSON from '@import/json/import-from-json';
import PathbuilderInputModal from '@import/pathbuilder/PathbuilderInputModal';
import { importFromPathbuilder } from '@import/pathbuilder/import-from-pathbuilder';
import {
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
import { accentVars } from '@utils/accent-color';
import { isPlayable } from '@utils/character';
import { getAllBackgroundImages } from '@utils/background-images';
import { setPageTitle } from '@utils/document-change';
import { hasPatreonAccess } from '@utils/patreon';
import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { useAtom, useAtomValue } from 'jotai';

/**
 * /characters — Codex Atlas roster page.
 *
 * Ported from `D:\Inst\Characters (2).html` — DOM structure and class
 * names match the mockup. Styles live in css/wg4-atlas.css under the
 * `.wg4` scope. Outer wrapper is `.codex-root.wg4` so the wg4 token
 * vars resolve; inner `.app` is the max-width 1680px container.
 *
 * Data wiring is unchanged from the previous implementation:
 *   - React-Query `find-character` for the roster
 *   - createCharacter / setCharacterArchived / deleteCharacter /
 *     createCharacterCopy mutations
 *   - importFromJSON, importFromPathbuilder, importFromGUIDECHAR
 *   - Electron min/max/close via the wgElectron preload bridge
 *   - `/` keyboard hotkey focuses the search input
 *   - Patreon-aware CHARACTER_SLOT_CAP
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
    // Always pull a fresh roster when this page is shown, so the cards reflect
    // the latest persisted hero points / HP / level rather than a stale cache
    // (the hero-point pips were showing a cached count that lagged the sheet).
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
  });

  const [_character, setCharacter] = useAtom(characterState);
  const navigate = useNavigate();

  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'archived'>('all');

  const [loadingImportCharacter, setLoadingImportCharacter] = useState(false);
  const [loadingCreateCharacter, setLoadingCreateCharacter] = useState(false);

  const jsonImportRef = useRef<HTMLButtonElement>(null);
  const guidecharImportRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [openedPathbuilderModal, setOpenedPathbuilderModal] = useState(false);

  const forceUpdate = useForceUpdate();

  // Press '/' anywhere to jump focus to the search input.
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

  const getSearchStr = (character: Character) =>
    JSON.stringify({
      _: character.name,
      __: character.details?.ancestry?.name,
      ___: character.details?.class?.name,
      ____: character.details?.background?.name,
      _____: character.details?.info,
    }).toLowerCase();

  const allCharacters = data ?? [];
  const characters = allCharacters
    .filter((c) => {
      if (!getSearchStr(c).includes(searchQuery.toLowerCase())) return false;
      const archived = !!(c.meta_data as Record<string, unknown> | undefined)?.archived;
      if (statusFilter === 'active') return !archived;
      if (statusFilter === 'archived') return archived;
      return true;
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  const total = allCharacters.length;
  const activeCount = allCharacters.filter(
    (c) => !((c.meta_data as Record<string, unknown> | undefined)?.archived)
  ).length;

  const lede = total === 0
    ? 'An empty tome — turn the page and inscribe your first hero.'
    : `${total} ${total === 1 ? 'soul' : 'souls'} under your stewardship` +
      (activeCount > 0 && activeCount !== total
        ? ` — ${activeCount} ${activeCount === 1 ? 'is' : 'are'} in active campaigns.`
        : activeCount === total
        ? ` — ${activeCount === 1 ? 'in an active campaign.' : 'all in active campaigns.'}`
        : '.');

  const w = (window as unknown as {
    wgElectron?: {
      windowMinimize?: () => void;
      windowMaximize?: () => void;
      windowClose?: () => void;
    };
  }).wgElectron;

  return (
    <div className='codex-root wg4'>
      <CodexLoadingOverlay
        visible={loadingCreateCharacter || loadingImportCharacter}
        tailMs={0}
      />

      {/* Top winbar + app header — OUTSIDE .app so they span the full
          window width. The .app container constrains the roster grid
          to 1680px but the window chrome (min/max/close + brand) must
          stretch corner-to-corner. */}
      <div className='winbar'>
        <div className='brand'>
          <span className='mark'></span>
          <span className='name'>
            Wanderer's <em>Codex</em> · Atlas
          </span>
        </div>
        <div className='center'>All your wanderers, in one tome</div>
        <div className='wbtns'>
          <button className='wbtn' aria-label='Minimize' title='Minimize' onClick={() => w?.windowMinimize?.()}>
            <svg viewBox='0 0 10 10'>
              <path d='M1 8 L9 8' />
            </svg>
          </button>
          <button className='wbtn' aria-label='Maximize' title='Maximize' onClick={() => w?.windowMaximize?.()}>
            <svg viewBox='0 0 10 10'>
              <path d='M1 1 L9 1 L9 9 L1 9 Z' />
            </svg>
          </button>
          <button className='wbtn close' aria-label='Close' title='Close' onClick={() => w?.windowClose?.()}>
            <svg viewBox='0 0 10 10'>
              <path d='M1 1 L9 9 M9 1 L1 9' />
            </svg>
          </button>
        </div>
      </div>

      {/* App header — sigil + brand name on left, hamburger on right.
          Full-width too so the hamburger sits in the corner. */}
      <div className='app-header'>
        <div className='brand-line'>
          <span className='sigil' aria-hidden='true'>❦</span>
          <span className='bn'>Wanderer's Codex</span>
        </div>
        <CharactersNavMenu navigate={navigate} />
      </div>

      <div className='app'>

        {/* Hero strip — eyebrow + big italic title + lede. */}
        <div className='hero'>
          <div className='eyebrow'>Volume I · The Roster</div>
          <h1>Your Wanderers</h1>
          <div className='lede'>{lede}</div>
        </div>

        {/* Toolbar — search + filter pills + add button. */}
        <div className='toolbar'>
          <div className='search-strip'>
            <span className='ico'>
              <svg viewBox='0 0 16 16' fill='none' stroke='currentColor' strokeWidth='1.5' strokeLinecap='round'>
                <circle cx='7' cy='7' r='4.5' />
                <line x1='10.3' y1='10.3' x2='13.5' y2='13.5' />
              </svg>
            </span>
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

          <div className='seg' role='tablist'>
            {(['all', 'active', 'archived'] as const).map((s) => (
              <span
                key={s}
                role='tab'
                aria-selected={statusFilter === s}
                className={statusFilter === s ? 'on' : ''}
                onClick={() => setStatusFilter(s)}
              >
                {s}
              </span>
            ))}
          </div>

          <button
            type='button'
            className='iconbtn'
            title='New character'
            aria-label='New character'
            onClick={() => handleCreateCharacter()}
            disabled={reachedCharacterLimit}
          >
            <svg viewBox='0 0 16 16' fill='none' stroke='currentColor' strokeWidth='2' strokeLinecap='round'>
              <line x1='8' y1='3' x2='8' y2='13' />
              <line x1='3' y1='8' x2='13' y2='8' />
            </svg>
          </button>

          <button
            type='button'
            className='iconbtn'
            title='Import character (.json)'
            aria-label='Import character'
            onClick={() => jsonImportRef.current?.click()}
            disabled={reachedCharacterLimit}
          >
            <svg viewBox='0 0 16 16' fill='none' stroke='currentColor' strokeWidth='1.7' strokeLinecap='round' strokeLinejoin='round'>
              <path d='M8 2.5 L8 9.5' />
              <path d='M5.2 6.8 L8 9.6 L10.8 6.8' />
              <path d='M3 10.5 L3 13 L13 13 L13 10.5' />
            </svg>
          </button>
        </div>

        {/* Hidden file inputs the import buttons trigger. */}
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

        {/* Roster grid. */}
        <div className='grid'>
          {isLoading && <div className='empty'>Gathering wanderers…</div>}

          {!isLoading &&
            characters.map((character) => (
              <CharacterCard
                key={character.id}
                character={character}
                navigate={navigate}
                onRefetch={() => refetch()}
                reachedCharacterLimit={reachedCharacterLimit}
              />
            ))}

          {/* Forge tile — always last in the grid. */}
          {!isLoading && !reachedCharacterLimit && (
            <AddCard
              loadingCreate={loadingCreateCharacter}
              onBuilder={handleCreateCharacter}
              onImport={() => jsonImportRef.current?.click()}
              onPathbuilder={() => setOpenedPathbuilderModal(true)}
              onGuidechar={() => guidecharImportRef.current?.click()}
            />
          )}

          {!isLoading && characters.length === 0 && searchQuery.trim() && (
            <div className='empty'>
              No wanderers match &ldquo;{searchQuery.trim()}&rdquo;.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Deterministic tier (t1..t5) from a character id so the same
 * character always gets the same portrait gradient.
 */
function tierForId(id: number): 't1' | 't2' | 't3' | 't4' | 't5' {
  const n = Math.abs(id) % 5;
  return (['t1', 't2', 't3', 't4', 't5'] as const)[n];
}

/** Validate a hex color (with or without leading #). */
function isHexColor(s: string | undefined | null): s is string {
  if (!s) return false;
  const stripped = s.startsWith('#') ? s.slice(1) : s;
  return /^[0-9a-fA-F]{3,8}$/.test(stripped);
}

/**
 * Hero-points display for a roster card. Fetches THIS character's hero points
 * fresh from the DB on its own query key (`['card-hero-points', id]`), so it is
 * immune to the roster list cache or optimistic sheet edits going stale — the
 * exact failure that kept the old inline pips showing a wrong count. Refetches
 * on mount and on window focus, and renders one filled diamond per hero point
 * held (inline-styled so the fill can't be lost).
 */
function HeroPips(props: { characterId: number; fallbackHeroPoints: number }) {
  const { data } = useQuery({
    queryKey: ['card-hero-points', props.characterId],
    queryFn: async () => {
      const ch = await makeRequest<Character>('find-character', { id: props.characterId });
      const hp = (ch as { hero_points?: number } | null)?.hero_points;
      return Math.max(0, Math.min(3, typeof hp === 'number' ? hp : 0));
    },
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
  });
  const hero = data ?? Math.max(0, Math.min(3, props.fallbackHeroPoints ?? 0));
  return (
    <>
      <span>Hero</span>
      <span
        role='img'
        aria-label={`${hero} of 3 hero points`}
        style={{ display: 'inline-flex', gap: 5, alignItems: 'center', marginLeft: 2 }}
      >
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            style={{
              width: 9,
              height: 9,
              display: 'inline-block',
              transform: 'rotate(45deg)',
              borderRadius: 1,
              boxSizing: 'border-box',
              border: '1.5px solid var(--wg4-accent)',
              // Filled diamond per hero point held; hollow otherwise. Inline so
              // it can't be defeated by the .pip.full rule that wasn't rendering.
              background: i < hero ? 'var(--wg4-accent)' : 'transparent',
            }}
          />
        ))}
      </span>
    </>
  );
}

/**
 * Single roster card — portrait + name/role/stats + foot row
 * (hero pips on left, ⋯ menu + OPEN button on right). Only the
 * portrait and the OPEN button navigate to the sheet; the rest of
 * the card is intentionally NOT a click target so the user can hit
 * HP/stat values, the … menu, or empty space without triggering a
 * navigation away.
 */
function CharacterCard(props: {
  character: Character;
  navigate: ReturnType<typeof useNavigate>;
  onRefetch: () => void;
  reachedCharacterLimit: boolean;
}) {
  const { character, navigate, onRefetch, reachedCharacterLimit } = props;
  const queryClient = useQueryClient();
  const [menuOpened, setMenuOpened] = useState(false);
  const [loading, setLoading] = useState(false);
  // Right-click context menu state. `null` when closed; { x, y } in
  // viewport coords when open. Rendered as a fixed-position portaled
  // div so it floats over the grid without affecting layout.
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null);
  const ctxRef = useRef<HTMLDivElement | null>(null);

  const playable = isPlayable(character);
  const archived = !!(character.meta_data as Record<string, unknown> | undefined)?.archived;
  const initial = character.name?.trim()?.[0]?.toUpperCase() || '?';
  // Character portrait, if one was chosen in the builder. When present it
  // fills the portrait tile (cover) and replaces the initial-letter
  // placeholder; otherwise we fall back to the theme color / tier gradient.
  const portraitUrl = character.details?.image_url || undefined;

  // Close right-click menu on outside click / Escape.
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

  // Clamp the right-click menu's viewport position so it never spills
  // past the right or bottom edges.
  useLayoutEffect(() => {
    if (!ctxMenu || !ctxRef.current) return;
    const rect = ctxRef.current.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const pad = 8;
    let nx = ctxMenu.x;
    let ny = ctxMenu.y;
    if (nx + rect.width > vw - pad) nx = Math.max(pad, vw - rect.width - pad);
    if (ny + rect.height > vh - pad) ny = Math.max(pad, vh - rect.height - pad);
    if (nx !== ctxMenu.x || ny !== ctxMenu.y) {
      setCtxMenu({ x: nx, y: ny });
    }
  }, [ctxMenu]);

  // HP — may or may not have a max stored.
  const hpMaxRaw = (character as unknown as { hp_max?: number | string }).hp_max;
  const hpMax = typeof hpMaxRaw === 'number' ? hpMaxRaw : undefined;
  const hpCurrent = character.hp_current ?? undefined;
  const hpPct =
    hpMax && hpCurrent != null
      ? Math.max(0, Math.min(100, (hpCurrent / hpMax) * 100))
      : hpCurrent != null
        ? 100
        : 100;
  const hpFillClass = hpPct >= 75 ? 'full' : hpPct >= 35 ? '' : 'warn';
  const hpVClass = hpPct < 75 ? 'crim' : '';

  const heroPoints = Math.max(0, Math.min(3, character.hero_points ?? 0));

  const ancestry = character.details?.ancestry?.name ?? '—';
  const className = character.details?.class?.name ?? '—';
  const background = character.details?.background?.name ?? '';

  // Status ribbon — active / archived / unfinished.
  const statusClass = archived ? 'archived' : playable ? 'active' : 'unfinished';
  const statusLabel = archived ? 'Archived' : playable ? 'Active' : 'Unfinished';

  // Portrait tile — prefer a custom sheet-theme hex color, else fall
  // back to a deterministic t1..t5 gradient from the id.
  const themeColor = character.details?.sheet_theme?.color;
  const hasThemeColor = isHexColor(themeColor);
  const themeHex = hasThemeColor
    ? (themeColor!.startsWith('#') ? themeColor! : `#${themeColor!}`)
    : undefined;
  const tier = tierForId(character.id);

  // Tint the whole card to the character's own accent — the same luminance-
  // clamped colour the sheet uses — so each card matches its character. We set
  // both the wg4 vars and the screen-alias vars on the card root; the hero
  // pips, class label, corner marks, etc. read those. No custom colour set →
  // leave the page-default accent in place.
  const cardAccent = hasThemeColor ? accentVars(themeHex!) : null;
  const accentVarStyle = cardAccent
    ? ({
        '--wg4-accent': cardAccent['--wg4-accent'],
        '--wg4-accent-soft': cardAccent['--wg4-accent-soft'],
        '--wg4-accent-ink': cardAccent['--wg4-accent-ink'],
        '--accent': cardAccent['--wg4-accent'],
        '--accent-soft': cardAccent['--wg4-accent-soft'],
        '--accent-ink': cardAccent['--wg4-accent-ink'],
      } as React.CSSProperties)
    : undefined;

  const openSheet = () => {
    if (!playable) {
      navigate(`/builder/${character.id}`);
      return;
    }
    navigate(`/sheet/${character.id}`);
  };

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

  // Single source of truth for the card's quick actions, rendered by BOTH the
  // ⋯ menu and the right-click context menu so the two always match. `divider`
  // draws a separator before the item.
  const cardActions: {
    label: string;
    run: () => void;
    disabled?: boolean;
    danger?: boolean;
    divider?: boolean;
  }[] = [
    {
      label: playable ? 'Edit in Builder' : 'Continue Building',
      run: () => navigate(`/builder/${character.id}`),
    },
    {
      label: 'Create copy',
      disabled: reachedCharacterLimit,
      run: async () => {
        await createCharacterCopy(character);
        onRefetch();
      },
    },
    {
      label: 'Open stat block',
      run: () => window.open(`/stat-block/character/${character.id}`, '_blank'),
    },
    {
      label: 'Export to JSON',
      run: async () => {
        setLoading(true);
        await exportToJSON(character);
        setLoading(false);
      },
    },
    {
      label: 'Export to PDF',
      run: async () => {
        setLoading(true);
        await exportToPDF(character);
        setLoading(false);
      },
    },
    archived
      ? {
          label: 'Make Active',
          divider: true,
          run: async () => {
            setLoading(true);
            await setCharacterArchived(character, false);
            setLoading(false);
            onRefetch();
          },
        }
      : {
          label: 'Archive',
          divider: true,
          run: async () => {
            setLoading(true);
            await setCharacterArchived(character, true);
            setLoading(false);
            onRefetch();
          },
        },
    {
      label: 'Delete',
      danger: true,
      run: () => {
        // Only archived characters can be deleted. For an active one, point the
        // user at Archive first rather than deleting outright.
        if (!archived) {
          showNotification({
            title: 'Archive before deleting',
            message: "Active characters can't be deleted directly. Archive this character first, then delete it.",
            color: 'yellow',
          });
          return;
        }
        openConfirmDeleteModal();
      },
    },
  ];

  return (
    <div
      className='ch-card'
      onClick={openSheet}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setCtxMenu({ x: e.clientX, y: e.clientY });
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          openSheet();
        }
      }}
      role='button'
      tabIndex={0}
      aria-label={`Open ${character.name || 'character'}`}
      style={{
        ...accentVarStyle,
        opacity: loading ? 0.5 : 1,
        pointerEvents: loading ? 'none' : 'auto',
        cursor: 'pointer',
      }}
    >
      <span className='corners-tr'></span>
      <span className='corners-bl'></span>
      <span className={`ribbon ${statusClass}`}>{statusLabel}</span>

      {/* Portrait tile. Whole card is now clickable so we don't need
          the explicit onClick handler on the portrait. */}
      <div
        className={`ch-portrait ${portraitUrl || hasThemeColor ? '' : tier}`}
        style={hasThemeColor && !portraitUrl ? { background: themeHex, backgroundImage: 'none' } : undefined}
        aria-hidden='true'
      >
        {portraitUrl ? (
          // Render the portrait as a real <img> (like the builder does) rather
          // than a CSS background — a CSS url() resolves relative to the
          // stylesheet, which breaks the builder's document-relative portrait
          // paths in the packaged app, leaving the tile blank. object-fit:cover
          // fills the tile and the level badge stays on top.
          <img
            src={portraitUrl}
            alt=''
            style={{
              position: 'absolute',
              inset: 0,
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              borderRadius: 'inherit',
              display: 'block',
            }}
          />
        ) : (
          <span>{initial}</span>
        )}
        <div className='level'>{character.level ?? 1}</div>
      </div>

      <div className='ch-info'>
        <div className='nm'>
          {(character.name || 'UNNAMED').toUpperCase()}
          {background ? <em>, {background}</em> : null}
        </div>
        <div className='descriptor'>
          {ancestry !== '—' ? ancestry : '—'}
          <i>·</i>
          {className !== '—' ? className : '—'}
        </div>
        <div className='ch-stats'>
          <div>
            <div className='k'>HP</div>
            <div className={`v ${hpVClass}`}>
              {hpCurrent ?? '—'}
              {hpMax ? <small>/{hpMax}</small> : null}
            </div>
            <div className='ch-hp-bar'>
              <div className={`fill ${hpFillClass}`} style={{ width: `${hpPct}%` }}></div>
            </div>
          </div>
          <div>
            <div className='k'>Lvl</div>
            <div className='v'>{character.level ?? 1}</div>
          </div>
          <div>
            <div className='k'>Class</div>
            <div className='v gold'>{className !== '—' ? className : '—'}</div>
          </div>
        </div>
      </div>

      <div className='ch-foot'>
        <div className='l'>
          <HeroPips characterId={character.id} fallbackHeroPoints={heroPoints} />
        </div>
        <div className='r'>
          <Menu
            shadow='md'
            width={210}
            opened={menuOpened}
            onClose={() => setMenuOpened(false)}
            withinPortal
          >
            <Menu.Target>
              <button
                type='button'
                className='more'
                aria-label='More actions'
                title='More'
                onClick={(e) => {
                  e.stopPropagation();
                  setMenuOpened((o) => !o);
                }}
              >
                ⋯
              </button>
            </Menu.Target>
            <Menu.Dropdown>
              {cardActions.map((a) => (
                <Fragment key={a.label}>
                  {a.divider && <Menu.Divider />}
                  <Menu.Item
                    color={a.danger ? 'red' : undefined}
                    className={a.danger ? 'menu-item-danger' : undefined}
                    disabled={a.disabled}
                    onClick={(e) => {
                      e.stopPropagation();
                      void a.run();
                    }}
                  >
                    {a.danger ? <span style={{ color: 'var(--crimson)' }}>{a.label}</span> : a.label}
                  </Menu.Item>
                </Fragment>
              ))}
            </Menu.Dropdown>
          </Menu>
        </div>
      </div>

      {/* Right-click quick-action menu (portaled). Wrapped in `.wg4`
          so the token vars resolve inside the body portal. */}
      {ctxMenu && createPortal(
        <div className='wg4'>
          <div
            ref={ctxRef}
            role='menu'
            onClick={(e) => e.stopPropagation()}
            onContextMenu={(e) => e.preventDefault()}
            className='ch-ctxmenu'
            style={{
              position: 'fixed',
              left: ctxMenu.x,
              top: ctxMenu.y,
            }}
          >
            {cardActions.map((a) => (
              <Fragment key={a.label}>
                {a.divider && <div className='ch-ctxmenu-divider' />}
                <button
                  type='button'
                  disabled={a.disabled}
                  onClick={(e) => {
                    e.stopPropagation();
                    setCtxMenu(null);
                    void a.run();
                  }}
                  className={`ch-ctxmenu-item${a.danger ? ' danger' : ''}`}
                  style={a.disabled ? { opacity: 0.4, cursor: 'not-allowed' } : undefined}
                >
                  {a.label}
                </button>
              </Fragment>
            ))}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

/**
 * "Forge a New Hero" tile — last cell of the grid. Two mini buttons:
 *  - Builder (creates a blank character and navigates to /builder)
 *  - Import (file picker for .json)
 *
 * The whole tile is also clickable (defaults to Builder) per the
 * mockup's outer onClick.
 */
function AddCard(props: {
  loadingCreate: boolean;
  onBuilder: () => void;
  onImport: () => void;
  onPathbuilder: () => void;
  onGuidechar: () => void;
}) {
  const { loadingCreate, onBuilder, onImport } = props;
  return (
    <div
      className='ch-card add'
      onClick={onBuilder}
      role='button'
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onBuilder();
        }
      }}
    >
      <div className='plus'>+</div>
      <div className='t'>{loadingCreate ? 'Inscribing…' : 'Forge a New Hero'}</div>
      <div className='s'>Begin from a blank page, or let the dice decide your fate.</div>
      <div className='actions'>
        <button
          type='button'
          className='mini-btn'
          onClick={(e) => {
            e.stopPropagation();
            onBuilder();
          }}
        >
          Builder
        </button>
        <button
          type='button'
          className='mini-btn'
          onClick={(e) => {
            e.stopPropagation();
            onImport();
          }}
        >
          Import
        </button>
      </div>
    </div>
  );
}

async function createCharacter() {
  const images = getAllBackgroundImages();
  const randomImageUrl = images[Math.floor(Math.random() * images.length)]?.url;

  // Seed the new character's accent from the global Settings accent so it opens
  // in the user's preferred colour (still editable per-character in the
  // builder). Omitted when no global accent is set, so the app default applies.
  const defaultAccent = getCachedPublicUser()?.site_theme?.color;

  const result = await makeRequest<Character>('create-character', {
    meta_data: { reset_hp: true },
    details: {
      background_image_url: randomImageUrl,
      ...(defaultAccent ? { sheet_theme: { color: defaultAccent } } : {}),
    },
  });
  return result;
}

/**
 * Toggle a character's archived flag. The "archived" state lives in
 * `meta_data.archived` — there's no dedicated column. We merge
 * instead of replacing `meta_data` so we don't clobber other fields
 * (reset_hp, dice_history, etc.). Shows a transient notification
 * while the request is in flight.
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

/**
 * Hamburger nav menu — uses the mockup's `.nav-menu` button. Wraps
 * itself in a relative-positioned span so the dropdown anchors to the
 * button correctly. Click-outside closes.
 */
function CharactersNavMenu(props: { navigate: (path: string) => void }) {
  const [open, setOpen] = useState(false);
  const [ref, setRef] = useState<HTMLSpanElement | null>(null);
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
    <span ref={setRef} className='nav-menu-wrap'>
      <button
        type='button'
        className='nav-menu'
        title='Open menu'
        aria-label='Menu'
        aria-expanded={open}
        aria-haspopup='menu'
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
      >
        <svg viewBox='0 0 16 16' fill='none' stroke='currentColor' strokeWidth='1.5' strokeLinecap='round'>
          <line x1='3' y1='5' x2='13' y2='5' />
          <line x1='3' y1='8' x2='13' y2='8' />
          <line x1='3' y1='11' x2='13' y2='11' />
        </svg>
      </button>
      {open && (
        <div role='menu' className='nav-menu-dropdown'>
          {items.map((item) => (
            <button
              key={item.path}
              type='button'
              onClick={() => {
                setOpen(false);
                props.navigate(item.path);
              }}
              className='nav-menu-item'
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </span>
  );
}
