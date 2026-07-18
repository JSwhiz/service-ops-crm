import { InventoryItemResponseDto } from './inventory-item-response.dto';

export class InventoryItemListResponseDto {
  items!: InventoryItemResponseDto[];
  total!: number;
  page!: number;
  limit!: number;
  totalPages!: number;
}
