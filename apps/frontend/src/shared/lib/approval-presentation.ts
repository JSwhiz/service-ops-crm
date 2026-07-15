export const APPROVAL_STATUS_OPTIONS = [
  { value: '', label: 'Все статусы' },
  { value: 'pending', label: 'Ожидает решения' },
  { value: 'approved', label: 'Подтверждено' },
  { value: 'rejected', label: 'Отклонено' },
  { value: 'cancelled', label: 'Отменено' },
] as const;

export const APPROVAL_TYPE_OPTIONS = [
  { value: '', label: 'Все типы' },
  {
    value: 'task_result_confirmation',
    label: 'Результат задачи',
  },
  {
    value: 'inventory_exception_confirmation',
    label: 'Inventory exception',
  },
  {
    value: 'accountability_closure_confirmation',
    label: 'Сверка подотчета',
  },
  {
    value: 'object_change_confirmation',
    label: 'Изменение объекта',
  },
  {
    value: 'inventory_writeoff_confirmation',
    label: 'Списание расходников',
  },
  {
    value: 'equipment_writeoff_confirmation',
    label: 'Списание оборудования',
  },
  {
    value: 'manual_timesheet_exception_confirmation',
    label: 'Исключение табеля',
  },
  {
    value: 'one_time_manager_availability',
    label: 'Доступность менеджера',
  },
] as const;

const APPROVAL_STATUS_LABELS: Record<string, string> = {
  pending: 'Ожидает решения',
  approved: 'Подтверждено',
  rejected: 'Отклонено',
  cancelled: 'Отменено',
};

const APPROVAL_TYPE_LABELS: Record<string, string> = {
  task_result_confirmation: 'Результат задачи',
  inventory_exception_confirmation: 'Inventory exception',
  inventory_return_confirmation: 'Возврат расходников',
  inventory_writeoff_confirmation: 'Списание расходников',
  equipment_return_confirmation: 'Возврат оборудования',
  equipment_writeoff_confirmation: 'Списание оборудования',
  object_change_confirmation: 'Изменение объекта',
  accountability_closure_confirmation: 'Сверка подотчета',
  manual_timesheet_exception_confirmation: 'Исключение табеля',
  one_time_manager_availability: 'Доступность менеджера',
};

export function getApprovalStatusLabel(status: string): string {
  return APPROVAL_STATUS_LABELS[status] ?? status;
}

export function getApprovalTypeLabel(type: string): string {
  return APPROVAL_TYPE_LABELS[type] ?? type;
}
