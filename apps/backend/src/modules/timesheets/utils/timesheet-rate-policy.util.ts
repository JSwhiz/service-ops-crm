import {
  TimesheetRatePolicySnapshot,
  TimesheetRatePolicyType,
} from '../types/timesheet-rate-policy.type';

export interface RatePolicyRecord {
  ratePolicyType?: string | null;
  ratePolicyBaseAmount?: number | null;
  ratePolicyScheduleCode?: string | null;
  ratePolicyRoundingMode?: string | null;
  ratePolicyRoundingStep?: number | null;
  ratePolicyStandardShiftHours?: number | null;
  ratePolicyWorkingDaysInMonth?: number | null;
  ratePolicyExcludedHolidayDays?: number | null;
  ratePolicyNotes?: string | null;
}

export interface AttendanceFactForCalculation {
  dayOfMonth: number;
  dailyRateSnapshot: number;
  workedHours: number | null;
  ratePolicySnapshot: unknown;
}

export interface CalculatedTimesheetDay {
  autoValue: number;
  workedHours: number | null;
  ratePolicySnapshot: TimesheetRatePolicySnapshot;
  calculationExplanation: string;
}

const RATE_POLICY_LABELS: Record<TimesheetRatePolicyType, string> = {
  daily_rate: 'Дневная ставка',
  monthly_fixed: 'Оклад',
  monthly_excluding_holidays: 'Оклад без праздников',
  shift_2_2_fixed: '2/2 фикс',
  shift_2_2_by_actual_shifts: '2/2 по сменам',
  per_attendance: 'За выход',
  partial_shift: 'Частичная смена',
  agreed_substitution_rate: 'Подмена по договоренности',
};

export function getRatePolicyLabel(policy: TimesheetRatePolicySnapshot): string {
  const base = RATE_POLICY_LABELS[policy.ratePolicyType] ?? policy.ratePolicyType;

  if (policy.ratePolicyType === 'monthly_fixed') {
    return `${base} · ${policy.baseAmount} ₽ / месяц`;
  }

  if (policy.ratePolicyType === 'monthly_excluding_holidays') {
    return `${base} · ${policy.baseAmount} ₽ / месяц`;
  }

  if (policy.ratePolicyType === 'shift_2_2_by_actual_shifts') {
    return `${base} · база ${policy.baseAmount} ₽`;
  }

  if (policy.ratePolicyType === 'partial_shift') {
    return `${base} · ${policy.baseAmount} ₽ / ${policy.standardShiftHours} ч`;
  }

  return `${base} · ${policy.baseAmount} ₽`;
}

export function normalizeRatePolicy(
  record: RatePolicyRecord | null | undefined,
  fallbackAmount: number,
): TimesheetRatePolicySnapshot {
  const rawType = record?.ratePolicyType ?? 'daily_rate';
  const ratePolicyType = isRatePolicyType(rawType) ? rawType : 'daily_rate';
  const standardShiftHours = normalizePositiveNumber(
    record?.ratePolicyStandardShiftHours,
    8,
  );

  return {
    ratePolicyType,
    baseAmount: normalizeMoney(record?.ratePolicyBaseAmount, fallbackAmount),
    scheduleCode: normalizeScheduleCode(record?.ratePolicyScheduleCode),
    roundingMode:
      record?.ratePolicyRoundingMode === 'nearest_step'
        ? 'nearest_step'
        : 'none',
    roundingStep: normalizeNullablePositiveInt(record?.ratePolicyRoundingStep),
    standardShiftHours,
    workingDaysInMonth: normalizeNullablePositiveInt(
      record?.ratePolicyWorkingDaysInMonth,
    ),
    excludedHolidayDays: normalizeNullableNonNegativeInt(
      record?.ratePolicyExcludedHolidayDays,
    ),
    notes: record?.ratePolicyNotes?.trim() || null,
  };
}

