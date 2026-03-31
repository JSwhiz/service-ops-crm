export const ATTENDANCE_OPTIONS = [
  { value: 'present', shortLabel: 'Я', label: 'Явка' },
  { value: 'absent', shortLabel: 'Н', label: 'Отсутствие' },
  { value: 'sick', shortLabel: 'Б', label: 'Больничный' },
  { value: 'vacation', shortLabel: 'О', label: 'Отпуск' },
  { value: 'day_off', shortLabel: 'В', label: 'Выходной' },
] as const;

export function getAttendanceLabel(status: string): string {
  const item = ATTENDANCE_OPTIONS.find((option) => option.value === status);
  return item?.label ?? status;
}

export function getAttendanceShortLabel(status: string): string {
  const item = ATTENDANCE_OPTIONS.find((option) => option.value === status);
  return item?.shortLabel ?? status;
}
