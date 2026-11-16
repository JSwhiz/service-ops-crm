import { InventoryMovementResponseDto } from './inventory-movement-response.dto';

/** Extend the scoped API without removing its original flat identifiers. */
export class OrderInventoryIssueResponseDto extends InventoryMovementResponseDto {
  inventoryItemId!: string;
  oneTimeOrderId!: string;
}

export type OrderInventoryIssueResult = OrderInventoryIssueResponseDto | { outcome: 'saved_without_access' };
