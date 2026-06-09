/* Shared two-bar codex top header — used on every full-screen page (Characters,
 * Homebrew, Settings, …) EXCEPT the character sheet + builder, which keep their
 * own headers.
 *
 *   Bar 1 (.winbar)      — brand · subtitle on the left, an optional tagline in
 *                          the centre, the working min / max / close window
 *                          controls on the right. This bar is the frameless
 *                          window's drag region (see `.wg4 .winbar` in
 *                          wg4-atlas.css; the buttons opt out via no-drag).
 *   Bar 2 (.app-header)  — the brand sigil + name on the left, the hamburger
 *                          nav menu on the right.
 *
 * Lifted verbatim from the Atlas page's inline header so the look is identical
 * everywhere; the `.winbar` / `.app-header` / `.brand-line` / `.nav-menu`
 * classes live in wg4-atlas.css and are `.wg4`-scoped, so this renders correctly
 * on any page whose root carries `.wg4`.
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

export function CodexTopBars(props: { subtitle: string; tagline?: string }) {
  const w = (
    window as unknown as {
      wgElectron?: {
        windowMinimize?: () => void;
        windowMaximize?: () => void;
        windowClose?: () => void;
      };
    }
  ).wgElectron;

  return (
    <>
      {/* Bar 1 — window chrome. */}
      <div className='winbar'>
        <div className='brand'>
          <span className='mark'></span>
          <span className='name'>
            Wanderer's <em>Codex</em>
            {props.subtitle ? ` · ${props.subtitle}` : ''}
          </span>
        </div>
        {props.tagline ? <div className='center'>{props.tagline}</div> : null}
        <div className='wbtns'>
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

      {/* Bar 2 — brand sigil + hamburger nav. */}
      <div className='app-header'>
        <div className='brand-line'>
          <span className='sigil' aria-hidden='true'>
            ❦
          </span>
          <span className='bn'>{props.subtitle}</span>
        </div>
        <CodexNavMenu />
      </div>
    </>
  );
}

/**
 * Hamburger nav menu (bar 2, right). Wraps itself in a relative-positioned span
 * so the dropdown anchors to the button. Click-outside closes. Lifted from the
 * Atlas page's CharactersNavMenu.
 */
function CodexNavMenu() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [ref, setRef] = useState<HTMLSpanElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const onDocMouseDown = (e: MouseEvent) => {
      if (ref && !ref.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, [open, ref]);

  const items = [
    { label: 'Characters', path: '/characters' },
    { label: 'Homebrew', path: '/homebrew' },
    { label: 'Settings', path: '/account' },
  ];

  return (
    <span ref={setRef} className='nav-menu-wrap'>
      <button
        type='button'
        className='nav-menu'
        title='Open menu'
        aria-label='Menu'
        aria-expanded={open}
        aria-haspopup='menu'
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
      >
        <svg viewBox='0 0 16 16' fill='none' stroke='currentColor' strokeWidth='1.5' strokeLinecap='round'>
          <line x1='3' y1='5' x2='13' y2='5' />
          <line x1='3' y1='8' x2='13' y2='8' />
          <line x1='3' y1='11' x2='13' y2='11' />
        </svg>
      </button>
      {open && (
        <div role='menu' className='nav-menu-dropdown'>
          {items.map((item) => (
            <button
              key={item.path}
              type='button'
              onClick={() => {
                setOpen(false);
                navigate(item.path);
              }}
              className='nav-menu-item'
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </span>
  );
}

export default CodexTopBars;
