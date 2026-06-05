/* Shared codex window bar — the parchment top strip with the brand on
 * the left, an optional center label, an optional hamburger nav, and the
 * working min / max / close window controls on the right. One component
 * so every surface (loading screen, Homebrew, Settings, …) gets the exact
 * same bar as the character sheet / builder, at the same size.
 *
 * It self-wraps in `.wg4` so the `.wg4 .winbar` styling (wg4-atlas.css)
 * applies even when rendered outside a `.wg4` ancestor (e.g. the loading
 * overlay, which portals to <body>).
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

export function CodexWinBar(props: { subtitle?: string; center?: React.ReactNode; nav?: boolean }) {
  const w = (
    window as unknown as {
      wgElectron?: {
        windowMinimize?: () => void;
        windowMaximize?: () => void;
        windowClose?: () => void;
      };
    }
  ).wgElectron;
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);

  const go = (path: string) => {
    setMenuOpen(false);
    navigate(path);
  };

  return (
    <div className='wg4'>
      <div className='winbar'>
        <div className='brand'>
          <span className='mark'></span>
          <span className='name'>
            Wanderer's <em>Codex</em>
            {props.subtitle ? ` · ${props.subtitle}` : ''}
          </span>
        </div>
        {props.center != null && <div className='center'>{props.center}</div>}
        <div className='wbtns'>
          {props.nav && (
            <div style={{ position: 'relative' }}>
              <button
                className='wbtn'
                aria-label='Menu'
                title='Menu'
                onClick={() => setMenuOpen((o) => !o)}
              >
                <svg viewBox='0 0 10 10'>
                  <path d='M1 2.5 L9 2.5 M1 5 L9 5 M1 7.5 L9 7.5' />
                </svg>
              </button>
              {menuOpen && (
                <>
                  <div
                    style={{ position: 'fixed', inset: 0, zIndex: 60 }}
                    onClick={() => setMenuOpen(false)}
                  />
                  <div
                    style={{
                      position: 'absolute',
                      top: 'calc(100% + 6px)',
                      right: 0,
                      zIndex: 61,
                      minWidth: 160,
                      background: 'var(--wg4-surface, #f6f3eb)',
                      border: '1px solid var(--wg4-border, #d8d3c4)',
                      borderRadius: 6,
                      boxShadow: '0 8px 24px rgba(60,50,35,.14)',
                      padding: 5,
                    }}
                  >
                    {[
                      { label: 'Characters', path: '/characters' },
                      { label: 'Homebrew', path: '/homebrew' },
                      { label: 'Settings', path: '/account' },
                    ].map((item) => (
                      <button
                        key={item.path}
                        onClick={() => go(item.path)}
                        style={{
                          display: 'block',
                          width: '100%',
                          textAlign: 'left',
                          padding: '7px 10px',
                          border: 0,
                          background: 'transparent',
                          color: 'var(--wg4-ink-2, #3a3a37)',
                          font: 'inherit',
                          fontSize: 13,
                          borderRadius: 4,
                          cursor: 'pointer',
                        }}
                        onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--wg4-surface-hover, #ece8dd)')}
                        onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
          <button className='wbtn' aria-label='Minimize' title='Minimize' onClick={() => w?.windowMinimize?.()}>
            <svg viewBox='0 0 10 10'>
              <path d='M1 8 L9 8' />
            </svg>
          </button>
          <button className='wbtn' aria-label='Maximize' title='Maximize' onClick={() => w?.windowMaximize?.()}>
            <svg viewBox='0 0 10 10'>
              <path d='M1 1 L9 1 L9 9 L1 9 Z' />
            </svg>
          </button>
          <button className='wbtn close' aria-label='Close' title='Close' onClick={() => w?.windowClose?.()}>
            <svg viewBox='0 0 10 10'>
              <path d='M1 1 L9 9 M9 1 L1 9' />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}

export default CodexWinBar;
