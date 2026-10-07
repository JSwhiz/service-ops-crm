'use client';

import { useLayoutEffect, useState } from 'react';
import type { RefObject } from 'react';

export type PopoverPlacement = 'bottom' | 'top';

interface PopoverPosition {
  placement: PopoverPlacement;
  availableHeight: number;
}

const VIEWPORT_GAP = 12;
const TRIGGER_GAP = 6;

export function usePopoverPlacement(
  open: boolean,
  anchorRef: RefObject<HTMLElement | null>,
  popoverRef: RefObject<HTMLElement | null>,
  preferredMaxHeight = 340,
): PopoverPosition {
  const [position, setPosition] = useState<PopoverPosition>({
    placement: 'bottom',
    availableHeight: preferredMaxHeight,
  });

  useLayoutEffect(() => {
    if (!open) return undefined;

    const updatePosition = (): void => {
      const anchor = anchorRef.current;
      const popover = popoverRef.current;
      if (!anchor || !popover) return;

      const rect = anchor.getBoundingClientRect();
      const desiredHeight = Math.min(popover.scrollHeight, preferredMaxHeight);
      let boundaryTop = VIEWPORT_GAP;
      let boundaryBottom = window.innerHeight - VIEWPORT_GAP;
      for (let ancestor = anchor.parentElement; ancestor && ancestor !== document.body; ancestor = ancestor.parentElement) {
        const overflowY = window.getComputedStyle(ancestor).overflowY;
        if (!/(auto|scroll|hidden|clip)/.test(overflowY)) continue;
        const ancestorRect = ancestor.getBoundingClientRect();
        boundaryTop = Math.max(boundaryTop, ancestorRect.top + VIEWPORT_GAP);
        boundaryBottom = Math.min(boundaryBottom, ancestorRect.bottom - VIEWPORT_GAP);
      }
      const spaceBelow = Math.max(
        0,
        boundaryBottom - rect.bottom - TRIGGER_GAP,
      );
      const spaceAbove = Math.max(
        0,
        rect.top - TRIGGER_GAP - boundaryTop,
      );
      const placement: PopoverPlacement =
        spaceBelow >= desiredHeight || spaceBelow >= spaceAbove
          ? 'bottom'
          : 'top';
      const availableSpace = placement === 'bottom' ? spaceBelow : spaceAbove;
      const availableHeight = Math.max(
        96,
        Math.min(preferredMaxHeight, availableSpace),
      );

      setPosition((current) =>
        current.placement === placement &&
        current.availableHeight === availableHeight
          ? current
          : { placement, availableHeight },
      );
    };

    updatePosition();
    const observer = new ResizeObserver(updatePosition);
    if (popoverRef.current) observer.observe(popoverRef.current);
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);

    return () => {
      observer.disconnect();
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [anchorRef, open, popoverRef, preferredMaxHeight]);

  return position;
}
