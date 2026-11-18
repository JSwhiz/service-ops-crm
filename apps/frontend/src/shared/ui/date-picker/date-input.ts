/** Calendar dates stay strings: parsing must never roll 31 February into March. */
export function calendarDate(key: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return null;
  const [year, month, day] = key.split('-').map(Number);
  if (!year || !month || !day) return null;
  const date = new Date(0);
  date.setFullYear(year!, month! - 1, day!);
  date.setHours(0, 0, 0, 0);
  return date.getFullYear() === year && date.getMonth() === month! - 1 && date.getDate() === day ? date : null;
}

export function formatDateInput(value: string, withTime = false): string {
  if (!value) return '';
  const key = value.slice(0, 10);
  if (!calendarDate(key)) return value;
  return `${key.slice(8, 10)}.${key.slice(5, 7)}.${key.slice(0, 4)}${withTime ? ` ${value.slice(11, 16) || '09:00'}` : ''}`;
}

export interface DateInputOptions {
  withTime?: boolean;
  time?: string;
  min?: string;
  max?: string;
  maxError?: string;
}

export function parseDateInput(text: string, options: DateInputOptions = {}): { value: string | null; error: string | null } {
  const input = text.trim();
  if (!input) return { value: '', error: null };
  const match = /^(\d{2})\.(\d{2})\.(\d{4})(?:\s+(\d{2}:\d{2}))?$/.exec(input);
  if (!match || (!options.withTime && match[4])) return { value: null, error: options.withTime ? 'Введите дату ДД.ММ.ГГГГ и время ЧЧ:ММ.' : 'Введите дату в формате ДД.ММ.ГГГГ.' };
  const key = `${match[3]}-${match[2]}-${match[1]}`;
  if (!calendarDate(key)) return { value: null, error: 'Такой даты нет. Проверьте день, месяц и год.' };
  const time = match[4] || options.time || '09:00';
  if (options.withTime && !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return { value: null, error: 'Введите время от 00:00 до 23:59.' };
  const value = options.withTime ? `${key}T${time}` : key;
  const beforeMin = options.min && (options.min.length > 10 && options.withTime ? value < options.min.slice(0, 16) : key < options.min.slice(0, 10));
  const afterMax = options.max && (options.max.length > 10 && options.withTime ? value > options.max.slice(0, 16) : key > options.max.slice(0, 10));
  if (beforeMin) return { value: null, error: `Дата должна быть не раньше ${formatDateInput(options.min!, options.withTime && options.min!.length > 10)}.` };
  if (afterMax) return { value: null, error: options.maxError || `Дата должна быть не позже ${formatDateInput(options.max!, options.withTime && options.max!.length > 10)}.` };
  return { value, error: null };
}

export function moscowDateKey(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const part = (type: string): string => parts.find((item) => item.type === type)!.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}
