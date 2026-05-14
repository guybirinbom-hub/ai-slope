// Homebrew page (local-app redesign).
//
// Upstream Wanderer's Guide ships this page as three tabs: Browse public
// bundles, Subscriptions, and My Creations (gated behind Patreon). Those
// concepts all rely on an online server to publish/subscribe to other
// people's content — none of that exists in the local fork. So this page
// is now a single view: "your bundles", with a prominent Create button
// and per-bundle Edit / Delete actions. Bundles created here are auto-
// subscribed so they show up in the character builder's Homebrew panel.

import { drawerState } from '@atoms/navAtoms';
import { userState } from '@atoms/userAtoms';
import { getPublicUser } from '@auth/user-manager';
import BlurBox from '@common/BlurBox';
import { ContentSourceInfo } from '@common/ContentSourceInfo';
import Paginator from '@common/Paginator';
import { IMPRINT_BG_COLOR, IMPRINT_BG_COLOR_2, IMPRINT_BORDER_COLOR } from '@constants/data';
import { deleteContent, upsertContentSource } from '@content/content-creation';
import { fetchContentSources, resetContentStore } from '@content/content-store';
import { updateSubscriptions } from '@content/homebrew';
import { importFromCustomPack } from '@homebrew/import/pathbuilder-custom-packs';
import {
  ActionIcon,
  Box,
  Button,
  Center,
  Divider,
  FileButton,
  Group,
  Loader,
  Menu,
  Stack,
  Text,
  TextInput,
  Title,
  VisuallyHidden,
  rem,
  useMantineTheme,
} from '@mantine/core';
import { useMediaQuery, useHover } from '@mantine/hooks';
import { modals } from '@mantine/modals';
import { CreateContentSourceModal } from '@modals/CreateContentSourceModal';
import { makeRequest } from '@requests/request-manager';
import { IconAsset, IconChevronDown, IconDots, IconPlus, IconSearch, IconTrash, IconUpload, IconX } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { ContentSource } from '@schemas/content';
import { setPageTitle } from '@utils/document-change';
import { phoneQuery } from '@utils/mobile-responsive';
import { useRef, useState } from 'react';
import { useAtom } from 'jotai';

export function Component() {
  setPageTitle(`Homebrew`);
  const theme = useMantineTheme();
  const isPhone = useMediaQuery(phoneQuery());
  const [searchQuery, setSearchQuery] = useState('');

  return (
    <Center>
      <Box maw={875} w='100%'>
        <BlurBox>
          {/* Header — title + inline search */}
          <Group px='md' py='sm' justify='space-between' wrap='nowrap'>
            <Group gap='sm' wrap='nowrap' style={{ flexShrink: 0 }}>
              {!isPhone && <IconAsset size='1.8rem' stroke={1.5} />}
              <Title size={28}>Homebrew</Title>
            </Group>

            {!isPhone && (
              <TextInput
                style={{ flex: 1, maxWidth: 280 }}
                leftSection={<IconSearch size='0.9rem' />}
                placeholder='Search your bundles'
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                variant='unstyled'
                rightSection={
                  searchQuery.trim() ? (
                    <ActionIcon
                      variant='subtle'
                      size='md'
                      color='gray'
                      radius='xl'
                      aria-label='Clear search'
                      onClick={() => setSearchQuery('')}
                    >
                      <IconX size='1.2rem' stroke={2} />
                    </ActionIcon>
                  ) : undefined
                }
                styles={(theme) => ({
                  wrapper: {
                    backgroundColor: 'rgba(0, 0, 0, 0.18)',
                    border: '1px solid rgba(255, 255, 255, 0.07)',
                    borderRadius: theme.radius.md,
                    padding: '2px 4px',
                  },
                  input: { '--input-placeholder-color': theme.colors.gray[5] },
                })}
              />
            )}
          </Group>

          {isPhone && (
            <Stack px='sm' pb='xs' gap='xs'>
              <TextInput
                style={{ flex: 1 }}
                leftSection={<IconSearch size='0.9rem' />}
                placeholder='Search your bundles'
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                variant='unstyled'
                rightSection={
                  searchQuery.trim() ? (
                    <ActionIcon
                      variant='subtle'
                      size='md'
                      color='gray'
                      radius='xl'
                      aria-label='Clear search'
                      onClick={() => setSearchQuery('')}
                    >
                      <IconX size='1.2rem' stroke={2} />
                    </ActionIcon>
                  ) : undefined
                }
                styles={(theme) => ({
                  wrapper: {
                    backgroundColor: 'rgba(0, 0, 0, 0.18)',
                    border: '1px solid rgba(255, 255, 255, 0.07)',
                    borderRadius: theme.radius.md,
                    padding: '2px 4px',
                  },
                  input: { '--input-placeholder-color': theme.colors.gray[5] },
                })}
              />
            </Stack>
          )}

          <Divider />

          {/* Single view — your bundles */}
          <Box p='md'>
            <MyBundlesSection searchQuery={searchQuery.trim()} />
          </Box>
        </BlurBox>
      </Box>
    </Center>
  );
}

