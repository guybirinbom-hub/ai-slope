// wg4 primitives — shared React components for the parchment
// redesign. Mirrors the design vocabulary in D:/Inst/wg4/drawers.jsx
// (DrawerTitle, TraitsDisplay, IndentedText, Lbl, RichText, Divider)
// plus a stat-breakdown table for the StatXDrawer family.
//
// All output is plain HTML so the styling is owned by css/wg4.css —
// no Mantine theme dependency. The components only render meaningful
// markup when given content; absent props collapse to null so
// consumers can shovel optional metadata in without nullish guards.

import React from 'react';
import { ActionSymbol } from '@common/Actions';
import { ActionCost } from '@schemas/content';

export const Wg4 = {
  /* Inline action glyph (1 / 2 / 3 actions, Free, Reaction).
   * Reuses the existing Pathfinder2eActions font from index.css. */
  ActionGlyph(props: { cost: ActionCost | null | undefined; size?: number }) {
    if (!props.cost) return null;
    // ActionSymbol's `size` is forwarded to Mantine's Text fz prop
    // which expects a string token or a px number passed via fz —
    // we pass via fz directly to skip the size-token narrowing.
    return (
      <span className='wg4-ag-wrap'>
        <ActionSymbol cost={props.cost} fz={props.size ?? 22} c='var(--wg4-ink)' />
      </span>
    );
  },

  /* Drawer head — eyebrow + italic-serif title + optional action
   * glyph + optional right-side meta or button. */
  DrawerHead(props: {
    eyebrow?: React.ReactNode;
    title: React.ReactNode;
    cost?: ActionCost | null;
    rightMeta?: React.ReactNode;
    rightButton?: React.ReactNode;
  }) {
    return (
      <div className='wg4-drawer-head'>
        <div className='title-cluster'>
          {props.eyebrow && <span className='eyebrow'>{props.eyebrow}</span>}
          <span className='title'>
            {props.title}
            {props.cost && <Wg4.ActionGlyph cost={props.cost} size={20} />}
          </span>
        </div>
        {props.rightButton ?? (props.rightMeta && <span className='right-meta'>{props.rightMeta}</span>)}
      </div>
    );
  },

  /* Traits row — rust-soft pills with uppercase text. Rarity
   * (Common / Uncommon / Rare) sits first; the rest follow as
   * regular pills. School pills use a neutral palette. */
  Traits(props: {
    rarity?: 'COMMON' | 'UNCOMMON' | 'RARE' | 'UNIQUE' | string;
    traits?: string[];
    schoolTraits?: string[];
  }) {
    const { rarity, traits = [], schoolTraits = [] } = props;
    if (!rarity && traits.length === 0 && schoolTraits.length === 0) return null;
    const rarityNorm = String(rarity ?? '').toUpperCase();
    const rarityClass =
      rarityNorm === 'UNCOMMON' ? 'wg4-trait uncommon'
        : rarityNorm === 'RARE' ? 'wg4-trait rare'
          : rarityNorm === 'UNIQUE' ? 'wg4-trait rare'
            : 'wg4-trait';
    return (
      <div className='wg4-traits-row'>
        {rarity && rarityNorm !== 'COMMON' && (
          <span className={rarityClass}>{toTitle(rarityNorm)}</span>
        )}
        {traits.map((t, i) => (
          <span key={`t-${i}`} className='wg4-trait'>{toTitle(t)}</span>
        ))}
        {schoolTraits.map((t, i) => (
          <span key={`s-${i}`} className='wg4-trait school'>{toTitle(t)}</span>
        ))}
      </div>
    );
  },

  /* One indented "<Lbl>key</Lbl> value" metadata line. */
  Indent(props: { children: React.ReactNode }) {
    return <div className='wg4-indent'>{props.children}</div>;
  },

  /* Bold label inside an Indent line. */
  Lbl(props: { children: React.ReactNode }) {
    return <span className='wg4-lbl'>{props.children}</span>;
  },

  /* Horizontal rule. */
  Divider() {
    return <div className='wg4-divider' />;
  },

  /* Newsreader serif body text. Pass raw text or an array of paragraphs. */
  Prose(props: { children: React.ReactNode }) {
    return <div className='wg4-prose'>{props.children}</div>;
  },

  /* Source attribution line ("Source: <b>Player Core</b>"). */
  Source(props: { name?: string | null }) {
    if (!props.name) return null;
    return (
      <div className='wg4-source'>
        Source: <b>{props.name}</b>
      </div>
    );
  },

  /* Drawer wrapper — chrome + scrollable body. Pass head as the
   * first child or via the `head` prop; body content is children. */
  Drawer(props: { head: React.ReactNode; children: React.ReactNode }) {
    return (
      <div className='wg4-drawer'>
        {props.head}
        <div className='wg4-drawer-body'>{props.children}</div>
      </div>
    );
  },

  /* StatHero strip — big rust-mono value + meta + optional Roll
   * button. Used at the top of every stat-breakdown drawer. */
  StatHero(props: {
    value: React.ReactNode;
    metaLabel?: React.ReactNode;
    metaValue?: React.ReactNode;
    onRoll?: () => void;
    rollLabel?: string;
  }) {
    return (
      <div className='wg4-stat-hero'>
        <div className='big'>{props.value}</div>
        <div>
          {props.metaLabel && <div className='meta'>{props.metaLabel}</div>}
          {props.metaValue && <div className='meta v'>{props.metaValue}</div>}
        </div>
        {props.onRoll && (
          <button className='wg4-roll-btn' onClick={props.onRoll}>{props.rollLabel ?? 'Roll'}</button>
        )}
      </div>
    );
  },

  /* StatBreakdown rows table — each row = source + label + signed value.
   * Last row should set `total: true` for the bold underline style. */
  StatBreakdown(props: {
    rows: { label: React.ReactNode; source?: React.ReactNode; value: React.ReactNode; sign?: 'pos' | 'neg'; total?: boolean }[];
  }) {
    return (
      <div className='wg4-breakdown'>
        {props.rows.map((r, i) => (
          <div key={i} className={'br-row' + (r.total ? ' total' : '')}>
            <div className='k'>{r.label}</div>
            <div className='src'>{r.source}</div>
            <div className={'v' + (r.sign ? ' ' + r.sign : '')}>{r.value}</div>
          </div>
        ))}
      </div>
    );
  },
};

/* Best-effort title-case for trait names that may come in as
 * UPPER_SNAKE or kebab-case or lowercase. Used by Traits row. */
function toTitle(s: string) {
  return s
    .toLowerCase()
    .replace(/[_-]/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
