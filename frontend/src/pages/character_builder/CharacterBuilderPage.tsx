import CodexLoadingOverlay from '@common/CodexLoadingOverlay';
import { Center, Menu, Text, rem } from '@mantine/core';
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
import { useAtomValue } from 'jotai';
import { characterState } from '@atoms/characterAtoms';

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

  const pageHeight = 550;

  const globalCharacter = useAtomValue(characterState);
  const { data, isLoading } = useQuery({
    queryKey: [`get-character-init-builder-${characterId}`, { characterId }],
    queryFn: async () => {
      return await makeRequest<Character>('find-character', {
        id: parseInt(characterId),
      });
    },
  });
  const character = useMemo(() => {
    if (globalCharacter && globalCharacter.id === parseInt(characterId)) {
      return globalCharacter;
    } else {
      return data ?? null;
    }
  }, [data, globalCharacter]);

  // Codex shell: the .topbar with Home / Build / Sheet nav-step buttons
  // replaces the old Mantine <Stepper>. We pick a root class based on
  // the active step so the home and builder pages each get their
  // scoped overrides (.codex-home-page vs .codex-builder-page).
  const initial = (character?.name?.trim() || 'W')[0].toUpperCase();
  const ancestryName = character?.details?.ancestry?.name ?? '—';
  const className = character?.details?.class?.name ?? '—';
  const rootClass = active === 1 ? 'codex-builder-page' : 'codex-home-page';
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
        <div className='title'>
          <span className='dot' />
          <span>
            <b>Wanderer's Codex</b> · {step === 1 ? 'Builder' : step === 2 ? 'Sheet' : 'Home'}
          </span>
        </div>
        <div className='center'>
          {character?.name || 'Unknown'}
          {ancestryName !== '—' && (<> <b>·</b> {ancestryName}</>)}
          {className !== '—' && (<> <b>·</b> {className}</>)}
          {character?.level != null && (<> <b>·</b> Level {character.level}</>)}
        </div>
        <div className='winbtns'>
          <div className='winbtn' title='Minimize' onClick={() => wgElectron?.windowMinimize?.()}>
            <svg viewBox='0 0 10 10'><path d='M1 8 L9 8' /></svg>
          </div>
          <div className='winbtn' title='Maximize' onClick={() => wgElectron?.windowMaximize?.()}>
            <svg viewBox='0 0 10 10'><path d='M1 1 L9 1 L9 9 L1 9 Z' /></svg>
          </div>
          <div className='winbtn close' title='Close' onClick={() => wgElectron?.windowClose?.()}>
            <svg viewBox='0 0 10 10'><path d='M1 1 L9 9 M9 1 L1 9' /></svg>
          </div>
        </div>
      </div>

      {/* Topbar — character crest + Home/Build/Sheet nav. No
          hamburger here; window controls live in the .winbar above
          and the app-level menu (the "big" floating hamburger) lives
          elsewhere. */}
      <div className='topbar'>
        <div className='who'>
          <div className='crest'>{initial}</div>
          <div className='label'>
            <div className='nm'>{(character?.name || 'UNNAMED').toUpperCase()}</div>
            <div className='sub'>
              {ancestryName} <i>·</i> {className}
            </div>
          </div>
        </div>

        {step === 1 ? (
          // Builder mode: 3 mode buttons in a flex .mode-row (matches
          // codex-builder mockup). Inside this branch TS knows step
          // is 1, so the middle button is always 'on'.
          <div className='mode-row'>
            <button
              type='button'
              className='m-btn'
              onClick={() => handleStepChange(0)}
            >
              <IconHome size={14} /> Home
            </button>
            <button
              type='button'
              className='m-btn on'
              onClick={() => handleStepChange(1)}
            >
              <IconHammer size={14} /> Build
            </button>
            <button
              type='button'
              className='m-btn'
              disabled={!isPlayable(character)}
              onClick={() => handleStepChange(2)}
            >
              <IconUser size={14} /> Sheet
            </button>
          </div>
        ) : (
          // Home mode: 3 nav-step columns (matches codex-home mockup).
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
        )}

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
          (.crumb-strip + .home-wrap for home; .levels + .body for
          builder). We render the active step only — others are
          unmounted. */}
      <div style={{ minHeight: pageHeight }}>
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
        {isLoading && <CodexLoadingOverlay visible={isLoading} zIndex={1000} />}
      </div>
    </div>
  );
}
