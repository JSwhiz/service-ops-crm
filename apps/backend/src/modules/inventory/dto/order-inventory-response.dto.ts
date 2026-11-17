import { InventoryItemResponseDto } from './inventory-item-response.dto';
import { InventoryMovementListResponseDto } from './inventory-movement-list-response.dto';

export class OrderInventoryResponseDto extends InventoryMovementListResponseDto {
  availableItems!: InventoryItemResponseDto[];
  availableReturnItems!: InventoryItemResponseDto[];
  capabilities!: { canIssueInventoryToOrder: boolean; canReturnInventoryFromOrder: boolean };
}
