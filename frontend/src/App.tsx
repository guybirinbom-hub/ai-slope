import { backendReadyState } from '@atoms/backendAtoms';
import { characterState } from '@atoms/characterAtoms';
import { creatureDrawerState, drawerState } from '@atoms/navAtoms';
import { sessionState } from '@atoms/supabaseAtoms';
import { getContentDataFromHref } from '@common/rich_text_input/ContentLinkExtension';
import { GUIDE_BLUE, IMPRINT_BG_COLOR, IMPRINT_BORDER_COLOR } from '@constants/data';
import { getCachedCustomization } from '@content/customization-cache';
import DrawerBase from '@drawers/DrawerBase';
import { convertContentLink } from '@drawers/drawer-utils';
import {
  Anchor,
  BackgroundImage,
  Button,
  MantineProvider,
  Text,
  createTheme,
  v8CssVariablesResolver,
} from '@mantine/core';
import { useMediaQuery, usePrevious } from '@mantine/hooks';
import { ModalsProvider } from '@mantine/modals';
import { Notifications } from '@mantine/notifications';
import SearchSpotlight from '@nav/SearchSpotlight';
import { IconBrush } from '@tabler/icons-react';
import { getBackgroundImageFromURL } from '@utils/background-images';
import { useEffect, useState } from 'react';
import { Outlet, useLocation, useSearchParams } from 'react-router-dom';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { supabase } from './main';
import Layout from './nav/Layout';
import AddNewLoreModal from '@modals/AddNewLoreModal';
import { phoneQuery } from '@utils/mobile-responsive';
import { fetchContentSources, resetContentStore } from '@content/content-store';
import SelectContentModal from '@common/select/SelectContent';
import ConditionModal from '@modals/ConditionModal';
import CreateDicePresetModal from '@modals/CreateDicePresetModal';
import SelectIconModal from '@modals/SelectIconModal';
import SelectImageModal from '@modals/SelectImageModal';
import UpdateCharacterPortraitModal from '@modals/UpdateCharacterPortraitModal';
import UpdateNotePageModal from '@modals/UpdateNotePageModal';
import AddItemsModal from '@modals/AddItemsModal';
import { isEqual } from 'lodash-es';
import SelectSpellSlotModal from '@modals/SelectSpellSlotModal';
import SelectStaffCastingModal from '@modals/SelectStaffCastingModal';
import InitiativeRollModal from '@modals/InitiativeRollModal';
import UpdateEncounterModal from '@modals/UpdateEncounterModal';
import GenerateEncounterModal from '@modals/GenerateEncounterModal';
import UpdateApiClientModal from '@modals/UpdateApiClientModal';
import { getAnchorStyles } from '@utils/anchor';
import BuyItemModal from '@modals/BuyItemModal';
import { generateColors } from '@mantine/colors-generator';
import { ImageOption } from '@schemas/index';

// TODO, it would be great to dynamically import these modals, but it with Mantine v7.6.2 it doesn't work
// const SelectContentModal = lazy(() => import('@common/select/SelectContent'));
// const SelectImageModal = lazy(() => import('@modals/SelectImageModal'));
// const SelectIconModal = lazy(() => import('@modals/SelectIconModal'));
// const UpdateCharacterPortraitModal = lazy(() => import('@modals/UpdateCharacterPortraitModal'));
// const AddNewLoreModal = lazy(() => import('@modals/AddNewLoreModal'));
// const UpdateNotePageModal = lazy(() => import('@modals/UpdateNotePageModal'));
// const ConditionModal = lazy(() => import('@modals/ConditionModal'));
// const CreateDicePresetModal = lazy(() => import('@modals/CreateDicePresetModal'));

const modals = {
  selectContent: SelectContentModal,
  selectImage: SelectImageModal,
  selectIcon: SelectIconModal,
  selectSpellSlot: SelectSpellSlotModal,
  selectStaffCasting: SelectStaffCastingModal,
  updateCharacterPortrait: UpdateCharacterPortraitModal,
  addNewLore: AddNewLoreModal,
  initiativeRoll: InitiativeRollModal,
  updateNotePage: UpdateNotePageModal,
  generateEncounter: GenerateEncounterModal,
  updateEncounter: UpdateEncounterModal,
  updateApiClient: UpdateApiClientModal,
  condition: ConditionModal,
  createDicePreset: CreateDicePresetModal,
  addItems: AddItemsModal,
  buyItem: BuyItemModal,
};
// declare module '@mantine/modals' {
//   export interface MantineModalsOverride {
//     modals: typeof modals;
//   }
// }

