import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

import { CreateArrivalPhotoDto } from './dto/create-arrival-photo.dto';
import { CreateObjectCommentDto } from './dto/create-object-comment.dto';
import { ListObjectFeedQueryDto } from './dto/list-object-feed-query.dto';
import { ObjectArrivalPhotoResponseDto } from './dto/object-arrival-photo-response.dto';
import { ObjectCommentResponseDto } from './dto/object-comment-response.dto';
import { ObjectDailyReportResponseDto } from './dto/object-daily-report-response.dto';
import { ObjectEmployeeOptionDto } from './dto/object-employee-option.dto';
import { ObjectFeedItemDto } from './dto/object-feed-item.dto';
import { UpsertDailyReportDto } from './dto/upsert-daily-report.dto';
import { UpsertObjectAttendanceDto } from './dto/upsert-object-attendance.dto';
import { ObjectOperationsService } from './object-operations.service';

interface CurrentAuthUser {
  id: string;
  login: string;
  fullName: string;
  roleCode: string;
  isActive: boolean;
}

@UseGuards(JwtAuthGuard)
@Controller('objects/:id')
export class ObjectOperationsController {
  constructor(
    private readonly objectOperationsService: ObjectOperationsService,
  ) {}

  @Get('arrival-photo/today')
  async getTodayArrivalPhoto(
    @CurrentUser() user: CurrentAuthUser,
    @Param('id') objectId: string,
    @Res() response: Response,
  ): Promise<void> {
    const result = await this.objectOperationsService.getTodayArrivalPhoto(
      user,
      objectId,
    );

    response.json(result ?? null);
  }

  @Post('arrival-photo')
  upsertTodayArrivalPhoto(
    @CurrentUser() user: CurrentAuthUser,
    @Param('id') objectId: string,
    @Body() payload: CreateArrivalPhotoDto,
  ): Promise<ObjectArrivalPhotoResponseDto> {
    return this.objectOperationsService.upsertTodayArrivalPhoto(
      user,
      objectId,
      payload,
    );
  }

  @Get('daily-report/today')
  async getTodayDailyReport(
    @CurrentUser() user: CurrentAuthUser,
    @Param('id') objectId: string,
    @Res() response: Response,
  ): Promise<void> {
    const result = await this.objectOperationsService.getTodayDailyReport(
      user,
      objectId,
    );

    response.json(result ?? null);
  }

  @Put('daily-report/today')
  upsertTodayDailyReport(
    @CurrentUser() user: CurrentAuthUser,
    @Param('id') objectId: string,
    @Body() payload: UpsertDailyReportDto,
  ): Promise<ObjectDailyReportResponseDto> {
    return this.objectOperationsService.upsertTodayDailyReport(
      user,
      objectId,
      payload,
    );
  }

  @Get('comments')
  listComments(
    @CurrentUser() user: CurrentAuthUser,
    @Param('id') objectId: string,
  ): Promise<ObjectCommentResponseDto[]> {
    return this.objectOperationsService.listComments(user, objectId);
  }

  @Post('comments')
  createComment(
    @CurrentUser() user: CurrentAuthUser,
    @Param('id') objectId: string,
    @Body() payload: CreateObjectCommentDto,
  ): Promise<ObjectCommentResponseDto> {
    return this.objectOperationsService.createComment(user, objectId, payload);
  }

  @Get('feed')
  getFeed(
    @CurrentUser() user: CurrentAuthUser,
    @Param('id') objectId: string,
    @Query() query: ListObjectFeedQueryDto,
  ): Promise<ObjectFeedItemDto[]> {
    return this.objectOperationsService.getFeed(user, objectId, query);
  }

  @Post('attendance')
  upsertObjectAttendance(
    @CurrentUser() user: CurrentAuthUser,
    @Param('id') objectId: string,
    @Body() payload: UpsertObjectAttendanceDto,
  ): Promise<{ success: true }> {
    return this.objectOperationsService.upsertObjectAttendance(
      user,
      objectId,
      payload,
    );
  }

  @Get('employees')
  listObjectEmployees(
    @CurrentUser() user: CurrentAuthUser,
    @Param('id') objectId: string,
  ): Promise<ObjectEmployeeOptionDto[]> {
    return this.objectOperationsService.listObjectEmployees(user, objectId);
  }

  @Get('ping')
  ping(): { ok: true; scope: string } {
    return {
      ok: true,
      scope: 'object-operations',
    };
  }
}
