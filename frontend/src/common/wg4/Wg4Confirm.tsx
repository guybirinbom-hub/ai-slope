// Wg4Confirm — wg4-styled replacement for modals.openConfirmModal.
//
// Registered as a context modal in App.tsx (key 'wg4Confirm') and
// invoked via `openWg4Confirm(opts)`. Renders the parchment chrome
// (italic Newsreader title, soft footer with two buttons) the
// designer drew for ConfirmationPrompt in modals.jsx.
//
// Signature mirrors Mantine's openConfirmModal so callsites can
// swap one-for-one:
//
//   openWg4Confirm({
//     id: 'delete-character',
//     title: 'Delete Character',
//     children: <>Are you sure?</>,
//     labels: { confirm: 'Delete', cancel: 'Cancel' },
//     confirmVariant: 'danger',
//     onConfirm: () => {…},
//   });

import { ContextModalProps, modals, openContextModal } from '@mantine/modals';
import React from 'react';

export interface Wg4ConfirmProps {
  title: React.ReactNode;
  children: React.ReactNode;
  labels?: { confirm?: string; cancel?: string };
  confirmVariant?: 'primary' | 'danger';
  onConfirm?: () => void;
  onCancel?: () => void;
}

export function Wg4ConfirmModal({ context, id, innerProps }: ContextModalProps<Wg4ConfirmProps>) {
  const confirmLabel = innerProps.labels?.confirm ?? 'Confirm';
  const cancelLabel = innerProps.labels?.cancel ?? 'Cancel';
  const variantClass = innerProps.confirmVariant === 'danger' ? 'wg4-btn danger' : 'wg4-btn primary';

  const close = () => context.closeModal(id);

  return (
    <div className='wg4'>
      <div className='wg4-modal-body' style={{ padding: '4px 0 0' }}>
        <div className='wg4-prose' style={{ fontSize: 14, color: 'var(--wg4-ink-2)' }}>
          {innerProps.children}
        </div>
      </div>
      <div className='wg4-modal-foot' style={{ marginTop: 18, marginInline: -24, marginBottom: -16 }}>
        <div style={{ flex: 1 }} />
        <button
          className='wg4-btn'
          onClick={() => {
            innerProps.onCancel?.();
            close();
          }}
        >
          {cancelLabel}
        </button>
        <button
          className={variantClass}
          onClick={() => {
            innerProps.onConfirm?.();
            close();
          }}
        >
          {confirmLabel}
        </button>
      </div>
    </div>
  );
}

/**
 * Drop-in replacement for `modals.openConfirmModal({...})`. Render
 * a wg4-styled confirmation prompt with the same shape of options.
 */
export function openWg4Confirm(opts: Wg4ConfirmProps & { id?: string }) {
  // Close any previously-opened wg4Confirm with the same id so we
  // don't stack duplicates (matches openConfirmModal's behavior when
  // an id is passed).
  if (opts.id) {
    try { modals.close(opts.id); } catch {}
  }
  openContextModal({
    modal: 'wg4Confirm',
    modalId: opts.id,
    title: (
      <span
        style={{
          fontFamily: 'Newsreader, ui-serif, Georgia, serif',
          fontStyle: 'italic',
          fontWeight: 500,
          fontSize: 22,
          color: 'var(--wg4-ink, #1a1a1a)',
          letterSpacing: '-0.01em',
        }}
      >
        {opts.title}
      </span>
    ),
    centered: true,
    radius: 10,
    size: 'sm',
    classNames: {
      root: 'wg4',
      content: 'wg4-modal-styled',
      header: 'wg4-modal-styled-head',
    },
    styles: {
      content: {
        backgroundColor: 'var(--wg4-surface, #f6f3eb)',
        border: '1px solid var(--wg4-border, #d8d3c4)',
        boxShadow: '0 1px 0 rgba(20,20,20,.02), 0 6px 20px rgba(20,20,20,.06), 0 18px 60px rgba(20,20,20,.05)',
      },
      header: {
        backgroundColor: 'var(--wg4-surface, #f6f3eb)',
        borderBottom: '1px solid var(--wg4-border-soft, #e0dbcd)',
        padding: '16px 22px 14px',
      },
      body: {
        padding: '14px 22px 16px',
        backgroundColor: 'var(--wg4-surface, #f6f3eb)',
      },
      close: {
        color: 'var(--wg4-ink-3, #6b6962)',
      },
    },
    innerProps: opts,
  });
}
