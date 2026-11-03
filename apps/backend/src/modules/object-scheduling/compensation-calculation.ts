import type { TimesheetRatePolicySnapshot } from '../timesheets/types/timesheet-rate-policy.type';
import { getPlannedWorkingDays } from '../timesheets/utils/timesheet-rate-policy.util';
import { dateOnly } from './scheduling-calendar';
import type { ScheduleRevisionView } from './scheduling.types';

export const COMPENSATION_CALCULATION_VERSION = 'half_salary_v2' as const;
export interface SalaryHalfExplanation {
  half: 1 | 2;
  baseHalf: number;
  normDays: number | null;
  paidDays: number;
  holidayDays: number;
  amount: number | null;
  unavailableReason: string | null;
}

/** Round the period once; never multiply an already-rounded day price. */
export function salaryHalf(monthlyAmount: number, half: 1 | 2, normDays: number | null, paidDays: number, holidayDays = 0): SalaryHalfExplanation {
  const first = Math.round(monthlyAmount / 2);
  const baseHalf = half === 1 ? first : monthlyAmount - first;
  const unavailableReason = normDays === null || normDays <= 0
    ? 'Не определена положительная норма дней этой половины месяца'
    : paidDays < 0 || paidDays > normDays
      ? 'Оплачиваемые дни превышают норму; проверьте покрытие позиции'
      : null;
  return {half, baseHalf, normDays, paidDays, holidayDays, amount: unavailableReason ? null : Math.round(baseHalf * paidDays / normDays!), unavailableReason};
}

/** Sum exact per-slot proportions across dated terms, then round only once. */
export function roundedSalaryFractions(items: ReadonlyArray<{baseHalf: number; norm: number}>): number {
  let numerator = 0n; let denominator = 1n;
  const gcd = (a: bigint, b: bigint): bigint => { while (b) {const rest = a % b; a = b; b = rest;} return a; };
  for (const item of items) {
    if (!Number.isInteger(item.norm) || item.norm <= 0) throw new Error('Норма оплачиваемых мест не определена');
    const divisor = BigInt(item.norm); const common = gcd(denominator, divisor);
    numerator = numerator * (divisor / common) + BigInt(item.baseHalf) * (denominator / common);
    denominator = denominator * (divisor / common);
    const reduce = gcd(numerator, denominator); numerator /= reduce; denominator /= reduce;
  }
  return Number((numerator * 2n + denominator) / (denominator * 2n));
}

export function isPublicHoliday(date: string): boolean {
  const month = Number(date.slice(5, 7)); const day = Number(date.slice(8, 10));
  return (month === 1 && day <= 8) || ['02-23', '03-08', '05-01', '05-09', '06-12', '11-04'].includes(date.slice(5));
}

/** Norm always covers the entire half, independently of hire/assignment dates. */
export function salaryNormDays(policy: TimesheetRatePolicySnapshot, year: number, month: number): {days: number[]; reason: string | null} {
  if (!policy.scheduleCode && !policy.scheduleWeekdays?.length) return {days: [], reason: 'Для оклада не задан график; норма не определена'};
  try {
    const days = getPlannedWorkingDays(year, month, policy.scheduleCode, policy.scheduleWeekdays, policy.scheduleCycleStartDate, policy.productionCalendarVersion);
    if (policy.scheduleCode === '5/2') {
      for (let day = 1; day <= new Date(Date.UTC(year, month, 0)).getUTCDate(); day++) {
        const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        if (isPublicHoliday(date) && ![0, 6].includes(dateOnly(date).getUTCDay()) && !days.includes(day)) days.push(day);
      }
    }
    return {days: days.sort((a, b) => a - b), reason: null};
  } catch (error) { return {days: [], reason: error instanceof Error ? error.message : 'Производственный календарь недоступен'}; }
}

/** A position owns one pool; rotation groups never each receive the full M. */
export function positionNormDays(revision: ScheduleRevisionView, contourId: string, year: number, month: number): {days: number[]; reason: string | null} {
  const template = revision.template;
  if (template.kind !== 'weekly' && (!template.anchorDate || !template.sequence?.length)) return {days: [], reason: 'У графика отсутствует дата начала или последовательность цикла'};
  const days: number[] = [];
  for (let day = 1; day <= new Date(Date.UTC(year, month, 0)).getUTCDate(); day++) {
    const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const ranges = new Map<string, Set<string>>();
    for (const group of revision.groups) {
      const exception = template.exceptions?.find(item => item.date === date);
      const offset = template.anchorDate ? Math.round((dateOnly(date).getTime() - dateOnly(template.anchorDate).getTime()) / 86400000) - group.offsetDays : 0;
      const working = exception?.working ?? (template.kind === 'weekly'
        ? template.weekdays?.includes(dateOnly(date).getUTCDay() || 7)
        : template.sequence![((offset % template.sequence!.length) + template.sequence!.length) % template.sequence!.length]);
      if (working) for (const range of group.timeRanges) if (range.contourId === contourId) {
        const key = `${range.start}:${range.end}:${range.endDayOffset}`;
        const owners = ranges.get(key) ?? new Set<string>();
        // Dated assignments identify who covers this date, not every past or
        // future candidate. Empty intervals still contribute required slots
        // below, so hiring/assignment dates never trim the full-half norm.
        for (const assignment of group.assignments) {
          if (assignment.from <= date && (!assignment.to || assignment.to >= date)) owners.add(assignment.employeeId);
        }
        ranges.set(key, owners);
      }
    }
    const payableOwners = new Set<string>();
    for (const [rangeKey, owners] of ranges) {
      if (owners.size > revision.requiredPerShift) {
        const sharesUnresolvedOwner = [...ranges].some(([otherKey, otherOwners]) => otherKey !== rangeKey && [...owners].some(owner => otherOwners.has(owner)));
        if (sharesUnresolvedOwner) return {days: [], reason: 'Неоднозначный состав разных интервалов одного контура: укажите, кто покрывает каждое оплачиваемое место. Норма не может выбираться по списку сотрудников.'};
        // Oversubscribed candidates of this interval are disjoint from every
        // other interval, so its required capacity is known without choosing
        // any particular employee from the roster.
        for (let slot = 0; slot < revision.requiredPerShift; slot++) payableOwners.add(`covered:${rangeKey}:${slot}`);
        continue;
      }
      const assignedSlots = [...owners];
      for (const owner of assignedSlots) payableOwners.add(`employee:${owner}`);
      for (let slot = assignedSlots.length; slot < revision.requiredPerShift; slot++) payableOwners.add(`unfilled:${rangeKey}:${slot}`);
    }
    // Repeated ranges covered by the same employee form one paid day, while
    // distinct covered shifts keep their capacity. Empty slots stay in norm.
    for (let slot = 0; slot < payableOwners.size; slot++) days.push(day);
  }
  return {days, reason: null};
}
