const MOSCOW_OFFSET_MS = 3 * 60 * 60 * 1000;

function getMoscowCalendarParts(now: Date): { year: number; month: number; day: number } {
  const shifted = new Date(now.getTime() + MOSCOW_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

export function isTimesheetDateEditable(params: {
  year: number;
  month: number;
  dayOfMonth: number;
  now?: Date;
}): boolean {
  const current = getMoscowCalendarParts(params.now ?? new Date());
  if (params.year !== current.year || params.month !== current.month) {
    return false;
  }

  return params.dayOfMonth >= 1 && params.dayOfMonth <= current.day;
}
