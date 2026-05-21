import {
  Text,
  Title,
  Button,
  Box,
  Divider,
  ColorSwatch,
  Popover,
  ColorPicker,
  Loader,
  Stack,
  Switch,
  Slider,
  Accordion,
  Group,
} from '@mantine/core';
import { setPageTitle } from '@utils/document-change';
import BlurBox from '@common/BlurBox';
import { useMutation, useQuery } from '@tanstack/react-query';
import { getPublicUser } from '@auth/user-manager';
import { GUIDE_BLUE } from '@constants/data';
import { IconAlertTriangle, IconCode, IconPalette, IconShadow, IconTrash } from '@tabler/icons-react';
import {
  CustomMode,
  getGlobalCustomModes,
  setGlobalCustomModes,
  targetLabelForVariable,
} from '@modes/custom-modes';
import { ModeEditor } from '@pages/character_sheet/ConditionsModesModal';
import { useDebouncedValue, useDidUpdate } from '@mantine/hooks';
import { makeRequest } from '@requests/request-manager';
import { modals } from '@mantine/modals';
import { showNotification } from '@mantine/notifications';
import { useAtom } from 'jotai';
import { userState } from '@atoms/userAtoms';
import { useState } from 'react';

export function Component() {
  setPageTitle(`Settings`);

  const [user, setUser] = useAtom(userState);

  const { data } = useQuery({
    queryKey: [`find-account-self`],
    queryFn: async () => {
      const user = await getPublicUser();
      setUser(user);
      return user;
    },
  });

  if (!data)
    return (
      <Loader
        size='lg'
        type='bars'
        style={{
          position: 'absolute',
          top: '30%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
        }}
      />
    );

  return <ProfileSection />;
}

function SettingRow({
  label,
  description,
  children,
  last,
}: {
  label: string;
  description?: string;
  children: React.ReactNode;
  last?: boolean;
}) {
  return (
    <>
      <Group justify='space-between' align='center' wrap='nowrap' py={6}>
        <Box style={{ flex: 1 }}>
          <Text size='sm'>{label}</Text>
          {description && (
            <Text size='xs' c='dimmed' lh={1.3}>
              {description}
            </Text>
          )}
        </Box>
        <Box>{children}</Box>
      </Group>
      {!last && <Divider />}
    </>
  );
}

