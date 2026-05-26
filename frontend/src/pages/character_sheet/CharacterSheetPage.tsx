// D20Loader replaced by the iframed /codex-loading.html — see `loader` below.
import { createPortal } from 'react-dom';
import { glassStyle } from '@utils/colors';
import BlurBox from '@common/BlurBox';
import { defineDefaultSources, fetchContentPackage, fetchContentSources } from '@content/content-store';

import {
  ActionIcon,
  Box,
  Button,
  Center,
  Menu,
  Popover,
  SimpleGrid,
  Stack,
  Tabs,
  rem,
  useMantineTheme,
} from '@mantine/core';
import { useElementSize, useHover, useInterval, useMediaQuery } from '@mantine/hooks';
import { makeRequest } from '@requests/request-manager';
import {
  IconBackpack,
  IconBadgesFilled,
  IconCaretLeftRight,
  IconDots,
  IconFlag,
  IconFlare,
  IconLayoutGrid,
  IconLayoutList,
  IconListDetails,
  IconNotebook,
  IconNotes,
  IconPaw,
  IconX,
} from '@tabler/icons-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Character, ContentPackage, LivingEntity } from '@schemas/content';
import { VariableListStr } from '@schemas/variables';
import { setPageTitle } from '@utils/document-change';
import { isPhoneSized, phoneQuery, tabletQuery } from '@utils/mobile-responsive';
import { toLabel } from '@utils/strings';
import { getVariable } from '@variables/variable-manager';
import { Suspense, lazy, useEffect, useRef, useState } from 'react';
import { useLoaderData } from 'react-router-dom';
import { SetterOrUpdater } from '@utils/type-fixing';
import CompanionsPanel from './panels/CompanionsPanel';
import DetailsPanel from './panels/DetailsPanel';
import ExtrasPanel from './panels/ExtrasPanel';
import FeatsFeaturesPanel from './panels/FeatsFeaturesPanel';
import InventoryPanel from './panels/InventoryPanel';
import NotesPanel from './panels/NotesPanel';
import SkillsActionsPanel from './panels/SkillsActionsPanel';
import SpellsPanel from './panels/SpellsPanel';
import ArmorSection from './sections/ArmorSection';
import AttributeSection from './sections/AttributeSection';
import EntityInfoSection from './sections/EntityInfoSection';
import ConditionSection from './sections/ConditionSection';
import HealthSection from './sections/HealthSection';
import SpeedSection from './sections/SpeedSection';
import { GiRollingDices } from 'react-icons/gi';
import { convertToSetEntity } from '@utils/type-fixing';
// ModesDrawer was the standalone "modes" floating drawer. Modes now
// live inside CodexSheet's ConditionsModesModal (one of its two tabs)
// so the standalone drawer is no longer mounted from this page.
import CampaignDrawer from '@pages/campaign/CampaignDrawer';
import useCharacter from '@utils/use-character';
import { getAnchorStyles } from '@utils/anchor';
import CodexSheet from './CodexSheet';
import { AnimatePresence, motion } from 'framer-motion';
import { IMPRINT_BG_COLOR, IMPRINT_BORDER_COLOR } from '@constants/data';

// Use lazy imports here to prevent a huge amount of js on initial load (3d dice smh)
const DiceRoller = lazy(() => import('@common/dice/DiceRoller'));

/**
 * Top-level route component for the character sheet page.
 * Handles fetching the content package and showing a loading screen
 * until the data is ready. Once loaded, renders CharacterSheetInner
 * while keeping the loader visible until the inner component signals
 * that it has finished its own initialization (EXECUTE_OPS).
 */
