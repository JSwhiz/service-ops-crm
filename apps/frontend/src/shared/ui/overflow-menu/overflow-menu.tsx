'use client';

import React, { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';

import { getMenuBoundaryIndex } from './overflow-menu-navigation';
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
  /** Lets a containing row invoke the same visible menu for context gestures. */
  triggerRef?: React.MutableRefObject<HTMLButtonElement | null>;
}

/**
 * Minimal contextual action menu (COMPONENT_CONTRACTS → OverflowMenu).
 * Danger items render last after a divider; items the user cannot perform are
 * filtered by the domain owner before they reach this component.
 */
export function OverflowMenu({
  items,
  triggerLabel = 'Другие действия',
  triggerRef,
}: OverflowMenuProps): React.JSX.Element | null {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const internalTriggerRef = useRef<HTMLButtonElement | null>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const menuRef = useRef<HTMLDivElement>(null);
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
    const onExternalScroll = (event: Event): void => {
      if (!menuRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onResize = (): void => setOpen(false);
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('scroll', onExternalScroll, true);
    window.addEventListener('resize', onResize);
    queueMicrotask(() => itemRefs.current.find((item) => item && !item.disabled)?.focus());
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('scroll', onExternalScroll, true);
      window.removeEventListener('resize', onResize);
    };
  }, [open]);

  useLayoutEffect(() => {
    if (!open) return;
    const menu = menuRef.current;
    const trigger = internalTriggerRef.current;
    if (!menu || !trigger) return;
    if (typeof menu.showPopover === 'function' && !menu.matches(':popover-open')) {
      menu.showPopover();
    }

    let bounds = { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight };
    for (let ancestor = trigger.parentElement; ancestor; ancestor = ancestor.parentElement) {
      const overflowY = window.getComputedStyle(ancestor).overflowY;
      if (overflowY === 'auto' || overflowY === 'scroll') {
        const rect = ancestor.getBoundingClientRect();
        bounds = {
          left: Math.max(bounds.left, rect.left),
          top: Math.max(bounds.top, rect.top),
          right: Math.min(bounds.right, rect.right),
          bottom: Math.min(bounds.bottom, rect.bottom),
        };
        break;
      }
    }
    const padding = 8;
    const availableWidth = Math.max(0, bounds.right - bounds.left - padding * 2);
    menu.style.maxHeight = `${Math.max(0, bounds.bottom - bounds.top - padding * 2)}px`;
    menu.style.maxWidth = `${availableWidth}px`;
    menu.style.minWidth = `${Math.min(232, availableWidth)}px`;
    const triggerRect = trigger.getBoundingClientRect();
    const menuRect = menu.getBoundingClientRect();
    const availableHeight = Math.max(0, bounds.bottom - bounds.top - padding * 2);
    const height = Math.min(menuRect.height, availableHeight);
    const belowTop = triggerRect.bottom + padding;
    const aboveTop = triggerRect.top - height - padding;
    const top = belowTop + height <= bounds.bottom - padding
      ? belowTop
      : aboveTop >= bounds.top + padding
        ? aboveTop
        : Math.min(bounds.bottom - height - padding, Math.max(bounds.top + padding, belowTop));
    const left = Math.min(
      bounds.right - menuRect.width - padding,
      Math.max(bounds.left + padding, triggerRect.right - menuRect.width),
    );
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
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

  const focusBoundary = (last: boolean): void => {
    const enabledIndexes = itemRefs.current.flatMap((node, index) => node && !node.disabled ? [index] : []);
    const targetIndex = getMenuBoundaryIndex(enabledIndexes, last);
    if (targetIndex !== null) itemRefs.current[targetIndex]?.focus();
  };

  const close = (): void => {
    setOpen(false);
    internalTriggerRef.current?.focus();
  };

  return (
    <div ref={rootRef} className={styles.root}>
      <button
        ref={(node) => {
          if (triggerRef) triggerRef.current = node;
          internalTriggerRef.current = node;
        }}
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
          popover="manual"
          role="menu"
          aria-label={triggerLabel}
          ref={menuRef}
          className={styles.menu}
          onKeyDown={(event) => {
            const current = itemRefs.current.findIndex((node) => node === document.activeElement);
            if (event.key === 'ArrowDown') { event.preventDefault(); focusItem(current, 1); }
            if (event.key === 'ArrowUp') { event.preventDefault(); focusItem(current, -1); }
            if (event.key === 'Home') { event.preventDefault(); focusBoundary(false); }
            if (event.key === 'End') { event.preventDefault(); focusBoundary(true); }
            if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
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
