import { generateNames } from '@ai/fantasygen-dev/name-controller';
import { GroupLinkSwitch, LinkSwitch, LinksGroup } from '@common/LinksGroup';
import { GUIDE_BLUE, IMPRINT_BG_COLOR, IMPRINT_BG_COLOR_HOVER, IMPRINT_BORDER_COLOR } from '@constants/data';
import {
  Stack,
  Group,
  Box,
  Avatar,
  Title,
  Text,
  TextInput,
  ActionIcon,
  rem,
  Select,
  Tabs,
  useMantineTheme,
  UnstyledButton,
  PasswordInput,
  Image,
  Divider,
  Paper,
  ScrollArea,
  ColorInput,
  HoverCard,
  List,
  Anchor,
} from '@mantine/core';
import { getHotkeyHandler, useElementSize, useMediaQuery } from '@mantine/hooks';
import { modals, openContextModal } from '@mantine/modals';
import { showNotification } from '@mantine/notifications';
import {
  IconUserCircle,
  IconRefreshDot,
  IconBooks,
  IconAsset,
  IconVocabulary,
  IconSettings,
  IconBook2,
  IconWorld,
  IconMap,
  IconBrandSafari,
  IconDots,
  IconServer,
  IconPlus,
  IconKey,
  IconArchive,
  IconHexagonalPrism,
  IconFlag,
  IconX,
  IconExternalLink,
  IconArrowRight,
} from '@tabler/icons-react';
import { getAllBackgroundImages } from '@utils/background-images';
import { getAllPortraitImages } from '@utils/portrait-images';
import useRefresh from '@utils/use-refresh';
import { useState } from 'react';
import { useAtom } from 'jotai';
import FantasyGen_dev from '@assets/images/fantasygen_dev.png';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  defineDefaultSources,
  fetchContentSources,
  findRequiredContentSources,
  resetContentStore,
} from '@content/content-store';
import { displayPatronOnly } from '@utils/notifications';
import { getCachedPublicUser, getPublicUser } from '@auth/user-manager';
import BlurButton from '@common/BlurButton';
import OperationsModal from '@modals/OperationsModal';
import { hasPatreonAccess } from '@utils/patreon';
import { phoneQuery } from '@utils/mobile-responsive';
import { drawerState } from '@atoms/navAtoms';
import { Campaign, PublicUser } from '@schemas/content';
import { userState } from '@atoms/userAtoms';
import { makeRequest } from '@requests/request-manager';
import { updateSubscriptions } from '@content/homebrew';
import { ImageOption } from '@schemas/index';
import { cloneDeep, isEqual, uniq } from 'lodash-es';
import BlurBox from '@common/BlurBox';
import { DisplayIcon } from '@common/IconDisplay';
import useCharacter from '@utils/use-character';

