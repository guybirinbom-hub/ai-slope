import { ColorInput, Group, Loader } from '@mantine/core';
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
import { makeRequest } from '@requests/request-manager';
import { modals } from '@mantine/modals';
import { showNotification } from '@mantine/notifications';
import { useAtom } from 'jotai';
import { userState } from '@atoms/userAtoms';
import { useState } from 'react';
import { CodexTopBars } from '@common/CodexTopBars';
import { applyTheme, getStoredTheme } from '@utils/theme';

export function Component() {
  setPageTitle(`Settings`);

  const [, setUser] = useAtom(userState);

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
      <div
        className='wg4 wg4-screen wg4-page-root'
        style={{ position: 'relative', minHeight: '100dvh', background: 'var(--wg4-page)' }}
      >
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

/** A codex section card: Cinzel header + accent rule + body. */
function Section({
  glyph,
  title,
  sub,
  danger,
  children,
}: {
  glyph: string;
  title: string;
  sub?: string;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={`section${danger ? ' danger' : ''}`}>
      <div className='sec-head'>
        <span className='glyph'>{glyph}</span>
        <span className='ttl'>{title}</span>
        {sub && <span className='sub'>{sub}</span>}
      </div>
      <div className='sec-body'>{children}</div>
    </div>
  );
}

/** Setting row: label + description on the left, control on the right. */
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

  // wg4 light/dark theme toggle — utils/theme.ts flips `theme-dark` on <html>
  // and persists the choice; css/wg4-dark.css does the actual recolor.
  const [darkMode, setDarkMode] = useState(getStoredTheme() === 'dark');

  // Theme colour is a draft until Save — mirrors the character builder's
  // accent picker (ColorInput + an explicit Apply), so the global accent
  // only changes when the user commits, not on every drag of the picker.
  const [draftColor, setDraftColor] = useState(user.site_theme?.color || GUIDE_BLUE);

  const { mutate: mutateUser } = useMutation({
    mutationFn: async (data: Record<string, any>) => {
      const response = await makeRequest('update-user', { ...data });
      return response;
    },
  });

  // Explicit persistence (the old debounced autosave was dropped): the
  // colour commits on Save, View Operations persists on toggle. Both write
  // the merged site_theme straight to the DB and update the live atom.
  const persistSiteTheme = (patch: Record<string, any>) => {
    const next = { ...user.site_theme, ...patch };
    setUser((prev) => (prev ? { ...prev, site_theme: next } : prev));
    mutateUser({ site_theme: next });
  };

  const saveColor = () => {
    persistSiteTheme({ color: draftColor });
    showNotification({ message: 'Theme colour saved.', color: 'green', autoClose: 1500 });
  };

  return (
    <div
      className='wg4 wg4-screen wg4-page-root'
      style={{ display: 'flex', flexDirection: 'column', minHeight: '100dvh', background: 'var(--wg4-page)' }}
    >
      {/* Shared two-bar window header — the page title shows in bar 2. */}
      <CodexTopBars subtitle='Settings' tagline='Tune the codex to your hand.' />

      <div style={{ width: '100%', maxWidth: 620, margin: '0 auto', padding: '0 20px 56px' }}>
        {/* Appearance */}
        <Section glyph='◈' title='Appearance' sub='look & feel'>
          <SettingRow label='Dark Mode' description='Switch the entire app to a dark color theme'>
            <button
              type='button'
              className={`sw${darkMode ? ' on' : ''}`}
              aria-pressed={darkMode}
              aria-label='Toggle dark mode'
              onClick={() => {
                const next = darkMode ? 'light' : 'dark';
                applyTheme(next);
                setDarkMode(next === 'dark');
              }}
            />
          </SettingRow>

          <SettingRow
            label='Theme Color'
            description='Primary accent — applied across the app and the default colour for new characters'
          >
            <Group gap={8} wrap='nowrap' align='center'>
              <ColorInput
                value={draftColor}
                onChange={setDraftColor}
                format='hex'
                size='sm'
                w={170}
                swatchesPerRow={9}
                swatches={[
                  '#b0542f',
                  '#cf6a3f',
                  '#c9a13b',
                  '#a83a25',
                  '#5b7148',
                  '#4a6987',
                  '#7a4a87',
                  '#2f855a',
                  '#b03a8a',
                ]}
                aria-label='Theme color'
              />
              <button type='button' className='btn sm' onClick={saveColor}>
                Save
              </button>
            </Group>
          </SettingRow>
        </Section>

        {/* Developer */}
        <Section glyph='⟨⟩' title='Developer' sub='under the hood'>
          <SettingRow label='View Operations' description='Show operation data on content entries'>
            <button
              type='button'
              className={`sw${user.site_theme?.view_operations ? ' on' : ''}`}
              aria-pressed={user.site_theme?.view_operations ?? false}
              aria-label='Toggle view operations'
              onClick={() => persistSiteTheme({ view_operations: !user.site_theme?.view_operations })}
            />
          </SettingRow>
        </Section>

        {/* Modes — global user modes (the ones that show on every character).
            Character-specific modes still live on the sheet's Conditions+Modes
            modal. Storage is localStorage; no network round-trip. */}
        <Section glyph='◐' title='Modes' sub='global effects'>
          <ModesSettings />
        </Section>

        {/* Danger Zone: full uninstall (wipes pg data + the app binary). */}
        <Section glyph='⚠' title='Uninstall' sub='point of no return' danger>
          <p className='danger-text'>
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
        </Section>
      </div>
    </div>
  );
}

/**
 * Settings → Modes panel. CRUD for *global* user modes (the ones that
 * show on every character). For character-specific modes the user uses
 * the per-character editor inside the character sheet's Conditions+Modes
 * modal — both reuse the same ModeEditor component so the form behavior
 * stays in one place.
 */
function ModesSettings() {
  // Track the saved list in state so renders refresh after edits.
  // localStorage isn't reactive, so we bump a counter when we write.
  const [, setTick] = useState(0);
  const modes = getGlobalCustomModes();
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
      <p className='flavor'>
        Modes saved here apply to every character. For modes tied to one character (a class-specific stance
        with that character's damage numbers), use the Modes tab inside that character's condition picker.
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
        <p className='flavor' style={{ marginTop: 12, marginBottom: 0 }}>
          No global modes yet. Click "Create Mode" to make one.
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {modes.map((m) => (
            <div key={m.id} className='mode'>
              <div style={{ flex: 1 }}>
                <div className='mname'>{m.name || '(unnamed)'}</div>
                {m.description && <div className='mdesc'>{m.description}</div>}
                {m.effects.length > 0 && (
                  <div className='eff'>
                    {m.effects.map((e, i) => (
                      <span className='chip' key={i}>
                        {`${e.value >= 0 ? '+' : ''}${e.value} ${targetLabelForVariable(e.variable)}${
                          e.type && e.type !== 'untyped' ? ` (${e.type})` : ''
                        }`}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <div className='acts'>
                <button type='button' className='btn ghost sm' onClick={() => setEditing(m)}>
                  Edit
                </button>
                <button type='button' className='btn danger sm' onClick={() => remove(m)}>
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
