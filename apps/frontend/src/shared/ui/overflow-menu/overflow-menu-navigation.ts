export function getMenuBoundaryIndex(enabledIndexes: readonly number[], last: boolean): number | null {
  if (enabledIndexes.length === 0) return null;
  return last ? enabledIndexes[enabledIndexes.length - 1] ?? null : enabledIndexes[0] ?? null;
}

export interface MenuRect { top: number; bottom: number; left: number; right: number }
export interface MenuSize { width: number; height: number }
export interface MenuPosition { top: number; left: number; maxHeight: number; maxWidth: number; minWidth: number }

const MENU_GAP = 8;

/** Place an overflow menu inside its viewport and nearest scroll boundary. */
export function getOverflowMenuPosition(anchor: MenuRect, menu: MenuSize, boundary: MenuRect): MenuPosition {
  const maxWidth = Math.max(0, boundary.right - boundary.left - MENU_GAP * 2);
  const maxHeight = Math.max(0, boundary.bottom - boundary.top - MENU_GAP * 2);
  const width = Math.min(menu.width, maxWidth);
  const height = Math.min(menu.height, maxHeight);
  const below = Math.max(0, boundary.bottom - MENU_GAP - anchor.bottom - MENU_GAP);
  const above = Math.max(0, anchor.top - MENU_GAP - boundary.top - MENU_GAP);
  const preferredTop = below >= menu.height || below >= above
    ? anchor.bottom + MENU_GAP
    : anchor.top - height - MENU_GAP;

  return {
    top: Math.min(Math.max(boundary.top + MENU_GAP, preferredTop), boundary.bottom - height - MENU_GAP),
    left: Math.min(boundary.right - width - MENU_GAP, Math.max(boundary.left + MENU_GAP, anchor.right - width)),
    maxHeight,
    maxWidth,
    minWidth: Math.min(232, maxWidth),
  };
}
