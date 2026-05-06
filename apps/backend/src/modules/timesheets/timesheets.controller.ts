import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  Res,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ApprovalRequestResponseDto } from '../approvals/dto/approval-request-response.dto';

import { CreateTimesheetManualExceptionDto } from './dto/create-timesheet-manual-exception.dto';
import { GetTimesheetQueryDto } from './dto/get-timesheet-query.dto';
import { ListTimesheetCorrectionsQueryDto } from './dto/list-timesheet-corrections-query.dto';
import { TimesheetCorrectionItemDto } from './dto/timesheet-correction-item.dto';
import { TimesheetResponseDto } from './dto/timesheet-response.dto';
import { UpsertTimesheetEntryDto } from './dto/upsert-timesheet-entry.dto';
import { TimesheetsService } from './timesheets.service';

interface CurrentAuthUser {
  id: string;
  login: string;
  fullName: string;
  roleCode: string;
  roleCodes?: string[];
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

  @Get('export')
  async exportTimesheet(
    @CurrentUser() user: CurrentAuthUser,
    @Query() query: GetTimesheetQueryDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const exportFile = await this.timesheetsService.exportTimesheet(user, query);

    response.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="${exportFile.fileName}"`,
    );

    return new StreamableFile(exportFile.buffer);
  }

  @Get('corrections')
  listCorrections(
    @CurrentUser() user: CurrentAuthUser,
    @Query() query: ListTimesheetCorrectionsQueryDto,
  ): Promise<TimesheetCorrectionItemDto[]> {
    return this.timesheetsService.listCorrections(user, query);
  }

  @Post('entries')
  upsertEntry(
    @CurrentUser() user: CurrentAuthUser,
    @Body() payload: UpsertTimesheetEntryDto,
  ): Promise<TimesheetResponseDto> {
    return this.timesheetsService.upsertEntry(user, payload);
  }

  @Post('exceptions')
  requestManualException(
    @CurrentUser() user: CurrentAuthUser,
    @Body() payload: CreateTimesheetManualExceptionDto,
  ): Promise<ApprovalRequestResponseDto> {
    return this.timesheetsService.requestManualException(user, payload);
  }
}
