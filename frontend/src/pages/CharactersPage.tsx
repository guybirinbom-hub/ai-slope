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
  Box,
  Button,
  FileButton,
  Menu,
  Text,
  Title,
  UnstyledButton,
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
import { useEffect, useRef, useState } from 'react';
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
    <div className='codex-root'>
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
        {/* Hamburger menu — uncontrolled Mantine Menu wrapping
            UnstyledButton (Mantine's canonical Menu.Target host).
            Refs forward cleanly; auto-injected click handler attaches. */}
        <Menu position='bottom-end' width={180} withinPortal shadow='md'>
          <Menu.Target>
            <UnstyledButton className='menu' title='Open menu' aria-label='Menu'>
              <div className='lines'>
                <span></span>
                <span></span>
                <span></span>
              </div>
            </UnstyledButton>
          </Menu.Target>
          <Menu.Dropdown>
            <Menu.Label>Navigate</Menu.Label>
            <Menu.Item onClick={() => navigate('/characters')}>Characters</Menu.Item>
            <Menu.Item onClick={() => navigate('/homebrew')}>Homebrew</Menu.Item>
            <Menu.Item onClick={() => navigate('/account')}>Settings</Menu.Item>
          </Menu.Dropdown>
        </Menu>
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
        <div className='view-toggle'>
          <div className='vt on' title='Grid view'>
            <svg viewBox='0 0 16 16' fill='currentColor'>
              <rect x='2' y='2' width='5' height='5' />
              <rect x='9' y='2' width='5' height='5' />
              <rect x='2' y='9' width='5' height='5' />
              <rect x='9' y='9' width='5' height='5' />
            </svg>
          </div>
          <div className='vt' title='Table view (coming soon)'>
            <svg viewBox='0 0 16 16' fill='currentColor'>
              <rect x='2' y='3' width='12' height='2' />
              <rect x='2' y='7' width='12' height='2' />
              <rect x='2' y='11' width='12' height='2' />
            </svg>
          </div>
        </div>
        <div className='iconbtn' title='Sort (alphabetical)'>
          ⇕
        </div>
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

  const playable = isPlayable(character);
  const archived = !!(character.meta_data as Record<string, unknown> | undefined)?.archived;
  const initial = character.name?.trim()?.[0]?.toUpperCase() || '?';

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
          <span className='last'>
            {/* Updated-at if the schema carries one; else show id. */}
            #<b>{character.id}</b>
          </span>
          {heroPoints > 0 && (
            <span style={{ color: 'var(--ink-dim)' }}>
              Hero
              <span className='ch-hp-mini'>
                {[0, 1, 2].map((i) => (
                  <span key={i} className={i < heroPoints ? 'pip full' : 'pip'}></span>
                ))}
              </span>
            </span>
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
    </div>
  );
}

async function createCharacter() {
  const images = getAllBackgroundImages();
  const randomImageUrl = images[Math.floor(Math.random() * images.length)]?.url;

  const result = await makeRequest<Character>('create-character', {
    meta_data: { reset_hp: true },
    details: { background_image_url: randomImageUrl },
  });
  return result;
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