export default function App() {
  const [_drawer, openDrawer] = useAtom(drawerState);
  const [_creatureDrawer, openCreatureDrawer] = useAtom(creatureDrawerState);
  const isPhone = useMediaQuery(phoneQuery());

  // Ctrl+Wheel zoom for the whole app UI. Applied to
  // `document.documentElement` (the <html> element) rather than a
  // React-rendered <Box> wrapper, so it also scales Mantine drawers,
  // modals, tooltips, popovers, and notifications — all of which
  // render via React Portal to `document.body` and therefore live
  // outside any in-tree wrapper. Without this, Ctrl+Wheel would zoom
  // the character sheet but leave the search modal, advanced filters,
  // spell drawer descriptions, etc. at their original size.
  //
  // Initial value comes from the saved customization so the Settings
  // UI-Size slider and Ctrl+Wheel stay in sync. Clamp to [0.5, 2.0]
  // to avoid unusable extremes. Step size 0.1 per scroll tick — a
  // single bump is noticeable but not jarring. localStorage
  // persistence is intentionally NOT done here; the Settings slider
  // is the source of truth for "permanent" zoom, and Ctrl+Wheel is a
  // per-session adjustment.
  const [zoom, setZoom] = useState<number>(() => getCachedCustomization()?.sheet_theme?.zoom ?? 1);
  useEffect(() => {
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      // preventDefault stops Chromium's native page zoom AND any
      // outer scroll from running on the same tick. Marked
      // `{ passive: false }` below so this is allowed.
      e.preventDefault();
      setZoom((prev) => {
        const next = prev + (e.deltaY < 0 ? 0.1 : -0.1);
        return Math.min(2.0, Math.max(0.5, +next.toFixed(2)));
      });
    };
    window.addEventListener('wheel', onWheel, { passive: false });
    return () => window.removeEventListener('wheel', onWheel);
  }, []);

  // Sync the zoom value to the renderer. Prefer Electron's
  // webFrame.setZoomLevel — it scales the ENTIRE viewport (including
  // the coordinate space that position:fixed elements anchor to), so
  // floating drawer buttons stay visible at the screen edge when
  // zoomed. CSS `zoom` does NOT do this — it scales layout but
  // leaves position:fixed in the original viewport, and inside
  // transformed containers (Mantine Drawer uses transform for the
  // slide-in animation) those fixed elements get pushed below
  // the visible area.
  //
  // Fallback to CSS zoom when running outside Electron (browser
  // preview / web build).
  useEffect(() => {
    const ew = (window as unknown as {
      wgElectron?: { setZoomLevel?: (n: number) => void };
    }).wgElectron;
    if (ew?.setZoomLevel) {
      // Electron's setZoomLevel uses log scale: 0 = 100%, +1 ≈ 120%,
      // +2 ≈ 144% (each step multiplies by 1.2). Convert a multiplier
      // (0.5..2.0) to that scale.
      const level = Math.log(zoom) / Math.log(1.2);
      ew.setZoomLevel(level);
      // Make sure we don't ALSO have CSS zoom applied (it would
      // multiply on top of the webFrame zoom).
      document.documentElement.style.zoom = '';
    } else {
      // Browser / dev preview — fall back to CSS zoom.
      document.documentElement.style.zoom = String(zoom);
    }
    return () => {
      document.documentElement.style.zoom = '';
    };
  }, [zoom]);

  const [session, setSession] = useAtom(sessionState);
  useEffect(() => {
    resetContentStore();

    // Local-only build: there's no real auth. The Electron backend
    // serves /auth/v1/* as an in-process shim that ignores credentials
    // and always returns a session for the single fixed local user.
    // On first launch (or after the user cleared storage) there's no
    // cached session in supabase-js's localStorage, so we trigger one
    // via signUp — the shim hands back a JWT signed with the same
    // secret PostgREST validates against, and supabase-js stores it
    // for future getSession() calls. Subsequent launches skip the
    // signUp path because the cached session is still valid (the
    // shim re-issues fresh tokens on refresh).
    (async () => {
      let current = (await supabase.auth.getSession()).data.session;
      if (!current) {
        const { data, error } = await supabase.auth.signUp({
          email: 'local@local.test',
          password: 'local-no-password-needed',
        });
        if (error) {
          console.error('Local auto-login failed:', error);
        }
        current = data.session ?? null;
      }
      setSession(current);
    })();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });

    return () => subscription.unsubscribe();
  }, []);

  // Backend readiness + background content prefetch.
  // The Electron main process starts the API gateway BEFORE pg + postgrest,
  // so the React shell renders while pg is still warming up. This effect
  // polls /wg/ready, flips the backendReadyState atom when the backend
  // reports ready (BackendReadyGate watches that atom to decide whether
  // to render the route or a warming-up loader), and kicks off a fire-
  // and-forget fetch of all official content sources to warm the cache
  // before the user navigates into a content-heavy page.
  const setBackendReady = useSetAtom(backendReadyState);
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const poll = async () => {
      if (cancelled) return;
      try {
        // cache: 'no-store' belt-and-suspenders the server-side
        // Cache-Control header. Without it (in some browser configs),
        // Express's default ETag handling makes the poll see 304 on
        // every request after the first, and the browser hands back
        // the stale {ready:false} body — gate never releases.
        const res = await fetch('/wg/ready', { cache: 'no-store' });
        if (res.ok) {
          const data = await res.json();
          if (data?.ready) {
            setBackendReady({ ready: true, error: null });
            // Fire-and-forget content warmup. Don't await — the UI is
            // already past the gate at this point and the page-level
            // useQuery hooks will pick up the cached results when ready.
            fetchContentSources('ALL-OFFICIAL-PUBLIC').catch(() => {
              /* offline / transient — page-level queries will re-fetch */
            });
            return;
          }
          if (data?.error) {
            // Backend tried and failed to start. Surface to the gate.
            setBackendReady({ ready: false, error: String(data.error) });
          }
        }
      } catch {
        // Gateway not listening yet — keep polling at 250 ms cadence.
      }
      timer = setTimeout(poll, 250);
    };
    poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [setBackendReady]);

  const activeCharacer = useAtomValue(characterState);
  const prevCharacer = usePrevious(activeCharacer);

  // Update background image when background_image_url changes
  const [background, setBackground] = useState<ImageOption>();
  useEffect(() => {
    (async () => {
      if (prevCharacer?.details?.background_image_url === activeCharacer?.details?.background_image_url) {
        if (!background?.url) {
          // Use cached customization if available
          const cache = getCachedCustomization();

          setBackground(await getBackgroundImageFromURL(cache?.background_image_url ?? undefined));
        }
        return;
      }
      console.log('Updating background image...');
      setBackground(await getBackgroundImageFromURL(activeCharacer?.details?.background_image_url));
    })();
  }, [activeCharacer]);

  const generateTheme = (theme?: { color?: string }) => {
    return createTheme({
      colors: {
        guide: generateColors(theme?.color || getCachedCustomization()?.sheet_theme?.color || GUIDE_BLUE),
        // Dark scale: near-opaque at [0] → nearly transparent at [9]
        dark: [
          'rgba(193, 194, 197, 0.89)', // [0] lightest text / icons
          'rgba(166, 167, 171, 0.85)', // [1]
          'rgba(144, 146, 150, 0.80)', // [2]
          'rgba(92,  95,  102, 0.75)', // [3]
          'rgba(55,  58,  64,  0.82)', // [4] ← glass surfaces
          'rgba(44,  46,  51,  0.77)', // [5]
          'rgba(37,  38,  43,  0.72)', // [6] ← card bg
          'rgba(26,  27,  30,  0.67)', // [7] ← page bg
          'rgba(20,  21,  23,  0.62)', // [8]
          'rgba(16,  17,  19,  0.57)', // [9] darkest / most transparent
        ],

        // Gray scale for light mode: near-opaque at [0] → nearly transparent at [9]
        // Mirrors the dark scale's opacity curve on a neutral-light palette.
        gray: [
          'rgba(248, 249, 250, 0.89)', // [0] near-white surfaces
          'rgba(241, 243, 245, 0.85)', // [1]
          'rgba(233, 236, 239, 0.80)', // [2]
          'rgba(222, 226, 230, 0.75)', // [3]
          'rgba(206, 212, 218, 0.82)', // [4] ← glass surfaces
          'rgba(173, 181, 189, 0.77)', // [5]
          'rgba(134, 142, 150, 0.72)', // [6] ← borders / muted text
          'rgba(73,  80,  87,  0.67)', // [7] ← body text
          'rgba(52,  58,  64,  0.62)', // [8]
          'rgba(33,  37,  41,  0.57)', // [9] darkest text
        ],
      },
      cursorType: 'pointer',
      primaryColor: 'guide',
      defaultRadius: 'md',
      fontFamily: getCachedCustomization()?.sheet_theme?.dyslexia_font
        ? 'OpenDyslexicRegular'
        : 'Montserrat, sans-serif',
      fontFamilyMonospace: 'Ubuntu Mono, monospace',
      components: {
        Popover: {
          vars: () => ({
            dropdown: {
              '--mantine-color-dark-6': 'rgba(37,  38,  43,  1)',
            },
          }),
        },
        Menu: {
          vars: () => ({
            dropdown: {
              '--mantine-color-dark-6': 'rgba(37,  38,  43,  1)',
            },
          }),
        },
        HoverCard: {
          vars: () => ({
            dropdown: {
              '--mantine-color-dark-6': 'rgba(37,  38,  43,  1)',
            },
          }),
        },
        Accordion: {
          vars: () => ({
            item: {
              '--item-filled-color': IMPRINT_BG_COLOR,
            },
          }),
          styles: {
            item: {
              borderColor: IMPRINT_BORDER_COLOR,
            },
          },
        },
        Badge: {
          styles: {
            label: { overflow: 'visible' },
          },
        },
        Tabs: {
          vars: () => ({
            tab: {
              '--tab-hover-color': IMPRINT_BG_COLOR,
            },
            list: {
              '--tab-border-color': IMPRINT_BG_COLOR,
            },
          }),
        },
        Stepper: {
          vars: () => ({
            root: {
              '--stepper-outline-color': IMPRINT_BG_COLOR,
            },
          }),
        },
        Divider: {
          vars: () => ({
            root: {
              '--divider-color': IMPRINT_BORDER_COLOR,
            },
          }),
        },
        RichTextEditor: {
          vars: () => ({
            root: {
              borderColor: IMPRINT_BORDER_COLOR,
            },
            toolbar: {
              borderColor: IMPRINT_BORDER_COLOR,
            },
          }),
        },
        Notification: {
          vars: () => ({
            root: {
              backgroundColor: 'rgba(37,  38,  43,  1)',
            },
          }),
        },
      },
    });
  };

  const [theme, setTheme] = useState<any>(generateTheme());
  useEffect(() => {
    if (isEqual(prevCharacer?.details?.sheet_theme, activeCharacer?.details?.sheet_theme)) return;
    console.log('Updating site theme...');
    setTheme(generateTheme({ color: activeCharacer?.details?.sheet_theme?.color }));
  }, [activeCharacer]);

  // Handle query params
  const location = useLocation();
  const [searchParams] = useSearchParams();
  useEffect(() => {
    (async () => {
      // If we have the `open=link_feat_3435` query param, open that content link
      const openValue = searchParams.get('open');
      if (openValue) {
        const contentData = getContentDataFromHref(openValue);
        if (contentData?.type === 'creature') {
          setTimeout(() => {
            openCreatureDrawer({
              data: {
                id: parseInt(contentData.id),
                readOnly: true,
              },
            });
          }, 500);
        } else {
          const drawerData = contentData ? convertContentLink(contentData) : null;
          if (drawerData) {
            setTimeout(() => {
              openDrawer(drawerData);
            }, 500);
          }
        }
        //removeQueryParam('open');
      }
    })();
  }, [location]);

  return (
    <MantineProvider
      theme={theme}
      forceColorScheme='dark'
      cssVariablesResolver={(theme) => {
        const v8 = v8CssVariablesResolver(theme);
        return {
          variables: { ...v8.variables },
          // Light scheme is intentionally empty — `forceColorScheme='dark'` locks the app to dark.
          // Mantine's resolver typing requires this key, but its values are never applied.
          light: {},
          dark: {
            ...v8.dark,
            '--mantine-color-text': 'rgb(202, 202, 202)',
            '--mantine-color-dimmed': 'rgb(200, 200, 200)',
            '--mantine-color-body': 'rgba(26, 27, 30, 1)',
          },
        };
      }}
    >
      <ModalsProvider modals={modals}>
        <BackgroundImage
          src={background?.url ?? ''}
          radius={0}
          style={{ position: 'fixed', top: 0, left: 0, zIndex: -1000, backgroundPosition: 'top' }}
          w='100dvw'
          h='100dvh'
        />
        {background?.source?.trim() && !isPhone && (
          <Anchor href={background.source_url} target='_blank' underline='hover'>
            <Text
              size='xs'
              c='dimmed'
              style={[
                getAnchorStyles({ r: 10, b: 6 }),
                {
                  zIndex: 1,
                },
              ]}
            >
              <IconBrush size='0.55rem' /> {background.source}
            </Text>
          </Anchor>
        )}
        <SearchSpotlight />
        <Notifications position='top-right' zIndex={9400} containerWidth={350} />
        <DrawerBase />
        {/* Zoom is applied to <html> in the useEffect above, not here,
            so that portaled UI (drawers, modals, tooltips, popovers,
            notifications) scales along with the in-tree Layout. */}
        <Layout>
          {/* Outlet is where react-router will render child routes */}
          <Outlet />
        </Layout>
      </ModalsProvider>
    </MantineProvider>
  );
}
