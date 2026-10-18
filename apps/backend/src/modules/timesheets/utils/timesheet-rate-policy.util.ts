import {
  TIMESHEET_RATE_POLICY_TYPES,
  TimesheetRatePolicySnapshot,
  TimesheetRatePolicyType,
} from '../types/timesheet-rate-policy.type';
import {
  getRussianProductionCalendarVersion,
  getRussianProductionWorkingDays,
  isCycleScheduleCode,
} from './russian-production-calendar.util';

export interface RatePolicyRecord {
  ratePolicyType?: string | null;
  ratePolicyBaseAmount?: number | null;
  ratePolicyScheduleCode?: string | null;
  ratePolicyWeekdays?: string[] | null;
  ratePolicyScheduleCycleStartDate?: Date | string | null;
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
  complex_shift: 'Сложный выход',
  side_job: 'Подработка',
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

export function buildObjectDefaultRatePolicy(params: {
  paymentType: 'monthly' | 'daily';
  monthlySalary: number;
  dailyRate: number;
  scheduleCode?: string | null;
  scheduleWeekdays?: string[];
  scheduleCycleStartDate?: Date | string | null;
  productionCalendarVersion?: string | null;
}): TimesheetRatePolicySnapshot {
  if (params.paymentType === 'monthly') {
    return normalizeRatePolicy(
      {
        ratePolicyType: 'monthly_fixed',
        ratePolicyBaseAmount: params.monthlySalary,
        ratePolicyScheduleCode: params.scheduleCode ?? null,
        ratePolicyWeekdays: params.scheduleWeekdays ?? [],
        ratePolicyScheduleCycleStartDate: params.scheduleCycleStartDate ?? null,
      },
      params.monthlySalary,
    );
  }

  return normalizeRatePolicy(
    {
      ratePolicyType: 'daily_rate',
      ratePolicyBaseAmount: params.dailyRate,
      ratePolicyScheduleCode: params.scheduleCode ?? null,
      ratePolicyWeekdays: params.scheduleWeekdays ?? [],
      ratePolicyScheduleCycleStartDate: params.scheduleCycleStartDate ?? null,
    },
    params.dailyRate,
  );
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
    scheduleWeekdays: normalizeScheduleWeekdays(record?.ratePolicyWeekdays),
    scheduleCycleStartDate: normalizeDateOnly(record?.ratePolicyScheduleCycleStartDate),
    productionCalendarVersion: null,
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

  const scheduleCode = typeof record.scheduleCode === 'string'
    ? normalizeScheduleCode(record.scheduleCode)
    : null;
  const scheduleWeekdays = normalizeScheduleWeekdays(record.scheduleWeekdays);
  const scheduleCycleStartDate = normalizeDateOnly(record.scheduleCycleStartDate as string | Date | null | undefined);

  return {
    ratePolicyType: type,
    baseAmount,
    scheduleCode,
    scheduleWeekdays,
    // Old snapshots were calculated using Monday-based weekdays and carry no
    // version. Keep that exact behavior when recalculating historical facts.
    scheduleCycleStartDate: scheduleCycleStartDate ?? (isCycleScheduleCode(scheduleCode) ? '2000-01-03' : null),
    productionCalendarVersion: typeof record.productionCalendarVersion === 'string'
      ? record.productionCalendarVersion
      : scheduleCode === '5/2' && scheduleWeekdays.length === 0
        ? 'legacy-weekdays'
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
  const policy = pinRatePolicyProductionCalendar(params.policy, params.year);
  params = { ...params, policy };
  const factsByDay = new Map(params.facts.map((fact) => [fact.dayOfMonth, fact]));
  const result = new Map<number, CalculatedTimesheetDay>();

  switch (params.policy.ratePolicyType) {
    case 'monthly_fixed': {
      const factDays = [...factsByDay.keys()].sort((left, right) => left - right);
      const workingDays =
        params.policy.workingDaysInMonth ??
        buildSchedulePaidDays(
          params.year,
          params.month,
          params.daysInMonth,
          params.policy,
        ).length;
      const payableDays = Math.min(factDays.length, workingDays);
      const totalAmount =
        workingDays > 0
          ? Math.round(
              (params.policy.baseAmount / workingDays) * payableDays,
            )
          : 0;

      distributeAmountAcrossDays({
        days: factDays,
        totalAmount,
        policy: params.policy,
        result,
        explanationPrefix:
          `Оклад ${params.policy.baseAmount} / ${workingDays} × ${payableDays} оплачиваемых дней`,
      });

      for (const dayOfMonth of factDays) {
        const calculated = result.get(dayOfMonth);
        const fact = factsByDay.get(dayOfMonth);
        if (calculated && fact) {
          calculated.workedHours = fact.workedHours;
        }
      }

      return result;
    }

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
    case 'complex_shift':
    case 'side_job':
      for (const fact of factsByDay.values()) {
        const factPolicy =
          parseRatePolicySnapshot(fact.ratePolicySnapshot) ?? params.policy;
        result.set(fact.dayOfMonth, {
          autoValue: factPolicy.baseAmount,
          workedHours: fact.workedHours,
          ratePolicySnapshot: factPolicy,
          calculationExplanation: factPolicy.ratePolicyType === 'agreed_substitution_rate'
            ? factPolicy.notes
              ? `Договорная ставка. Основание: ${factPolicy.notes}`
              : 'Договорная ставка подмены'
            : `${RATE_POLICY_LABELS[factPolicy.ratePolicyType]}: ставка задана вручную${factPolicy.notes ? `. Основание: ${factPolicy.notes}` : ''}`,
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

export function pinRatePolicyProductionCalendar(
  policy: TimesheetRatePolicySnapshot,
  year: number,
): TimesheetRatePolicySnapshot {
  if (
    policy.scheduleCode !== '5/2' ||
    (policy.scheduleWeekdays ?? []).length > 0 ||
    policy.productionCalendarVersion != null
  ) return policy;
  return {
    ...policy,
    productionCalendarVersion: getRussianProductionCalendarVersion(year),
  };
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

export function getPlannedWorkingDays(
  year: number,
  month: number,
  scheduleCode: string | null = null,
  scheduleWeekdays: string[] = [],
  scheduleCycleStartDate: Date | string | null = null,
  productionCalendarVersion: string | null = null,
): number[] {
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const normalizedSchedule = normalizeScheduleCode(scheduleCode);
  const normalizedWeekdays = normalizeScheduleWeekdays(scheduleWeekdays);
  if (normalizedWeekdays.length > 0) {
    const weekdayIndexes = new Set(normalizedWeekdays.map((day) => ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].indexOf(day)));
    return Array.from({ length: daysInMonth }, (_, index) => index + 1).filter((dayOfMonth) => {
      const weekday = new Date(Date.UTC(year, month - 1, dayOfMonth)).getUTCDay();
      const mondayBasedIndex = weekday === 0 ? 6 : weekday - 1;
      return weekdayIndexes.has(mondayBasedIndex);
    });
  }
  if (normalizedSchedule === '5/2' && productionCalendarVersion !== 'legacy-weekdays') {
    return getRussianProductionWorkingDays(year, month);
  }
  if (isCycleScheduleCode(normalizedSchedule)) {
    const anchor = normalizeDateOnly(scheduleCycleStartDate);
    if (!anchor) {
      throw new Error(`Для циклического графика ${normalizedSchedule} укажите дату начала цикла.`);
    }
    const workDaysPerCycle = Number(normalizedSchedule!.split('/')[0]);
    const [anchorYear, anchorMonth, anchorDay] = anchor.split('-').map(Number);
    const anchorUtc = Date.UTC(anchorYear, anchorMonth - 1, anchorDay);
    return Array.from({ length: daysInMonth }, (_, index) => index + 1).filter((dayOfMonth) => {
      const dateUtc = Date.UTC(year, month - 1, dayOfMonth);
      const offset = Math.floor((dateUtc - anchorUtc) / 86_400_000);
      if (offset < 0) return false;
      const position = ((offset % 7) + 7) % 7;
      return position < workDaysPerCycle;
    });
  }
  const workDaysPerWeek = Number(normalizedSchedule?.split('/')[0] ?? 5);

  if (workDaysPerWeek >= 7) {
    return Array.from({ length: daysInMonth }, (_, index) => index + 1);
  }

  return Array.from({ length: daysInMonth }, (_, index) => index + 1).filter(
    (dayOfMonth) => {
      const weekday = new Date(Date.UTC(year, month - 1, dayOfMonth)).getUTCDay();
      const mondayBasedIndex = weekday === 0 ? 6 : weekday - 1;
      return mondayBasedIndex < workDaysPerWeek;
    },
  );
}

export function calculateMonthlySalaryDailyRate(params: {
  monthlySalary: number;
  year: number;
  month: number;
  scheduleCode?: string | null;
  scheduleWeekdays?: string[];
  scheduleCycleStartDate?: Date | string | null;
  productionCalendarVersion?: string | null;
}): { dailyRate: number; workingDays: number } {
  const workingDays = getPlannedWorkingDays(
    params.year,
    params.month,
    params.scheduleCode ?? null,
    params.scheduleWeekdays ?? [],
    params.scheduleCycleStartDate ?? null,
    params.productionCalendarVersion ?? null,
  ).length;
  const monthlySalary = Math.max(0, Math.round(params.monthlySalary));

  return {
    dailyRate:
      workingDays > 0 ? Math.round(monthlySalary / workingDays) : 0,
    workingDays,
  };
}

function buildSchedulePaidDays(
  year: number,
  month: number,
  _daysInMonth: number,
  policy: TimesheetRatePolicySnapshot,
): number[] {
  return getPlannedWorkingDays(
    year,
    month,
    policy.scheduleCode,
    policy.scheduleWeekdays ?? [],
    policy.scheduleCycleStartDate,
    policy.productionCalendarVersion,
  );
}

function normalizeDateOnly(value: Date | string | null | undefined): string | null {
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day) return value;
  }
  return null;
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
  return (TIMESHEET_RATE_POLICY_TYPES as readonly string[]).includes(value);
}

function normalizeScheduleCode(value: string | null | undefined) {
  return ['1/6', '2/5', '3/4', '4/3', '5/2', '6/1', '7/0'].includes(
    value ?? '',
  )
    ? (value as TimesheetRatePolicySnapshot['scheduleCode'])
    : null;
}

function normalizeScheduleWeekdays(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const valid = new Set(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']);
  return [...new Set(value.filter((day): day is string => typeof day === 'string' && valid.has(day)))];
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
