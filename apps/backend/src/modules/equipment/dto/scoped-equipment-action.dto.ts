import { IsOptional, IsString, MaxLength } from 'class-validator';

export class ScopedEquipmentActionDto {
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  comment?: string;
}