export function Component(props: {}) {
  useEffect(() => {
    setPageTitle(`Sheet`);
  }, []);

  const { characterId } = useLoaderData() as {
    characterId: string;
  };

  const theme = useMantineTheme();
  const [doneLoading, setDoneLoading] = useState(false);
  // Separate "the data is ready" (doneLoading) from "the loader element
  // is gone" (hideLoaderAfterTail). doneLoading is what fires
  // codex-complete to the iframe — that's when the d20 starts its
  // .land animation. We then wait SHEET_LOCK_TAIL_MS before flipping
  // hideLoaderAfterTail (which is what actually toggles display:none on
  // the loader) so the user sees the dice settle on its number for a
  // brief beat instead of the loader vanishing the same frame the lock
  // animation starts. Without this tail the user complained that the
  // dice "never lands visibly" — display:none cut the animation off
  // before the eye could register it.
  const [hideLoaderAfterTail, setHideLoaderAfterTail] = useState(false);
  // Track first mount of the sheet's loader so we can enforce a
  // minimum visible time before flipping doneLoading. Without this,
  // a sheet that opens with content already in the React Query cache
  // flashes the loader for <100ms and the user sees the d20 never
  // rolled — the "loading screen that finishes without rolling"
  // symptom. With it, even on a warm cache the d20 rolls for ~900ms
  // before locking, so the user always sees a coherent loader.
  const loaderMountedAtRef = useRef<number>(Date.now());
  const MIN_SHEET_LOADER_MS = 900;
  // Post-lock visible time. 500ms = .42s d20-land keyframe + ~80ms of
  // settled breathing room. Keep this in sync with CodexLoadingOverlay's
  // tailMs default — both loaders should feel identical at the
  // hand-off.
  const SHEET_LOCK_TAIL_MS = 500;

  // Seed the React Query cache with the freshly-fetched character so
  // useCharacter's inner fetch hits the cache instead of round-tripping
  // to the gateway a second time. Without this, opening a sheet ran
  // find-character TWICE (once here for content_sources, once inside
  // useCharacter) — double network + double parse on the slowest user
  // path.
  const queryClient = useQueryClient();
  const { data: content, isFetching } = useQuery({
    queryKey: [`find-content-${characterId}`],
    queryFn: async () => {
      // Fetch character + start prefetching the content package in
      // parallel. defineDefaultSources only needs the character's
      // content_sources.enabled, which is a tiny piece — kicking off
      // the content fetch with the user's stored sources (or empty if
      // we don't have them yet) overlaps the database read with the
      // larger content read. If the user's stored sources differ we
      // re-fetch with the corrected source set; on the happy path
      // (which is most opens) this halves the wall time.
      const charPromise = makeRequest<Character>('find-character', {
        id: characterId,
      });
      const character = await charPromise;
      // Cache it for use-character to read instead of refetching.
      if (character) {
        queryClient.setQueryData(['find-character', characterId], character);
        queryClient.setQueryData(['find-character', parseInt(characterId)], character);
      }
      const sv = defineDefaultSources('PAGE', character?.content_sources?.enabled ?? []);
      // fetchContentPackage with fetchSources:true also fetches the
      // sources — we don't need a separate fetchContentSources call,
      // it was double-fetching the same metadata.
      const content = await fetchContentPackage(sv, { fetchSources: true });
      return content;
    },
    refetchOnWindowFocus: false,
    staleTime: 60_000,
  });

  // Manually animate the loader progress bar so it feels responsive even
  // while waiting for the server. Once content arrives the bar jumps to
  // at least 50%, then CharacterSheetInner drives it to 100 via onFinishLoading.
  const [_p, setPercentage] = useState(0);
  const percentage = content && !doneLoading ? Math.max(_p, 50) : _p;
  const interval = useInterval(() => setPercentage(percentage + 2), 50);
  useEffect(() => {
    interval.start();
    return interval.stop;
  }, []);

  // Codex parchment loader. Replaces the bespoke D20Loader so character
  // sheet load matches the rest of the app's loading aesthetic. We send
  // a `codex-progress` postMessage frame each time `percentage`
  // updates so the bar in the iframe reflects the same 0→100 ramp the
  // old D20Loader had.
  //
  // Two things to be careful about here:
  //  1. The percentage variable can climb past 100 because the
  //     useInterval keeps ticking until interval.stop() runs in
  //     onFinishLoading — we cap at 95 so the loader visually settles
  //     just shy of "done" instead of reaching its asymptote (where
  //     Math.floor(99.95) hangs forever at "99 %").
  //  2. When doneLoading flips true we explicitly send codex-complete
  //     so the d20 lock animation actually plays out instead of
  //     stalling at 95 — the parent's CSS toggles display:none on the
  //     loader at the same moment, but the postMessage round-trip is
  //     cheap and guarantees the dice lands cleanly if a future caller
  //     keeps the iframe visible for the tail of the lock animation.
  const loaderIframeRef = useRef<HTMLIFrameElement | null>(null);
  useEffect(() => {
    const win = loaderIframeRef.current?.contentWindow;
    if (!win) return;
    try {
      win.postMessage(
        { type: 'codex-progress', value: Math.min(percentage, 95) },
        '*'
      );
    } catch {
      // Cross-origin throws in stray dev contexts — fine to ignore.
    }
  }, [percentage]);
  // Fire codex-complete when the sheet finishes loading. We retry the
  // postMessage for up to 1.5s to defeat a race where the iframe's
  // <script> hasn't finished wiring its message listener yet — on a
  // warm cache the React tree can mount + this effect can fire before
  // the iframe is even loaded, so the first message lands in a dead
  // slot and the d20 never locks. complete() inside the loader is
  // idempotent (`locked` flag), so duplicate sends are no-ops.
  useEffect(() => {
    if (!doneLoading) return;
    let cancelled = false;
    const deadline = Date.now() + 1500;
    const send = () => {
      if (cancelled) return;
      const w = loaderIframeRef.current?.contentWindow;
      if (w) {
        try { w.postMessage({ type: 'codex-complete' }, '*'); } catch {}
      }
      if (Date.now() < deadline) {
        setTimeout(send, 80);
      }
    };
    send();
    // After the .land animation has had time to play, snap the loader
    // away. This is what the user perceives as "the loading screen
    // closing" — we want it to feel like 1 beat after the dice locks,
    // not the older 700ms+ "stays at 100" feel.
    const hideTimer = setTimeout(
      () => setHideLoaderAfterTail(true),
      SHEET_LOCK_TAIL_MS
    );
    return () => {
      cancelled = true;
      clearTimeout(hideTimer);
    };
  }, [doneLoading]);
  // Fullscreen overlay rendered via portal directly to document.body.
  //
  // The portal is load-bearing: every route renders inside
  // Layout.tsx's <ScrollArea> which uses Radix's scroll viewport, and
  // Radix internally applies a CSS transform on its content wrapper.
  // A `transform` creates a containing block — which means any
  // descendant with `position: fixed` is positioned relative to that
  // transformed ancestor, NOT the viewport. The loader ended up
  // confined to the ScrollArea content rectangle (a small box in
  // the top-left when the rest of the sheet hadn't rendered yet),
  // which is exactly the symptom in the user's screenshot.
  //
  // Mounting via createPortal(..., document.body) sidesteps the
  // ScrollArea entirely — the loader is a child of <body>, so its
  // position:fixed snaps to the viewport.
  const loader = createPortal(
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        width: '100vw',
        height: '100vh',
        zIndex: 9999,
        background: '#e8e4d8', // wg4 parchment to match the new loading-screen palette
      }}
    >
      <iframe
        ref={loaderIframeRef}
        src='/codex-loading.html'
        title='Loading character sheet'
        style={{ width: '100%', height: '100%', border: 0, display: 'block' }}
      />
    </div>,
    document.body
  );

  if (isFetching || !content) {
    return loader;
  } else {
    // Render both elements simultaneously so CharacterSheetInner can run
    // EXECUTE_OPS in the background while the loader is still visible.
    //
    // CRITICAL: don't try to control loader visibility by wrapping it in
    // a styled <div>. The loader is a `createPortal(...)` mounted at
    // document.body — wrapping it in a div with `display: none` has
    // ZERO effect because the portal's actual DOM nodes are children
    // of <body>, not of the wrapping div. (We discovered this when the
    // user reported the loader was "stuck at 100%" — `setHideLoaderAfterTail`
    // was firing correctly, but the portal'd loader stayed visible
    // because the display:none on its React wrapper applied to a
    // sibling-of-the-portal-contents, not the portal contents
    // themselves.)
    //
    // Instead: conditionally render the loader. When hideLoaderAfterTail
    // flips true, we stop emitting the createPortal element at all,
    // which makes React unmount the portal contents from document.body.
    return (
      <>
        {!hideLoaderAfterTail && loader}
        <div style={{ display: hideLoaderAfterTail ? undefined : 'none' }}>
          <CharacterSheetInner
            content={content}
            characterId={parseInt(characterId)}
            onFinishLoading={() => {
              interval.stop();
              // Honour minimum visible time so the d20 always has a
              // moment to roll on screen, even when content was already
              // cached and the inner sheet finished operations in
              // milliseconds.
              const shownFor = Date.now() - loaderMountedAtRef.current;
              const remaining = Math.max(0, MIN_SHEET_LOADER_MS - shownFor);
              if (remaining === 0) {
                setDoneLoading(true);
              } else {
                setTimeout(() => setDoneLoading(true), remaining);
              }
            }}
          />
        </div>
      </>
    );
  }
}