export function parseRatePolicySnapshot(
  value: unknown,
): TimesheetRatePolicySnapshot | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const type = record.ratePolicyType;
  const baseAmount = record.baseAmount;

  if (typeof type !== 'string' || !isRatePolicyType(type)) {
    return null;
  }

  if (typeof baseAmount !== 'number' || !Number.isFinite(baseAmount)) {
    return null;
  }

  return {
    ratePolicyType: type,
    baseAmount,
    scheduleCode:
      typeof record.scheduleCode === 'string'
        ? normalizeScheduleCode(record.scheduleCode)
        : null,
    roundingMode:
      record.roundingMode === 'nearest_step' ? 'nearest_step' : 'none',
    roundingStep:
      typeof record.roundingStep === 'number'
        ? normalizeNullablePositiveInt(record.roundingStep)
        : null,
    standardShiftHours:
      typeof record.standardShiftHours === 'number'
        ? normalizePositiveNumber(record.standardShiftHours, 8)
        : 8,
    workingDaysInMonth:
      typeof record.workingDaysInMonth === 'number'
        ? normalizeNullablePositiveInt(record.workingDaysInMonth)
        : null,
    excludedHolidayDays:
      typeof record.excludedHolidayDays === 'number'
        ? normalizeNullableNonNegativeInt(record.excludedHolidayDays)
        : null,
    notes: typeof record.notes === 'string' ? record.notes : null,
  };
}

export function calculateTimesheetAutoValues(params: {
  year: number;
  month: number;
  daysInMonth: number;
  policy: TimesheetRatePolicySnapshot;
  facts: AttendanceFactForCalculation[];
}): Map<number, CalculatedTimesheetDay> {
  const factsByDay = new Map(params.facts.map((fact) => [fact.dayOfMonth, fact]));
  const result = new Map<number, CalculatedTimesheetDay>();

  switch (params.policy.ratePolicyType) {
    case 'monthly_fixed':
      distributePlannedMonthlyAmount({
        ...params,
        totalAmount: params.policy.baseAmount,
        result,
        explanationPrefix: 'Оклад распределен по плановым дням графика',
      });
      return result;

    case 'monthly_excluding_holidays': {
      const workingDays =
        params.policy.workingDaysInMonth ??
        buildSchedulePaidDays(params.year, params.month, params.daysInMonth, params.policy)
          .length;
      const excludedHolidayDays = params.policy.excludedHolidayDays ?? 0;
      const payableDays = Math.max(0, workingDays - excludedHolidayDays);
      const totalAmount =
        workingDays > 0
          ? Math.round((params.policy.baseAmount / workingDays) * payableDays)
          : 0;

      distributePlannedMonthlyAmount({
        ...params,
        totalAmount,
        result,
        explanationPrefix: `Оклад ${params.policy.baseAmount} / ${workingDays} * ${payableDays}`,
      });
      return result;
    }

    case 'shift_2_2_fixed':
      distributeAmountAcrossDays({
        days: buildShift22Days(params.daysInMonth),
        totalAmount: params.policy.baseAmount,
        policy: params.policy,
        result,
        explanationPrefix: 'Фиксированная сумма 2/2 распределена по плановым сменам',
      });
      return result;

    case 'shift_2_2_by_actual_shifts': {
      const factDays = [...factsByDay.keys()].sort((left, right) => left - right);
      const rawTotal =
        params.policy.baseAmount * 2 / params.daysInMonth * factDays.length;
      const totalAmount = roundByPolicy(rawTotal, params.policy);
      distributeAmountAcrossDays({
        days: factDays,
        totalAmount,
        policy: params.policy,
        result,
        explanationPrefix: `${params.policy.baseAmount} * 2 / ${params.daysInMonth} * ${factDays.length}`,
      });
      return result;
    }

    case 'partial_shift':
      for (const fact of factsByDay.values()) {
        const factPolicy =
          parseRatePolicySnapshot(fact.ratePolicySnapshot) ?? params.policy;
        const workedHours = fact.workedHours ?? factPolicy.standardShiftHours;
        const autoValue = Math.round(
          factPolicy.baseAmount * workedHours / factPolicy.standardShiftHours,
        );
        result.set(fact.dayOfMonth, {
          autoValue,
          workedHours,
          ratePolicySnapshot: factPolicy,
          calculationExplanation: `${factPolicy.baseAmount} * ${workedHours} / ${factPolicy.standardShiftHours}`,
        });
      }
      return result;

    case 'agreed_substitution_rate':
      for (const fact of factsByDay.values()) {
        const factPolicy =
          parseRatePolicySnapshot(fact.ratePolicySnapshot) ?? params.policy;
        result.set(fact.dayOfMonth, {
          autoValue: factPolicy.baseAmount,
          workedHours: fact.workedHours,
          ratePolicySnapshot: factPolicy,
          calculationExplanation: factPolicy.notes
            ? `Договорная ставка. Основание: ${factPolicy.notes}`
            : 'Договорная ставка подмены',
        });
      }
      return result;

    case 'daily_rate':
    case 'per_attendance':
    default:
      for (const fact of factsByDay.values()) {
        const factPolicy =
          parseRatePolicySnapshot(fact.ratePolicySnapshot) ??
          normalizeRatePolicy(
            {
              ratePolicyType: params.policy.ratePolicyType,
              ratePolicyBaseAmount: fact.dailyRateSnapshot,
              ratePolicyStandardShiftHours: params.policy.standardShiftHours,
            },
            fact.dailyRateSnapshot,
          );
        result.set(fact.dayOfMonth, {
          autoValue: factPolicy.baseAmount,
          workedHours: fact.workedHours,
          ratePolicySnapshot: factPolicy,
          calculationExplanation: 'Attendance fact: ставка за выход',
        });
      }
      return result;
  }
}

