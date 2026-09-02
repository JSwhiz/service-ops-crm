import { BadRequestException } from '@nestjs/common';

const MOSCOW_OFFSET_MS = 3 * 60 * 60 * 1000;

function getMoscowCalendarParts(now: Date): { year: number; month: number; day: number } {
  const shifted = new Date(now.getTime() + MOSCOW_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

export function assertTimesheetDateEditable(params: {
  year: number;
  month: number;
  dayOfMonth: number;
  now?: Date;
}): void {
  const current = getMoscowCalendarParts(params.now ?? new Date());

  if (params.year !== current.year || params.month !== current.month) {
    throw new BadRequestException(
      'Timesheet corrections are available only for the current calendar month',
    );
  }

  if (params.dayOfMonth > current.day) {
    throw new BadRequestException(
      'Timesheet corrections are not available for future dates',
    );
  }
}
