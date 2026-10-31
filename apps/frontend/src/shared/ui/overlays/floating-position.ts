export interface FloatingAnchorRect {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export interface FloatingSize { width: number; height: number }

export interface FloatingPosition {
  left: number;
  top: number;
  placement: 'above' | 'below';
  maxHeight: number;
}

const VIEWPORT_GAP = 12;
const TRIGGER_GAP = 6;

/** Viewport geometry for a floating element that escapes ancestor clipping. */
export function getFloatingPosition(
  anchor: FloatingAnchorRect,
  content: FloatingSize,
  viewport: FloatingSize,
): FloatingPosition {
  const left = Math.min(Math.max(VIEWPORT_GAP, anchor.left), Math.max(VIEWPORT_GAP, viewport.width - content.width - VIEWPORT_GAP));
  const above = Math.max(0, anchor.top - TRIGGER_GAP - VIEWPORT_GAP);
  const below = Math.max(0, viewport.height - VIEWPORT_GAP - anchor.bottom - TRIGGER_GAP);
  const placement = below >= content.height || below >= above ? 'below' : 'above';
  const maxHeight = Math.max(1, placement === 'below' ? below : above);
  const visibleHeight = Math.min(content.height, maxHeight);
  const preferredTop = placement === 'below' ? anchor.bottom + TRIGGER_GAP : anchor.top - TRIGGER_GAP - visibleHeight;
  const top = Math.min(Math.max(VIEWPORT_GAP, preferredTop), Math.max(VIEWPORT_GAP, viewport.height - VIEWPORT_GAP - visibleHeight));
  return { left, top, placement, maxHeight };
}
