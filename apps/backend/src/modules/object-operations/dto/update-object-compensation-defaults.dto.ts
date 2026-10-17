import { ArrayUnique, IsArray, IsIn, IsInt, IsOptional, Min } from 'class-validator';

const SCHEDULES = ['1/6', '2/5', '3/4', '4/3', '5/2', '6/1', '7/0'];
const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

export class UpdateObjectCompensationDefaultsDto {
  @IsOptional() @IsIn(['daily', 'monthly']) paymentType?: 'daily' | 'monthly';
  @IsOptional() @IsInt() @Min(0) dailyRate?: number;
  @IsOptional() @IsInt() @Min(0) monthlySalary?: number;
  @IsOptional() @IsIn(SCHEDULES) paymentScheduleCode?: string | null;
  @IsOptional() @IsArray() @ArrayUnique() @IsIn(WEEKDAYS, { each: true }) paymentScheduleWeekdays?: string[];
  @IsOptional() @IsIn(['daily', 'monthly']) summerPaymentType?: 'daily' | 'monthly';
  @IsOptional() @IsInt() @Min(0) summerDailyRate?: number;
  @IsOptional() @IsInt() @Min(0) summerMonthlySalary?: number;
  @IsOptional() @IsIn(SCHEDULES) summerScheduleCode?: string | null;
  @IsOptional() @IsArray() @ArrayUnique() @IsIn(WEEKDAYS, { each: true }) summerScheduleWeekdays?: string[];
  @IsOptional() @IsIn(['daily', 'monthly']) winterPaymentType?: 'daily' | 'monthly';
  @IsOptional() @IsInt() @Min(0) winterDailyRate?: number;
  @IsOptional() @IsInt() @Min(0) winterMonthlySalary?: number;
  @IsOptional() @IsIn(SCHEDULES) winterScheduleCode?: string | null;
  @IsOptional() @IsArray() @ArrayUnique() @IsIn(WEEKDAYS, { each: true }) winterScheduleWeekdays?: string[];
}
