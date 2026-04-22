export const EQUIPMENT_STATUS_OPTIONS = [
  'in_storage',
  'assigned_to_object',
  'assigned_to_one_time_order',
  'under_repair',
  'broken',
  'lost',
  'written_off',
] as const;

export const EQUIPMENT_MOVEMENT_OPTIONS = [
  'issue_to_object',
  'issue_to_one_time_order',
  'return_to_storage',
  'send_to_repair',
  'return_from_repair',
  'mark_broken',
  'mark_lost',
  'writeoff',
] as const;

export function getEquipmentStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    in_storage: 'На складе',
    assigned_to_object: 'На объекте',
    assigned_to_one_time_order: 'На разовом заказе',
    under_repair: 'В ремонте',
    broken: 'Неисправно',
    lost: 'Утеряно',
    written_off: 'Списано',
  };

  return labels[status] ?? status;
}

export function getEquipmentMovementLabel(type: string): string {
  const labels: Record<string, string> = {
    issue_to_object: 'Выдача на объект',
    issue_to_one_time_order: 'Выдача на разовый заказ',
    return_to_storage: 'Возврат на склад',
    send_to_repair: 'Передача в ремонт',
    return_from_repair: 'Возврат из ремонта',
    mark_broken: 'Отметить неисправность',
    mark_lost: 'Отметить утерю',
    writeoff: 'Списание',
  };

  return labels[type] ?? type;
}
