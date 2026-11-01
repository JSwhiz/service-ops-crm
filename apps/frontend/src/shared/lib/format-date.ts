/** Date-only values never enter the viewer's time zone. Timestamps keep the caller's zone. */
export function formatUiDate(value: string | null | undefined, options: { timeZone?: string; time?: boolean; full?: boolean; dateOnly?: boolean } = {}): string {
  if (!value) return '—';
  const dateOnly = options.dateOnly ?? /^\d{4}-\d{2}-\d{2}$/.test(value);
  const date = new Date(dateOnly ? `${value.slice(0, 10)}T00:00:00Z` : value);
  if (!Number.isFinite(date.getTime())) return '—';
  return new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric', month: options.full ? 'long' : 'short', year: 'numeric',
    timeZone: dateOnly ? 'UTC' : options.timeZone,
    ...(!dateOnly && options.time ? { hour: '2-digit' as const, minute: '2-digit' as const } : {}),
  }).format(date);
}
