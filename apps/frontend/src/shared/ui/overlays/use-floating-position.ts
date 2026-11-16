'use client';

import { useContext, useLayoutEffect, useState, type RefObject } from 'react';
import { AccessSnapshotBlockedContext } from '@/shared/auth/access-snapshot-boundary';
import { getFloatingPosition, type FloatingPosition } from './floating-position';

export function useFloatingPosition(
  open: boolean,
  anchorRef: RefObject<HTMLElement | null>,
  floatingRef: RefObject<HTMLElement | null>,
  matchAnchorWidth = false,
): FloatingPosition | null {
  const accessBlocked = useContext(AccessSnapshotBlockedContext);
  const [position, setPosition] = useState<FloatingPosition | null>(null);

  useLayoutEffect(() => {
    if (!open || accessBlocked) return;
    const floating = floatingRef.current;
    if (!floating) return;
    // The dialog's DOM still owns focus, while the top layer escapes scroll clipping.
    const nativePopover = typeof floating.showPopover === 'function';
    if (nativePopover && !floating.matches(':popover-open')) floating.showPopover();
    const update = (): void => {
      const anchor = anchorRef.current;
      if (!anchor) return;
      const anchorRect = anchor.getBoundingClientRect();
      if (matchAnchorWidth) floating.style.width = `${Math.min(anchorRect.width, Math.max(0, window.innerWidth - 24))}px`;
      const next = getFloatingPosition(anchorRect, {
        width: floating.offsetWidth,
        height: floating.scrollHeight,
      }, { width: window.innerWidth, height: window.innerHeight });
      setPosition((current) => current?.left === next.left && current.top === next.top && current.maxHeight === next.maxHeight && current.placement === next.placement ? current : next);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(floating);
    if (anchorRef.current) observer.observe(anchorRef.current);
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
      if (nativePopover && floating.matches(':popover-open')) floating.hidePopover();
    };
  }, [anchorRef, floatingRef, open, accessBlocked, matchAnchorWidth]);

  return accessBlocked ? null : position;
}
