'use client';

import React, { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import styles from './chat-ui.module.css';

/** Presentation only: stays outside the scrolling/clipped message surface. */
export function ChatMessageMenu({
  messageId,
  onClose,
  children,
}: {
  messageId: string;
  onClose: () => void;
  children: React.ReactNode;
}): React.JSX.Element {
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<React.CSSProperties>({
    visibility: 'hidden',
  });

  useLayoutEffect(() => {
    const menu = menuRef.current;
    const anchor = document.querySelector<HTMLElement>(
      `[data-message-id="${CSS.escape(messageId)}"]`,
    );
    if (!menu || !anchor) return;
    const place = (): void => {
      const rect = anchor.getBoundingClientRect();
      const viewport = window.visualViewport;
      const top = viewport?.offsetTop ?? 0;
      const height = viewport?.height ?? window.innerHeight;
      const width = viewport?.width ?? window.innerWidth;
      const menuHeight = Math.min(menu.scrollHeight, height - 24);
      const menuWidth = Math.min(240, width - 24);
      const mobile = width <= 640;
      const below = rect.top + 38;
      setPosition({
        visibility: 'visible',
        width: mobile ? width - 24 : menuWidth,
        maxHeight: height - 24,
        left: mobile
          ? 12
          : Math.max(
              12,
              Math.min(rect.right - menuWidth, width - menuWidth - 12),
            ),
        top: mobile
          ? top + height - menuHeight - 16
          : Math.max(
              top + 12,
              Math.min(
                below + menuHeight > top + height - 12
                  ? rect.top - menuHeight - 6
                  : below,
                top + height - menuHeight - 12,
              ),
            ),
      });
    };
    place();
    const focusFrame = window.requestAnimationFrame(() =>
      menu
        .querySelector<HTMLButtonElement>('button')
        ?.focus({ preventScroll: true }),
    );
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    window.visualViewport?.addEventListener('resize', place);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
      window.visualViewport?.removeEventListener('resize', place);
    };
  }, [messageId]);

  return createPortal(
    <div
      ref={menuRef}
      className={`chat-message-menu ${styles.messageMenu}`}
      style={position}
      role="menu"
      aria-label="Действия с сообщением"
      onKeyDown={(event) => {
        const items = Array.from(
          event.currentTarget.querySelectorAll<HTMLButtonElement>(
            'button:not(:disabled)',
          ),
        );
        const index = items.indexOf(
          document.activeElement as HTMLButtonElement,
        );
        if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
          event.preventDefault();
          const next =
            event.key === 'Home'
              ? 0
              : event.key === 'End'
                ? items.length - 1
                : (index +
                    (event.key === 'ArrowDown' ? 1 : -1) +
                    items.length) %
                  items.length;
          items[next]?.focus();
        } else if (event.key === 'Escape' || event.key === 'Tab') {
          if (event.key === 'Escape') event.preventDefault();
          document
            .querySelector<HTMLButtonElement>(
              `[data-message-id="${CSS.escape(messageId)}"] .chat-message__more`,
            )
            ?.focus({ preventScroll: true });
          onClose();
        }
      }}
    >
      {children}
    </div>,
    document.body,
  );
}
