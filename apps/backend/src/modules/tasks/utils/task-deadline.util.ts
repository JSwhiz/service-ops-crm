import { BadRequestException } from '@nestjs/common';

type DateTimeParts = [number, number, number, number, number, number];

function getZonedParts(date: Date, timeZone: string): DateTimeParts {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const values = new Map(
    parts.map((part) => [part.type, Number(part.value)]),
  );

  return [
    values.get('year') ?? 0,
    values.get('month') ?? 0,
    values.get('day') ?? 0,
    values.get('hour') ?? 0,
    values.get('minute') ?? 0,
    values.get('second') ?? 0,
  ];
}

function zonedDateTimeToUtc(
  values: DateTimeParts,
  timeZone: string,
): Date {
  const expectedUtc = Date.UTC(
    values[0],
    values[1] - 1,
    values[2],
    values[3],
    values[4],
    values[5],
  );
  let candidate = expectedUtc;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const zoned = getZonedParts(new Date(candidate), timeZone);
    const representedUtc = Date.UTC(
      zoned[0],
      zoned[1] - 1,
      zoned[2],
      zoned[3],
      zoned[4],
      zoned[5],
    );
    candidate -= representedUtc - expectedUtc;
  }

  return new Date(candidate);
}

export function parseTaskDeadline(params: {
  dueDate?: string | null;
  dueTime?: string | null;
  timeZone: string;
}): { dueAt: Date | null; dueTimeSpecified: boolean } {
  if (!params.dueDate) {
    if (params.dueTime) {
      throw new BadRequestException('dueTime requires dueDate');
    }

    return { dueAt: null, dueTimeSpecified: false };
  }

  try {
    new Intl.DateTimeFormat('en', { timeZone: params.timeZone }).format();
  } catch {
    throw new BadRequestException('APP_TIMEZONE is invalid');
  }

  const [year = NaN, month = NaN, day = NaN] = params.dueDate
    .split('-')
    .map(Number);
  const [hour = NaN, minute = NaN] = params.dueTime
    ? params.dueTime.split(':').map(Number)
    : [23, 59];
  const values: DateTimeParts = [
    year,
    month,
    day,
    hour,
    minute,
    params.dueTime ? 0 : 59,
  ];

  if (values.some((value) => !Number.isFinite(value))) {
    throw new BadRequestException('Invalid task deadline');
  }
  const dueAt = zonedDateTimeToUtc(values, params.timeZone);
  const rendered = getZonedParts(dueAt, params.timeZone);

  if (rendered.some((value, index) => value !== values[index])) {
    throw new BadRequestException('Invalid task deadline');
  }

  return {
    dueAt,
    dueTimeSpecified: Boolean(params.dueTime),
  };
}
