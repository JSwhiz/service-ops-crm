export const INVENTORY_MOVEMENT_TYPE_OPTIONS = [
  { value: 'receipt', label: 'Приход' },
  { value: 'issue_to_object', label: 'Выдача на объект' },
  { value: 'issue_to_one_time_order', label: 'Выдача на разовый заказ' },
  { value: 'return', label: 'Возврат' },
  { value: 'writeoff', label: 'Списание' },
  { value: 'adjustment', label: 'Корректировка' },
] as const;

export function getInventoryMovementTypeLabel(value: string): string {
  return (
    INVENTORY_MOVEMENT_TYPE_OPTIONS.find((option) => option.value === value)
      ?.label ?? value
  );
}

export function formatInventoryQuantity(value: number, unit: string): string {
  return `${value.toFixed(3).replace(/\.?0+$/, '')} ${unit}`;
}
