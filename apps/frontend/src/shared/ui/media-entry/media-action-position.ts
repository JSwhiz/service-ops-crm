export interface MediaMenuRect {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export interface MediaMenuSize {
  width: number;
  height: number;
}

export interface MediaMenuPosition {
  left: number;
  top: number;
  placement: 'above' | 'below';
  maxHeight: number;
}

const VIEWPORT_GAP = 12;
const TRIGGER_GAP = 6;

/** Horizontally and vertically clamps the attachment menu to the safe viewport. */
export function getMediaMenuPosition(
  anchor: MediaMenuRect,
  menu: MediaMenuSize,
  viewport: { width: number; height: number; left?: number; top?: number },
): MediaMenuPosition {
  const viewportLeft = viewport.left ?? 0;
  const viewportTop = viewport.top ?? 0;
  const left = Math.min(
    Math.max(viewportLeft + VIEWPORT_GAP, anchor.left),
    Math.max(viewportLeft + VIEWPORT_GAP, viewportLeft + viewport.width - menu.width - VIEWPORT_GAP),
  );
  const spaceAbove = Math.max(0, anchor.top - viewportTop - TRIGGER_GAP - VIEWPORT_GAP);
  const spaceBelow = Math.max(0, viewportTop + viewport.height - VIEWPORT_GAP - anchor.bottom - TRIGGER_GAP);
  const placement = spaceBelow >= menu.height || spaceBelow >= spaceAbove ? 'below' : 'above';
  const maxHeight = Math.max(1, Math.min(viewport.height - VIEWPORT_GAP * 2, placement === 'below' ? spaceBelow : spaceAbove));
  const visibleHeight = Math.min(menu.height, maxHeight);
  const preferredTop = placement === 'below'
    ? anchor.bottom + TRIGGER_GAP
    : anchor.top - TRIGGER_GAP - visibleHeight;
  const top = Math.min(
    Math.max(viewportTop + VIEWPORT_GAP, preferredTop),
    Math.max(viewportTop + VIEWPORT_GAP, viewportTop + viewport.height - VIEWPORT_GAP - visibleHeight),
  );

  return { left, top, placement, maxHeight };
}
