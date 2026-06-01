import { generateNames } from '@ai/fantasygen-dev/name-controller';
import { GUIDE_BLUE } from '@constants/data';
import { Stack, Group, Box, Title, Text, ActionIcon, HoverCard, List, Anchor } from '@mantine/core';
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
  IconHome,
  IconHammer,
  IconUser,
  IconExternalLink,
} from '@tabler/icons-react';
import { getAllBackgroundImages } from '@utils/background-images';
import { getAllPortraitImages } from '@utils/portrait-images';
import useRefresh from '@utils/use-refresh';
import { useState } from 'react';
import { useAtom } from 'jotai';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  defineDefaultSources,
  fetchContentSources,
  findRequiredContentSources,
  resetContentStore,
} from '@content/content-store';
import { displayPatronOnly } from '@utils/notifications';
import { getCachedPublicUser, getPublicUser } from '@auth/user-manager';
import OperationsModal from '@modals/OperationsModal';
import { hasPatreonAccess } from '@utils/patreon';
import { drawerState } from '@atoms/navAtoms';
import { Campaign, PublicUser } from '@schemas/content';
import { userState } from '@atoms/userAtoms';
import { makeRequest } from '@requests/request-manager';
import { updateSubscriptions } from '@content/homebrew';
import { ImageOption } from '@schemas/index';
import { cloneDeep, isEqual, truncate, uniq } from 'lodash-es';
import useCharacter from '@utils/use-character';

// Codex-styled toggle row used by the Variants / Options / Homebrew
// tabs in this page. Same DOM shape as the .var-row rule in
// wg4-builder.css — clicking the body or the diamond "pip" toggles,
// and the small info icon opens the existing generic info drawer
// with the variant/option's description.
function CodexToggleRow(props: {
  glyph: string;
  name: string;
  sub: string;
  on: boolean | undefined;
  onToggle: () => void;
  onInfo?: () => void;
  tag?: 'beta' | 'homebrew';
}) {
  return (
    <div
      className={`var-row${props.on ? ' on' : ''}`}
      onClick={props.onToggle}
      role='button'
      tabIndex={0}
    >
      <div className='ico'>
        <span>{props.glyph}</span>
      </div>
      <div className='body'>
        <div className='nm'>{props.name}</div>
        <div className='sub'>{props.sub}</div>
        {props.tag === 'beta' && <span className='tag beta'>Beta</span>}
        {props.tag === 'homebrew' && <span className='tag beta'>Beta · Homebrew</span>}
      </div>
      {props.onInfo ? (
        <div
          className='info'
          onClick={(e) => {
            e.stopPropagation();
            props.onInfo!();
          }}
          title='Open full description'
          role='button'
          tabIndex={0}
        >
          i
        </div>
      ) : (
        <div />
      )}
    </div>
  );
}

