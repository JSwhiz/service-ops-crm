export function getAccountabilityAccountStatusLabel(status: string | null): string {
  switch (status) {
    case 'active':
      return 'Активен';
    case 'closing_requested':
      return 'Отправлен на сверку';
    case 'closed':
      return 'Закрыт';
    case null:
      return 'Не открыт';
    default:
      return status;
  }
}

export function getAccountabilityExpenseStatusLabel(status: string): string {
  switch (status) {
    case 'draft':
      return 'Черновик';
    case 'submitted':
      return 'Отправлен';
    case 'approved':
      return 'Подтвержден';
    case 'rejected':
      return 'Отклонен';
    case 'reconciled':
      return 'Сверен';
    default:
      return status;
  }
}

export function getAccountabilityExpenseCategoryLabel(
  category: string | null,
): string {
  switch (category) {
    case 'consumables':
      return 'Расходные материалы';
    case 'delivery':
      return 'Доставка';
    case 'transport':
      return 'Транспорт';
    case 'services':
      return 'Услуги';
    case 'other':
      return 'Другое';
    case null:
      return 'Без категории';
    default:
      return category;
  }
}

export function getAccountabilityClosureStatusLabel(status: string): string {
  switch (status) {
    case 'requested':
      return 'Запрошена сверка';
    case 'approved':
      return 'Сверка подтверждена';
    case 'rejected':
      return 'Сверка отклонена';
    default:
      return status;
  }
}

export function getAccountabilityFundingTypeLabel(type: string): string {
  switch (type) {
    case 'manual_issue':
      return 'Выдача денег';
    case 'one_time_order_receipt':
      return 'Поступление от разового заказа';
    case 'one_time_order_receipt_reversal':
      return 'Сторнирование поступления';
    case 'manual_correction':
      return 'Ручная корректировка';
    default:
      return type;
  }
}