/**
 * Main character sheet layout. Renders the top info/stat sections and the
 * tabbed panel area. Also owns the floating action buttons anchored to the
 * bottom-left corner (modes, campaign, dice roller).
 */
function CharacterSheetInner(props: { content: ContentPackage; characterId: number; onFinishLoading: () => void }) {
  const isTablet = useMediaQuery(tabletQuery());
  const isPhone = useMediaQuery(phoneQuery());
  const { ref, width, height } = useElementSize();

  // Reserve 60px for the tab bar; clamp panel height based on screen height
  const panelWidth = width ? width - 60 : 2000;
  const panelHeight = height > 800 ? 555 : 500;
  const [hideSections, setHideSections] = useState(false);

  // EXECUTE_OPS triggers the character's operation pipeline and calls
  // onFinishLoading when it completes, which dismisses the loading screen.
  const { character, setCharacter, isLoading } = useCharacter(props.characterId, {
    type: 'EXECUTE_OPS',
    data: {
      content: props.content,
      context: 'CHARACTER-SHEET',
      onFinishLoading: props.onFinishLoading,
    },
  });

  setPageTitle(character && character.name.trim() ? character.name : 'Sheet');

  // Dice roller is lazy-loaded; loadedDiceRoller tracks whether to keep it
  // mounted after the first open (so it doesn't remount on subsequent opens).
  const [openedDiceRoller, setOpenedDiceRoller] = useState(false);
  const [loadedDiceRoller, setLoadedDiceRoller] = useState(false);

  const [openedCampaign, setOpenedCampaign] = useState(false);
  // The mode list itself is now derived inside ConditionsModesModal
  // from MODE_IDS + content.abilityBlocks; no need to compute it here
  // since the standalone Modes button is gone.

  return (
    <Box ref={ref} w='100%'>
      {/* Codex sheet — full-bleed two-column layout matching
          codex-sheet-v5.html. Replaces the previous SimpleGrid +
          SectionPanels. Sub-panels (Spells/Inventory/Feats/etc.)
          are rendered inside CodexSheet via the tab system; they
          use the existing panel components for content + the
          codex-bridge.css for styling. */}
      <CodexSheet
        characterId={props.characterId}
        character={character}
        setCharacter={setCharacter}
        content={props.content}
        panelWidth={panelWidth}
        panelHeight={panelHeight}
        sidebarActions={
          <>
            {/* Modes used to live here as a standalone icon. They're
                now a tab inside the Conditions/Modes modal opened from
                the vitals "+ add" chip — see CodexSheet's
                ConditionsModesModal. The legacy state below is kept
                only because the still-mounted SectionPanels block
                (hidden, but referenced via React refs) imports it; we
                no longer surface a Modes opener at this site. */}
            {character?.campaign_id && (
              <ActionIcon
                size={28}
                variant='light'
                aria-label='Campaign'
                onClick={() => setOpenedCampaign((prev) => !prev)}
              >
                <IconFlag size='1rem' stroke={1.5} />
              </ActionIcon>
            )}
            {/* Dice roller is always available in the local fork. */}
            <ActionIcon
              size={28}
              variant='light'
              aria-label='Dice Roller'
              onClick={() => {
                if (!loadedDiceRoller) setLoadedDiceRoller(true);
                setOpenedDiceRoller(true);
              }}
            >
              <GiRollingDices size='1rem' stroke={'1.5px'} />
            </ActionIcon>
          </>
        }
      />
      {/* Keep the legacy SectionPanels reachable via the bottom of
          the page for now — there's still functionality (extras,
          phone-specific layouts) that CodexSheet doesn't replicate
          yet. Hidden by default; the codex tabs cover the same
          panels. */}
      {hideSections && (
        <Box style={{ display: 'none' }}>
          <SectionPanels
            content={props.content}
            entity={character}
            setEntity={convertToSetEntity(setCharacter)}
            isLoaded={!isLoading}
            panelHeight={panelHeight}
            panelWidth={panelWidth}
            hideSections={hideSections}
            onHideSections={(hide) => setHideSections(hide)}
          />
        </Box>
      )}

      {/* Modes / Campaign / Dice are now docked at the bottom of the
          codex sidebar via the sidebarActions prop above, not floating
          at the bottom-left corner. */}

      {/* Keep DiceRoller mounted once loaded so it doesn't lose its state between opens */}
      {loadedDiceRoller && (
        <Suspense fallback={<></>}>
          <DiceRoller
            opened={openedDiceRoller}
            onClose={() => {
              setOpenedDiceRoller(false);
            }}
          />
        </Suspense>
      )}
      {/* ModesDrawer mount removed — modes live inside the
          ConditionsModesModal opened from CodexSheet's vitals "+ add" chip. */}
      {openedCampaign && character?.campaign_id && (
        <CampaignDrawer campaignId={character?.campaign_id} opened={true} onClose={() => setOpenedCampaign(false)} />
      )}
    </Box>
  );
}

