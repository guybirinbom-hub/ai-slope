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
import { useLocation, useNavigate } from 'react-router-dom';
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
  const location = useLocation();

  // Routes that ship their own codex topbar/header with a working
  // hamburger menu — render the drag strip without one to avoid the
  // duplicate-menu the user saw. Path tests are prefix-based so /sheet/67
  // and /sheet/142 both match.
  const codexRoutes = ['/sheet/', '/characters'];
  const hasOwnMenu = codexRoutes.some((p) => location.pathname.startsWith(p)) ||
    location.pathname === '/';

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
            // Opaque dark fill so the Mantine BackgroundImage at
            // z-index:-1000 doesn't bleed the upstream mountain art
            // through this 32 px gap above the page content. Matches
            // the codex --bg (#15110b); blends fine with the existing
            // Mantine dark theme on non-codex routes too.
            background: '#15110b',
            borderBottom: '1px solid rgba(201, 161, 59, 0.12)',
            // Sit above the BackgroundImage. Codex-root is z:1; we go
            // higher so the drag strip wins over both.
            position: 'relative',
            zIndex: 10,
          } as React.CSSProperties
        }
      >
        {/* Only render the hamburger here on routes that don't ship
            their own codex topbar with a menu — otherwise the user
            sees two hamburgers. */}
        {!hasOwnMenu && (
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
        )}
      </Box>

      {/* Page content. Padding is owned by each route — the codex pages
          (Characters list, Sheet, Spells, etc.) have their own hero +
          toolbar with calibrated 56 px outer margins, so an extra
          wrapper padding would push them in from the edges twice and
          break the design grid. Pages that still want padding (Settings,
          Homebrew until they're migrated) wrap themselves. */}
      <ScrollArea
        h={`calc(100dvh - ${TITLE_BAR_HEIGHT}px)`}
        type={isMobileTouch ? 'never' : 'auto'}
        scrollbars='y'
      >
        {props.children}
      </ScrollArea>
    </>
  );
}
