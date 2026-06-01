import { ColorSwatch, Popover, ColorPicker, Loader, Slider } from '@mantine/core';
import { setPageTitle } from '@utils/document-change';
import { useMutation, useQuery } from '@tanstack/react-query';
import { getPublicUser } from '@auth/user-manager';
import { GUIDE_BLUE } from '@constants/data';
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
      <div className='wg4 wg4-screen wg4-page-root' style={{ position: 'relative', minHeight: '100%' }}>
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
      </div>
    );

  return <ProfileSection />;
}

/** A single parchment accordion section (header + collapsible body). */
function AccItem({
  icon,
  iconColor,
  title,
  open,
  onToggle,
  children,
}: {
  icon: React.ReactNode;
  iconColor?: string;
  title: string;
  open: boolean;
  onToggle: () => void;
  children?: React.ReactNode;
}) {
  return (
    <div className={`acc-item${open ? ' open' : ''}`}>
      <div className='acc-head' onClick={onToggle}>
        <span className='ic' style={iconColor ? { color: iconColor } : undefined}>
          {icon}
        </span>
        {title}
        <span className='chev'>▸</span>
      </div>
      {open && <div className='acc-body'>{children}</div>}
    </div>
  );
}

/** Parchment setting row: label + description on the left, control on the right. */
function SettingRow({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className='row'>
      <div className='g'>
        <div className='nm'>{label}</div>
        {description && <div className='ds'>{description}</div>}
      </div>
      <div>{children}</div>
    </div>
  );
}