/**
 * Renders the tabbed panel area of the character sheet.
 *
 * On phone: shows a single full-screen panel at a time, with a floating
 * grid button (bottom-right) that opens a popover to switch panels.
 * The top stat sections are hidden while a panel is active to maximise
 * vertical space.
 *
 * On desktop/tablet: renders a standard Mantine Tabs bar. Tabs that the
 * user has marked as "primary" appear directly in the bar; the rest are
 * accessible via the "..." overflow menu.
 */
function SectionPanels(props: {
  content: ContentPackage;
  entity: LivingEntity | null;
  setEntity: SetterOrUpdater<LivingEntity | null>;
  isLoaded: boolean;
  hideSections: boolean;
  onHideSections: (hide: boolean) => void;
  panelHeight: number;
  panelWidth: number;
}) {
  const theme = useMantineTheme();
  const isPhone = isPhoneSized(props.panelWidth);

  // Controls visibility of the mobile panel-picker popover
  const [openedPhonePanel, setOpenedPhonePanel] = useState(false);

  // null until the character finishes loading, then defaults to 'skills-actions'
  const [activeTab, setActiveTab] = useState<string | null>(null);
  const { hovered: hoveredTabOptions, ref: tabOptionsRef } = useHover<HTMLButtonElement>();

  const iconStyle = { width: rem(12), height: rem(12) };

  // Full ordered list of all available sheet tabs
  const allSheetTabs = [
    'skills-actions',
    'inventory',
    'spells',
    'feats-features',
    'companions',
    'details',
    'notes',
    'extras',
  ];

  // PRIMARY_SHEET_TABS is a character-level variable that determines which tabs
  // are shown directly in the tab bar vs hidden behind the "..." overflow menu.
  const primarySheetTabs = getVariable<VariableListStr>('CHARACTER', 'PRIMARY_SHEET_TABS')?.value ?? [];
  const tabOptions = allSheetTabs.filter((tab) => !primarySheetTabs.includes(tab));

  // True when the currently active tab is one of the overflow (non-primary) tabs,
  // used to highlight the "..." button to indicate a hidden tab is selected.
  const openedTabOption = tabOptions.find((tab) => tab === activeTab);

  const getTabIcon = (tab: string) => {
    switch (tab) {
      case 'skills-actions':
        return <IconBadgesFilled style={iconStyle} />;
      case 'inventory':
        return <IconBackpack style={iconStyle} />;
      case 'spells':
        return <IconFlare style={iconStyle} />;
      case 'feats-features':
        return <IconCaretLeftRight style={iconStyle} />;
      case 'companions':
        return <IconPaw style={iconStyle} />;
      case 'details':
        return <IconListDetails style={iconStyle} />;
      case 'notes':
        return <IconNotebook style={iconStyle} />;
      case 'extras':
        return <IconNotes style={iconStyle} />;
      default:
        return null;
    }
  };

  useEffect(() => {
    // Open first tab when finished loading
    if (props.isLoaded && activeTab === null) {
      setActiveTab('skills-actions');
    }
  }, [props.isLoaded, activeTab]);

  useEffect(() => {
    // Add back the sections when switching from phone to desktop
    if (!isPhone) {
      props.onHideSections(false);
      setOpenedPhonePanel(false);
    }
  }, [isPhone]);

  // ── Phone layout ────────────────────────────────────────────────────────────
  if (isPhone) {
    return (
      <Box>
        {/* Only render the active panel when sections are hidden (i.e. a panel is selected) */}
        {props.hideSections && (
          <BlurBox p='sm' mih={props.panelHeight}>
            {activeTab === 'skills-actions' && (
              <SkillsActionsPanel
                id='CHARACTER'
                entity={props.entity}
                setEntity={props.setEntity}
                content={props.content}
                panelHeight={props.panelHeight}
                panelWidth={props.panelWidth}
              />
            )}

            {activeTab === 'inventory' && (
              <InventoryPanel
                id='CHARACTER'
                entity={props.entity}
                setEntity={props.setEntity}
                content={props.content}
                panelHeight={props.panelHeight}
                panelWidth={props.panelWidth}
              />
            )}

            {activeTab === 'spells' && (
              <SpellsPanel
                panelHeight={props.panelHeight}
                panelWidth={props.panelWidth}
                id={'CHARACTER'}
                entity={props.entity}
                setEntity={props.setEntity}
              />
            )}

            {activeTab === 'feats-features' && (
              <FeatsFeaturesPanel panelHeight={props.panelHeight} panelWidth={props.panelWidth} />
            )}

            {activeTab === 'companions' && (
              <CompanionsPanel panelHeight={props.panelHeight} panelWidth={props.panelWidth} />
            )}

            {activeTab === 'details' && (
              <DetailsPanel content={props.content} panelHeight={props.panelHeight} panelWidth={props.panelWidth} />
            )}

            {activeTab === 'notes' && (
              <NotesPanel
                panelHeight={props.panelHeight}
                panelWidth={props.panelWidth}
                entity={props.entity}
                setEntity={props.setEntity}
              />
            )}

            {activeTab === 'extras' && <ExtrasPanel panelHeight={props.panelHeight} panelWidth={props.panelWidth} />}
          </BlurBox>
        )}

        {/* Floating grid button anchored bottom-right that opens the panel picker */}
        <Box style={getAnchorStyles({ r: 20, b: 20 })}>
          <Popover
            position='top'
            withArrow
            opened={openedPhonePanel}
            onChange={setOpenedPhonePanel}
            styles={(t) => ({
              dropdown: {
                // Force the dropdown to span the full viewport width.
                // `left: 0 !important` overrides Mantine's floating-ui positioning
                // which would otherwise anchor it relative to the target button.
                ...glassStyle(),
                backgroundColor: 'rgba(0,0,0,0.4)',
                border: `1px solid ` + IMPRINT_BORDER_COLOR,
                width: '100dvw',
                left: '0 !important',
                borderRadius: t.radius.lg,
                padding: t.spacing.sm,
              },
            })}
          >
            <Popover.Target>
              <ActionIcon
                size={55}
                variant='filled'
                radius={100}
                aria-label='Panel Grid'
                onClick={() => setOpenedPhonePanel((o) => !o)}
              >
                {openedPhonePanel ? <IconX size='2rem' stroke={2} /> : <IconLayoutGrid size='2rem' stroke={1.5} />}
              </ActionIcon>
            </Popover.Target>
            <Popover.Dropdown>
              <Box>
                <Stack>
                  {/* "Health, Attributes, Saves" restores the top stat sections */}
                  <Button
                    leftSection={<IconLayoutList size='1.2rem' stroke={2} />}
                    variant={!props.hideSections ? 'filled' : 'light'}
                    onClick={() => {
                      props.onHideSections(false);
                      setOpenedPhonePanel(false);
                    }}
                  >
                    Health, Attributes, Saves
                  </Button>
                  <SimpleGrid cols={2}>
                    <Button
                      leftSection={<IconBadgesFilled size='1.2rem' stroke={2} />}
                      variant={activeTab === 'skills-actions' && props.hideSections ? 'filled' : 'light'}
                      onClick={() => {
                        setActiveTab('skills-actions');
                        props.onHideSections(true);
                        setOpenedPhonePanel(false);
                      }}
                    >
                      Skills & Actions
                    </Button>
                    <Button
                      leftSection={<IconCaretLeftRight size='1.2rem' stroke={2} />}
                      variant={activeTab === 'feats-features' && props.hideSections ? 'filled' : 'light'}
                      onClick={() => {
                        setActiveTab('feats-features');
                        props.onHideSections(true);
                        setOpenedPhonePanel(false);
                      }}
                    >
                      Feats & Features
                    </Button>
                  </SimpleGrid>
                  <SimpleGrid cols={2}>
                    <Button
                      leftSection={<IconBackpack size='1.2rem' stroke={2} />}
                      variant={activeTab === 'inventory' && props.hideSections ? 'filled' : 'light'}
                      onClick={() => {
                        setActiveTab('inventory');
                        props.onHideSections(true);
                        setOpenedPhonePanel(false);
                      }}
                    >
                      Inventory
                    </Button>
                    <Button
                      leftSection={<IconFlare size='1.2rem' stroke={2} />}
                      variant={activeTab === 'spells' && props.hideSections ? 'filled' : 'light'}
                      onClick={() => {
                        setActiveTab('spells');
                        props.onHideSections(true);
                        setOpenedPhonePanel(false);
                      }}
                    >
                      Spells
                    </Button>
                  </SimpleGrid>
                  <SimpleGrid cols={2}>
                    <Button
                      leftSection={<IconNotebook size='1.2rem' stroke={2} />}
                      variant={activeTab === 'notes' && props.hideSections ? 'filled' : 'light'}
                      onClick={() => {
                        setActiveTab('notes');
                        props.onHideSections(true);
                        setOpenedPhonePanel(false);
                      }}
                    >
                      Notes
                    </Button>
                    <Button
                      leftSection={<IconListDetails size='1.2rem' stroke={2} />}
                      variant={activeTab === 'details' && props.hideSections ? 'filled' : 'light'}
                      onClick={() => {
                        setActiveTab('details');
                        props.onHideSections(true);
                        setOpenedPhonePanel(false);
                      }}
                    >
                      Details
                    </Button>
                  </SimpleGrid>
                  <SimpleGrid cols={2}>
                    <Button
                      leftSection={<IconPaw size='1.2rem' stroke={2} />}
                      variant={activeTab === 'companions' && props.hideSections ? 'filled' : 'light'}
                      onClick={() => {
                        setActiveTab('companions');
                        props.onHideSections(true);
                        setOpenedPhonePanel(false);
                      }}
                    >
                      Companions
                    </Button>
                    <Button
                      leftSection={<IconNotes size='1.2rem' stroke={2} />}
                      variant={activeTab === 'extras' && props.hideSections ? 'filled' : 'light'}
                      onClick={() => {
                        setActiveTab('extras');
                        props.onHideSections(true);
                        setOpenedPhonePanel(false);
                      }}
                    >
                      Extras
                    </Button>
                  </SimpleGrid>
                </Stack>
              </Box>
            </Popover.Dropdown>
          </Popover>
        </Box>
      </Box>
    );
  } else {
    // ── Desktop / tablet layout ────────────────────────────────────────────────

    // Shared fade-in animation applied to each panel on mount
    const panelMotion = {
      initial: { opacity: 0 },
      animate: { opacity: 1 },
      exit: { opacity: 1 },
      transition: {
        duration: 0.12,
        ease: 'easeOut',
      },
    };

    return (
      <Box>
        <BlurBox
          p='sm'
          style={{
            height: props.panelHeight + 65,
          }}
        >
          {/* keepMounted={false} ensures inactive panels are unmounted to save memory */}
          <Tabs
            color='dark.6'
            variant='pills'
            radius='xl'
            keepMounted={false}
            value={activeTab}
            onChange={setActiveTab}
            activateTabWithKeyboard={false}
          >
            <Tabs.List pb={10} grow>
              {/* Only render tabs that are in the character's PRIMARY_SHEET_TABS variable */}
              {primarySheetTabs.includes('skills-actions') && (
                <Tabs.Tab
                  value='skills-actions'
                  style={{
                    border:
                      activeTab === 'skills-actions' ? `1px solid ` + IMPRINT_BORDER_COLOR : `1px solid transparent`,
                  }}
                  leftSection={getTabIcon('skills-actions')}
                >
                  Skills & Actions
                </Tabs.Tab>
              )}
              {primarySheetTabs.includes('inventory') && (
                <Tabs.Tab
                  value='inventory'
                  style={{
                    border: activeTab === 'inventory' ? `1px solid ` + IMPRINT_BORDER_COLOR : `1px solid transparent`,
                  }}
                  leftSection={getTabIcon('inventory')}
                >
                  Inventory
                </Tabs.Tab>
              )}
              {primarySheetTabs.includes('spells') && (
                <Tabs.Tab
                  value='spells'
                  style={{
                    border: activeTab === 'spells' ? `1px solid ` + IMPRINT_BORDER_COLOR : `1px solid transparent`,
                  }}
                  leftSection={getTabIcon('spells')}
                >
                  Spells
                </Tabs.Tab>
              )}
              {primarySheetTabs.includes('feats-features') && (
                <Tabs.Tab
                  value='feats-features'
                  style={{
                    border:
                      activeTab === 'feats-features' ? `1px solid ` + IMPRINT_BORDER_COLOR : `1px solid transparent`,
                  }}
                  leftSection={getTabIcon('feats-features')}
                >
                  Feats & Features
                </Tabs.Tab>
              )}
              {primarySheetTabs.includes('companions') && (
                <Tabs.Tab
                  value='companions'
                  style={{
                    border: activeTab === 'companions' ? `1px solid ` + IMPRINT_BORDER_COLOR : `1px solid transparent`,
                  }}
                  leftSection={getTabIcon('companions')}
                >
                  Companions
                </Tabs.Tab>
              )}
              {primarySheetTabs.includes('details') && (
                <Tabs.Tab
                  value='details'
                  style={{
                    border: activeTab === 'details' ? `1px solid ` + IMPRINT_BORDER_COLOR : `1px solid transparent`,
                  }}
                  leftSection={getTabIcon('details')}
                >
                  Details
                </Tabs.Tab>
              )}
              {primarySheetTabs.includes('notes') && (
                <Tabs.Tab
                  value='notes'
                  style={{
                    border: activeTab === 'notes' ? `1px solid ` + IMPRINT_BORDER_COLOR : `1px solid transparent`,
                  }}
                  leftSection={getTabIcon('notes')}
                >
                  Notes
                </Tabs.Tab>
              )}

              {/* Overflow "..." menu for non-primary tabs; highlighted when an overflow tab is active */}
              <Menu shadow='md' width={160} trigger='hover' openDelay={100} closeDelay={100}>
                <Menu.Target>
                  <ActionIcon
                    variant='subtle'
                    color='gray.4'
                    size='lg'
                    radius='xl'
                    aria-label='Tab Options'
                    ref={tabOptionsRef}
                    style={{
                      backgroundColor: hoveredTabOptions || openedTabOption ? IMPRINT_BG_COLOR : 'transparent',
                      color: openedTabOption ? theme.colors.gray[0] : undefined,
                      border: openedTabOption ? `1px solid ` + IMPRINT_BORDER_COLOR : `1px solid transparent`,
                    }}
                  >
                    <IconDots style={{ width: '70%', height: '70%' }} stroke={1.5} />
                  </ActionIcon>
                </Menu.Target>

                <Menu.Dropdown>
                  <Menu.Label>Other sections</Menu.Label>
                  {tabOptions.map((tab, index) => (
                    <Menu.Item
                      key={index}
                      leftSection={getTabIcon(tab)}
                      onClick={() => {
                        setActiveTab(tab);
                      }}
                      style={{
                        backgroundColor: activeTab === tab ? IMPRINT_BG_COLOR : undefined,
                        color: activeTab === tab ? theme.colors.gray[0] : undefined,
                      }}
                    >
                      {toLabel(tab)}
                    </Menu.Item>
                  ))}
                </Menu.Dropdown>
              </Menu>
            </Tabs.List>

            {/* Each panel is wrapped in AnimatePresence + motion.div for the fade-in transition */}
            <Tabs.Panel value='skills-actions'>
              <AnimatePresence mode='wait'>
                <motion.div key='skills-actions' {...panelMotion}>
                  <SkillsActionsPanel
                    id='CHARACTER'
                    entity={props.entity}
                    setEntity={props.setEntity}
                    content={props.content}
                    panelHeight={props.panelHeight}
                    panelWidth={props.panelWidth}
                  />
                </motion.div>
              </AnimatePresence>
            </Tabs.Panel>

            <Tabs.Panel value='inventory'>
              <AnimatePresence mode='wait'>
                <motion.div key='inventory' {...panelMotion}>
                  <InventoryPanel
                    id='CHARACTER'
                    entity={props.entity}
                    setEntity={props.setEntity}
                    content={props.content}
                    panelHeight={props.panelHeight}
                    panelWidth={props.panelWidth}
                  />
                </motion.div>
              </AnimatePresence>
            </Tabs.Panel>

            <Tabs.Panel value='spells'>
              <AnimatePresence mode='wait'>
                <motion.div key='spells' {...panelMotion}>
                  <SpellsPanel
                    panelHeight={props.panelHeight}
                    panelWidth={props.panelWidth}
                    id={'CHARACTER'}
                    entity={props.entity}
                    setEntity={props.setEntity}
                  />
                </motion.div>
              </AnimatePresence>
            </Tabs.Panel>

            <Tabs.Panel value='feats-features'>
              <AnimatePresence mode='wait'>
                <motion.div key='feats-features' {...panelMotion}>
                  <FeatsFeaturesPanel panelHeight={props.panelHeight} panelWidth={props.panelWidth} />
                </motion.div>
              </AnimatePresence>
            </Tabs.Panel>

            <Tabs.Panel value='companions'>
              <AnimatePresence mode='wait'>
                <motion.div key='companions' {...panelMotion}>
                  <CompanionsPanel panelHeight={props.panelHeight} panelWidth={props.panelWidth} />
                </motion.div>
              </AnimatePresence>
            </Tabs.Panel>

            <Tabs.Panel value='details'>
              <AnimatePresence mode='wait'>
                <motion.div key='details' {...panelMotion}>
                  <DetailsPanel content={props.content} panelHeight={props.panelHeight} panelWidth={props.panelWidth} />
                </motion.div>
              </AnimatePresence>
            </Tabs.Panel>

            <Tabs.Panel value='notes'>
              <AnimatePresence mode='wait'>
                <motion.div key='notes' {...panelMotion}>
                  <NotesPanel
                    panelHeight={props.panelHeight}
                    panelWidth={props.panelWidth}
                    entity={props.entity}
                    setEntity={props.setEntity}
                  />
                </motion.div>
              </AnimatePresence>
            </Tabs.Panel>

            <Tabs.Panel value='extras'>
              <AnimatePresence mode='wait'>
                <motion.div key='extras' {...panelMotion}>
                  <ExtrasPanel panelHeight={props.panelHeight} panelWidth={props.panelWidth} />
                </motion.div>
              </AnimatePresence>
            </Tabs.Panel>
          </Tabs>
        </BlurBox>
      </Box>
    );
  }
}
