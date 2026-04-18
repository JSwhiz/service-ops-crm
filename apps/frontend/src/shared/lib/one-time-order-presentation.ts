export const ONE_TIME_ORDER_STATUS_OPTIONS = [
  { value: 'new', label: 'Новый' },
  { value: 'planned', label: 'Запланирован' },
  { value: 'in_progress', label: 'В работе' },
  { value: 'completed', label: 'Завершен' },
  { value: 'cancelled', label: 'Отменен' },
] as const;

export function getOneTimeOrderStatusLabel(status: string): string {
  return (
    ONE_TIME_ORDER_STATUS_OPTIONS.find((item) => item.value === status)?.label ??
    status
  );
}
