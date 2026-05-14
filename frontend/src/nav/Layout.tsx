import {
  ActionIcon,
  Box,
  Menu,
  ScrollArea,
  rem,
  useMantineTheme,
} from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { IconAsset, IconMenu2, IconSettings, IconUsers } from '@tabler/icons-react';
import { useNavigate } from 'react-router-dom';
import { isTouchDevice, tabletQuery } from '@utils/mobile-responsive';

// Title-bar overlay height — matches `titleBarOverlay.height` in
// electron/main.cjs. The window is frameless; this strip is what the
// user grabs to drag the window. Native Windows min/max/close are
// rendered to the right of this strip by Electron's titleBarOverlay.
const TITLE_BAR_HEIGHT = 32;

// Reserve the right edge of the drag strip so our menu button doesn't
// collide with the system min/max/close controls. ~138 px on Win11;
// pad a bit for breathing room.
const WIN_CONTROLS_WIDTH = 150;

/**
 * Local-only build replacement for the upstream AppShell-based Layout.
 *
 * The upstream layout had:
 *   - A full-width AppShell.Header with the WG logo on the left,
 *     Community / Support / Legacy Site link buttons in the middle,
 *     a SearchBar, and a signed-in user button on the right
 *   - A responsive AppShell.Navbar drawer mirroring those links for
 *     mobile / narrow widths
 *   - A scroll-driven "pinned" mechanic to auto-hide the header
 *
 * None of that fits a single-user local Electron app, so everything
 * is gone. In its place: a thin draggable strip at the top of the
 * frameless window (the user grabs it to move the window) with a
 * single hamburger menu icon at the right that drops down the only
 * nav surface — Characters, Homebrew, Settings. The native Windows
 * min/max/close buttons live just to the right of our menu icon, in
 * the area reserved by `titleBarOverlay`.
 */
export default function Layout(props: { children: React.ReactNode }) {
  const theme = useMantineTheme();
  const isMobileTouch = useMediaQuery(tabletQuery()) && isTouchDevice();
  const navigate = useNavigate();

  return (
    <>
      <Box
        style={
          {
            height: TITLE_BAR_HEIGHT,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-end',
            paddingRight: WIN_CONTROLS_WIDTH,
            // Whole strip is draggable; the ActionIcon below opts out
            // via no-drag so clicks register as a button press, not a
            // window-drag gesture.
            WebkitAppRegion: 'drag',
          } as React.CSSProperties
        }
      >
        <Menu
          width={180}
          position='bottom-end'
          transitionProps={{ transition: 'pop-top-right' }}
          withinPortal
        >
          <Menu.Target>
            <ActionIcon
              variant='subtle'
              color='gray'
              size='md'
              radius='md'
              aria-label='Menu'
              style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
            >
              <IconMenu2 size={18} stroke={1.5} />
            </ActionIcon>
          </Menu.Target>
          <Menu.Dropdown>
            <Menu.Item
              leftSection={
                <IconUsers
                  style={{ width: rem(16), height: rem(16) }}
                  color={theme.colors.blue[5]}
                  stroke={1.5}
                />
              }
              component='a'
              href='/characters'
              onClick={(e) => {
                e.preventDefault();
                navigate('/characters');
              }}
            >
              Characters
            </Menu.Item>
            <Menu.Item
              leftSection={
                <IconAsset
                  style={{ width: rem(16), height: rem(16) }}
                  color={theme.colors.yellow[6]}
                  stroke={1.5}
                />
              }
              component='a'
              href='/homebrew'
              onClick={(e) => {
                e.preventDefault();
                navigate('/homebrew');
              }}
            >
              Homebrew
            </Menu.Item>
            <Menu.Item
              leftSection={<IconSettings style={{ width: rem(16), height: rem(16) }} stroke={1.5} />}
              component='a'
              href='/account'
              onClick={(e) => {
                e.preventDefault();
                navigate('/account');
              }}
            >
              Settings
            </Menu.Item>
          </Menu.Dropdown>
        </Menu>
      </Box>

      <ScrollArea
        h={`calc(100dvh - ${TITLE_BAR_HEIGHT}px)`}
        type={isMobileTouch ? 'never' : 'auto'}
        scrollbars='y'
      >
        <Box p='md'>{props.children}</Box>
      </ScrollArea>
    </>
  );
}
