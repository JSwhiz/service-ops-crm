import { InventoryItemResponseDto } from './inventory-item-response.dto';
import { InventoryMovementResponseDto } from './inventory-movement-response.dto';

export class ObjectInventoryResponseDto {
  movements!: InventoryMovementResponseDto[];
  availableItems!: InventoryItemResponseDto[];
  capabilities!: {
    canIssueInventoryToObject: boolean;
    canResolveMissingPhotoApproval: boolean;
  };
}
