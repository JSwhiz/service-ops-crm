import { Type } from 'class-transformer';
import { IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class CreateObjectInventoryIssueDto {
  @IsString()
  inventoryItemId!: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0.001)
  quantity!: number;

  @IsOptional()
  @IsString()
  comment?: string;
}
