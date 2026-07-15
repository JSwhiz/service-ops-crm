import {
  ArrayUnique,
  IsArray,
  IsOptional,
  IsUUID,
  Matches,
} from 'class-validator';

export class CheckOneTimeOrderConflictsDto {
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  executionStartDate!: string;

  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  executionEndDate!: string;

  @IsArray()
  @ArrayUnique()
  @IsUUID('4', { each: true })
  managerUserIds!: string[];

  @IsOptional()
  @IsUUID('4')
  excludeOrderId?: string;
}