export default function CharBuilderHome(props: {
  characterId: number;
  pageHeight: number;
  onContinue?: () => void;
}) {
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
  const { data: fetchedHomebrewBundles } = useQuery({
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
      classNames: { content: 'codex-confirm-modal' },
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
          classNames: { content: 'codex-confirm-modal' },
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

  // Campaign Section
  const [campaignKey, setCampaignKey] = useState('');
  const { refetch: refetchCampaign } = useQuery({
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

  // Re-introduce the campaign join handler (kept from the original
  // file). Right now there's no UI surface for it in the new layout,
  // but the underlying logic is preserved so a follow-up can wire a
  // codex-styled card to it without re-deriving the data.
  const joinCampaign = async () => {
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
          classNames: { content: 'codex-confirm-modal' },
          onCancel: () => {},
          onConfirm: async () => {
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
                classNames: { content: 'codex-confirm-modal' },
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
  // Silence "unused" warnings — keep these around for the campaign UI
  // that hangs off the Options panel.
  void joinCampaign;
  void campaignKey;

  // Per-group book toggling. Each codex .book-row represents one
  // source group (Pathfinder Core, Adventure Paths, etc.); the
  // toggle on the row flips every book in that group on or off via
  // the existing setBooksEnabled handler.
  const bookGroups: Array<{
    key: string;
    name: string;
    subtitle: string;
    tag: string;
    subtag: string;
  }> = [
    {
      key: 'pathfinder-core',
      name: 'Pathfinder Core',
      subtitle: 'Foundational rulebook — every class, ancestry, and rule begins here.',
      tag: 'PF2e',
      subtag: 'Core',
    },
    {
      key: 'starfinder-core',
      name: 'Starfinder Core',
      subtitle: 'Optional sci-fi crossover — themes, drift tech, and starships.',
      tag: 'SF2e',
      subtag: 'Cross',
    },
    {
      key: 'adventure-path',
      name: 'Adventure Paths',
      subtitle: 'Tied to a campaign — feats, items, and creatures from many paths.',
      tag: 'APs',
      subtag: '',
    },
    {
      key: 'standalone-adventure',
      name: 'Standalone Adventures',
      subtitle: 'One-shot modules with their own rule riders.',
      tag: 'mods',
      subtag: '',
    },
    {
      key: 'lost-omens',
      name: 'Lost Omens',
      subtitle: 'World-canon tomes — Absalom, Mwangi, the Mortal Heralds.',
      tag: 'vols',
      subtag: '',
    },
    {
      key: 'legacy',
      name: 'Core Backports',
      subtitle: 'Pre-Remaster classics fitted into the new core.',
      tag: 'parts',
      subtag: '',
    },
    {
      key: 'playtest',
      name: 'Playtest',
      subtitle: 'Unfinished rulesets in open testing.',
      tag: 'draft',
      subtag: 'unstable',
    },
    {
      key: 'misc',
      name: 'Miscellaneous',
      subtitle: 'Conventions, free supplements, and one-page rules.',
      tag: 'scraps',
      subtag: '',
    },
  ];

  // Counts used by both the subhead chip and the foot summary.
  const enabledBookCount = (character?.content_sources?.enabled ?? []).length;
  const totalAvailableBooks = books.length;

  // Topbar fields (character crest + ancestry/class label).
  const initial = (character?.name?.trim() || 'W')[0]?.toUpperCase() ?? 'W';
  const ancestryName = character?.details?.ancestry?.name ?? '—';
  const className = character?.details?.class?.name ?? '—';

  return (
    <>
      {/* CharacterBuilderPage wraps this in `.wg4 .codex-home-page`
          + its own .winbar / .topbar (crest + Home/Build/Sheet nav +
          hamburger). We render only the page body here — the
          Sources/Ancestry/Class/Skills/Feats crumb strip from the
          original mockup was decorative (the buttons didn't do
          anything) so it's been removed. */}
        <div className='home-wrap'>
          {/* Hero — portrait + name input + level chip. */}
          <div className='hero'>
            <div
              className='portrait'
              title='Select portrait'
              onClick={() => {
                openContextModal({
                  modal: 'selectImage',
                  title: <Title order={3}>Select Portrait</Title>,
                  classNames: { content: 'codex-select-image-modal' },
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
                    placeholder='Name your wanderer'
                    defaultValue={character?.name === 'Unknown Wanderer' ? '' : character?.name ?? ''}
                    onChange={(e) => {
                      setCharacter((prev) => {
                        if (!prev) return prev;
                        return { ...prev, name: e.target.value };
                      });
                    }}
                  />
                )}
              </div>
            </div>

            <div className='lvl-card'>
              <div className='lbl'>
                Level
                <small>1 – 20</small>
              </div>
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
          <div className='builder-panel'>
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
                style={activeTab === 'options' ? { color: 'var(--accent)' } : undefined}
              >
                <IconSettings size={13} />
                Options
              </button>
            </div>

            {activeTab === 'books' && (
              <>
                <div className='panel-subhead'>
                  <div className='lhs'>
                    <b>{enabledBookCount}</b> / {totalAvailableBooks} sources active
                    <em>· official tomes you can draw on</em>
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
                              className={`fill${!noneOn && enabled < total ? ' partial' : ''}`}
                              style={{ right: `${100 - fillPct}%` }}
                            />
                          </div>
                        </div>
                        <div className='pf'>
                          {group.tag}
                          {group.subtag && (
                            <>
                              <br />
                              <b>{group.subtag}</b>
                            </>
                          )}
                        </div>
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

            {activeTab === 'homebrew' && (
              <>
                <div className='panel-subhead'>
                  <div className='lhs'>
                    <b>{homebrewBundles.length}</b> personal bundle{homebrewBundles.length === 1 ? '' : 's'}
                    <em>· your own homebrew content, available to every character you own</em>
                  </div>
                </div>

                {homebrewBundles.length === 0 ? (
                  <div className='empty-state'>
                    You haven't created any homebrew bundles yet. <a href='/homebrew'>Go make one →</a>
                  </div>
                ) : (
                  <div className='var-grid'>
                    {homebrewBundles.map((s) => {
                      const enabled = character?.content_sources?.enabled?.includes(s.id);
                      return (
                        <CodexToggleRow
                          key={s.id}
                          glyph={'❀'}
                          name={s.name}
                          sub={s.description ? truncate(s.description, { length: 110 }) : 'No description.'}
                          on={enabled}
                          onToggle={() => setBooksEnabled([s.id], !enabled)}
                          onInfo={() =>
                            openDrawer({
                              type: 'content-source',
                              data: { id: s.id, showOperations: true },
                            })
                          }
                        />
                      );
                    })}
                  </div>
                )}
              </>
            )}

            {activeTab === 'variants' &&
              (() => {
                const setVariant = (key: string, enabled: boolean, extra?: (prev: any) => any) => {
                  setCharacter((prev) => {
                    if (!prev) return prev;
                    const next: any = {
                      ...prev,
                      variants: {
                        ...prev.variants,
                        [key]: enabled,
                      },
                    };
                    return extra ? extra(next) : next;
                  });
                };
                const variants: Array<{
                  key: string;
                  name: string;
                  sub: string;
                  glyph: string;
                  info: string;
                  url?: string;
                  tag?: 'beta' | 'homebrew';
                  onChange?: (enabled: boolean) => void;
                }> = [
                  {
                    key: 'ancestry_paragon',
                    name: 'Ancestry Paragon',
                    glyph: '❦',
                    sub: 'Get a bonus ancestry feat at every odd level — for groups where ancestry matters as much as class.',
                    info: `Most characters have some elements that connect them to their ancestry but identify more strongly with their class or unique personality. Sometimes, though, a character is the embodiment of their ancestry to the point that it's of equal importance to their class. For a game where an ancestral background is a major theme and such characters are the norm, your group might consider using the ancestry paragon variant.`,
                    url: 'https://2e.aonprd.com/Rules.aspx?ID=1336',
                  },
                  {
                    key: 'automatic_bonus_progression',
                    name: 'Automatic Bonus Progression',
                    glyph: '⚖',
                    sub: 'Innate potency replaces magic-item bonuses; items become flavour, not numbers.',
                    info: `This variant removes the item bonus to rolls and DCs usually provided by magic items (with the exception of armor's item bonus) and replaces it with a new kind of bonus - potency - to reflect a character's innate ability. In this variant, magic items, if they exist at all, can provide unique special abilities rather than numerical increases.`,
                    url: 'https://2e.aonprd.com/Rules.aspx?ID=2741',
                  },
                  {
                    key: 'dual_class',
                    name: 'Dual Class',
                    glyph: '⚔',
                    sub: 'Take the full benefits of two classes simultaneously — for small parties.',
                    info: `Sometimes, especially when you have a particularly small play group or want to play incredibly versatile characters, you might want to allow dual-class characters that have the full benefits of two different classes.`,
                    url: 'https://2e.aonprd.com/Rules.aspx?ID=1328',
                    onChange: (enabled) =>
                      setVariant('dual_class', enabled, (next) => ({
                        ...next,
                        details: { ...next.details, class_2: enabled ? next.details?.class_2 : undefined },
                      })),
                  },
                  {
                    key: 'free_archetype',
                    name: 'Free Archetype',
                    glyph: '✦',
                    sub: 'Every character gets a free bonus archetype track — perfect for themed parties.',
                    info: `Sometimes the story of your game calls for a group where everyone is a pirate or an apprentice at a magic school. The free archetype variant introduces a shared aspect to every character without taking away any of that character's existing choices.`,
                    url: 'https://2e.aonprd.com/Rules.aspx?ID=2751',
                  },
                  {
                    key: 'gradual_attribute_boosts',
                    name: 'Gradual Attribute Boosts',
                    glyph: '▴',
                    sub: 'Spread the level-5/10/15/20 boost sets across the four levels leading up to each.',
                    info: `In this variant, a character gains attribute boosts more gradually as they level up, rather than receiving four attribute boosts at 5th, 10th, 15th, and 20th levels. Each character gains one attribute boost when they reach each of 2nd, 3rd, 4th, and 5th levels. These are collectively a single set of attribute boosts, so a character can't boost the same attribute more than once per set.`,
                    url: 'https://2e.aonprd.com/Rules.aspx?ID=1300',
                  },
                  {
                    key: 'proficiency_without_level',
                    name: 'Proficiency without Level',
                    glyph: '≡',
                    sub: 'Removes character level from proficiency — gritty, uncertain, every fight a real risk.',
                    info: `This variant removes a character's level from their proficiency bonus, scaling it differently for a style of game that's outside the norm. The proficiency rank progression in Player Core is designed for heroic fantasy games where heroes rise from humble origins to world-shattering strength. For some games, this narrative arc doesn't fit.`,
                    url: 'https://2e.aonprd.com/Rules.aspx?ID=2762',
                  },
                  {
                    key: 'monster_parts',
                    name: 'Battlezoo Monster Parts (Light)',
                    glyph: '♟',
                    tag: 'homebrew',
                    sub: 'Convert monster trophies into gear potency. Replaces some treasure with crafted upgrades.',
                    info: `Enables the Battlezoo Bestiary Monster Parts subsystem (Light variant). With this on, currency is partially replaced by monster parts harvested from defeated foes, and each item in your inventory can be flipped into "monster-parts mode" via the Item drawer — its potency, striking, and resilient runes are then derived from the gp of monster parts you've invested in it. Subscribe to the bundle on the Homebrew page to enable the imbued-property catalog.`,
                  },
                  {
                    key: 'deep_background',
                    name: 'Deep Background',
                    glyph: '✎',
                    sub: 'Build your own background from scratch — name, two boosts, a Lore, and a feat.',
                    info: `Instead of picking a published background, build your own. You'll choose a name and short description, two attribute boosts (each to a different ability score), training in a Lore skill of your choice, and one skill feat — the character automatically becomes trained in that feat's prerequisite skill.`,
                    onChange: (enabled) =>
                      setVariant('deep_background', enabled, (next) => ({
                        ...next,
                        details: enabled ? { ...next.details, background: undefined } : next.details,
                      })),
                  },
                ];
                const activeCount = variants.filter((v) => !!(character?.variants as any)?.[v.key]).length;
                return (
                  <>
                    <div className='panel-subhead'>
                      <div className='lhs'>
                        <b>{activeCount}</b> / {variants.length} variant rules active
                        <em>· optional rule riders that change how the game plays</em>
                      </div>
                    </div>
                    <div className='var-grid'>
                      {variants.map((v) => (
                        <CodexToggleRow
                          key={v.key}
                          glyph={v.glyph}
                          name={v.name}
                          sub={v.sub}
                          tag={v.tag}
                          on={!!(character?.variants as any)?.[v.key]}
                          onToggle={() => {
                            const enabled = !(character?.variants as any)?.[v.key];
                            if (v.onChange) v.onChange(enabled);
                            else setVariant(v.key, enabled);
                          }}
                          onInfo={() =>
                            openDrawer({
                              type: 'generic',
                              data: {
                                title: v.name,
                                description:
                                  v.info.trim() +
                                  (v.url ? `\n\n[[Archives of Nethys Rules Page](${v.url})]` : ''),
                              },
                            })
                          }
                        />
                      ))}
                    </div>
                  </>
                );
              })()}

            {activeTab === 'options' &&
              (() => {
                const setOption = (key: string, enabled: boolean) => {
                  setCharacter((prev) =>
                    prev
                      ? {
                          ...prev,
                          options: { ...prev.options, [key]: enabled },
                        }
                      : prev
                  );
                };
                const optionDefs: Array<{
                  key: string;
                  name: string;
                  sub: string;
                  glyph: string;
                  info: string;
                  tag?: 'beta' | 'homebrew';
                }> = [
                  {
                    key: 'alternate_ancestry_boosts',
                    name: 'Alternate Ancestry Boosts',
                    glyph: '⛬',
                    sub: "Skip your ancestry's default boosts/flaws — take two free attribute boosts instead.",
                    info: `The attribute boosts and flaws listed in each ancestry represent general trends or help guide players to create the kinds of characters from that ancestry most likely to pursue the life of an adventurer. However, ancestries aren't a monolith. You always have the option to replace your ancestry's listed attribute boosts and attribute flaws entirely and instead select two free attribute boosts when creating your character.`,
                  },
                  {
                    key: 'auto_detect_prerequisites',
                    name: 'Auto-Detect Prerequisites',
                    glyph: '⛓',
                    tag: 'beta',
                    sub: 'Highlight feats whose prerequisites your character has met.',
                    info: `Automatically determine if a feat or feature has its prerequisites met in order to be taken. This is a beta feature and may not always work correctly.`,
                  },
                  {
                    key: 'dice_roller',
                    name: 'Dice Roller',
                    glyph: '⚇',
                    sub: 'Integrated dice tray on the sheet — roll attacks, saves, and damage in-app.',
                    info: `Roll your dice directly from the character sheet! Integrated with all your character's stats and abilities.`,
                  },
                  {
                    key: 'ignore_bulk_limit',
                    name: 'Ignore Bulk Limit',
                    glyph: '⛁',
                    sub: 'Disable encumbrance — useful for narrative games where bulk is fiddly.',
                    info: `Disables the negative effects of carrying too much bulk, such as adding the encumbered condition.`,
                  },
                  {
                    key: 'is_public',
                    name: 'Public Character',
                    glyph: '◐',
                    sub: "Anyone with the link can view this character's sheet (read-only).",
                    info: `Makes your character public and viewable by anyone with your sheet link:\n\n_https://wanderersguide.app/sheet/${character?.id}_`,
                  },
                  {
                    key: 'voluntary_flaws',
                    name: 'Voluntary Flaw',
                    glyph: '❉',
                    sub: 'Optionally accept an extra ancestry flaw in exchange for narrative flavour.',
                    info: `Sometimes, it's fun to play a character with a major flaw regardless of your ancestry. You can elect to take an additional attribute flaw when applying the attribute boosts and attribute flaws from your ancestry.`,
                  },
                  {
                    key: 'custom_operations',
                    name: 'Custom Operations',
                    glyph: '⚙',
                    sub: 'Add custom operations to this character. Executed before most other operations.',
                    info: `Enables an area to add custom operations to your character. These are executed before most other operations.`,
                  },
                ];
                const swatches: Array<{ key: string; gradient: string; hex: string }> = [
                  { key: 'gold', gradient: 'linear-gradient(135deg, #c9a13b, #8a6f25)', hex: '#c9a13b' },
                  { key: 'crimson', gradient: 'linear-gradient(135deg, #a83a25, #6f1f10)', hex: '#a83a25' },
                  { key: 'sage', gradient: 'linear-gradient(135deg, #5b7148, #344128)', hex: '#5b7148' },
                  { key: 'tide', gradient: 'linear-gradient(135deg, #4a6987, #2c4259)', hex: '#4a6987' },
                  { key: 'amethyst', gradient: 'linear-gradient(135deg, #7a4a87, #4a2c59)', hex: '#7a4a87' },
                  { key: 'obsidian', gradient: 'linear-gradient(135deg, #2b2620, #15110b)', hex: '#2b2620' },
                  { key: 'copper', gradient: 'linear-gradient(135deg, #c98c5a, #7a4d2b)', hex: '#c98c5a' },
                  { key: 'sun', gradient: 'linear-gradient(135deg, #e8c557, #b09438)', hex: '#e8c557' },
                  { key: 'ember', gradient: 'linear-gradient(135deg, #c4452a, #863519)', hex: '#c4452a' },
                ];
                const currentColor = character?.details?.sheet_theme?.color || GUIDE_BLUE;
                const setSheetColor = (hex: string) => {
                  if (!hasPatreonAccess(getCachedPublicUser(), 1)) {
                    displayPatronOnly();
                    return;
                  }
                  setCharacter((prev) =>
                    prev
                      ? {
                          ...prev,
                          details: {
                            ...prev.details,
                            sheet_theme: { ...prev.details?.sheet_theme, color: hex },
                          },
                        }
                      : prev
                  );
                };
                const allBgs = getAllBackgroundImages();
                const featuredBgs = allBgs.slice(0, 4);
                const currentBg = character?.details?.background_image_url;
                return (
                  <>
                    <div className='panel-subhead'>
                      <div className='lhs'>
                        <b>
                          {
                            optionDefs.filter((o) => !!(character?.options as any)?.[o.key])
                              .length
                          }
                        </b>{' '}
                        / {optionDefs.length} options active
                        <em>· per-character toggles for visuals + behaviour</em>
                      </div>
                    </div>
                    <div className='var-grid'>
                      {optionDefs.map((o) => (
                        <CodexToggleRow
                          key={o.key}
                          glyph={o.glyph}
                          name={o.name}
                          sub={o.sub}
                          tag={o.tag}
                          on={!!(character?.options as any)?.[o.key]}
                          onToggle={() => setOption(o.key, !(character?.options as any)?.[o.key])}
                          onInfo={() =>
                            openDrawer({
                              type: 'generic',
                              data: { title: o.name, description: o.info.trim() },
                            })
                          }
                        />
                      ))}
                    </div>

                    {character?.options?.custom_operations && (
                      <>
                        <button
                          type='button'
                          className='ops-btn'
                          onClick={() => setOpenedOperations(true)}
                        >
                          Open Operations
                          <span className='ct'>
                            {character.custom_operations && character.custom_operations.length > 0
                              ? `(${character.custom_operations.length})`
                              : ''}
                          </span>
                        </button>
                        <OperationsModal
                          title='Custom Operations'
                          opened={openedOperations}
                          onClose={() => setOpenedOperations(false)}
                          operations={cloneDeep(character.custom_operations ?? [])}
                          onChange={(operations) => {
                            if (isEqual(character.custom_operations, operations)) return;
                            setCharacter((prev) =>
                              prev ? { ...prev, custom_operations: operations } : prev
                            );
                          }}
                          classNames={{ content: 'codex-operations-modal' }}
                        />
                      </>
                    )}

                    <div className='options-panel'>
                      <h3>Sheet Customisation</h3>

                      <div className='theme-row'>
                        <div className='lab'>Colour theme</div>
                        <div className='swatch-row'>
                          {swatches.map((s) => (
                            <div
                              key={s.key}
                              className={`sw${currentColor === s.hex ? ' on' : ''}`}
                              style={{ background: s.gradient }}
                              onClick={() => setSheetColor(s.hex)}
                              title={s.key}
                              role='button'
                              tabIndex={0}
                            />
                          ))}
                        </div>
                      </div>

                      <div className='theme-row'>
                        <div className='lab'>Background</div>
                        <div className='bg-picker'>
                          {featuredBgs.map((bg: ImageOption) => (
                            <div
                              key={bg.url}
                              className={`bg-tile${currentBg === bg.url ? ' on' : ''}`}
                              style={{ backgroundImage: `url(${bg.url})` }}
                              onClick={() => {
                                setCharacter((prev) =>
                                  prev
                                    ? {
                                        ...prev,
                                        details: {
                                          ...prev.details,
                                          background_image_url: bg.url,
                                        },
                                      }
                                    : prev
                                );
                              }}
                              role='button'
                              tabIndex={0}
                            />
                          ))}
                          <div
                            className='bg-tile'
                            onClick={() => {
                              openContextModal({
                                modal: 'selectImage',
                                title: <Title order={3}>Select Background</Title>,
                                classNames: { content: 'codex-select-image-modal' },
                                innerProps: {
                                  options: allBgs,
                                  onSelect: (option: ImageOption) => {
                                    setCharacter((prev) =>
                                      prev
                                        ? {
                                            ...prev,
                                            details: {
                                              ...prev.details,
                                              background_image_url: option.url,
                                            },
                                          }
                                        : prev
                                    );
                                  },
                                  category: 'backgrounds',
                                },
                              });
                            }}
                            role='button'
                            tabIndex={0}
                          />
                        </div>
                      </div>

                      {apiClients && apiClients.length > 0 && (
                        <>
                          <h3 style={{ marginTop: 22 }}>Authorised Clients</h3>
                          {apiClients.map((client, index) => (
                            <div
                              key={index}
                              className='theme-row'
                              style={{ gridTemplateColumns: '1fr auto' }}
                            >
                              <div className='lab' style={{ letterSpacing: 0, textTransform: 'none' }}>
                                {client?.name ?? 'Unknown client'}
                              </div>
                              <button
                                type='button'
                                className='ops-btn'
                                style={{ margin: 0 }}
                                onClick={() => {
                                  modals.openConfirmModal({
                                    id: 'remove-client-access',
                                    title: <Title order={4}>Revoke Access</Title>,
                                    children: (
                                      <Stack>
                                        <Text>
                                          Are you sure you want to revoke access for {client?.name} to read
                                          and edit this character?
                                        </Text>
                                      </Stack>
                                    ),
                                    labels: { confirm: 'Remove', cancel: 'Cancel' },
                                    classNames: { content: 'codex-confirm-modal' },
                                    onCancel: () => {},
                                    onConfirm: async () => {
                                      setCharacter((prev) =>
                                        prev
                                          ? {
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
                                            }
                                          : prev
                                      );
                                      queryClient.invalidateQueries({
                                        queryKey: [`find-content-${character?.id}`],
                                      });
                                    },
                                  });
                                }}
                              >
                                Revoke
                              </button>
                            </div>
                          ))}
                        </>
                      )}
                    </div>
                  </>
                );
              })()}
          </div>
        </div>
    </>
  );
}