const getSearchStr = (source: ContentSource) => {
  return JSON.stringify({
    _: source.name,
    ___: source.contact_info,
    ____: source.description,
    _____: source.url,
    ______: source.meta_data,
  }).toLowerCase();
};

function MyBundlesSection(props: { searchQuery: string }) {
  const isPhone = useMediaQuery(phoneQuery());
  const [sourceId, setSourceId] = useState<number | undefined>(undefined);
  const [loadingCreate, setLoadingCreate] = useState(false);
  const jsonImportRef = useRef<HTMLButtonElement>(null);

  const [user, setUser] = useAtom(userState);
  useQuery({
    queryKey: [`find-account-self`],
    queryFn: async () => {
      const user = await getPublicUser();
      setUser(user);
      return user;
    },
    refetchOnWindowFocus: false,
  });

  const {
    data,
    isFetching: isFetchingBundles,
    refetch: refetchBundles,
  } = useQuery({
    queryKey: [`get-homebrew-content-sources-creations`],
    queryFn: async () => {
      resetContentStore(false);
      // Every bundle the local user owns. We don't filter by published or
      // require_key because those are publishing-store concepts that don't
      // apply locally — every bundle the user makes is automatically
      // "theirs to use" in the character builder.
      return (await fetchContentSources('ALL-HOMEBREW-ACCESSIBLE')).filter(
        (c) => c.user_id && c.user_id === user?.user_id
      );
    },
    enabled: !!user,
    refetchOnWindowFocus: false,
  });
  const isFetching = isFetchingBundles || !user;

  const bundles =
    data?.filter((source) => getSearchStr(source).toLowerCase().includes(props.searchQuery.toLowerCase())) ?? [];

  // Create-bundle handler: makes a new content_source row, auto-subscribes
  // the user (so it shows up in the character builder's Homebrew panel),
  // and opens the editor on the new bundle.
  const handleCreate = async () => {
    setLoadingCreate(true);
    const source = await upsertContentSource({
      id: -1,
      created_at: '',
      user_id: '',
      name: 'New Bundle',
      foundry_id: null,
      url: '',
      description: '',
      operations: [],
      contact_info: '',
      group: '',
      require_key: false,
      keys: null,
      is_published: false,
      artwork_url: '',
      deprecated: false,
      required_content_sources: [],
      meta_data: {},
    });
    if (source && user) {
      // Auto-subscribe — so the new bundle is immediately visible in the
      // character builder's Homebrew panel without an extra step.
      const subscriptions = await updateSubscriptions(user, source, true);
      setUser({ ...user, subscribed_content_sources: subscriptions });
      await makeRequest('update-user', {
        subscribed_content_sources: subscriptions ?? [],
      });
      setSourceId(source.id);
    }
    refetchBundles();
    setLoadingCreate(false);
  };

  return (
    <Stack w='100%' gap={15}>
      {/* Action bar — Create + Import */}
      <Group justify='space-between' align='center'>
        <Text c='gray.2' fw={600}>
          Your bundles
        </Text>
        <Button.Group>
          <Button
            loading={loadingCreate}
            leftSection={<IconPlus size='1rem' />}
            variant='filled'
            color='guide'
            radius='xl'
            size='sm'
            onClick={handleCreate}
          >
            Create New Bundle
          </Button>
          <Menu shadow='md' width={200} position='bottom-end'>
            <Menu.Target>
              <Button variant='filled' color='guide' px={8} size='sm'>
                <IconChevronDown size='1.2rem' />
              </Button>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Item
                leftSection={<IconUpload size='1rem' />}
                onClick={() => {
                  jsonImportRef.current?.click();
                }}
              >
                Import from Custom Pack
              </Menu.Item>
            </Menu.Dropdown>
          </Menu>
        </Button.Group>
      </Group>

      <VisuallyHidden>
        {/* File-button trampoline so the menu item can trigger a file picker. */}
        <FileButton
          onChange={async (file) => {
            if (!file) return;
            setLoadingCreate(true);
            const source = await importFromCustomPack(file);
            if (source && user) {
              const subscriptions = await updateSubscriptions(user, source, true);
              setUser({ ...user, subscribed_content_sources: subscriptions });
              await makeRequest('update-user', {
                subscribed_content_sources: subscriptions ?? [],
              });
              setSourceId(source.id);
            }
            refetchBundles();
            setLoadingCreate(false);
          }}
          accept='application/JSON'
        >
          {(props) => (
            <Button ref={jsonImportRef} {...props}>
              Import from Custom Pack
            </Button>
          )}
        </FileButton>
      </VisuallyHidden>

      {/* Bundle list */}
      <Group>
        {isFetching && (
          <Center w='100%' py='xl'>
            <Loader size='sm' type='dots' />
          </Center>
        )}
        {!isFetching && bundles.length === 0 && (
          <BlurBox w={'100%'} h={140}>
            <Stack mt={40} gap={6} align='center'>
              <Text ta='center' c='gray.2' fs='italic'>
                You haven't created any bundles yet.
              </Text>
              <Text ta='center' c='gray.4' fz='sm'>
                Click "Create New Bundle" to start. Inside a bundle you can add classes, archetypes, feats, ancestries,
                spells, and more.
              </Text>
            </Stack>
          </BlurBox>
        )}
        {!isFetching && bundles.length > 0 && (
          <Center w='100%'>
            <Stack w='100%'>
              <Paginator
                h={500}
                records={bundles.map((source, index) => (
                  <ContentSourceCard
                    key={index}
                    source={source}
                    onEdit={() => setSourceId(source.id)}
                    onDelete={async () => {
                      await deleteContent('content-source', source.id);
                      // Also remove from subscriptions so the builder panel
                      // updates immediately.
                      if (user) {
                        const subscriptions = await updateSubscriptions(user, source, false);
                        setUser({ ...user, subscribed_content_sources: subscriptions });
                        await makeRequest('update-user', {
                          subscribed_content_sources: subscriptions ?? [],
                        });
                      }
                      refetchBundles();
                    }}
                    deleteTitle='Delete Bundle'
                    deleteMessage='Are you sure you want to delete this bundle? All characters using this bundle will lose their abilities from this source.'
                  />
                ))}
                numPerPage={isPhone ? 4 : 12}
                numInRow={isPhone ? 1 : 3}
                gap='sm'
                pagSize='md'
              />
            </Stack>
          </Center>
        )}
      </Group>

      {sourceId && (
        <CreateContentSourceModal
          opened={true}
          sourceId={sourceId}
          onClose={() => setSourceId(undefined)}
          onUpdate={async () => {
            const source = await makeRequest<ContentSource>('find-content-source', { id: sourceId });
            if (user && source) {
              const subscriptions = await updateSubscriptions(user, source, true);
              setUser({ ...user, subscribed_content_sources: subscriptions });
              await makeRequest('update-user', {
                subscribed_content_sources: subscriptions ?? [],
              });
            }
            refetchBundles();
          }}
        />
      )}
    </Stack>
  );
}

