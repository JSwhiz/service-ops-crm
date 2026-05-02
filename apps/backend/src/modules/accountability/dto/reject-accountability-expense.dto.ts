import { IsString } from 'class-validator';

export class RejectAccountabilityExpenseDto {
  @IsString()
  comment!: string;
}
