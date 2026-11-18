import { Type } from 'class-transformer';
import { IsInt, IsOptional, Min } from 'class-validator';

export class DeleteInventoryItemQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedVersion?: number;
}
