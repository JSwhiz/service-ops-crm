/** Client calendar helpers. All boundaries use the browser's local business day. */

export const WEEKDAY_LABELS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'] as const;

const monthFormatter = new Intl.DateTimeFormat('ru-RU', { month: 'long', year: 'numeric' });
const dayFormatter = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', weekday: 'short' });
const dateFormatter = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
const dateTimeFormatter = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
});

export interface MonthCursor {
  year: number;
  /** 1–12 */
  month: number;
}

export interface CalendarDay {
  date: Date;
  key: string;
  inMonth: boolean;
  isToday: boolean;
}

export function toDateKey(date: Date): string {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}

export function currentMonth(): MonthCursor {
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() + 1 };
}

export function shiftMonth(cursor: MonthCursor, delta: number): MonthCursor {
  const date = new Date(cursor.year, cursor.month - 1 + delta, 1);
  return { year: date.getFullYear(), month: date.getMonth() + 1 };
}

export function formatMonth(cursor: MonthCursor): string {
  const label = monthFormatter.format(new Date(cursor.year, cursor.month - 1, 1)).replace(' г.', '');
  return label.charAt(0).toLocaleUpperCase('ru-RU') + label.slice(1);
}

export function formatCalendarDay(date: Date): string {
  return dayFormatter.format(date);
}

/** Monday-first grid covering whole weeks of the month. */
export function buildMonthGrid(cursor: MonthCursor): CalendarDay[] {
  const first = new Date(cursor.year, cursor.month - 1, 1);
  const leading = (first.getDay() + 6) % 7;
  const daysInMonth = new Date(cursor.year, cursor.month, 0).getDate();
  const total = Math.ceil((leading + daysInMonth) / 7) * 7;
  const todayKey = toDateKey(new Date());

  return Array.from({ length: total }, (_unused, index) => {
    const date = new Date(cursor.year, cursor.month - 1, 1 - leading + index);
    const key = toDateKey(date);
    return { date, key, inMonth: date.getMonth() === cursor.month - 1, isToday: key === todayKey };
  });
}

/** True when [start, end] (end inclusive, open when null) touches the given local day. */
export function coversDay(startIso: string, endIso: string | null, day: Date): boolean {
  const dayStart = new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime();
  const dayEnd = dayStart + 24 * 60 * 60 * 1000;
  const start = new Date(startIso).getTime();
  const end = endIso ? new Date(endIso).getTime() : Number.POSITIVE_INFINITY;
  return start < dayEnd && end >= dayStart;
}

export function formatPeriod(startIso: string, endIso: string | null, withTime: boolean): string {
  const format = (value: string): string =>
    (withTime ? dateTimeFormatter : dateFormatter).format(new Date(value));
  const start = format(startIso);
  if (!endIso) return `с ${start}, без даты окончания`;
  const end = format(endIso);
  return start === end ? start : `${start} — ${end}`;
}