function ProfileSection() {
  const [_user, setUser] = useAtom(userState);

  // User should always be defined here
  const user = _user!;
  if (!user) {
    throw new Error('User is not defined');
  }

  // Local-only build: every query/handler that fed the deleted UI is
  // gone — character / campaign / bundle counts, GM-tier benefitingUsers,
  // approvedContentUpdates → contentTier badge, patronTier badge. The
  // only thing left is the debounced "save site_theme + accessibility"
  // path, since Appearance + Developer are the surviving accordions.

  const { mutate: mutateUser } = useMutation({
    mutationFn: async (data: Record<string, any>) => {
      const response = await makeRequest('update-user', {
        ...data,
      });
      return response;
    },
  });

  // Update user in db when site_theme changes (debounced).
  const [debouncedUser] = useDebouncedValue(user, 500);
  useDidUpdate(() => {
    if (!debouncedUser) return;
    mutateUser({
      site_theme: debouncedUser.site_theme,
    });
  }, [debouncedUser]);

  return (
    <Box p='md' pos='relative'>
      <BlurBox maw={450} mx='auto' style={{ overflow: 'hidden' }}>
        {/* Local-only build: stripped the profile/avatar/name/summary/stats/
            badges/Patreon-connect/GM-tier-share blocks. None of those apply
            to a single local user, so the page is just the settings
            accordion (Appearance + Developer) below. */}
          <Accordion
            defaultValue=''
            variant='contained'
            styles={{
              control: {
                backgroundColor: 'var(--mantine-color-default-hover)',
                '&:hover': { backgroundColor: 'var(--mantine-color-default-hover)' },
              },
              // Match the panel bg to the control so the whole accordion item reads
              // as one dark surface instead of a dark header on top of a transparent body.
              panel: { backgroundColor: 'var(--mantine-color-default-hover)' },
            }}
          >
            {/* Appearance */}
            <Accordion.Item value='appearance'>
              <Accordion.Control icon={<IconPalette size='0.9rem' />}>Appearance</Accordion.Control>
              <Accordion.Panel>
                <Stack gap={0}>
                  <SettingRow label='Theme Color' description='Primary accent color for the site'>
                    <Popover position='bottom-end' withArrow shadow='md'>
                      <Popover.Target>
                        <ColorSwatch
                          style={{ cursor: 'pointer' }}
                          color={user.site_theme?.color || GUIDE_BLUE}
                          size={22}
                        />
                      </Popover.Target>
                      <Popover.Dropdown p={5}>
                        <ColorPicker
                          format='hex'
                          value={user.site_theme?.color || GUIDE_BLUE}
                          onChange={(value) => {
                            // Local-only build: dropped the Patreon gate
                            // — every preference is free on the local app.
                            setUser((prev) => {
                              if (!prev) return prev;
                              return { ...prev, site_theme: { ...prev.site_theme, color: value } };
                            });
                          }}
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
                        />
                      </Popover.Dropdown>
                    </Popover>
                  </SettingRow>

                  <SettingRow label='Dyslexia Font' description='Use OpenDyslexic for improved readability'>
                    <Switch
                      size='sm'
                      checked={user.site_theme?.dyslexia_font ?? false}
                      onChange={(e) => {
                        setUser((prev) => {
                          if (!prev) return prev;
                          return {
                            ...prev,
                            site_theme: { ...prev.site_theme, dyslexia_font: e.currentTarget.checked },
                          };
                        });
                      }}
                    />
                  </SettingRow>

                  <Box pt={6} pb={8}>
                    <Text size='sm' mb={12}>
                      UI Size
                    </Text>
                    <Slider
                      min={0.75}
                      max={1.5}
                      step={0.01}
                      value={user.site_theme?.zoom ?? 1}
                      marks={[
                        { value: 0.75, label: 'Small' },
                        { value: 1, label: 'Default' },
                        { value: 1.5, label: 'Large' },
                      ]}
                      mb='xl'
                      onChange={(value) => {
                        setUser((prev) => {
                          if (!prev) return prev;
                          return { ...prev, site_theme: { ...prev.site_theme, zoom: value } };
                        });
                      }}
                    />
                  </Box>
                </Stack>
              </Accordion.Panel>
            </Accordion.Item>

            {/* Developer */}
            <Accordion.Item value='developer'>
              <Accordion.Control icon={<IconCode size='0.9rem' />}>Developer</Accordion.Control>
              <Accordion.Panel>
                <Stack gap={0}>
                  <SettingRow label='View Operations' description='Show operation data on content entries'>
                    <Switch
                      size='sm'
                      checked={user.site_theme?.view_operations ?? false}
                      onChange={(e) => {
                        setUser((prev) => {
                          if (!prev) return prev;
                          return {
                            ...prev,
                            site_theme: { ...prev.site_theme, view_operations: e.currentTarget.checked },
                          };
                        });
                      }}
                    />
                  </SettingRow>

                  {/* Local-only build: dropped the "API Clients" block.
                      The upstream Developer accordion let you mint API keys
                      for third-party tooling against the public WG API — no
                      such API exists on the local backend. */}
                </Stack>
              </Accordion.Panel>
            </Accordion.Item>

            {/* Modes — manage user-created modes. This page only
                surfaces *global* modes (the ones that show up on
                every character); character-specific modes still live
                on the character sheet's Conditions+Modes modal.
                Storage is localStorage; no network round-trip. */}
            <Accordion.Item value='modes'>
              <Accordion.Control icon={<IconShadow size='0.9rem' />}>Modes</Accordion.Control>
              <Accordion.Panel>
                <ModesSettings />
              </Accordion.Panel>
            </Accordion.Item>

            {/* Danger Zone: full uninstall (wipes pg data + the app
                binary itself). No remote state to worry about — every
                byte the app ever wrote lives in either userData or
                the install directory, and the IPC handler wipes both. */}
            <Accordion.Item value='danger'>
              <Accordion.Control icon={<IconAlertTriangle size='0.9rem' color='var(--mantine-color-red-6)' />}>
                Uninstall
              </Accordion.Control>
              <Accordion.Panel>
                <Stack gap='sm'>
                  <Text size='sm' c='dimmed'>
                    Permanently delete <b>everything</b> — every character, homebrew bundle, custom
                    pack, and the app itself. The window will close once the wipe starts; there is
                    no undo.
                  </Text>
                  <Button
                    color='red'
                    variant='light'
                    leftSection={<IconTrash size={14} />}
                    onClick={() => {
                      modals.openConfirmModal({
                        id: 'uninstall-app',
                        title: <Title order={4}>Uninstall Wanderer's Guide?</Title>,
                        children: (
                          <Stack gap='xs'>
                            <Text size='sm'>This will delete:</Text>
                            <Text size='sm' component='ul' style={{ paddingLeft: 20, margin: 0 }}>
                              <li>Every character on this machine</li>
                              <li>Every homebrew bundle and custom pack you've imported</li>
                              <li>The local database and uploaded images</li>
                              <li>The Wanderer's Guide app itself</li>
                            </Text>
                            <Text size='sm' c='red' fw={500}>
                              This cannot be undone.
                            </Text>
                          </Stack>
                        ),
                        labels: { confirm: 'Delete Everything', cancel: 'Cancel' },
                        confirmProps: { color: 'red' },
                        onConfirm: async () => {
                          if (!window.wgElectron) {
                            // Dev-server / browser fallback — no Electron
                            // bridge available, so nothing to nuke.
                            showNotification({
                              title: 'Uninstall unavailable',
                              message:
                                'The uninstall hook is only wired up in the packaged Electron app.',
                              color: 'yellow',
                            });
                            return;
                          }
                          showNotification({
                            id: 'uninstall-progress',
                            title: 'Uninstalling…',
                            message: 'Wiping local data. The window will close in a moment.',
                            color: 'red',
                            loading: true,
                            autoClose: false,
                            withCloseButton: false,
                          });
                          try {
                            await window.wgElectron.uninstall();
                          } catch (err) {
                            console.error('Uninstall IPC failed:', err);
                            showNotification({
                              title: 'Uninstall failed',
                              message: String((err as Error)?.message ?? err),
                              color: 'red',
                            });
                          }
                        },
                      });
                    }}
                  >
                    Uninstall the app
                  </Button>
                </Stack>
              </Accordion.Panel>
            </Accordion.Item>
          </Accordion>
      </BlurBox>
    </Box>
  );
}

