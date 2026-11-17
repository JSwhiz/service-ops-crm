import type { InventoryItem, InventoryMovement } from '@/entities/inventory/model/inventory.types';
import { postCommittedWrite } from '@/shared/api/fetcher';
import type { OrderInventoryIssueInput } from '../ui/one-time-order-inventory-issue-form';

export interface OrderInventoryReturnScope {
  availableReturnItems?: InventoryItem[];
  capabilities: { canReturnInventoryFromOrder?: boolean };
}

export function createOneTimeOrderInventoryReturn(orderId: string, input: OrderInventoryIssueInput) {
  return postCommittedWrite<InventoryMovement>(`/one-time-orders/${orderId}/inventory/return`, {
    body: JSON.stringify(input),
  });
}
