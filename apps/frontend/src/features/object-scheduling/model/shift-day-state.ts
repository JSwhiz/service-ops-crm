import type { ShiftAttendance } from '@/entities/object/model/object-scheduling.types';

export interface ShiftDayState {
  checked: boolean;
  pending: boolean;
  owned: boolean;
  confirmedEmployeeIds: string[];
}

export function confirmedShiftEmployeeIds(facts: ShiftAttendance[], date: string): string[] {
  return [...new Set(facts.filter((fact) => fact.operationDate === date && fact.status === 'confirmed').map((fact) => fact.employeeId))];
}