export default function CharBuilderHome(props: { characterId: number; pageHeight: number; onContinue?: () => void }) {
  const theme = useMantineTheme();

  const { ref, height } = useElementSize();
  const topGap = 30;
  const isPhone = useMediaQuery(phoneQuery());

  // Active codex tab — Books / Homebrew / Variant Rules. The "Options"
  // gear in the tabs row is a button (not a tab) that opens the
  // sheet-settings panel (color / background / campaign join) inline
  // below — those used to live in a side panel.
  const [activeTab, setActiveTab] = useState<'books' | 'homebrew' | 'variants' | 'options'>('books');

  const queryClient = useQueryClient();
  const [_drawer, openDrawer] = useAtom(drawerState);

  const { character, setCharacter } = useCharacter(props.characterId, {
    type: 'SIMPLE',
  });

  const [loadingGenerateName, setLoadingGenerateName] = useState(false);
  const [displayNameInput, refreshNameInput] = useRefresh();

  const [openedOperations, setOpenedOperations] = useState(false);

  const [user, setUser] = useAtom(userState);
  useQuery({
    queryKey: [`find-account-self`],
    queryFn: async () => {
      const user = await getPublicUser();
      setUser(user);
      return user;
    },
  });

  const { data: apiClients } = useQuery({
    queryKey: [`get-api-clients`, character?.details?.api_clients],
    queryFn: async () => {
      //
      if (character?.details?.api_clients?.client_access) {
        const users = await Promise.all(
          character.details.api_clients.client_access.map((client) =>
            makeRequest<PublicUser>('get-user', {
              _id: client.publicUserId,
            })
          )
        );

        return character.details.api_clients.client_access.map((c) => {
          const user = users?.find((u) => `${u?.id ?? ''}` === c.publicUserId);
          const fullClient = user?.api?.clients?.find((cl) => cl.id === c.clientId) ?? null;

          return fullClient;
        });
      } else {
        return [];
      }
    },
  });

  const { data: fetchedBooks, refetch } = useQuery({
    queryKey: [`get-content-sources-character-settings`, { characterId: character?.id }],
    queryFn: async () => {
      return (await fetchContentSources('ALL-OFFICIAL-PUBLIC')).filter((book) => book.deprecated !== true);
    },
  });
  const books = fetchedBooks ?? [];

  // Every homebrew bundle the local user owns. Locally we don't need the
  // upstream "subscribe to other people's bundles" indirection — the
  // builder just lists everything you've made. Auto-subscription on
  // create is still wired up so existing characters keep working, but
  // the panel itself queries owned bundles directly.
  const { data: fetchedHomebrewBundles, refetch: refetchHomebrewBundles } = useQuery({
    queryKey: [`get-homebrew-bundles-for-builder`, { userId: user?.user_id }],
    queryFn: async () => {
      if (!user?.user_id) return [];
      return (await fetchContentSources('ALL-HOMEBREW-ACCESSIBLE')).filter(
        (c) => c.user_id && c.user_id === user.user_id
      );
    },
    enabled: !!user?.user_id,
  });
  const homebrewBundles = fetchedHomebrewBundles ?? [];

  const openConfirmLevelChangeModal = (oldLevel: number, newLevel: number) =>
    modals.openConfirmModal({
      title: (
        <Title order={4}>
          Decrease Level from {oldLevel} → {newLevel}
        </Title>
      ),
      children: (
        <Text size='sm'>
          Are you sure you want to decrease your character's level? Any selections you've made at levels higher than the
          new level will be erased.
        </Text>
      ),
      labels: { confirm: 'Confirm', cancel: 'Cancel' },
      onCancel: () => {},
      onConfirm: () => {
        setCharacter((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            level: newLevel,
            meta_data: {
              ...prev.meta_data,
              reset_hp: true,
            },
          };
        });
      },
    });

  const hasBookEnabled = (bookId: number) => {
    return character?.content_sources?.enabled?.includes(bookId);
  };

  const setBooksEnabled = async (inputIds: number[], enabled: boolean) => {
    // For the sake of a responsive UI, let's change the clicked book immediately
    setCharacter((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        content_sources: {
          ...prev.content_sources,
          enabled: enabled
            ? uniq([...(prev.content_sources?.enabled ?? []), ...inputIds])
            : prev.content_sources?.enabled?.filter((id: number) => !inputIds.includes(id)),
        },
      };
    });
    //

    const changeBooks = (bookIds: number[]) => {
      // Update character content sources
      setCharacter((prev) => {
        if (!prev) return prev;

        const newEnabled = enabled
          ? uniq([...(prev.content_sources?.enabled ?? []), ...bookIds])
          : prev.content_sources?.enabled?.filter((id: number) => !bookIds.includes(id));

        // Refresh data to repopulate with new book content
        resetContentStore();
        defineDefaultSources('PAGE', newEnabled ?? []);
        refetch();
        queryClient.invalidateQueries({
          queryKey: [`find-content-${character?.id}`, `get-character-init-builder-${character?.id}`],
        });

        // Save new enabled books to character
        return {
          ...prev,
          content_sources: {
            ...prev.content_sources,
            enabled: newEnabled,
          },
        };
      });
    };

    if (enabled) {
      // Handle dependency logic
      const requiredBooks = await findRequiredContentSources(
        uniq([...(character?.content_sources?.enabled ?? []), ...inputIds])
      );
      if (requiredBooks.newSources.length > 0) {
        modals.openConfirmModal({
          title: <Title order={3}>Enable Dependencies</Title>,
          children: (
            <Stack gap='xs'>
              <Text fz='sm'>
                It's recommended to enable the following as well. Certain features may not work as intended without
                them.
              </Text>
              <List>
                {requiredBooks.newSources.map((source, index) => (
                  <List.Item key={index}>
                    <Anchor
                      onClick={() => {
                        openDrawer({
                          type: 'content-source',
                          data: {
                            id: source.id,
                          },
                        });
                      }}
                    >
                      {source.name}
                    </Anchor>
                  </List.Item>
                ))}
              </List>
            </Stack>
          ),
          labels: { confirm: 'Enable', cancel: 'Continue without' },
          onCancel: () => changeBooks(inputIds),
          onConfirm: () => changeBooks([...inputIds, ...requiredBooks.sourceIds]),
        });
      } else {
        changeBooks(inputIds);
      }
    } else {
      changeBooks(inputIds);
    }
  };

  const iconStyle = { width: rem(12), height: rem(12) };

  const getOptionsSection = () => (
    <Box h='100%'>
      <Paper
        shadow='sm'
        h='100%'
        style={{
          backgroundColor: 'rgba(0, 0, 0, 0.13)',
        }}
      >
        <Tabs defaultValue='books' h='100%'>
          <Tabs.List grow>
            <Tabs.Tab
              value='books'
              leftSection={isPhone ? undefined : <IconBooks style={iconStyle} />}
              px={isPhone ? 5 : undefined}
            >
              <Text fz={isPhone ? 11 : 'sm'}>Books</Text>
            </Tabs.Tab>
            <Tabs.Tab
              value='homebrew'
              leftSection={isPhone ? undefined : <IconAsset style={iconStyle} />}
              px={isPhone ? 5 : undefined}
            >
              <Text fz={isPhone ? 11 : 'sm'}>Homebrew</Text>
            </Tabs.Tab>
            <Tabs.Tab
              value='variants'
              leftSection={isPhone ? undefined : <IconVocabulary style={iconStyle} />}
              px={isPhone ? 5 : undefined}
            >
              <Text fz={isPhone ? 11 : 'sm'}>Variant Rules</Text>
            </Tabs.Tab>
            <Tabs.Tab
              value='options'
              leftSection={isPhone ? undefined : <IconSettings style={iconStyle} />}
              px={isPhone ? 5 : undefined}
            >
              <Text fz={isPhone ? 11 : 'sm'}>Options</Text>
            </Tabs.Tab>
          </Tabs.List>
          <ScrollArea h='90%' scrollbars='y'>
            <Tabs.Panel value='books'>
              <Stack gap={0} pt='sm'>
                <LinksGroup
                  icon={IconBook2}
                  label={'Pathfinder Core'}
                  links={books
                    .filter((book) => book.group === 'pathfinder-core')
                    .map((book) => ({
                      label: book.name,
                      id: book.id,
                      url: book.url,
                      enabled: hasBookEnabled(book.id),
                    }))}
                  onLinkChange={(bookId, enabled) => setBooksEnabled([bookId], enabled)}
                  onEnableAll={() => {
                    setBooksEnabled(
                      books.filter((book) => book.group === 'pathfinder-core').map((book) => book.id),
                      true
                    );
                  }}
                />
                <LinksGroup
                  icon={IconServer}
                  label={'Starfinder Core'}
                  links={books
                    .filter((book) => book.group === 'starfinder-core')
                    .map((book) => ({
                      label: book.name,
                      id: book.id,
                      url: book.url,
                      enabled: hasBookEnabled(book.id),
                    }))}
                  onLinkChange={(bookId, enabled) => setBooksEnabled([bookId], enabled)}
                  onEnableAll={() => {
                    setBooksEnabled(
                      books.filter((book) => book.group === 'starfinder-core').map((book) => book.id),
                      true
                    );
                  }}
                />
                <Box py={8}>
                  <Divider w={220} ml={15} />
                </Box>
                <LinksGroup
                  icon={IconMap}
                  label={'Adventure Paths'}
                  links={books
                    .filter((book) => book.group === 'adventure-path')
                    .map((book) => ({
                      label: book.name,
                      id: book.id,
                      url: book.url,
                      enabled: hasBookEnabled(book.id),
                    }))}
                  onLinkChange={(bookId, enabled) => setBooksEnabled([bookId], enabled)}
                  onEnableAll={() => {
                    setBooksEnabled(
                      books.filter((book) => book.group === 'adventure-path').map((book) => book.id),
                      true
                    );
                  }}
                />
                <LinksGroup
                  icon={IconBrandSafari}
                  label={'Standalone Adventures'}
                  links={books
                    .filter((book) => book.group === 'standalone-adventure')
                    .map((book) => ({
                      label: book.name,
                      id: book.id,
                      url: book.url,
                      enabled: hasBookEnabled(book.id),
                    }))}
                  onLinkChange={(bookId, enabled) => setBooksEnabled([bookId], enabled)}
                  onEnableAll={() => {
                    setBooksEnabled(
                      books.filter((book) => book.group === 'standalone-adventure').map((book) => book.id),
                      true
                    );
                  }}
                />
                <LinksGroup
                  icon={IconWorld}
                  label={'Lost Omens'}
                  links={books
                    .filter((book) => book.group === 'lost-omens')
                    .map((book) => ({
                      label: book.name,
                      id: book.id,
                      url: book.url,
                      enabled: hasBookEnabled(book.id),
                    }))}
                  onLinkChange={(bookId, enabled) => setBooksEnabled([bookId], enabled)}
                  onEnableAll={() => {
                    setBooksEnabled(
                      books.filter((book) => book.group === 'lost-omens').map((book) => book.id),
                      true
                    );
                  }}
                />
                <LinksGroup
                  icon={IconArchive}
                  label={'Core Backports'}
                  links={books
                    .filter((book) => book.group === 'legacy')
                    .map((book) => ({
                      label: book.name,
                      id: book.id,
                      url: book.url,
                      enabled: hasBookEnabled(book.id),
                    }))}
                  onLinkChange={(bookId, enabled) => setBooksEnabled([bookId], enabled)}
                  onEnableAll={() => {
                    setBooksEnabled(
                      books.filter((book) => book.group === 'legacy').map((book) => book.id),
                      true
                    );
                  }}
                />
                <LinksGroup
                  icon={IconHexagonalPrism}
                  label={'Playtest'}
                  links={books
                    .filter((book) => book.group === 'playtest')
                    .map((book) => ({
                      label: book.name,
                      id: book.id,
                      url: book.url,
                      enabled: hasBookEnabled(book.id),
                    }))}
                  onLinkChange={(bookId, enabled) => setBooksEnabled([bookId], enabled)}
                  onEnableAll={() => {
                    setBooksEnabled(
                      books.filter((book) => book.group === 'playtest').map((book) => book.id),
                      true
                    );
                  }}
                />
                <LinksGroup
                  icon={IconDots}
                  label={'Miscellaneous'}
                  links={books
                    .filter((book) => book.group === 'misc')
                    .map((book) => ({
                      label: book.name,
                      id: book.id,
                      url: book.url,
                      enabled: hasBookEnabled(book.id),
                    }))}
                  onLinkChange={(bookId, enabled) => setBooksEnabled([bookId], enabled)}
                  onEnableAll={() => {
                    setBooksEnabled(
                      books.filter((book) => book.group === 'misc').map((book) => book.id),
                      true
                    );
                  }}
                />
              </Stack>
            </Tabs.Panel>

            <Tabs.Panel value='homebrew'>
              <Stack gap={0} pt='sm'>
                {homebrewBundles.map((s, index) => (
                  <GroupLinkSwitch
                    key={index}
                    label={s.name}
                    id={s.id}
                    url={s.url ?? ''}
                    enabled={character?.content_sources?.enabled?.includes(s.id)}
                    onLinkChange={(id, enabled) => setBooksEnabled([id], enabled)}
                  />
                ))}
                {homebrewBundles.length === 0 && (
                  <Text c='gray.2' fz='sm' ta='center' fs='italic' py={20}>
                    You haven't created any homebrew bundles yet.{' '}
                    <Anchor fz='sm' href='/homebrew'>
                      Go make one!
                    </Anchor>
                  </Text>
                )}
              </Stack>
            </Tabs.Panel>

            <Tabs.Panel value='variants'>
              <Stack gap={0} pt='sm'>
                <LinkSwitch
                  label='Ancestry Paragon'
                  info={`Most characters have some elements that connect them to their ancestry but identify more strongly with their class or unique personality. Sometimes, though, a character is the embodiment of their ancestry to the point that it’s of equal importance to their class. For a game where an ancestral background is a major theme and such characters are the norm, your group might consider using the ancestry paragon variant.`}
                  url='https://2e.aonprd.com/Rules.aspx?ID=1336'
                  enabled={character?.variants?.ancestry_paragon}
                  onLinkChange={(enabled) => {
                    setCharacter((prev) => {
                      if (!prev) return prev;
                      return {
                        ...prev,
                        variants: {
                          ...prev.variants,
                          ancestry_paragon: enabled,
                        },
                      };
                    });
                  }}
                />
                <LinkSwitch
                  label='Automatic Bonus Progression'
                  info={`This variant removes the item bonus to rolls and DCs usually provided by magic items (with the exception of armor’s item bonus) and replaces it with a new kind of bonus - potency - to reflect a character’s innate ability. In this variant, magic items, if they exist at all, can provide unique special abilities rather than numerical increases.`}
                  url='https://2e.aonprd.com/Rules.aspx?ID=2741'
                  enabled={character?.variants?.automatic_bonus_progression}
                  onLinkChange={(enabled) => {
                    setCharacter((prev) => {
                      if (!prev) return prev;
                      return {
                        ...prev,
                        variants: {
                          ...prev.variants,
                          automatic_bonus_progression: enabled,
                        },
                      };
                    });
                  }}
                />
                <LinkSwitch
                  label='Dual Class'
                  info={`Sometimes, especially when you have a particularly small play group or want to play incredibly versatile characters, you might want to allow dual-class characters that have the full benefits of two different classes.`}
                  url='https://2e.aonprd.com/Rules.aspx?ID=1328'
                  enabled={character?.variants?.dual_class}
                  onLinkChange={(enabled) => {
                    setCharacter((prev) => {
                      if (!prev) return prev;
                      return {
                        ...prev,
                        details: {
                          ...prev.details,
                          class_2: enabled ? prev.details?.class_2 : undefined,
                        },
                        variants: {
                          ...prev.variants,
                          dual_class: enabled,
                        },
                      };
                    });
                  }}
                />
                <LinkSwitch
                  label='Free Archetype'
                  info={`Sometimes the story of your game calls for a group where everyone is a pirate or an apprentice at a magic school. The free archetype variant introduces a shared aspect to every character without taking away any of that character’s existing choices.`}
                  url='https://2e.aonprd.com/Rules.aspx?ID=2751'
                  enabled={character?.variants?.free_archetype}
                  onLinkChange={(enabled) => {
                    setCharacter((prev) => {
                      if (!prev) return prev;
                      return {
                        ...prev,
                        variants: {
                          ...prev.variants,
                          free_archetype: enabled,
                        },
                      };
                    });
                  }}
                />
                <LinkSwitch
                  label='Gradual Attribute Boosts'
                  info={`In this variant, a character gains attribute boosts more gradually as they level up, rather than receiving four attribute boosts at 5th, 10th, 15th, and 20th levels. Each character gains one attribute boost when they reach each of 2nd, 3rd, 4th, and 5th levels. These are collectively a single set of attribute boosts, so a character can’t boost the same attribute more than once per set; players can put a dot next to each boosted attribute or otherwise mark it to keep track. PCs also receive an attribute boost at 7th, 8th, 9th, and 10th level (a second set); at 12th, 13th, 14th, and 15th level (a third set); and at 17th, 18th, 19th, and 20th level (the fourth and final set).\n\nThis spreads out the attribute boosts, and using them earlier means a character can increase their most important attribute modifiers at a lower level. This makes characters slightly more powerful on average, but it makes levels 5, 10, 15, and 20 less important since characters usually choose the least important attribute boost of the set at those levels.`}
                  url='https://2e.aonprd.com/Rules.aspx?ID=1300'
                  enabled={character?.variants?.gradual_attribute_boosts}
                  onLinkChange={(enabled) => {
                    setCharacter((prev) => {
                      if (!prev) return prev;
                      return {
                        ...prev,
                        variants: {
                          ...prev.variants,
                          gradual_attribute_boosts: enabled,
                        },
                      };
                    });
                  }}
                />
                <LinkSwitch
                  label='Proficiency without Level'
                  info={`This variant removes a character's level from their proficiency bonus, scaling it differently for a style of game that's outside the norm. This is a significant change to the system. The proficiency rank progression in Player Core is designed for heroic fantasy games where heroes rise from humble origins to world-shattering strength. For some games, this narrative arc doesn't fit. Such games are about hedging bets in an uncertain and gritty world, in which even the world's best fighter can't guarantee a win against a large group of moderately skilled brigands.`}
                  url='https://2e.aonprd.com/Rules.aspx?ID=2762'
                  enabled={character?.variants?.proficiency_without_level}
                  onLinkChange={(enabled) => {
                    setCharacter((prev) => {
                      if (!prev) return prev;
                      return {
                        ...prev,
                        variants: {
                          ...prev.variants,
                          proficiency_without_level: enabled,
                        },
                      };
                    });
                  }}
                />
                <LinkSwitch
                  label='Battlezoo Monster Parts (Light)'
                  info={`Enables the Battlezoo Bestiary Monster Parts subsystem (Light variant). With this on, currency is partially replaced by monster parts harvested from defeated foes, and each item in your inventory can be flipped into "monster-parts mode" via the Item drawer — its potency, striking, and resilient runes are then derived from the gp of monster parts you've invested in it (Tables 3A/3B). An item can be upgraded with either runes OR monster parts, not both. Imbued Property items from the Battlezoo Bestiary homebrew bundle apply as property runes on monster-parts items. Subscribe to the bundle on the Homebrew page to enable the imbued-property catalog.`}
                  enabled={character?.variants?.monster_parts}
                  onLinkChange={(enabled) => {
                    setCharacter((prev) => {
                      if (!prev) return prev;
                      return {
                        ...prev,
                        variants: {
                          ...prev.variants,
                          monster_parts: enabled,
                        },
                      };
                    });
                  }}
                />
                <LinkSwitch
                  label='Deep Background'
                  info={`Instead of picking a published background, build your own. You'll choose a name and short description, two attribute boosts (each to a different ability score), training in a Lore skill of your choice, and one skill feat — the character automatically becomes trained in that feat's prerequisite skill.`}
                  enabled={character?.variants?.deep_background}
                  onLinkChange={(enabled) => {
                    setCharacter((prev) => {
                      if (!prev) return prev;
                      return {
                        ...prev,
                        variants: {
                          ...prev.variants,
                          deep_background: enabled,
                        },
                        // When turning Deep Background ON, clear any
                        // published background that was previously picked.
                        // When turning OFF, the custom background data
                        // stays in details.info.deep_background (harmless)
                        // but is no longer rendered.
                        details: enabled
                          ? { ...prev.details, background: undefined }
                          : prev.details,
                      };
                    });
                  }}
                />
                {/* <LinkSwitch
                  label='Stamina'
                  info={`In some fantasy stories, the heroes are able to avoid any serious injury until the situation gets dire, getting by with a graze or a flesh wound and needing nothing more than a quick rest to get back on their feet. If your group wants to tell tales like those, you can use the stamina variant to help make that happen.`}
                  url='https://2e.aonprd.com/Rules.aspx?ID=1378'
                  enabled={character?.variants?.stamina}
                  onLinkChange={(enabled) => {
                    setCharacter((prev) => {
                      if (!prev) return prev;
                      return {
                        ...prev,
                        variants: {
                          ...prev.variants,
                          stamina: enabled,
                        },
                      };
                    });
                  }}
                /> */}
              </Stack>
            </Tabs.Panel>

            <Tabs.Panel value='options'>
              <Stack gap={0} pt='sm'>
                <LinkSwitch
                  label='Alternate Ancestry Boosts'
                  info={`The attribute boosts and flaws listed in each ancestry represent general trends or help guide players to create the kinds of characters from that ancestry most likely to pursue the life of an adventurer. However, ancestries aren’t a monolith. You always have the option to replace your ancestry’s listed attribute boosts and attribute flaws entirely and instead select two free attribute boosts when creating your character.`}
                  enabled={character?.options?.alternate_ancestry_boosts}
                  onLinkChange={(enabled) => {
                    setCharacter((prev) => {
                      if (!prev) return prev;
                      return {
                        ...prev,
                        options: {
                          ...prev.options,
                          alternate_ancestry_boosts: enabled,
                        },
                      };
                    });
                  }}
                />
                <LinkSwitch
                  label='Auto Detect Prerequisites'
                  info={`**[Beta]** Automatically determine if a feat or feature has its prerequisites met in order to be taken. This is a beta feature and may not always work correctly.`}
                  enabled={character?.options?.auto_detect_prerequisites}
                  onLinkChange={(enabled) => {
                    setCharacter((prev) => {
                      if (!prev) return prev;
                      return {
                        ...prev,
                        options: {
                          ...prev.options,
                          auto_detect_prerequisites: enabled,
                        },
                      };
                    });
                  }}
                />
                {/* <LinkSwitch
                      label='Auto Heighten Spells'
                      info={`**[Beta]** Automatically apply the heightened effects of a spell to its stat block. This is a beta feature and may not always work correctly.`}
                      enabled={character?.options?.auto_heighten_spells}
                      onLinkChange={(enabled) => {
                        setCharacter((prev) => {
                          if (!prev) return prev;
                          return {
                            ...prev,
                            options: {
                              ...prev.options,
                              auto_heighten_spells: enabled,
                            },
                          };
                        });
                      }}
                    /> */}
                {/* <LinkSwitch
                      label='Class Archetypes'
                      info={``}
                      enabled={character?.options?.class_archetypes}
                      onLinkChange={(enabled) => {
                        setCharacter((prev) => {
                          if (!prev) return prev;
                          return {
                            ...prev,
                            options: {
                              ...prev.options,
                              class_archetypes: enabled,
                            },
                          };
                        });
                      }}
                    /> */}
                <LinkSwitch
                  label='Dice Roller'
                  info={`Roll your dice directly from the character sheet! Integrated with all your character's stats and abilities.`}
                  enabled={character?.options?.dice_roller}
                  onLinkChange={(enabled) => {
                    setCharacter((prev) => {
                      if (!prev) return prev;
                      return {
                        ...prev,
                        options: {
                          ...prev.options,
                          dice_roller: enabled,
                        },
                      };
                    });
                  }}
                />
                <LinkSwitch
                  label='Ignore Bulk Limit'
                  info={`Disables the negative effects of carrying too much bulk, such as adding the encumbered condition.`}
                  enabled={character?.options?.ignore_bulk_limit}
                  onLinkChange={(enabled) => {
                    setCharacter((prev) => {
                      if (!prev) return prev;
                      return {
                        ...prev,
                        options: {
                          ...prev.options,
                          ignore_bulk_limit: enabled,
                        },
                      };
                    });
                  }}
                />
                <LinkSwitch
                  label='Public Character'
                  info={`Makes your character public and viewable by anyone with your sheet link: \n\n _https://wanderersguide.app/sheet/${character?.id}_`}
                  enabled={character?.options?.is_public}
                  onLinkChange={(enabled) => {
                    setCharacter((prev) => {
                      if (!prev) return prev;
                      return {
                        ...prev,
                        options: {
                          ...prev.options,
                          is_public: enabled,
                        },
                      };
                    });
                  }}
                />
                <LinkSwitch
                  label='Voluntary Flaw'
                  info={`Sometimes, it’s fun to play a character with a major flaw regardless of your ancestry. You can elect to take an additional attribute flaw when applying the attribute boosts and attribute flaws from your ancestry.`}
                  enabled={character?.options?.voluntary_flaws}
                  onLinkChange={(enabled) => {
                    setCharacter((prev) => {
                      if (!prev) return prev;
                      return {
                        ...prev,
                        options: {
                          ...prev.options,
                          voluntary_flaws: enabled,
                        },
                      };
                    });
                  }}
                />
                <LinkSwitch
                  label='Custom Operations'
                  info={`Enables an area to add custom operations to your character. These are executed before most other operations.`}
                  enabled={character?.options?.custom_operations}
                  onLinkChange={(enabled) => {
                    setCharacter((prev) => {
                      if (!prev) return prev;
                      return {
                        ...prev,
                        options: {
                          ...prev.options,
                          custom_operations: enabled,
                        },
                      };
                    });
                  }}
                />
                {character?.options?.custom_operations && (
                  <Box pl={15}>
                    <BlurButton
                      size='compact-xs'
                      fw={400}
                      w={180}
                      onClick={() => {
                        setOpenedOperations(true);
                      }}
                    >
                      Open Operations{' '}
                      {character.custom_operations && character.custom_operations.length > 0
                        ? `(${character.custom_operations.length})`
                        : ''}
                    </BlurButton>
                    <OperationsModal
                      title='Custom Operations'
                      opened={openedOperations}
                      onClose={() => setOpenedOperations(false)}
                      operations={cloneDeep(character.custom_operations ?? [])}
                      onChange={(operations) => {
                        if (isEqual(character.custom_operations, operations)) return;

                        setCharacter((prev) => {
                          if (!prev) return prev;
                          return {
                            ...prev,
                            custom_operations: operations,
                          };
                        });
                      }}
                    />
                  </Box>
                )}
              </Stack>
            </Tabs.Panel>
          </ScrollArea>
        </Tabs>
      </Paper>
    </Box>
  );

  const getSidebarSection = () => (
    <Box h='100%'>
      <Paper
        shadow='sm'
        p='sm'
        h='100%'
        style={{
          backgroundColor: 'rgba(0, 0, 0, 0.13)',
        }}
      >
        <Stack>
          <ColorInput
            radius='xl'
            size='xs'
            label={<Text fz='sm'>Color Theme</Text>}
            placeholder='Character Color Theme'
            defaultValue={character?.details?.sheet_theme?.color || GUIDE_BLUE}
            swatches={[
              '#25262b',
              '#868e96',
              '#fa5252',
              '#e64980',
              '#be4bdb',
              '#8d69f5',
              '#577deb',
              GUIDE_BLUE,
              '#15aabf',
              '#12b886',
              '#40c057',
              '#82c91e',
              '#fab005',
              '#fd7e14',
            ]}
            swatchesPerRow={7}
            onChange={(color) => {
              if (!hasPatreonAccess(getCachedPublicUser(), 1)) {
                displayPatronOnly();
                return;
              }
              setCharacter((prev) => {
                if (!prev) return prev;
                return {
                  ...prev,
                  details: {
                    ...prev.details,
                    sheet_theme: {
                      ...prev.details?.sheet_theme,
                      color: color,
                    },
                  },
                };
              });
            }}
            styles={{
              input: {
                backgroundColor: IMPRINT_BG_COLOR,
                borderColor: IMPRINT_BORDER_COLOR,
              },
            }}
          />
          <Box>
            <Text fz='sm'>Background Artwork</Text>
            <UnstyledButton
              w={'50%'}
              onClick={() => {
                openContextModal({
                  modal: 'selectImage',
                  title: <Title order={3}>Select Background</Title>,
                  innerProps: {
                    options: getAllBackgroundImages(),
                    onSelect: (option: ImageOption) => {
                      setCharacter((prev) => {
                        if (!prev) return prev;
                        return {
                          ...prev,
                          details: {
                            ...prev.details,
                            background_image_url: option.url,
                          },
                        };
                      });
                    },
                    category: 'backgrounds',
                  },
                });
              }}
            >
              <Image
                radius='md'
                h='auto'
                fit='contain'
                src={character?.details?.background_image_url}
                fallbackSrc='/backgrounds/placeholder.jpeg'
              />
            </UnstyledButton>
          </Box>
          {apiClients && apiClients.length > 0 && (
            <Stack gap={5}>
              <Divider my={0} />
              <Text fz='sm'>Authorized Clients</Text>
              <ScrollArea h={150} scrollbars='y'>
                <Stack gap={5}>
                  {apiClients?.map((client, index) => (
                    <BlurBox key={index} p='sm'>
                      <Stack gap={5}>
                        <Group>
                          <DisplayIcon width={25} strValue={client?.image_url} />
                          <Text size='md'>{client?.name}</Text>
                        </Group>
                        {client?.description && <Text fz='xs'>{client?.description}</Text>}
                        <Anchor
                          underline='hover'
                          onClick={() => {
                            modals.openConfirmModal({
                              id: 'remove-client-access',
                              title: <Title order={4}>{`Revoke Access`}</Title>,
                              children: (
                                <Stack>
                                  <Text>
                                    Are you sure you want to revoke access for {client?.name} to read and edit this
                                    character?
                                  </Text>
                                </Stack>
                              ),
                              labels: { confirm: 'Remove', cancel: 'Cancel' },
                              onCancel: () => {},
                              onConfirm: async () => {
                                setCharacter((prev) => {
                                  if (!prev) return prev;
                                  return {
                                    ...prev,
                                    details: {
                                      ...prev.details,
                                      api_clients: {
                                        ...prev.details?.api_clients,
                                        client_access:
                                          prev.details?.api_clients?.client_access.filter(
                                            (c) => c.clientId !== client?.id
                                          ) ?? [],
                                      },
                                    },
                                  };
                                });
                                queryClient.invalidateQueries({ queryKey: [`find-content-${character?.id}`] });
                              },
                            });
                          }}
                          c='gray.5'
                          ta='center'
                          size='xs'
                        >
                          [ Revoke Access ]
                        </Anchor>
                      </Stack>
                    </BlurBox>
                  ))}
                </Stack>
              </ScrollArea>
            </Stack>
          )}
        </Stack>
      </Paper>
    </Box>
  );

  // Campaign Section
  const [campaignKey, setCampaignKey] = useState('');
  const { data: campaign, refetch: refetchCampaign } = useQuery({
    queryKey: [`find-campaign-${character?.campaign_id}`, { campaign_id: character?.campaign_id }],
    queryFn: async ({ queryKey }) => {
      // @ts-ignore
      const [_key, { campaign_id }] = queryKey;

      const campaigns = await makeRequest<Campaign[]>('find-campaign', {
        id: campaign_id,
      });
      return campaigns?.length ? campaigns[0] : null;
    },
    enabled: !!character?.campaign_id,
    refetchOnWindowFocus: false,
  });

  const joinCampaign = async () => {
    // TODO: Secure this joining process
    const campaigns = await makeRequest<Campaign[]>('find-campaign', {
      join_key: campaignKey,
    });
    const campaign = campaigns?.length ? campaigns[0] : null;
    setCampaignKey('');
    if (campaign) {
      setCharacter((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          campaign_id: campaign.id,
        };
      });

      setTimeout(() => {
        refetchCampaign();
      }, 3000);

      // Check if the campaign has recommended settings for the character
      if (
        !isEqual(
          {
            sources: character?.content_sources,
            variants: character?.variants,
            options: character?.options,
            custom_operations: character?.custom_operations,
          },
          {
            sources: campaign?.recommended_content_sources,
            variants: campaign?.recommended_variants,
            options: campaign?.recommended_options,
            custom_operations: campaign?.custom_operations,
          }
        )
      ) {
        modals.openConfirmModal({
          id: 'campaign-recommended-settings',
          title: <Title order={4}>Campaign Default Settings</Title>,
          children: (
            <Text size='sm'>
              It’s recommended to use your campaign’s default settings but doing so will override your current settings.
              Are you sure you want to?
            </Text>
          ),
          labels: { confirm: 'Apply Settings', cancel: 'Skip' },
          onCancel: () => {},
          onConfirm: async () => {
            // Find the missing content sources that need to be subscribed to
            const homebrewSources = campaign?.recommended_content_sources?.enabled?.filter((id: number) => {
              return !books.find((book) => book.id === id);
            });
            const subscribedSources = user?.subscribed_content_sources?.map((src) => src.source_id) ?? [];

            const missingSourceIds = homebrewSources?.filter((id: number) => !subscribedSources.includes(id));
            const missingSources =
              missingSourceIds && missingSourceIds.length > 0 ? await fetchContentSources(missingSourceIds) : [];

            const subscribeToMissingSources = async () => {
              if (!user) return;
              for (const source of missingSources) {
                const subscriptions = await updateSubscriptions(user, source, true);
                setUser({ ...user, subscribed_content_sources: subscriptions });
                await makeRequest('update-user', {
                  subscribed_content_sources: subscriptions ?? [],
                });
              }
            };

            const applySettings = async () => {
              setCharacter((prev) => {
                if (!prev) return prev;
                return {
                  ...prev,
                  content_sources: campaign?.recommended_content_sources,
                  variants: campaign?.recommended_variants,
                  options: campaign?.recommended_options,
                  custom_operations: campaign?.custom_operations,
                };
              });
            };

            if (missingSources.length > 0) {
              modals.openConfirmModal({
                id: 'campaign-default-homebrew',
                title: <Title order={4}>Campaign Default Homebrew</Title>,
                children: (
                  <Box>
                    <Text size='sm'>
                      This campaign also has some default homebrew enabled. If you accept, you’ll automatically be
                      subscribed to each of these bundles which you can use in your current or future characters:
                    </Text>
                    <List>
                      {missingSources.map((source, index) => (
                        <List.Item key={index}>
                          <Group gap={3} wrap='nowrap'>
                            <Text size='sm'>{source.name}</Text>
                            <HoverCard shadow='md' position='top' openDelay={500} withinPortal withArrow>
                              <HoverCard.Target>
                                <ActionIcon
                                  mr={40}
                                  color='gray.9'
                                  variant='transparent'
                                  size='xs'
                                  radius='xl'
                                  aria-label='Source Info'
                                  onClick={() => {
                                    openDrawer({
                                      type: 'content-source',
                                      data: {
                                        id: source.id,
                                        showOperations: true,
                                      },
                                    });
                                  }}
                                >
                                  <IconExternalLink size='0.6rem' stroke={1.5} />
                                </ActionIcon>
                              </HoverCard.Target>
                              <HoverCard.Dropdown px={10} py={5}>
                                <Text size='sm'>Open Source Info</Text>
                              </HoverCard.Dropdown>
                            </HoverCard>
                          </Group>
                        </List.Item>
                      ))}
                    </List>
                  </Box>
                ),
                labels: { confirm: 'Accept', cancel: 'Cancel' },
                onCancel: () => {},
                onConfirm: async () => {
                  // Subscribe to missing sources then apply settings
                  // (so that the sources are available before we add them)
                  await subscribeToMissingSources();
                  await applySettings();
                },
              });
            } else {
              await applySettings();
            }
          },
        });
      } else {
        showNotification({
          title: 'Joined Campaign!',
          message: `You've joined "${campaign.name}"`,
          color: 'blue',
          icon: null,
          autoClose: 3000,
        });
      }
    } else {
      showNotification({
        title: 'Invalid Join Key',
        message: 'Please ask your GM for a valid key.',
        color: 'red',
        icon: null,
        autoClose: 3000,
      });
    }
  };

  const leaveCampaign = () => {
    setCharacter((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        campaign_id: null,
      };
    });

    setTimeout(() => {
      refetchCampaign();
    }, 3000);

    showNotification({
      title: 'Left Campaign',
      message: 'You have left the campaign.',
      color: 'blue',
      icon: null,
      autoClose: 3000,
    });
  };

  // Per-group book toggling. Each codex .book-row represents one
  // source group (Pathfinder Core, Adventure Paths, etc.); the
  // toggle on the row flips every book in that group on or off via
  // the existing setBooksEnabled handler.
  const bookGroups: Array<{ key: string; name: string; subtitle: string; pf: React.ReactNode }> = [
    { key: 'pathfinder-core', name: 'Pathfinder Core', subtitle: 'Foundational rulebook — every class, ancestry, and rule begins here.', pf: <><b>PF2e</b> · Core</> },
    { key: 'starfinder-core', name: 'Starfinder Core', subtitle: 'Optional sci-fi crossover — themes, drift tech, and starships.', pf: <><b>SF2e</b> · Cross</> },
    { key: 'adventure-path', name: 'Adventure Paths', subtitle: 'Tied to a campaign — feats, items, and creatures from many paths.', pf: <>APs</> },
    { key: 'standalone-adventure', name: 'Standalone Adventures', subtitle: 'One-shot modules with their own rule riders.', pf: <>mods</> },
    { key: 'lost-omens', name: 'Lost Omens', subtitle: 'World-canon tomes — Absalom, Mwangi, the Mortal Heralds.', pf: <>vols</> },
    { key: 'legacy', name: 'Core Backports', subtitle: 'Pre-Remaster classics fitted into the new core.', pf: <>parts</> },
    { key: 'playtest', name: 'Playtest', subtitle: 'Unfinished rulesets in open testing.', pf: <>draft · unstable</> },
    { key: 'misc', name: 'Miscellaneous', subtitle: 'Conventions, free supplements, and one-page rules.', pf: <>scraps</> },
  ];

  // Counts used by both the subhead chip and the foot summary.
  const enabledBookCount = (character?.content_sources?.enabled ?? []).length;
  const totalAvailableBooks = books.length;

  return (
    <>
      {/* Builder breadcrumb — Sources is the current step. The other
          steps are non-interactive labels here; navigation between
          them happens via the topbar Build / Sheet buttons higher up.*/}
      <div className='crumb-strip'>
        <span className='seg on'>Sources</span>
        <span className='sep'>▸</span>
        <span className='seg'>Ancestry</span>
        <span className='sep'>▸</span>
        <span className='seg'>Class</span>
        <span className='sep'>▸</span>
        <span className='seg'>Skills</span>
        <span className='sep'>▸</span>
        <span className='seg'>Feats</span>
      </div>

      <div className='home-wrap'>

        {/* Hero — portrait + name input + level chip. */}
        <div className='hero' ref={ref}>
          <div
            className='portrait'
            title='Select portrait'
            onClick={() => {
              openContextModal({
                modal: 'selectImage',
                title: <Title order={3}>Select Portrait</Title>,
                innerProps: {
                  options: getAllPortraitImages(),
                  onSelect: (option: ImageOption) => {
                    setCharacter((prev) => {
                      if (!prev) return prev;
                      return {
                        ...prev,
                        details: {
                          ...prev.details,
                          image_url:
                            prev.details?.image_url === option.url ? undefined : option.url,
                        },
                      };
                    });
                  },
                  category: 'portraits',
                },
              });
            }}
          >
            {character?.details?.image_url ? (
              <img src={character.details.image_url} alt='Character Portrait' />
            ) : (
              <IconUserCircle size={36} stroke={1.5} />
            )}
            <span className='tag'>+</span>
          </div>

          <div className='name-field'>
            <div className='lbl'>
              Name
              <span className='rule' />
              <em>— sign the page</em>
            </div>
            <div className='input-row'>
              {displayNameInput && (
                <input
                  key={character?.name}
                  className='name-input'
                  type='text'
                  placeholder='Unknown Wanderer'
                  defaultValue={
                    character?.name === 'Unknown Wanderer' ? '' : character?.name ?? ''
                  }
                  onChange={(e) => {
                    setCharacter((prev) => {
                      if (!prev) return prev;
                      return { ...prev, name: e.target.value };
                    });
                  }}
                />
              )}
              <button
                type='button'
                className='reroll'
                title='Reroll a name'
                disabled={loadingGenerateName}
                onClick={async () => {
                  if (!character) return;
                  setLoadingGenerateName(true);
                  const names = await generateNames(character, 1);
                  setLoadingGenerateName(false);
                  if (names.length > 0) {
                    const name = names[0].replace(/\*/g, '');
                    setCharacter((prev) => (prev ? { ...prev, name } : prev));
                    refreshNameInput();
                  } else {
                    showNotification({
                      title: 'Failed to Generate Name',
                      message: 'Please try again.',
                      color: 'red',
                      icon: null,
                      autoClose: 3000,
                    });
                  }
                }}
              >
                <IconRefreshDot size={16} stroke={1.5} />
              </button>
            </div>
          </div>

          <div className='lvl-card'>
            <div className='lbl'>
              Level
              <small>1 – 20</small>
            </div>
            <div>
              <input
                key={character?.level}
                type='number'
                min={1}
                max={20}
                defaultValue={character?.level ?? 1}
                onBlur={(e) => {
                  const newLevel = Math.min(20, Math.max(1, parseInt(e.target.value || '1', 10)));
                  const oldLevel = character?.level ?? 0;
                  if (newLevel === oldLevel) return;
                  if (oldLevel > newLevel) {
                    openConfirmLevelChangeModal(oldLevel, newLevel);
                  } else {
                    setCharacter((prev) =>
                      prev
                        ? {
                            ...prev,
                            level: newLevel,
                            meta_data: { ...prev.meta_data, reset_hp: true },
                          }
                        : prev
                    );
                  }
                }}
              />
            </div>
            <div className='steps'>
              <button
                type='button'
                onClick={() => {
                  const v = character?.level ?? 1;
                  if (v >= 20) return;
                  setCharacter((prev) =>
                    prev
                      ? {
                          ...prev,
                          level: v + 1,
                          meta_data: { ...prev.meta_data, reset_hp: true },
                        }
                      : prev
                  );
                }}
              >
                ▴
              </button>
              <button
                type='button'
                onClick={() => {
                  const v = character?.level ?? 1;
                  if (v <= 1) return;
                  openConfirmLevelChangeModal(v, v - 1);
                }}
              >
                ▾
              </button>
            </div>
            <div className='of'>
              of <b>20</b>
            </div>
          </div>
        </div>

        {/* Sourcebook panel — codex tabs + book-rows. */}
        <div className='panel'>

          <div className='tabs-row'>
            <button
              type='button'
              className={`tab-btn${activeTab === 'books' ? ' on' : ''}`}
              onClick={() => setActiveTab('books')}
            >
              <IconBooks size={14} />
              Books
              <span className='ct'>{totalAvailableBooks}</span>
            </button>
            <button
              type='button'
              className={`tab-btn${activeTab === 'homebrew' ? ' on' : ''}`}
              onClick={() => setActiveTab('homebrew')}
            >
              <IconAsset size={14} />
              Homebrew
              <span className='ct'>{homebrewBundles.length}</span>
            </button>
            <button
              type='button'
              className={`tab-btn${activeTab === 'variants' ? ' on' : ''}`}
              onClick={() => setActiveTab('variants')}
            >
              <IconVocabulary size={14} />
              Variant Rules
              <span className='ct'>9</span>
            </button>
            <button
              type='button'
              className='tab-options'
              onClick={() => setActiveTab('options')}
              style={activeTab === 'options' ? { color: 'var(--gold)' } : undefined}
            >
              <IconSettings size={13} />
              Options
            </button>
          </div>

          {activeTab === 'books' && (
            <>
              <div className='panel-subhead'>
                <div className='lhs'>
                  <span><b>{totalAvailableBooks}</b> Sources Available</span>
                  <em>— official tomes you can draw on</em>
                </div>
                <div className='actions'>
                  <div className='act on'>All</div>
                  <div className='act'>Enabled</div>
                  <div className='act'>Restricted</div>
                </div>
              </div>

              <div className='book-list'>
                {bookGroups.map((group, idx) => {
                  const groupBooks = books.filter((b) => b.group === group.key);
                  const enabled = groupBooks.filter((b) => hasBookEnabled(b.id)).length;
                  const total = groupBooks.length;
                  const allOn = total > 0 && enabled === total;
                  const noneOn = enabled === 0;
                  const fillPct = total > 0 ? (enabled / total) * 100 : 0;
                  const locked = total === 0;
                  return (
                    <div
                      key={group.key}
                      className={`book-row${idx === 2 ? ' divider-top' : ''}${locked ? ' locked' : ''}`}
                      onClick={() => {
                        const groupIds = groupBooks.map((b) => b.id);
                        if (groupIds.length === 0) return;
                        setBooksEnabled(groupIds, !allOn);
                      }}
                    >
                      <div className='ico'>
                        <IconBook2 size={20} stroke={1.6} />
                      </div>
                      <div className='nm'>
                        {group.name}
                        <small>{group.subtitle}</small>
                      </div>
                      <div className='progress'>
                        <div className='nums'>
                          <b>{enabled}</b> / {total} <em>books</em>
                        </div>
                        <div className='bar'>
                          <div
                            className={`fill${noneOn ? ' partial' : ''}`}
                            style={{ right: `${100 - fillPct}%` }}
                          />
                        </div>
                      </div>
                      <div className='pf'>{group.pf}</div>
                      <div
                        className={`toggle${allOn ? ' on' : ''}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          const groupIds = groupBooks.map((b) => b.id);
                          if (groupIds.length === 0) return;
                          setBooksEnabled(groupIds, !allOn);
                        }}
                      >
                        <div className='knob' />
                      </div>
                      <div className='chev' />
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {activeTab !== 'books' && (
            <div className='tab-body'>
              {/* Homebrew / Variants / Options panels still use the
                  legacy Mantine widgets — getOptionsSection picks the
                  active panel via its own internal <Tabs>. */}
              {getOptionsSection()}
              {activeTab === 'options' && getSidebarSection()}
            </div>
          )}

        </div>

        {/* Foot — summary + Continue. */}
        <div className='home-foot'>
          <div className='summary'>
            Bound to <b>{enabledBookCount}</b> sources <span style={{ color: 'var(--ink-deep)' }}>·</span>
            <span style={{ color: 'var(--ink-muted)' }}> drawing your tome's lore.</span>
          </div>
          <button
            type='button'
            className='btn-continue'
            onClick={() => props.onContinue?.()}
          >
            <span className='lhs'>
              Continue to Builder
              <span className='arrow' />
            </span>
          </button>
        </div>

      </div>
    </>
  );
}
