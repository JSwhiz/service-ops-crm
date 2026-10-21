import type {
  EmployeeType,
  EmployeeWorkScheduleCode,
} from '../model/employee.types';

export const EMPLOYEE_TYPE_OPTIONS: Array<{
  value: EmployeeType;
  label: string;
}> = [
  { value: 'regular', label: 'Постоянный' },
  { value: 'one_time', label: 'Разовый' },
  { value: 'substitution', label: 'Подменный' },
];

export const EMPLOYEE_SCHEDULE_OPTIONS: Array<{
  value: EmployeeWorkScheduleCode;
  label: string;
}> = [
  { value: '5_2', label: '5/2' },
  { value: '2_2', label: '2/2' },
  { value: '6_1', label: '6/1' },
  { value: '7_0', label: '7/0' },
  { value: '3_1', label: '3/1' },
  { value: 'on_demand', label: 'По выходам' },
  { value: 'custom', label: 'Свой вариант' },
];

export function getEmployeeTypeLabel(type: EmployeeType): string {
  return EMPLOYEE_TYPE_OPTIONS.find((option) => option.value === type)?.label ?? type;
}

export function getEmployeeScheduleLabel(
  code: EmployeeWorkScheduleCode | null,
  custom: string | null = null,
): string {
  if (!code) return 'Не указан';
  if (code === 'custom' && custom) return custom;
  return EMPLOYEE_SCHEDULE_OPTIONS.find((option) => option.value === code)?.label ?? code;
}

export function getEmployeeStatusLabel(status: string): string {
  if (status === 'active') return 'Работает';
  if (status === 'inactive') return 'Неактивен';
  return status;
}

export function formatEmployeeDate(value: string | null): string {
  if (!value) return '—';
  const [year, month, day] = value.split('-');
  return year && month && day ? `${day}.${month}.${year}` : value;
}

export function getEmployeeAge(value: string | null): number | null {
  if (!value) return null;
  const birthDate = new Date(`${value}T00:00:00`);
  if (Number.isNaN(birthDate.getTime())) return null;

  const today = new Date();
  let age = today.getFullYear() - birthDate.getFullYear();
  const monthDifference = today.getMonth() - birthDate.getMonth();
  if (
    monthDifference < 0 ||
    (monthDifference === 0 && today.getDate() < birthDate.getDate())
  ) {
    age -= 1;
  }
  return age >= 0 ? age : null;
}

export function formatEmployeeRate(value: number | null): string {
  if (value === null) return '—';
  return `${new Intl.NumberFormat('ru-RU').format(value)} ₽`;
}

export type EmployeeStatusTone = 'success' | 'neutral' | 'warning';

/** One lifecycle badge per employee: archive wins over employment status. */
export function getEmployeeLifecycleBadge(params: {
  isArchived: boolean;
  employmentStatus: string;
}): { label: string; tone: EmployeeStatusTone } {
  if (params.isArchived) return { label: 'В архиве', tone: 'neutral' };
  if (params.employmentStatus === 'active') return { label: 'Работает', tone: 'success' };
  if (params.employmentStatus === 'inactive') return { label: 'Неактивен', tone: 'warning' };
  return { label: 'Неизвестное состояние', tone: 'neutral' };
}

export const EMPLOYEE_SUBSTITUTION_STATUS_OPTIONS = [
  { value: 'planned', label: 'Запланирована' },
  { value: 'active', label: 'Идёт' },
  { value: 'completed', label: 'Завершена' },
  { value: 'cancelled', label: 'Отменена' },
] as const;

export function getSubstitutionStatusLabel(status: string): string {
  return (
    EMPLOYEE_SUBSTITUTION_STATUS_OPTIONS.find((option) => option.value === status)?.label ??
    'Неизвестное состояние'
  );
}

/** Display-only phone formatting; the stored value is never rewritten. */
/** «Иванов И. И.» for dense places such as calendar cells. */
export function getEmployeeShortName(fullName: string): string {
  const [last, first, middle] = fullName.trim().split(/\s+/);
  if (!last) return fullName;
  return [last, first ? `${first[0]}.` : '', middle ? `${middle[0]}.` : ''].filter(Boolean).join(' ');
}

/** Human description of pay; distinguishes «not set» from a real amount. */
export function formatEmployeeCompensation(
  compensation: { amount: number | null; unit: 'shift' | 'month'; source: string; optionName: string | null } | null | undefined,
): string | null {
  if (!compensation) return null;
  if (!compensation.amount) return 'Ставка не задана';
  const amount = `${new Intl.NumberFormat('ru-RU').format(compensation.amount)} ₽ ${compensation.unit === 'month' ? 'в месяц' : 'за выход'}`;
  if (compensation.source === 'rate_option' && compensation.optionName) return `${compensation.optionName}: ${amount}`;
  if (compensation.source === 'individual') return `${amount}, индивидуально`;
  return amount;
}
