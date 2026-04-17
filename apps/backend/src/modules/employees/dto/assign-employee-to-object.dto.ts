import { IsDateString, IsOptional, IsString } from 'class-validator';

export class AssignEmployeeToObjectDto {
  @IsString()
  objectId!: string;

  @IsOptional()
  @IsDateString()
  startDate?: string;
}
