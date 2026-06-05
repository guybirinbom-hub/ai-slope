import CodexLoadingOverlay from '@common/CodexLoadingOverlay';
import { Center, Menu, Text, rem } from '@mantine/core';
import { useViewportSize } from '@mantine/hooks';
import { makeRequest } from '@requests/request-manager';
import { IconAsset, IconHammer, IconHome, IconSettings, IconUser, IconUsers } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { Character } from '@schemas/content';
import { isPlayable } from '@utils/character';
import { setPageTitle } from '@utils/document-change';
import { useEffect, useMemo, useState } from 'react';
import { useLoaderData, useNavigate } from 'react-router-dom';
import CharBuilderCreation from './CharBuilderCreation';
import CharBuilderHome from './CharBuilderHome';
import { useAtomValue, useSetAtom } from 'jotai';
import { characterState } from '@atoms/characterAtoms';
import { openContextModal } from '@mantine/modals';
import { getAllPortraitImages } from '@utils/portrait-images';
import { ImageOption } from '@schemas/index';

export function Component() {
  setPageTitle(`Builder`);

  // Honor `?tab=builder` / `?tab=home` / `?tab=sheet` in the URL so the
  // "Edit in Builder" link from the character sheet's hamburger menu
  // lands directly on the Builder step (step 1) instead of always
  // bouncing through Home (step 0) and making the user click forward.
  const initialStep = (() => {
    if (typeof window === 'undefined') return 0;
    const tab = new URLSearchParams(window.location.search).get('tab');
    if (tab === 'builder') return 1;
    if (tab === 'sheet') return 2;
    return 0;
  })();
  const [active, setActive] = useState(initialStep);
  const navigate = useNavigate();

  const { characterId } = useLoaderData() as {
    characterId: string;
  };

  const handleStepChange = (nextStep: number) => {
    const isOutOfBounds = nextStep > 3 || nextStep < 0;
    if (isOutOfBounds) {
      return;
    }
    setActive(nextStep);
  };

  useEffect(() => {
    if (active === 2) {
      navigate(`/sheet/${characterId}`);
    }
  }, [active]);

  // Drive the builder's scrollable areas off the REAL window height so
  // the middle "level choices" panel fills the page instead of being
  // pinned to a short fixed height (the old hardcoded 550 left a large
  // empty gap below the choices on anything but a tiny window). Subtract
  // the chrome above/below the body (winbar + topbar + level strip +
  // body padding ≈ 190px); floor at 550 so short windows stay usable.
  const { height: viewportHeight } = useViewportSize();
  const pageHeight = Math.max(550, viewportHeight - 190);

  const globalCharacter = useAtomValue(characterState);
  const setCharacter = useSetAtom(characterState);
  // If the user came from /sheet/<id>, the characterState atom is
  // already populated with this character — no need to refetch +
  // show a second loader. We compute "already have it" before the
  // useQuery so we can suppress the loader entirely on the warm
  // hand-off (the most common path: Sheet → Edit in Builder).
  const hasGlobal =
    !!globalCharacter && globalCharacter.id === parseInt(characterId);
  const { data, isLoading: queryLoading } = useQuery({
    queryKey: [`get-character-init-builder-${characterId}`, { characterId }],
    queryFn: async () => {
      return await makeRequest<Character>('find-character', {
        id: parseInt(characterId),
      });
    },
    // Skip the fetch when characterState already has the character —
    // saves a redundant API call and stops React Query from flipping
    // isLoading=true on the warm path.
    enabled: !hasGlobal,
  });
  const character = useMemo(() => {
    if (hasGlobal) return globalCharacter;
    return data ?? null;
  }, [data, globalCharacter, hasGlobal]);
  // Only "loading" when we don't have the character from either
  // source. queryLoading is always false when the query is disabled
  // (which is the warm-path case), so this naturally collapses to
  // "no loader" on Sheet → Builder navigation.
  const isLoading = !character && (queryLoading || !hasGlobal);

  // Codex shell: the .topbar with Home / Build / Sheet nav-step buttons
  // replaces the old Mantine <Stepper>. We pick a root class based on
  // the active step so the home and builder pages each get their
  // scoped overrides (.codex-home-page vs .codex-builder-page).
  const initial = (character?.name?.trim() || 'W')[0].toUpperCase();
  const ancestryName = character?.details?.ancestry?.name ?? '—';
  const className = character?.details?.class?.name ?? '—';
  // Wrap the page in both `.wg4` (so the wg4-builder.css rules apply
  // — every selector in that file is scoped under .wg4) AND the
  // mockup-specific `.codex-builder-page` / `.codex-home-page` class
  // so the children paint correctly. Children no longer carry their
  // own wg4 wrapper / topbar — the parent owns those.
  const rootClass = `wg4 ${active === 1 ? 'codex-builder-page' : 'codex-home-page'}`;
  // TS narrows `active` aggressively because handleStepChange typings;
  // widen for the JSX comparisons below.
  const step: number = active;

  // Wire min/max/X buttons in the .winbar to the wgElectron preload
  // bridge. Falls through silently in non-Electron contexts (e.g. dev
  // browser preview) since `window.wgElectron` won't exist there.
  const wgElectron = (window as unknown as {
    wgElectron?: {
      windowMinimize?: () => void;
      windowMaximize?: () => void;
      windowClose?: () => void;
    };
  }).wgElectron;

  return (
    <div className={rootClass} style={{ minHeight: '100vh' }}>
      {/* Window title bar — matches the codex-builder / codex-home
          mockup. Holds the codex brand on the left, a centred italic
          summary of what's being edited, and the min/max/X window
          control SVGs on the right. The previous version put a small
          hamburger in the topbar's right cluster instead; that
          hamburger duplicated the existing app-level menu, so it's
          gone in favour of these window controls (which the codex
          mockup explicitly calls for). */}
      <div className='winbar'>
        <div className='brand'>
          <span className='mark'></span>
          <span className='name'>
            Wanderer's <em>Codex</em> · {step === 1 ? 'Builder' : step === 2 ? 'Sheet' : 'Home'}
          </span>
        </div>
        <div className='center'>
          {character?.name || 'Unknown'}
          {ancestryName !== '—' && (<> · {ancestryName}</>)}
          {className !== '—' && (<> · {className}</>)}
          {character?.level != null && (<> · Level {character.level}</>)}
        </div>
        <div className='wbtns'>
          <button className='wbtn' aria-label='Minimize' title='Minimize' onClick={() => wgElectron?.windowMinimize?.()}>
            <svg viewBox='0 0 10 10'><path d='M1 8 L9 8' /></svg>
          </button>
          <button className='wbtn' aria-label='Maximize' title='Maximize' onClick={() => wgElectron?.windowMaximize?.()}>
            <svg viewBox='0 0 10 10'><path d='M1 1 L9 1 L9 9 L1 9 Z' /></svg>
          </button>
          <button className='wbtn close' aria-label='Close' title='Close' onClick={() => wgElectron?.windowClose?.()}>
            <svg viewBox='0 0 10 10'><path d='M1 1 L9 9 M9 1 L1 9' /></svg>
          </button>
        </div>
      </div>

      {/* Topbar — character crest + Home/Build/Sheet nav as 3 column
          buttons that span the full width. Uses `.builder-topbar` so
          the wg4-builder.css styling kicks in (grid columns, hairline
          dividers, accent underline on `.on`). Same layout regardless
          of which step is active — Home / Build / Sheet are always
          rendered as nav-step columns, never as pill buttons. */}
      <div className='builder-topbar'>
        <div className='who'>
          <div
            className='crest'
            title='Select portrait'
            style={{ cursor: 'pointer' }}
            onClick={() => {
              openContextModal({
                modal: 'selectImage',
                title: 'Select Portrait',
                classNames: { content: 'codex-select-image-modal' },
                innerProps: {
                  options: getAllPortraitImages(),
                  onSelect: (option: ImageOption) => {
                    setCharacter((prev) =>
                      prev
                        ? {
                            ...prev,
                            details: {
                              ...prev.details,
                              image_url: prev.details?.image_url === option.url ? undefined : option.url,
                            },
                          }
                        : prev
                    );
                  },
                  category: 'portraits',
                },
              });
            }}
          >
            {character?.details?.image_url ? (
              <img src={character.details.image_url} alt='Character Portrait' />
            ) : (
              initial
            )}
          </div>
          <div className='label'>
            <div className='nm'>{(character?.name || 'UNNAMED').toUpperCase()}</div>
            <div className='sub'>
              {ancestryName} <i>·</i> {className}
            </div>
          </div>
        </div>

        <>
            <button
              type='button'
              className={`nav-step${step === 0 ? ' on' : ''}`}
              onClick={() => handleStepChange(0)}
            >
              <IconHome size={18} /> Home
            </button>
            <button
              type='button'
              className={`nav-step${step === 1 ? ' on' : ''}`}
              onClick={() => handleStepChange(1)}
            >
              <IconHammer size={18} /> Build
            </button>
            <button
              type='button'
              className={`nav-step${step === 2 ? ' on' : ''}`}
              disabled={!isPlayable(character)}
              onClick={() => handleStepChange(2)}
            >
              <IconUser size={18} /> Sheet
            </button>
        </>

        {/* Hamburger menu — lives INSIDE the topbar's right cluster so
            the codex shell owns the navigation surface end-to-end. The
            mockup's codex .menu div (gold-bordered square with three
            horizontal lines) wraps a Mantine Menu.Target. We use
            useState to drive the dropdown because Mantine's Menu
            requires a ref-forwarding target — our decorative codex
            div doesn't satisfy that contract on its own. */}
        <div className='topbar-right'>
          <Menu
            width={180}
            position='bottom-end'
            transitionProps={{ transition: 'pop-top-right' }}
            withinPortal
          >
            <Menu.Target>
              <div className='menu' role='button' tabIndex={0} aria-label='Menu'>
                <div className='lines'><span /><span /><span /></div>
              </div>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Item
                leftSection={<IconUsers style={{ width: rem(16), height: rem(16) }} stroke={1.5} />}
                onClick={() => navigate('/characters')}
              >
                Characters
              </Menu.Item>
              <Menu.Item
                leftSection={<IconAsset style={{ width: rem(16), height: rem(16) }} stroke={1.5} />}
                onClick={() => navigate('/homebrew')}
              >
                Homebrew
              </Menu.Item>
              <Menu.Item
                leftSection={<IconSettings style={{ width: rem(16), height: rem(16) }} stroke={1.5} />}
                onClick={() => navigate('/account')}
              >
                Settings
              </Menu.Item>
            </Menu.Dropdown>
          </Menu>
        </div>
      </div>

      {/* Step content. Home and Builder each own their inner shell
          (.home-wrap for home; .levels + .body for builder). We render
          the active step only — others are unmounted. The container's
          min-height is removed so the page sizes to its actual content
          height — no scrolling on shorter level pages. */}
      <div>
        {step === 0 && character && !isLoading && (
          <CharBuilderHome
            characterId={character.id}
            pageHeight={pageHeight}
            onContinue={() => handleStepChange(1)}
          />
        )}
        {step === 1 && character && !isLoading && (
          <CharBuilderCreation characterId={character.id} pageHeight={pageHeight} />
        )}
        {step === 2 && (
          <Center style={{ padding: 40 }}>
            <Text ta='center' c='dimmed' fs='italic'>Redirecting to sheet…</Text>
          </Center>
        )}
        {/* Outer page-shell loader, only visible while the character
            data is being fetched. tailMs=0 because CharBuilderCreation
            (rendered below) has its OWN CodexLoadingOverlay that
            handles the dice-lock animation when EXECUTE_OPS finishes.
            With a non-zero tail here, the outer loader's lock+tail
            would overlap with the inner loader's rolling dice — two
            stacked loaders showing different dice states. tailMs=0
            unmounts instantly when isLoading flips false, handing off
            cleanly to the inner overlay. */}
        <CodexLoadingOverlay visible={isLoading} zIndex={1000} tailMs={0} />
      </div>
    </div>
  );
}