/** Homebrew bundle card — imprint styling. Edit + Delete inline. */
function ContentSourceCard(props: {
  source: ContentSource;
  onEdit?: () => void;
  onDelete?: () => void;
  deleteTitle?: string;
  deleteMessage?: string;
}) {
  const theme = useMantineTheme();
  const [_drawer, openDrawer] = useAtom(drawerState);

  const { hovered: hoveredCard, ref: refCard } = useHover();

  return (
    <Box
      ref={refCard}
      w='100%'
      style={{
        backgroundColor: hoveredCard ? IMPRINT_BG_COLOR_2 : IMPRINT_BG_COLOR,
        border: `1px solid ${IMPRINT_BORDER_COLOR}`,
        borderRadius: theme.radius.md,
        boxShadow: '0 2px 10px rgba(0, 0, 0, 0.18)',
        cursor: 'pointer',
        transition: 'transform 200ms ease, box-shadow 200ms ease, background-color 200ms ease',
        ...(hoveredCard
          ? {
              transform: 'translateY(-2px)',
              boxShadow: '0 6px 24px rgba(0, 0, 0, 0.3)',
            }
          : {}),
      }}
      onClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
        // Clicking the card opens the inspector drawer (same as upstream),
        // which shows the bundle's contents read-only. To edit, use the
        // Edit Bundle button below.
        openDrawer({
          type: 'content-source',
          data: {
            id: props.source.id,
            showOperations: true,
          },
        });
      }}
    >
      <Box w='100%' h='100%' px='sm' style={{ position: 'relative' }}>
        <ContentSourceInfo source={props.source} />
      </Box>
      {(props.onEdit || props.onDelete) && (
        <Group gap={5} pb='xs' px='sm'>
          {props.onEdit ? (
            <Button
              size='xs'
              variant='default'
              radius='xl'
              style={{ flex: 1 }}
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
                props.onEdit?.();
              }}
            >
              Edit Bundle
            </Button>
          ) : (
            <Box style={{ flex: 1 }}></Box>
          )}
          {props.onDelete && (
            <Menu shadow='md' width={200} withArrow withinPortal>
              <Menu.Target>
                <ActionIcon
                  size={30}
                  variant='subtle'
                  color='gray'
                  radius='xl'
                  aria-label='Options'
                  onClick={(e) => e.stopPropagation()}
                >
                  <IconDots style={{ width: '60%', height: '60%' }} stroke={1.5} />
                </ActionIcon>
              </Menu.Target>

              <Menu.Dropdown>
                <Menu.Item
                  color='red'
                  leftSection={<IconTrash style={{ width: rem(14), height: rem(14) }} />}
                  onClick={(e) => {
                    e.stopPropagation();
                    modals.openConfirmModal({
                      id: 'delete-source',
                      title: <Title order={4}>{props.deleteTitle ?? 'Delete'}</Title>,
                      children: <Text size='sm'>{props.deleteMessage ?? 'Are you sure?'}</Text>,
                      labels: { confirm: 'Confirm', cancel: 'Cancel' },
                      onCancel: () => {},
                      onConfirm: () => {
                        props.onDelete?.();
                      },
                    });
                  }}
                >
                  {props.deleteTitle ?? 'Delete'}
                </Menu.Item>
              </Menu.Dropdown>
            </Menu>
          )}
        </Group>
      )}
    </Box>
  );
}
