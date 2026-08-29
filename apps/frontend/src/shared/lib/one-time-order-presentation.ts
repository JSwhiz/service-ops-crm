export const ONE_TIME_ORDER_STATUS_OPTIONS = [
  { value: 'new', label: 'Новый' },
  { value: 'planned', label: 'Запланирован' },
  { value: 'in_progress', label: 'В работе' },
  { value: 'completed', label: 'Завершен' },
  { value: 'cancelled', label: 'Отменен' },
] as const;

export const ONE_TIME_ORDER_PLANNED_PAYMENT_METHOD_OPTIONS = [
  { value: 'cash', label: 'Наличные' },
  { value: 'personal_card_transfer', label: 'Перевод на личную карту' },
  { value: 'organization_transfer', label: 'Перевод организации' },
  { value: 'other', label: 'Другое' },
] as const;

export function getOneTimeOrderPlannedPaymentMethodLabel(
  method: string,
): string {
  return (
    ONE_TIME_ORDER_PLANNED_PAYMENT_METHOD_OPTIONS.find(
      (item) => item.value === method,
    )?.label ?? method
  );
}

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

export function getOneTimeOrderPaymentMethodLabel(method: string): string {
  const labels: Record<string, string> = {
    cash: 'Наличные менеджеру',
    personal_card_transfer: 'Перевод на личную карту',
    organization_transfer: 'Перевод организации',
    other: 'Другой способ',
  };
  return labels[method] ?? method;
}

export function getOneTimeOrderPaymentDestinationLabel(
  destination: string,
): string {
  return destination === 'manager_accountability'
    ? 'Личный подотчет менеджера'
    : destination === 'organization'
      ? 'Организация'
      : destination;
}

export function getOneTimeOrderPaymentZeroReasonLabel(reason: string): string {
  const labels: Record<string, string> = {
    payment_later: 'Оплата будет позже',
    paid_directly_to_organization: 'Оплачено напрямую организации',
    free_order: 'Заказ выполнен без оплаты',
    customer_did_not_pay: 'Клиент не оплатил',
    other: 'Другая причина',
  };
  return labels[reason] ?? reason;
}
