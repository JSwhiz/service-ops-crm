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

export function getOneTimeOrderConflictTypeLabel(type: string): string {
  const labels: Record<string, string> = {
    existing_order: 'другой заказ',
    day_off: 'выходной',
    vacation: 'отпуск',
    sick_leave: 'больничный',
    pending_availability_request: 'запрос отсутствия на согласовании',
  };
  return labels[type] ?? type;
}
