import { BadRequestException } from '@nestjs/common';

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_EXECUTION_DURATION_DAYS = 366;

export interface OneTimeOrderDateRange {
  executionStartDate: Date | null;
  executionEndDate: Date | null;
  durationDays: number | null;
}

export function normalizeOneTimeOrderDateRange(input: {
  executionStartDate?: string | null;
  executionEndDate?: string | null;
  executionDate?: string | null;
}): OneTimeOrderDateRange {
  const hasStart = input.executionStartDate !== undefined;
  const hasEnd = input.executionEndDate !== undefined;
  const hasLegacyDate = input.executionDate !== undefined;

  if (hasEnd && !hasStart && !hasLegacyDate) {
    throw new BadRequestException(
      'Execution end date requires execution start date',
    );
  }

  const startValue = hasStart
    ? input.executionStartDate
    : hasLegacyDate
      ? input.executionDate
      : null;

  if (!startValue) {
    if (input.executionEndDate) {
      throw new BadRequestException(
        'Execution end date requires execution start date',
      );
    }

    return {
      executionStartDate: null,
      executionEndDate: null,
      durationDays: null,
    };
  }

  const executionStartDate = parseBusinessDate(startValue);
  const executionEndDate = parseBusinessDate(
    input.executionEndDate || startValue,
  );

  if (executionEndDate.getTime() < executionStartDate.getTime()) {
    throw new BadRequestException(
      'Execution end date cannot be before execution start date',
    );
  }

  const durationDays =
    Math.floor(
      (executionEndDate.getTime() - executionStartDate.getTime()) / DAY_MS,
    ) + 1;

  if (durationDays > MAX_EXECUTION_DURATION_DAYS) {
    throw new BadRequestException(
      `Execution date range cannot exceed ${MAX_EXECUTION_DURATION_DAYS} days`,
    );
  }

  return {
    executionStartDate,
    executionEndDate,
    durationDays,
  };
}

export function normalizeOneTimeOrderDateRangePatch(
  input: {
    executionStartDate?: string | null;
    executionEndDate?: string | null;
    executionDate?: string | null;
  },
  current: {
    executionStartDate: Date | null;
    executionEndDate: Date | null;
  },
): OneTimeOrderDateRange {
  const hasStart = input.executionStartDate !== undefined;
  const hasEnd = input.executionEndDate !== undefined;
  const hasLegacyDate = input.executionDate !== undefined;

  if (hasLegacyDate && !hasStart && !hasEnd) {
    return normalizeOneTimeOrderDateRange({ executionDate: input.executionDate });
  }

  if (hasStart && input.executionStartDate === null) {
    return normalizeOneTimeOrderDateRange({ executionStartDate: null });
  }

  const currentStart = formatBusinessDate(current.executionStartDate);
  const currentEnd = formatBusinessDate(
    current.executionEndDate ?? current.executionStartDate,
  );
  const nextStart = hasStart ? input.executionStartDate : currentStart;

  if (!nextStart) {
    if (hasEnd && input.executionEndDate) {
      throw new BadRequestException(
        'Execution end date requires execution start date',
      );
    }

    return normalizeOneTimeOrderDateRange({ executionStartDate: null });
  }

  const nextEnd = hasEnd
    ? input.executionEndDate ?? nextStart
    : currentEnd ?? nextStart;

  return normalizeOneTimeOrderDateRange({
    executionStartDate: nextStart,
    executionEndDate: nextEnd,
  });
}

export function formatBusinessDate(value: Date | null): string | null {
  return value?.toISOString().slice(0, 10) ?? null;
}

export function getOneTimeOrderDurationDays(
  executionStartDate: Date | null,
  executionEndDate: Date | null,
): number | null {
  if (!executionStartDate || !executionEndDate) {
    return null;
  }

  return (
    Math.floor(
      (executionEndDate.getTime() - executionStartDate.getTime()) / DAY_MS,
    ) + 1
  );
}

function parseBusinessDate(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new BadRequestException('Execution date must use YYYY-MM-DD format');
  }

  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year!, month! - 1, day!));

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month! - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new BadRequestException('Execution date is invalid');
  }

  return date;
}
