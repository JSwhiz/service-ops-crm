import { Type } from 'class-transformer';
import { IsNumber, IsString, Min } from 'class-validator';

export class SaveAccountabilityExpenseDto {
  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  amount!: number;

  @IsString()
  description!: string;
}
