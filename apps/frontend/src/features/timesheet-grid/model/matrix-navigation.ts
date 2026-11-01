export function getMoscowToday(now = new Date()): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Moscow', year: 'numeric', month: 'numeric', day: 'numeric',
  }).formatToParts(now);
  const part = (type: string): number => Number(parts.find((item) => item.type === type)?.value);
  return { year: part('year'), month: part('month'), day: part('day') };
}

export function getDayHeading(year: number, month: number, day: number): { weekday: string; label: string; weekend: boolean } {
  const date = new Date(Date.UTC(year, month - 1, day));
  return {
    weekday: new Intl.DateTimeFormat('ru-RU', { weekday: 'short', timeZone: 'UTC' }).format(date),
    label: new Intl.DateTimeFormat('ru-RU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(date),
    weekend: date.getUTCDay() === 0 || date.getUTCDay() === 6,
  };
}

export function getHorizontalOverflow(scrollLeft: number, clientWidth: number, scrollWidth: number): { before: boolean; after: boolean } {
  return { before: scrollLeft > 1, after: scrollWidth - clientWidth - scrollLeft > 1 };
}

/** Keep focused days clear of sticky identity columns, without scrolling the page. */
export function getCellScrollDelta(cellLeft: number, cellRight: number, visibleLeft: number, visibleRight: number): number {
  if (cellLeft < visibleLeft) return cellLeft - visibleLeft;
  if (cellRight > visibleRight) return cellRight - visibleRight;
  return 0;
}

/** Reveal both axes within the matrix, allowing for the sticky date header. */
export function getCellRevealScroll(cell: { left: number; right: number; top: number; bottom: number }, viewport: { left: number; right: number; top: number; bottom: number }, sticky: { left: number; right: number; top: number }): { left: number; top: number } {
  return {
    left: getCellScrollDelta(cell.left, cell.right, viewport.left + sticky.left, viewport.right - sticky.right),
    top: getCellScrollDelta(cell.top, cell.bottom, viewport.top + sticky.top, viewport.bottom),
  };
}

export function getNextMatrixCell(row: number, column: number, key: string, rows: number, columns: number, control = false): { row: number; column: number } | null {
  if (rows < 1 || columns < 1) return null;
  switch (key) {
    case 'ArrowLeft': column -= 1; break;
    case 'ArrowRight': column += 1; break;
    case 'ArrowUp': row -= 1; break;
    case 'ArrowDown': row += 1; break;
    case 'Home': column = 0; if (control) row = 0; break;
    case 'End': column = columns - 1; if (control) row = rows - 1; break;
    default: return null;
  }
  return { row: Math.max(0, Math.min(rows - 1, row)), column: Math.max(0, Math.min(columns - 1, column)) };
}