function distributePlannedMonthlyAmount(params: {
  year: number;
  month: number;
  daysInMonth: number;
  policy: TimesheetRatePolicySnapshot;
  totalAmount: number;
  result: Map<number, CalculatedTimesheetDay>;
  explanationPrefix: string;
}): void {
  const paidDays = buildSchedulePaidDays(
    params.year,
    params.month,
    params.daysInMonth,
    params.policy,
  );

  distributeAmountAcrossDays({
    days: paidDays,
    totalAmount: params.totalAmount,
    policy: params.policy,
    result: params.result,
    explanationPrefix: params.explanationPrefix,
  });
}

function distributeAmountAcrossDays(params: {
  days: number[];
  totalAmount: number;
  policy: TimesheetRatePolicySnapshot;
  result: Map<number, CalculatedTimesheetDay>;
  explanationPrefix: string;
}): void {
  if (params.days.length === 0 || params.totalAmount === 0) {
    return;
  }

  const baseDayAmount = Math.floor(params.totalAmount / params.days.length);
  let allocated = 0;

  params.days.forEach((dayOfMonth, index) => {
    const isLast = index === params.days.length - 1;
    const autoValue = isLast
      ? params.totalAmount - allocated
      : baseDayAmount;
    allocated += autoValue;
    params.result.set(dayOfMonth, {
      autoValue,
      workedHours: null,
      ratePolicySnapshot: params.policy,
      calculationExplanation: `${params.explanationPrefix}; остаток распределения в последнюю смену`,
    });
  });
}

function buildSchedulePaidDays(
  year: number,
  month: number,
  daysInMonth: number,
  policy: TimesheetRatePolicySnapshot,
): number[] {
  const workDaysPerWeek = Number(policy.scheduleCode?.split('/')[0] ?? 5);

  if (workDaysPerWeek >= 7) {
    return Array.from({ length: daysInMonth }, (_, index) => index + 1);
  }

  return Array.from({ length: daysInMonth }, (_, index) => index + 1).filter(
    (dayOfMonth) => {
      const weekday = new Date(year, month - 1, dayOfMonth).getDay();
      const mondayBasedIndex = weekday === 0 ? 6 : weekday - 1;
      return mondayBasedIndex < workDaysPerWeek;
    },
  );
}

function buildShift22Days(daysInMonth: number): number[] {
  return Array.from({ length: daysInMonth }, (_, index) => index + 1).filter(
    (dayOfMonth) => ((dayOfMonth - 1) % 4) < 2,
  );
}

function roundByPolicy(
  value: number,
  policy: TimesheetRatePolicySnapshot,
): number {
  if (policy.roundingMode !== 'nearest_step' || !policy.roundingStep) {
    return Math.round(value);
  }

  return Math.round(value / policy.roundingStep) * policy.roundingStep;
}

function isRatePolicyType(value: string): value is TimesheetRatePolicyType {
  return [
    'daily_rate',
    'monthly_fixed',
    'monthly_excluding_holidays',
    'shift_2_2_fixed',
    'shift_2_2_by_actual_shifts',
    'per_attendance',
    'partial_shift',
    'agreed_substitution_rate',
  ].includes(value);
}

function normalizeScheduleCode(value: string | null | undefined) {
  return ['1/6', '2/5', '3/4', '4/3', '5/2', '6/1', '7/0'].includes(
    value ?? '',
  )
    ? (value as TimesheetRatePolicySnapshot['scheduleCode'])
    : null;
}

function normalizeMoney(value: number | null | undefined, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    return Math.round(value);
  }

  return Math.max(0, Math.round(fallback));
}

function normalizePositiveNumber(
  value: number | null | undefined,
  fallback: number,
): number {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return value;
  }

  return fallback;
}

function normalizeNullablePositiveInt(
  value: number | null | undefined,
): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return Math.round(value);
  }

  return null;
}

function normalizeNullableNonNegativeInt(
  value: number | null | undefined,
): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    return Math.round(value);
  }

  return null;
}
