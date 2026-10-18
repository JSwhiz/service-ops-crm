import { BadRequestException } from '@nestjs/common';

const SCHEDULE_CODES = ['1/6', '2/5', '3/4', '4/3', '5/2', '6/1', '7/0'] as const;

type CalendarDefinition = {
  version: string;
  additionalDaysOff: readonly string[];
  workingWeekendDays: readonly string[];
};

// Versioned from the approved Russian transfer resolutions. Add a new year
// only after its official transfer resolution has been published and checked.
const CALENDARS: Record<number, CalendarDefinition> = {
  2026: {
    version: 'ru-production-2026-v1',
    additionalDaysOff: ['2026-01-09', '2026-12-31'],
    workingWeekendDays: [],
  },
  2027: {
    version: 'ru-production-2027-v1',
    additionalDaysOff: ['2027-02-22', '2027-11-05', '2027-12-31'],
    workingWeekendDays: ['2027-02-20'],
  },
};

export function getRussianProductionCalendarVersion(year: number): string {
  const calendar = CALENDARS[year];
  if (!calendar) {
    throw new BadRequestException(`Не загружен утвержденный производственный календарь РФ на ${year} год.`);
  }
  return calendar.version;
}

export function isRussianProductionWorkingDay(date: Date): boolean {
  const year = date.getUTCFullYear();
  const calendar = CALENDARS[year];
  if (!calendar) {
    throw new BadRequestException(`Не загружен утвержденный производственный календарь РФ на ${year} год.`);
  }

  const dateKey = formatDateKey(date);
  if (calendar.additionalDaysOff.includes(dateKey)) return false;
  if (calendar.workingWeekendDays.includes(dateKey)) return true;

  const weekdayIndex = (date.getUTCDay() + 6) % 7;
  if (weekdayIndex >= 5) return false;
  if (isRussianPublicHoliday(date)) return false;

  // Under Article 112 of the Labour Code, non-January public holidays that
  // coincide with a weekend move the rest day to the next working day.
  if (isObservedPublicHolidayRestDay(date)) return false;

  return true;
}

export function getRussianProductionWorkingDays(year: number, month: number): number[] {
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new BadRequestException('Месяц производственного календаря должен быть от 1 до 12.');
  }
  getRussianProductionCalendarVersion(year);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return Array.from({ length: daysInMonth }, (_, index) => index + 1).filter((day) =>
    isRussianProductionWorkingDay(new Date(Date.UTC(year, month - 1, day))),
  );
}

export function isCycleScheduleCode(value: string | null): boolean {
  return value !== null && value !== '5/2' && SCHEDULE_CODES.includes(value as (typeof SCHEDULE_CODES)[number]);
}

export function getScheduleConfigurationError(params: {
  scheduleCode: string | null | undefined;
  scheduleWeekdays: readonly string[] | null | undefined;
  scheduleCycleStartDate: string | Date | null | undefined;
}): string | null {
  const code = params.scheduleCode ?? null;
  const weekdays = params.scheduleWeekdays ?? [];
  const cycleStartDate = params.scheduleCycleStartDate ?? null;
  if (weekdays.length > 0 && code !== null) {
    return 'Выберите шаблон графика или конкретные дни недели — одновременно задавать оба режима нельзя.';
  }
  if (weekdays.length > 0 && cycleStartDate !== null) {
    return 'Дата начала цикла не используется при выборе конкретных дней недели.';
  }
  if (code === '5/2' && cycleStartDate !== null) {
    return 'Для графика 5/2 используется производственный календарь; дата начала цикла не нужна.';
  }
  if (isCycleScheduleCode(code) && cycleStartDate === null) {
    return `Для графика ${code} укажите дату первого рабочего дня цикла.`;
  }
  if (code === null && cycleStartDate !== null) {
    return 'Дата начала цикла допустима только для циклического шаблона графика.';
  }
  return null;
}

function isRussianPublicHoliday(date: Date): boolean {
  const month = date.getUTCMonth() + 1;
  const day = date.getUTCDate();
  if (month === 1 && day <= 8) return true;
  return (
    (month === 2 && day === 23) ||
    (month === 3 && day === 8) ||
    (month === 5 && (day === 1 || day === 9)) ||
    (month === 6 && day === 12) ||
    (month === 11 && day === 4)
  );
}

function isObservedPublicHolidayRestDay(date: Date): boolean {
  const weekdayIndex = (date.getUTCDay() + 6) % 7;
  if (weekdayIndex >= 5) return false;

  const year = date.getUTCFullYear();
  for (let offset = 1; offset <= 7; offset += 1) {
    const holidayDate = new Date(Date.UTC(year, date.getUTCMonth(), date.getUTCDate() - offset));
    const holidayMonth = holidayDate.getUTCMonth() + 1;
    if (holidayMonth === 1 && holidayDate.getUTCDate() <= 8) continue;
    const holidayWeekday = (holidayDate.getUTCDay() + 6) % 7;
    if (holidayWeekday < 5 || !isRussianPublicHoliday(holidayDate)) continue;

    let next = new Date(holidayDate.getTime());
    for (let attempt = 0; attempt < 7; attempt += 1) {
      next = new Date(Date.UTC(year, next.getUTCMonth(), next.getUTCDate() + 1));
      const nextWeekday = (next.getUTCDay() + 6) % 7;
      if (nextWeekday >= 5 || isRussianPublicHoliday(next)) continue;
      if (formatDateKey(next) === formatDateKey(date)) return true;
      break;
    }
  }
  return false;
}

function formatDateKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}
