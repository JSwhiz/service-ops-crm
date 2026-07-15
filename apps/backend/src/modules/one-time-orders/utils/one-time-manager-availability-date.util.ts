import { BadRequestException } from '@nestjs/common';

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_AVAILABILITY_DURATION_DAYS = 366;

export function normalizeAvailabilityDateRange(
  startDateValue: string,
  endDateValue: string,
): { startDate: Date; endDate: Date; durationDays: number } {
  const startDate = parseAvailabilityDate(startDateValue);
  const endDate = parseAvailabilityDate(endDateValue);

  if (endDate.getTime() < startDate.getTime()) {
    throw new BadRequestException(
      'Availability end date cannot be before start date',
    );
  }

  const durationDays =
    Math.floor((endDate.getTime() - startDate.getTime()) / DAY_MS) + 1;

  if (durationDays > MAX_AVAILABILITY_DURATION_DAYS) {
    throw new BadRequestException(
      `Availability date range cannot exceed ${MAX_AVAILABILITY_DURATION_DAYS} days`,
    );
  }

  return { startDate, endDate, durationDays };
}

export function formatAvailabilityDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function parseAvailabilityDate(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new BadRequestException('Availability date must use YYYY-MM-DD format');
  }

  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year!, month! - 1, day!));

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month! - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new BadRequestException('Availability date is invalid');
  }

  return date;
}
