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
import Paginator from '@common/Paginator';
import { deleteContent, upsertContentSource } from '@content/content-creation';
import { fetchContentSources, resetContentStore } from '@content/content-store';
import { updateSubscriptions } from '@content/homebrew';
import { importFromCustomPack } from '@homebrew/import/pathbuilder-custom-packs';
import { Center, FileButton, Loader, Menu, VisuallyHidden } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { modals } from '@mantine/modals';
import { CreateContentSourceModal } from '@modals/CreateContentSourceModal';
import { makeRequest } from '@requests/request-manager';
import { IconUpload } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { ContentSource } from '@schemas/content';
import { setPageTitle } from '@utils/document-change';
import { phoneQuery } from '@utils/mobile-responsive';
import { pluralize, toLabel } from '@utils/strings';
import { CodexWinBar } from '@common/CodexWinBar';
import { useRef, useState } from 'react';
import { useAtom } from 'jotai';

export function Component() {
  setPageTitle(`Homebrew`);
  const [searchQuery, setSearchQuery] = useState('');

  return (
    <div
      className='wg4 wg4-screen wg4-page-root'
      style={{ minHeight: '100dvh', background: 'var(--wg4-page)' }}
    >
      <CodexWinBar subtitle='Homebrew' nav />
      <div style={{ padding: 16 }}>
        <div style={{ maxWidth: 875, margin: '0 auto', width: '100%' }}>
          <MyBundlesSection
            searchQuery={searchQuery.trim()}
            rawSearchQuery={searchQuery}
            onSearch={setSearchQuery}
          />
        </div>
      </div>
    </div>
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

// Notability weights for picking the most interesting 2 counts to show on a
// bundle card's meta line (mirrors ContentSourceInfo's ordering).
const COUNT_NOTABILITY: Record<string, number> = {
  class: 30,
  ancestry: 20,
  archetype: 18,
  'versatile-heritage': 17,
  background: 15,
  heritage: 12,
  feat: 10,
  spell: 9,
  item: 8,
  creature: 7,
  'class-archetype': 6,
  action: 5,
  language: 3,
  trait: 2,
};

/** Build a concise "12 feats · 3 classes" meta string from a bundle's counts. */
function bundleMeta(source: ContentSource): string {
  const counts = source.meta_data?.counts ?? {};
  const parts = Object.entries(counts)
    .filter(([, value]) => !!value)
    .sort(([a], [b]) => (COUNT_NOTABILITY[b] ?? -1) - (COUNT_NOTABILITY[a] ?? -1))
    .slice(0, 3)
    .map(([key, value]) => `${value} ${value === 1 ? toLabel(key) : pluralize(toLabel(key))}`);
  return parts.length > 0 ? parts.join(' · ') : 'Empty bundle';
}

function MyBundlesSection(props: { searchQuery: string; rawSearchQuery: string; onSearch: (v: string) => void }) {
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
    <div style={{ width: '100%' }}>
      {/* Header — "Your bundles" + search + Create / Import */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 12,
          flexWrap: 'wrap',
          marginBottom: 18,
        }}
      >
        <div style={{ fontFamily: 'var(--font-serif)', fontStyle: 'italic', fontSize: 22 }}>Your bundles</div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <input
            className='input'
            style={{ maxWidth: 220 }}
            placeholder='Search your bundles'
            value={props.rawSearchQuery}
            onChange={(e) => props.onSearch(e.currentTarget.value)}
          />
          {/* Create + Import joined pill group (matches the mockup). */}
          <div style={{ display: 'flex' }}>
            <button
              type='button'
              className='btn'
              style={{ borderRadius: 'var(--rpill) 0 0 var(--rpill)', opacity: loadingCreate ? 0.7 : 1 }}
              disabled={loadingCreate}
              onClick={handleCreate}
            >
              + Create New Bundle
            </button>
            <Menu shadow='md' width={200} position='bottom-end'>
              <Menu.Target>
                <button
                  type='button'
                  className='btn'
                  style={{
                    borderRadius: '0 var(--rpill) var(--rpill) 0',
                    borderLeft: '1px solid var(--accent-ink)',
                    padding: '8px 10px',
                  }}
                  aria-label='Import options'
                >
                  ▾
                </button>
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
          </div>
        </div>
      </div>

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
          {(fileProps) => (
            <button type='button' ref={jsonImportRef} {...fileProps}>
              Import from Custom Pack
            </button>
          )}
        </FileButton>
      </VisuallyHidden>

      {/* Bundle list */}
      {isFetching && (
        <Center w='100%' py='xl'>
          <Loader size='sm' type='dots' />
        </Center>
      )}
      {!isFetching && bundles.length === 0 && (
        <div className='note'>
          You haven't created any bundles yet. Click <b>Create New Bundle</b> to start. Inside a bundle you can
          add classes, archetypes, feats, ancestries, spells, and more.
        </div>
      )}
      {!isFetching && bundles.length > 0 && (
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
      )}

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
    </div>
  );
}

/** Homebrew bundle card — parchment `.bundle` styling. Edit + Delete inline. */
function ContentSourceCard(props: {
  source: ContentSource;
  onEdit?: () => void;
  onDelete?: () => void;
  deleteTitle?: string;
  deleteMessage?: string;
}) {
  const [_drawer, openDrawer] = useAtom(drawerState);

  return (
    <div
      className='bundle'
      style={{ cursor: 'pointer' }}
      onClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
        // Clicking the card opens the inspector drawer (same as upstream),
        // which shows the bundle's contents read-only. To edit, use the
        // Edit button below.
        openDrawer({
          type: 'content-source',
          data: {
            id: props.source.id,
            showOperations: true,
          },
        });
      }}
    >
      <div className='tt'>{props.source.name}</div>
      <div className='meta'>{bundleMeta(props.source)}</div>
      {(props.onEdit || props.onDelete) && (
        <div className='acts'>
          {props.onEdit && (
            <button
              type='button'
              className='btn ghost sm'
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
                props.onEdit?.();
              }}
            >
              Edit
            </button>
          )}
          {props.onDelete && (
            <button
              type='button'
              className='btn danger sm'
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
                modals.openConfirmModal({
                  id: 'delete-source',
                  title: <span style={{ fontWeight: 600 }}>{props.deleteTitle ?? 'Delete'}</span>,
                  children: <span style={{ fontSize: 14 }}>{props.deleteMessage ?? 'Are you sure?'}</span>,
                  labels: { confirm: 'Confirm', cancel: 'Cancel' },
                  onCancel: () => {},
                  onConfirm: () => {
                    props.onDelete?.();
                  },
                });
              }}
            >
              Delete
            </button>
          )}
        </div>
      )}
    </div>
  );
}