function ProfileSection() {
  const [_user, setUser] = useAtom(userState);

  // User should always be defined here
  const user = _user!;
  if (!user) {
    throw new Error('User is not defined');
  }

  // Which accordion section is open. Mirrors the mockup where one section
  // is expanded at a time; `''` means all collapsed.
  const [openSection, setOpenSection] = useState<string>('appearance');
  const toggle = (key: string) => setOpenSection((cur) => (cur === key ? '' : key));

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
    <div
      className='wg4 wg4-screen wg4-page-root'
      style={{ display: 'flex', justifyContent: 'center', padding: 16, minHeight: '100%' }}
    >
      <div style={{ width: '100%', maxWidth: 460 }}>
        {/* Local-only build: stripped the profile/avatar/name/summary/stats/
            badges/Patreon-connect/GM-tier-share blocks. None of those apply
            to a single local user, so the page is just the settings
            accordion (Appearance + Developer + Modes + Uninstall) below. */}
        <div className='acc'>
          {/* Appearance */}
          <AccItem
            icon='◈'
            title='Appearance'
            open={openSection === 'appearance'}
            onToggle={() => toggle('appearance')}
          >
            <SettingRow label='Theme Color' description='Primary accent color for the site'>
              <Popover position='bottom-end' withArrow shadow='md'>
                <Popover.Target>
                  <ColorSwatch
                    className='swatch'
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
              <button
                type='button'
                className={`sw${user.site_theme?.dyslexia_font ? ' on' : ''}`}
                aria-pressed={user.site_theme?.dyslexia_font ?? false}
                aria-label='Toggle dyslexia font'
                onClick={() => {
                  setUser((prev) => {
                    if (!prev) return prev;
                    return {
                      ...prev,
                      site_theme: { ...prev.site_theme, dyslexia_font: !prev.site_theme?.dyslexia_font },
                    };
                  });
                }}
              />
            </SettingRow>

            <div className='row' style={{ display: 'block', borderBottom: 0 }}>
              <div className='nm' style={{ marginBottom: 6 }}>
                UI Size
              </div>
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
                color='var(--wg4-accent)'
                onChange={(value) => {
                  setUser((prev) => {
                    if (!prev) return prev;
                    return { ...prev, site_theme: { ...prev.site_theme, zoom: value } };
                  });
                }}
              />
            </div>
          </AccItem>

          {/* Developer */}
          <AccItem
            icon='⟨⟩'
            title='Developer'
            open={openSection === 'developer'}
            onToggle={() => toggle('developer')}
          >
            <SettingRow label='View Operations' description='Show operation data on content entries'>
              <button
                type='button'
                className={`sw${user.site_theme?.view_operations ? ' on' : ''}`}
                aria-pressed={user.site_theme?.view_operations ?? false}
                aria-label='Toggle view operations'
                onClick={() => {
                  setUser((prev) => {
                    if (!prev) return prev;
                    return {
                      ...prev,
                      site_theme: { ...prev.site_theme, view_operations: !prev.site_theme?.view_operations },
                    };
                  });
                }}
              />
            </SettingRow>

            {/* Local-only build: dropped the "API Clients" block.
                The upstream Developer accordion let you mint API keys
                for third-party tooling against the public WG API — no
                such API exists on the local backend. */}
          </AccItem>

          {/* Modes — manage user-created modes. This page only
              surfaces *global* modes (the ones that show up on
              every character); character-specific modes still live
              on the character sheet's Conditions+Modes modal.
              Storage is localStorage; no network round-trip. */}
          <AccItem icon='◐' title='Modes' open={openSection === 'modes'} onToggle={() => toggle('modes')}>
            <ModesSettings />
          </AccItem>

          {/* Danger Zone: full uninstall (wipes pg data + the app
              binary itself). No remote state to worry about — every
              byte the app ever wrote lives in either userData or
              the install directory, and the IPC handler wipes both. */}
          <AccItem
            icon='⚠'
            iconColor='var(--danger)'
            title='Uninstall'
            open={openSection === 'danger'}
            onToggle={() => toggle('danger')}
          >
            <p className='muted' style={{ fontSize: 12.5, margin: '2px 0 12px' }}>
              Permanently delete <b>everything</b> — every character, homebrew bundle, custom pack, and the app
              itself. The window will close once the wipe starts; there is no undo.
            </p>
            <button
              type='button'
              className='btn danger'
              onClick={() => {
                modals.openConfirmModal({
                  id: 'uninstall-app',
                  title: <span style={{ fontWeight: 600 }}>Uninstall Wanderer's Guide?</span>,
                  children: (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <span style={{ fontSize: 14 }}>This will delete:</span>
                      <ul style={{ paddingLeft: 20, margin: 0, fontSize: 14 }}>
                        <li>Every character on this machine</li>
                        <li>Every homebrew bundle and custom pack you've imported</li>
                        <li>The local database and uploaded images</li>
                        <li>The Wanderer's Guide app itself</li>
                      </ul>
                      <span style={{ fontSize: 14, color: 'var(--danger)', fontWeight: 500 }}>
                        This cannot be undone.
                      </span>
                    </div>
                  ),
                  labels: { confirm: 'Delete Everything', cancel: 'Cancel' },
                  confirmProps: { color: 'red' },
                  onConfirm: async () => {
                    if (!window.wgElectron) {
                      // Dev-server / browser fallback — no Electron
                      // bridge available, so nothing to nuke.
                      showNotification({
                        title: 'Uninstall unavailable',
                        message: 'The uninstall hook is only wired up in the packaged Electron app.',
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
              🗑 Uninstall the app
            </button>
          </AccItem>
        </div>
      </div>
    </div>
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
    setGlobalCustomModes(idx >= 0 ? list.map((x) => (x.id === next.id ? next : x)) : [...list, next]);
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
    return (
      <ModeEditor mode={{ ...editing, scope: 'global' }} onCancel={() => setEditing(null)} onSave={save} />
    );
  }

  return (
    <div>
      <p className='muted' style={{ fontSize: 12, margin: '2px 0 12px' }}>
        Modes saved here apply to every character. For modes tied to one specific character (a class-specific
        stance with that character's damage numbers), use the Modes tab inside the character sheet's condition
        picker.
      </p>
      <button
        type='button'
        className='btn ghost sm'
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
      </button>
      {modes.length === 0 ? (
        <p className='muted' style={{ fontSize: 13, fontStyle: 'italic', marginTop: 12 }}>
          No global modes yet. Click "Create Mode" to make one.
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 10 }}>
          {modes.map((m) => (
            <div
              key={m.id}
              style={{
                border: '1px solid var(--border)',
                borderRadius: 'var(--r2)',
                padding: 10,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600 }}>{m.name || '(unnamed)'}</div>
                  {m.description && (
                    <div className='muted' style={{ fontSize: 11.5, lineHeight: 1.4 }}>
                      {m.description}
                    </div>
                  )}
                  {m.effects.length > 0 && (
                    <div className='muted' style={{ fontSize: 11.5, marginTop: 4 }}>
                      {m.effects
                        .map(
                          (e) =>
                            `${e.value >= 0 ? '+' : ''}${e.value} ${targetLabelForVariable(e.variable)}${
                              e.type && e.type !== 'untyped' ? ` (${e.type})` : ''
                            }`
                        )
                        .join(', ')}
                    </div>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button type='button' className='btn ghost sm' onClick={() => setEditing(m)}>
                    Edit
                  </button>
                  <button type='button' className='btn danger sm' onClick={() => remove(m)}>
                    Delete
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
