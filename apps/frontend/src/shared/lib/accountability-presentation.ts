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
