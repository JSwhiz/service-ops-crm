import { Type } from 'class-transformer';
import { IsInt, Min } from 'class-validator';

export class RestoreInventoryItemDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedVersion!: number;
}
