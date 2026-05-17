/**
 * CodexSection — collapsible `.sec` wrapper.
 *
 * The codex design uses `.sec` blocks with a `.sec-title` (lozenge +
 * label + optional sub + chevron) and a `.sec-body` underneath.
 * Clicking the title toggles the body open / closed. Chevron rotates
 * accordingly. The chevron / body-collapse rules are already in
 * codex.css under `.sec`, `.sec.collapsed .chev`, and
 * `.sec.collapsed .sec-body` — this component just owns the open
 * state and adds the `.collapsed` class.
 *
 * Click handler ignores nested interactive elements (inputs, pips,
 * buttons) so editing HP / clicking hero pips doesn't accidentally
 * collapse the section.
 */

import { useState, ReactNode, MouseEvent } from 'react';

export default function CodexSection(props: {
  /** Lozenge glyph shown left of the label (e.g. '♥', '➤', '★'). */
  lozenge?: string;
  /** Section label, all-caps in the design. */
  label: string;
  /** Optional sub text right-aligned in the title (e.g. "2 / 3"). */
  sub?: ReactNode;
  /** If true, render the compact variant (smaller title). */
  compact?: boolean;
  /** Body content. */
  children: ReactNode;
  /** Default open / closed state — defaults to open. */
  defaultCollapsed?: boolean;
  /** Optional className appended to the section. */
  className?: string;
}) {
  const [collapsed, setCollapsed] = useState(!!props.defaultCollapsed);

  const onTitleClick = (e: MouseEvent<HTMLDivElement>) => {
    // Ignore clicks on interactive children — let inputs, buttons,
    // pips (which use .pip / .fp / .dot-pip classes) do their thing
    // without also collapsing the section.
    const target = e.target as HTMLElement;
    if (
      target.closest(
        'input, button, textarea, select, a, .pip, .fp, .dot-pip, .x, .cond .x, [data-no-collapse]'
      )
    ) {
      return;
    }
    setCollapsed((c) => !c);
  };

  return (
    <section className={`sec ${collapsed ? 'collapsed' : ''} ${props.className ?? ''}`.trim()}>
      <div
        className={`sec-title${props.compact ? ' compact' : ''}`}
        onClick={onTitleClick}
      >
        {props.lozenge && <span className='lozenge'>{props.lozenge}</span>}
        <span className='label'>{props.label}</span>
        {props.sub != null && <span className='sub'>{props.sub}</span>}
        <span className='chev'></span>
      </div>
      <div className='sec-body'>{props.children}</div>
    </section>
  );
}
