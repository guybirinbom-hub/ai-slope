import { characterState } from '@atoms/characterAtoms';
import { drawerState, feedbackState } from '@atoms/navAtoms';
import { convertToContentType, isAbilityBlockType } from '@content/content-utils';
import { ActionIcon, Box, Divider, Drawer, Group, HoverCard, Loader, ScrollArea, Text, Title } from '@mantine/core';
import { useDidUpdate, useElementSize, useLocalStorage, useMediaQuery } from '@mantine/hooks';
import {
  IconArrowLeft,
  IconHelpTriangleFilled,
  IconStar,
  IconStarFilled,
  IconX,
} from '@tabler/icons-react';
import { ContentType } from '@schemas/content';
import { Suspense, lazy, useRef } from 'react';
import { useAtom } from 'jotai';
import { favoriteFromDrawer, isFavorited, toggleFavorite } from '@character/favorites';
import { PrevMetadata } from './drawer-utils';
import ContentFeedbackModal from '@modals/ContentFeedbackModal';
import useRefresh from '@utils/use-refresh';
import { useSwipeGesture } from '@utils/use-swipe-gesture';
import { modals } from '@mantine/modals';
import { wideDesktopQuery } from '@utils/mobile-responsive';
import { cloneDeep } from 'lodash-es';
import { getAnchorStyles } from '@utils/anchor';
import DrawerCreatureBase from './DrawerCreatureBase';

// Use lazy imports here to prevent a huge amount of js on initial load
const DrawerContent = lazy(() => import('./DrawerContent'));
const DrawerTitle = lazy(() => import('./DrawerTitle'));

// wg4 redesign — drawer types that have been ported to the parchment
// design language. When the open drawer's type is in this set, we
// apply `classNames={{ root: 'wg4', content: 'wg4-drawer-mantine' }}`
// to the Mantine Drawer so the wg4 CSS overrides kick in (parchment
// background, ink-2 title, hairline border). Drawers not in the set
// keep the existing dark codex chrome. Append types as their bodies
// get ported through waves 2-4.
const WG4_DRAWER_TYPES = new Set<string>([
  // Wave 2 — description-card drawers (FeatDrawer template + reuses).
  'feat',
  'spell',
  'item',
  'condition',
  'background',
  'archetype',
  'versatile-heritage',
  'language',
  'trait',
  'content-source',
  'generic',
  'class-feature',
  'class-archetype',
  'action',
  'heritage',
  'sense',
  'physical-feature',
  'mode',
  // Wave 3 — stat drawers (StatAttrDrawer template + reuses).
  'stat-prof',
  'stat-attr',
  'stat-hp',
  'stat-ac',
  'stat-weapon',
  'stat-speed',
  'stat-perception',
  'stat-resist-weak',
  // Wave 4 — special drawers (each unique).
  'class',
  'ancestry',
  'inv-item',
  'cast-spell',
  'manage-coins',
]);

// No feedback drawers
const NO_FEEDBACK_DRAWERS = [
  'generic',
  'character',
  'condition',
  'manage-coins',
  'stat-prof',
  'stat-attr',
  'stat-hp',
  'stat-ac',
  'stat-speed',
  'stat-perception',
  'stat-resist-weak',
  'stat-weapon',
  'add-spell',
  'inv-item',
];

// Win11-titlebar accommodations that every Mantine `<Drawer>` in this
// app needs, regardless of whether it goes through DrawerBase:
//   - `inner.top: 32` — push the panel down so the OS titlebar overlay
//     (32 px tall, defined in electron/main.cjs as `titleBarOverlay.height`)
//     doesn't sit on top of the drawer's header.
//   - `header.paddingRight: 160` — reserve room on the right so the
//     drawer's own X button doesn't end up under the native Win11
//     min/max/close trio in the window corner.
// Without these, the drawer X is either invisible or sits directly
// under the OS X — so clicking it closes the whole app instead.
//
// Exported so peer drawers (ModesDrawer, CampaignDrawer, DiceRoller, the
// builder's mobile stat drawer) can spread it into their own `styles` prop
// without re-deriving the magic numbers.
export const DRAWER_TITLEBAR_FIX = {
  inner: {
    top: 32,
  },
  header: {
    paddingRight: 160,
  },
} as const;

export const DRAWER_STYLES = {
  ...DRAWER_TITLEBAR_FIX,
  content: {
    display: 'flex',
    flexDirection: 'column',
    position: 'relative',
    paddingBottom: 'env(safe-area-inset-bottom)',
    minHeight: '100dvh',
  },
  title: {
    width: '100%',
  },
  header: {
    ...DRAWER_TITLEBAR_FIX.header,
    paddingBottom: 0,
  },
  body: {
    flex: '1 1 auto',
    minHeight: 0,
    overflow: 'hidden',
    paddingRight: 2,
  },
} as const;