/**
 * Settings → Modes panel. CRUD for *global* user modes (the ones that
 * show on every character). For character-specific modes the user
 * uses the per-character editor inside the character sheet's
 * Conditions+Modes modal — both reuse the same ModeEditor component
 * so the form behavior stays in one place.
 */
function ModesSettings() {
  // Track the saved list in state so renders refresh after edits.
  // localStorage isn't reactive, so we bump a counter when we write.
  const [, setTick] = useState(0);
  const modes = getGlobalCustomModes();
  // Either 'list' (default) or a CustomMode being edited / created.
  // `null` means "show list"; an object means the editor is open.
  const [editing, setEditing] = useState<CustomMode | null>(null);

  const refresh = () => setTick((t) => t + 1);

  const save = (m: CustomMode) => {
    // Settings page only manages globals — force scope.
    const next = { ...m, scope: 'global' as const };
    const list = getGlobalCustomModes();
    const idx = list.findIndex((x) => x.id === next.id);
    setGlobalCustomModes(
      idx >= 0 ? list.map((x) => (x.id === next.id ? next : x)) : [...list, next]
    );
    setEditing(null);
    refresh();
  };

  const remove = (m: CustomMode) => {
    if (!window.confirm(`Delete "${m.name}"? This removes it from every character.`)) return;
    setGlobalCustomModes(getGlobalCustomModes().filter((x) => x.id !== m.id));
    refresh();
  };

  if (editing) {
    // ModeEditor is the same form used inside the character sheet.
    // Wrapped in a Mantine Stack with a small dark surface so it sits
    // visually inside the accordion without looking like it floated
    // in from elsewhere.
    return (
      <Box style={{ background: 'var(--mantine-color-default-hover)' }}>
        <ModeEditor
          mode={{ ...editing, scope: 'global' }}
          onCancel={() => setEditing(null)}
          onSave={save}
        />
      </Box>
    );
  }

  return (
    <Stack gap='sm'>
      <Text size='xs' c='dimmed'>
        Modes saved here apply to every character. For modes tied to one
        specific character (a class-specific stance with that character's
        damage numbers), use the Modes tab inside the character sheet's
        condition picker.
      </Text>
      <Box>
        <Button
          variant='light'
          size='compact-sm'
          onClick={() =>
            setEditing({
              id: crypto.randomUUID(),
              name: '',
              description: '',
              effects: [],
              scope: 'global',
            })
          }
        >
          + Create Mode
        </Button>
      </Box>
      {modes.length === 0 ? (
        <Text size='sm' c='dimmed' fs='italic'>
          No global modes yet. Click "Create Mode" to make one.
        </Text>
      ) : (
        <Stack gap={6}>
          {modes.map((m) => (
            <Box
              key={m.id}
              style={{
                padding: 10,
                border: '1px solid var(--mantine-color-default-border)',
              }}
            >
              <Group justify='space-between' align='flex-start' wrap='nowrap'>
                <Box style={{ flex: 1 }}>
                  <Text fw={600}>{m.name || '(unnamed)'}</Text>
                  {m.description && (
                    <Text size='xs' c='dimmed' lh={1.4}>
                      {m.description}
                    </Text>
                  )}
                  {m.effects.length > 0 && (
                    <Text size='xs' c='dimmed' mt={4}>
                      {m.effects
                        .map(
                          (e) =>
                            `${e.value >= 0 ? '+' : ''}${e.value} ${targetLabelForVariable(e.variable)}${
                              e.type && e.type !== 'untyped' ? ` (${e.type})` : ''
                            }`
                        )
                        .join(', ')}
                    </Text>
                  )}
                </Box>
                <Group gap={6} wrap='nowrap'>
                  <Button
                    size='compact-xs'
                    variant='subtle'
                    onClick={() => setEditing(m)}
                  >
                    Edit
                  </Button>
                  <Button
                    size='compact-xs'
                    variant='subtle'
                    color='red'
                    onClick={() => remove(m)}
                  >
                    Delete
                  </Button>
                </Group>
              </Group>
            </Box>
          ))}
        </Stack>
      )}
    </Stack>
  );
}
