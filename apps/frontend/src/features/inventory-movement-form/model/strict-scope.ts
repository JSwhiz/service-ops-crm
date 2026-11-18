import type { InventoryItem, InventoryObjectReference, InventoryOneTimeOrderReference, CreateInventoryMovementPayload } from '@/entities/inventory/model/inventory.types';

export interface StrictMovementScope {
  ready: boolean;
  items: InventoryItem[];
  objects: InventoryObjectReference[];
  orders: InventoryOneTimeOrderReference[];
  movementType: CreateInventoryMovementPayload['movementType'];
  relationScope: 'object' | 'one_time_order' | 'none';
  objectId: string;
  orderId: string;
}
export interface MovementLine { inventoryItemId: string; quantity: string; movementId?: string }

export function itemAllowsMovement(item: InventoryItem | undefined, type: string): boolean {
  if (!item?.isActive || item.deletedAt) return false;
  switch (type) {
    case 'receipt': return item.capabilities?.canCreateReceipt === true;
    case 'return': return item.capabilities?.canReturn === true;
    case 'writeoff': return item.capabilities?.canWriteoff === true;
    case 'adjustment': return item.capabilities?.canAdjust === true;
    // Issue permission belongs to the destination, not the item projection.
    case 'issue_to_object': case 'issue_to_one_time_order': return true;
    default: return false;
  }
}

export function strictTypeAvailable(scope: StrictMovementScope, type: string): boolean {
  if (!scope.ready) return false;
  if (type === 'issue_to_object') return scope.objects.some((row) => row.capabilities?.canIssueToObject === true);
  if (type === 'issue_to_one_time_order') return scope.orders.some((row) => row.capabilities?.canIssueToOneTimeOrder === true);
  return scope.items.some((item) => itemAllowsMovement(item, type));
}

export function strictMovementError(scope: StrictMovementScope, lines: MovementLine[]): string | null {
  if (!scope.ready) return 'Проверяем актуальные права. Черновик сохранён.';
  if (!lines.length) return 'Добавьте позицию движения.';
  const pending = lines.filter((line) => !line.movementId);
  // Created rows are evidence retries, never another business POST.
  if (!pending.length) return null;
  for (const line of pending) {
    if (!itemAllowsMovement(scope.items.find((item) => item.id === line.inventoryItemId), scope.movementType)) {
      return 'Выбранная позиция недоступна для этой операции. Выбор и черновик сохранены.';
    }
    if (!Number.isFinite(Number(line.quantity)) || Number(line.quantity) < 0.001) return 'Укажите количество не меньше 0,001 для каждой позиции.';
  }
  if (scope.movementType === 'issue_to_object') {
    return scope.objects.find((row) => row.id === scope.objectId)?.capabilities?.canIssueToObject === true
      ? null : 'Выбранный объект недоступен для выдачи. Выберите разрешённый объект.';
  }
  if (scope.movementType === 'issue_to_one_time_order') {
    // Backend flag includes the generic global-issuer invariant. Never infer it from role/assignment.
    return scope.orders.find((row) => row.id === scope.orderId)?.capabilities?.canIssueToOneTimeOrder === true
      ? null : 'Отгрузка со склада в выбранный заказ недоступна. Проверьте возможность отгрузки в карточке заказа.';
  }
  if (scope.movementType === 'return' || scope.movementType === 'writeoff') {
    if (scope.relationScope === 'object') {
      if (!scope.objectId && scope.movementType === 'writeoff') return null;
      if (!scope.objects.some((row) => row.id === scope.objectId)) return 'Связанный объект недоступен. Черновик сохранён.';
    } else if (scope.relationScope === 'one_time_order') {
      if (!scope.orderId && scope.movementType === 'writeoff') return null;
      if (scope.orders.find((row) => row.id === scope.orderId)?.capabilities?.canLinkMovement !== true) return 'Выбранный заказ недоступен для связи с движением. Черновик сохранён.';
    } else if (scope.movementType === 'return') return 'Для возврата выберите связанный объект или заказ.';
  }
  return null;
}

/** A page miss is not a revocation: retain independently revalidated selections. */
export function mergeInventoryChoices(page: InventoryItem[], selected: InventoryItem[]): InventoryItem[] {
  return [...new Map([...page, ...selected].map((item) => [item.id, item])).values()];
}