export default function DrawerBase() {
  /* Use this syntax as the standard API for opening drawers:

    const [_drawer, openDrawer] = useAtom(drawerState);
    openDrawer({ type: 'feat', data: { id: 1 } });
  */

  const isWideDesktop = useMediaQuery(wideDesktopQuery());

  const [_drawer, openDrawer] = useAtom(drawerState);
  const [character, setCharacter] = useAtom(characterState);

  // Compute the favoritable identity of the current drawer (if any).
  // `null` for stat / manager / non-favoritable drawers.
  const favoriteEntry = _drawer ? favoriteFromDrawer(_drawer.type, _drawer.data) : null;
  const starred = favoriteEntry
    ? isFavorited(character, favoriteEntry.type, favoriteEntry.id)
    : false;

  const toggleStar = () => {
    if (!favoriteEntry || !character) return;
    const newFavs = toggleFavorite(character, favoriteEntry);
    setCharacter({
      ...character,
      meta_data: {
        ...(character.meta_data ?? {}),
        favorites: newFavs,
      } as typeof character.meta_data,
    });
  };

  const { ref, height: titleHeight } = useElementSize();
  const [displayTitle, refreshTitle] = useRefresh();
  const [feedbackData, setFeedbackData] = useAtom(feedbackState);

  const viewport = useRef<HTMLDivElement>(null);
  const [value, setValue] = useLocalStorage<PrevMetadata>({
    key: 'prev-drawer-metadata',
    defaultValue: {
      scrollTop: 0,
      openedDict: {},
    },
  });

  const saveMetadata = (openedDict?: Record<string, string>) => {
    if (viewport.current === null) return;
    const newMetadata = {
      scrollTop: viewport.current.scrollTop ?? 0,
      openedDict: openedDict ?? value.openedDict,
    };
    setValue(newMetadata);
  };

  const handleDrawerClose = () => {
    openDrawer(null);
    // Clear metadata
    saveMetadata({});
  };

  const handleDrawerGoBack = () => {
    let history = [...(_drawer?.extra?.history ?? [])];
    const newDrawer = history.pop();
    if (!newDrawer) return handleDrawerClose();

    openDrawer({
      type: newDrawer.type,
      data: newDrawer.data,
      extra: {
        history,
      },
    });

    setTimeout(() => {
      if (!viewport.current) return;
      viewport.current.scrollTo({ top: value.scrollTop });
    }, 1);
  };

  useDidUpdate(() => {
    refreshTitle();
  }, [_drawer]);

  const swipeHandlers = useSwipeGesture({ onSwipeRight: handleDrawerGoBack });

  const opened = !!_drawer;
  // Apply wg4 chrome only when the open drawer type is one we've
  // ported. The classNames flow into Mantine's root portal + content
  // panel so the wg4.css overrides take effect (parchment bg, ink
  // title, hairline border, Geist typography).
  const isWg4Drawer = !!(_drawer?.type && WG4_DRAWER_TYPES.has(_drawer.type));
  const drawerClassNames = isWg4Drawer
    ? { root: 'wg4', content: 'wg4-drawer-mantine', header: 'wg4-drawer-mantine-head', body: 'wg4-drawer-mantine-body' }
    : undefined;
  return (
    <>
      <Drawer
        opened={opened}
        onClose={handleDrawerClose}
        classNames={drawerClassNames}
        title={
          <>
            {displayTitle && (
              <Box ref={ref}>
                <Group gap={12} justify='space-between'>
                  <Box style={{ flex: 1 }}>
                    {opened && (
                      <Suspense
                        fallback={
                          <Group wrap='nowrap' gap={10}>
                            <Loader size='sm' />
                            <Title order={3}>Loading...</Title>
                          </Group>
                        }
                      >
                        <DrawerTitle />
                      </Suspense>
                    )}
                    <Divider />
                  </Box>
                  {!!_drawer?.extra?.history?.length ? (
                    <ActionIcon
                      variant='light'
                      color='gray'
                      radius='xl'
                      size='md'
                      onClick={handleDrawerGoBack}
                      aria-label='Go back to previous drawer'
                    >
                      <IconArrowLeft size='1.2rem' stroke={1.5} />
                    </ActionIcon>
                  ) : (
                    <ActionIcon
                      variant='light'
                      color='gray'
                      radius='xl'
                      size='md'
                      onClick={handleDrawerClose}
                      aria-label='Close drawer'
                    >
                      <IconX size='1.2rem' stroke={1.5} />
                    </ActionIcon>
                  )}
                </Group>
              </Box>
            )}
          </>
        }
        withCloseButton={false}
        lockScroll={!isWideDesktop}
        closeOnClickOutside={!isWideDesktop}
        withOverlay={!isWideDesktop}
        position='right'
        zIndex={_drawer?.data.zIndex ?? 1000}
        styles={DRAWER_STYLES}
        transitionProps={{ duration: 200 }}
        style={{
          overflow: 'hidden',
        }}
      >
        <Box onTouchStart={swipeHandlers.onTouchStart} onTouchEnd={swipeHandlers.onTouchEnd} style={{ height: '100%' }}>
          {/* pb={110} reserves 110 px of empty space at the bottom
              of the scroll viewport so long descriptions don't slide
              UNDER the floating action row (favorite star, charges
              indicator, edit, delete) which is anchored at bottom:
              50 px and is ~40 px tall. Without this padding the last
              few lines of text would sit behind those buttons. */}
          <ScrollArea viewportRef={viewport} h='100%' pr={16} pb={110} scrollbars='y'>
            {opened && (
              <Suspense fallback={<div></div>}>
                <DrawerContent
                  onMetadataChange={(openedDict) => {
                    saveMetadata(openedDict);
                  }}
                />
              </Suspense>
            )}
          </ScrollArea>

          {/* Bottom-left favorite (star) button. Renders for any
              drawer whose type / data we can extract a (type, id, name)
              triple from (see favoriteFromDrawer). Stat managers / coin
              drawers / generic dialogs return null and the button is
              hidden. The wrapping Box gives the button a solid backdrop
              that matches the drawer body so scrolling content
              underneath doesn't bleed through the icon area. */}
          {_drawer && favoriteEntry && character && (
            <HoverCard shadow='md' openDelay={500} zIndex={1000} withArrow withinPortal>
              <HoverCard.Target>
                <Box
                  style={{
                    // Lifted well above the Windows taskbar / window
                    // bottom edge so the star isn't crammed against
                    // it or the last line of description text above.
                    ...getAnchorStyles({ l: 5, b: 50 }),
                    // Mantine drawers use var(--mantine-color-body) for
                    // their body bg; matching it keeps the button
                    // visually flush with the drawer and masks any
                    // content scrolled behind it.
                    backgroundColor: 'var(--mantine-color-body)',
                    borderRadius: '50%',
                    padding: 2,
                  }}
                >
                  <ActionIcon
                    variant='subtle'
                    aria-label={starred ? 'Remove from favorites' : 'Add to favorites'}
                    radius='xl'
                    color={starred ? 'yellow.5' : 'dark.3'}
                    onClick={toggleStar}
                  >
                    {starred ? (
                      <IconStarFilled style={{ width: '70%', height: '70%' }} />
                    ) : (
                      <IconStar style={{ width: '70%', height: '70%' }} stroke={1.5} />
                    )}
                  </ActionIcon>
                </Box>
              </HoverCard.Target>
              <HoverCard.Dropdown py={0} px={10}>
                <Text size='sm'>{starred ? 'Remove from favorites' : 'Add to favorites'}</Text>
              </HoverCard.Dropdown>
            </HoverCard>
          )}

          {_drawer && !NO_FEEDBACK_DRAWERS.includes(_drawer.type) && _drawer.data?.noFeedback !== true && (
            <>
              <HoverCard shadow='md' openDelay={500} zIndex={1000} withArrow withinPortal>
                <HoverCard.Target>
                  <ActionIcon
                    variant='subtle'
                    aria-label='Help and Feedback'
                    radius='xl'
                    color='dark.3'
                    // Matches the star on the other side and lifts the
                    // delete / feedback cluster well above the window
                    // bottom so it's not crammed against the taskbar.
                    style={getAnchorStyles({ r: 5, b: 50 })}
                    onClick={() => {
                      const type = isAbilityBlockType(_drawer.type)
                        ? _drawer.type
                        : convertToContentType(_drawer.type as ContentType);
                      const data = cloneDeep(_drawer.data);

                      // Use creature id from .creature to allow edited creatures to get content updates on original
                      if (type === 'creature' && data.creature?.id) {
                        data.id = data.creature.id;
                        data.content_source_id = data.creature.content_source_id;
                      }

                      setFeedbackData({
                        type: type,
                        data: data,
                      });
                    }}
                  >
                    <IconHelpTriangleFilled style={{ width: '70%', height: '70%' }} stroke={1.5} />
                  </ActionIcon>
                </HoverCard.Target>
                <HoverCard.Dropdown py={0} px={10}>
                  <Text size='sm'>Something wrong?</Text>
                </HoverCard.Dropdown>
              </HoverCard>
            </>
          )}
        </Box>
      </Drawer>
      {feedbackData && (
        <ContentFeedbackModal
          opened={true}
          onCancel={() => {
            setFeedbackData(null);
          }}
          onStartFeedback={() => {
            modals.closeAll();
            openDrawer(null);
          }}
          onCompleteFeedback={() => {
            handleDrawerClose();
            setFeedbackData(null);
          }}
          type={feedbackData.type}
          data={feedbackData.data}
        />
      )}
      <DrawerCreatureBase />
    </>
  );
}
