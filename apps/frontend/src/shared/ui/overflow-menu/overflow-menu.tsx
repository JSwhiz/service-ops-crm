'use client';

import React, { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';

import styles from './overflow-menu.module.css';

export interface OverflowMenuItem {
  key: string;
  label: string;
  onSelect: () => void;
  tone?: 'default' | 'danger';
  disabled?: boolean;
  /** Visible explanation for an unavailable action; not hidden in a tooltip. */
  disabledReason?: string;
}

export interface OverflowMenuProps {
  items: ReadonlyArray<OverflowMenuItem>;
  triggerLabel?: string;
}

/**
 * Minimal contextual action menu (COMPONENT_CONTRACTS → OverflowMenu).
 * Danger items render last after a divider; items the user cannot perform are
 * filtered by the domain owner before they reach this component.
 */
export function OverflowMenu({
  items,
  triggerLabel = 'Другие действия',
}: OverflowMenuProps): React.JSX.Element | null {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const menuRef = useRef<HTMLDivElement>(null);
  const [alignStart, setAlignStart] = useState(false);
  const menuId = useId();

  const ordered = [
    ...items.filter((item) => item.tone !== 'danger'),
    ...items.filter((item) => item.tone === 'danger'),
  ];
  const firstDangerIndex = ordered.findIndex((item) => item.tone === 'danger');

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    queueMicrotask(() => itemRefs.current.find((item) => item && !item.disabled)?.focus());
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  useLayoutEffect(() => {
    if (!open) { setAlignStart(false); return; }
    // Keep the menu inside the viewport when the trigger sits near the left edge.
    const rect = menuRef.current?.getBoundingClientRect();
    if (rect && rect.left < 8) setAlignStart(true);
  }, [open]);

  if (ordered.length === 0) return null;

  const focusItem = (from: number, step: 1 | -1): void => {
    const enabled = itemRefs.current
      .map((node, index) => ({ node, index }))
      .filter(({ node }) => node && !node.disabled);
    if (enabled.length === 0) return;
    const position = enabled.findIndex(({ index }) => index === from);
    const next = enabled[(position + step + enabled.length) % enabled.length];
    next?.node?.focus();
  };

  const close = (): void => {
    setOpen(false);
    triggerRef.current?.focus();
  };

  return (
    <div ref={rootRef} className={styles.root}>
      <button
        ref={triggerRef}
        type="button"
        className={`ui-button ${styles.trigger}`}
        aria-label={triggerLabel}
        title={triggerLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="5" cy="12" r="1.6" />
          <circle cx="12" cy="12" r="1.6" />
          <circle cx="19" cy="12" r="1.6" />
        </svg>
      </button>

      {open ? (
        <div
          id={menuId}
          role="menu"
          aria-label={triggerLabel}
          ref={menuRef}
          className={`${styles.menu} ${alignStart ? styles.menuStart : ''}`}
          onKeyDown={(event) => {
            const current = itemRefs.current.findIndex((node) => node === document.activeElement);
            if (event.key === 'ArrowDown') { event.preventDefault(); focusItem(current, 1); }
            if (event.key === 'ArrowUp') { event.preventDefault(); focusItem(current, -1); }
            if (event.key === 'Home') { event.preventDefault(); focusItem(-1, 1); }
            if (event.key === 'End') { event.preventDefault(); focusItem(ordered.length, -1); }
            if (event.key === 'Escape') { event.preventDefault(); close(); }
            if (event.key === 'Tab') setOpen(false);
          }}
        >
          {ordered.map((item, index) => (
            <React.Fragment key={item.key}>
              {index === firstDangerIndex && index > 0 ? (
                <div role="separator" className={styles.divider} />
              ) : null}
              <button
                ref={(node) => { itemRefs.current[index] = node; }}
                type="button"
                role="menuitem"
                tabIndex={-1}
                disabled={item.disabled}
                className={`${styles.item} ${item.tone === 'danger' ? styles.danger : ''}`}
                onClick={() => {
                  // Close first so a dialog opened by onSelect owns focus.
                  setOpen(false);
                  item.onSelect();
                }}
              >
                <span>{item.label}</span>
                {item.disabled && item.disabledReason ? (
                  <span className={styles.reason}>{item.disabledReason}</span>
                ) : null}
              </button>
            </React.Fragment>
          ))}
        </div>
      ) : null}
    </div>
  );
}
