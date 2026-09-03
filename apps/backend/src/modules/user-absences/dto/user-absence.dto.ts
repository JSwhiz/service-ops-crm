import { IsIn, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';

export const USER_ABSENCE_TYPES = ['vacation', 'sick_leave', 'day_off'] as const;
export type UserAbsenceType = (typeof USER_ABSENCE_TYPES)[number];

export class ListUserAbsencesQueryDto {
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  from?: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  to?: string;

  @IsOptional()
  @IsUUID('4')
  userId?: string;

  @IsOptional()
  @IsIn(USER_ABSENCE_TYPES)
  absenceType?: UserAbsenceType;
}

export class CreateUserAbsenceDto {
  @IsUUID('4')
  userId!: string;

  @IsIn(USER_ABSENCE_TYPES)
  absenceType!: UserAbsenceType;

  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  startDate!: string;

  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  endDate!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  comment?: string | null;
}

export class UpdateUserAbsenceDto {
  @IsOptional()
  @IsIn(USER_ABSENCE_TYPES)
  absenceType?: UserAbsenceType;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  startDate?: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  endDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  comment?: string | null;
}

export interface UserAbsenceResponseDto {
  id: string;
  userId: string;
  user: { id: string; login: string; fullName: string };
  absenceType: UserAbsenceType;
  startDate: string;
  endDate: string;
  comment: string | null;
  createdByUserId: string;
  createdAt: string;
  updatedAt: string;
}

export interface UserAbsenceCapabilitiesDto {
  canViewAll: boolean;
  canManage: boolean;
}

export interface UserAbsenceListResponseDto {
  items: UserAbsenceResponseDto[];
  capabilities: UserAbsenceCapabilitiesDto;
}
