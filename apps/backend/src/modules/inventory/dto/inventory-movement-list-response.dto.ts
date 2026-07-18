import { InventoryMovementResponseDto } from './inventory-movement-response.dto';

export class InventoryMovementListResponseDto {
  items!: InventoryMovementResponseDto[];
  total!: number;
  page!: number;
  limit!: number;
  totalPages!: number;
}
