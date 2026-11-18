import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsDateString, IsInt, IsOptional, IsString, IsUUID, Length, Matches, Max, Min } from 'class-validator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { AccessSubject } from '../users-access/types/access-policy.type';
import { EmployeeSubstitutionReadService } from './employee-substitution-read.service';

export class EmployeeSubstitutionReadQuery {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100000) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50) limit = 25;
  @IsOptional() @IsString() @Length(0, 200) q?: string;
  @IsOptional() @IsUUID() objectId?: string;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) @IsDateString({ strict: true }) from?: string;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) @IsDateString({ strict: true }) to?: string;
}

@UseGuards(JwtAuthGuard)
@Controller('workforce-substitutions')
export class EmployeeSubstitutionReadController {
  constructor(private readonly service: EmployeeSubstitutionReadService) {}
  @Get()
  list(@CurrentUser() actor: AccessSubject, @Query() query: EmployeeSubstitutionReadQuery) {
    return this.service.list(actor, query);
  }
}
