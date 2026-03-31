import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

import { GetTimesheetQueryDto } from './dto/get-timesheet-query.dto';
import { TimesheetResponseDto } from './dto/timesheet-response.dto';
import { UpsertTimesheetEntryDto } from './dto/upsert-timesheet-entry.dto';
import { TimesheetsService } from './timesheets.service';

interface CurrentAuthUser {
  id: string;
  login: string;
  fullName: string;
  roleCode: string;
  isActive: boolean;
}

@UseGuards(JwtAuthGuard)
@Controller('timesheets')
export class TimesheetsController {
  constructor(private readonly timesheetsService: TimesheetsService) {}

  @Get()
  getTimesheet(
    @CurrentUser() user: CurrentAuthUser,
    @Query() query: GetTimesheetQueryDto,
  ): Promise<TimesheetResponseDto> {
    return this.timesheetsService.getTimesheet(user, query);
  }

  @Post('entries')
  upsertEntry(
    @CurrentUser() user: CurrentAuthUser,
    @Body() payload: UpsertTimesheetEntryDto,
  ): Promise<TimesheetResponseDto> {
    return this.timesheetsService.upsertEntry(user, payload);
  }
}
