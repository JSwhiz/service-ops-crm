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
