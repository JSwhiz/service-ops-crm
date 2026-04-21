import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CreateObjectInventoryIssueDto } from '../inventory/dto/create-object-inventory-issue.dto';
import { InventoryMovementResponseDto } from '../inventory/dto/inventory-movement-response.dto';
import { ObjectInventoryResponseDto } from '../inventory/dto/object-inventory-response.dto';

import { AddObjectEmployeeDto } from './dto/add-object-employee.dto';
import { CreateArrivalPhotoDto } from './dto/create-arrival-photo.dto';
import { CreateObjectCommentDto } from './dto/create-object-comment.dto';
import { ListEmployeeDirectoryQueryDto } from './dto/list-employee-directory-query.dto';
import { ListObjectFeedQueryDto } from './dto/list-object-feed-query.dto';
import { LinkedOneTimeOrderProjectionDto } from './dto/linked-one-time-order-projection.dto';
import { ObjectArrivalPhotoResponseDto } from './dto/object-arrival-photo-response.dto';
import { ObjectAttendanceResponseDto } from './dto/object-attendance-response.dto';
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
  roleCodes?: string[];
  isActive: boolean;
}

@UseGuards(JwtAuthGuard)
@Controller('objects/:id')
export class ObjectOperationsController {
  constructor(
    private readonly objectOperationsService: ObjectOperationsService,
  ) {}

  @Get('arrival-photo/today')
  getTodayArrivalPhoto(
    @CurrentUser() user: CurrentAuthUser,
    @Param('id') objectId: string,
  ): Promise<ObjectArrivalPhotoResponseDto | null> {
    return this.objectOperationsService.getTodayArrivalPhoto(user, objectId);
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
  getTodayDailyReport(
    @CurrentUser() user: CurrentAuthUser,
    @Param('id') objectId: string,
  ): Promise<ObjectDailyReportResponseDto | null> {
    return this.objectOperationsService.getTodayDailyReport(user, objectId);
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

  @Get('linked-one-time-orders')
  listLinkedOneTimeOrders(
    @CurrentUser() user: CurrentAuthUser,
    @Param('id') objectId: string,
  ): Promise<LinkedOneTimeOrderProjectionDto[]> {
    return this.objectOperationsService.listLinkedOneTimeOrders(user, objectId);
  }

  @Get('inventory')
  getObjectInventory(
    @CurrentUser() user: CurrentAuthUser,
    @Param('id') objectId: string,
  ): Promise<ObjectInventoryResponseDto> {
    return this.objectOperationsService.getObjectInventory(user, objectId);
  }

  @Post('inventory/issue')
  createObjectInventoryIssue(
    @CurrentUser() user: CurrentAuthUser,
    @Param('id') objectId: string,
    @Body() payload: CreateObjectInventoryIssueDto,
  ): Promise<InventoryMovementResponseDto> {
    return this.objectOperationsService.createObjectInventoryIssue(
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

  @Get('employee-directory')
  searchEmployeeDirectory(
    @CurrentUser() user: CurrentAuthUser,
    @Param('id') objectId: string,
    @Query() query: ListEmployeeDirectoryQueryDto,
  ): Promise<ObjectEmployeeOptionDto[]> {
    return this.objectOperationsService.searchEmployeeDirectory(
      user,
      objectId,
      query,
    );
  }

  @Post('employees')
  addEmployeeToObject(
    @CurrentUser() user: CurrentAuthUser,
    @Param('id') objectId: string,
    @Body() payload: AddObjectEmployeeDto,
  ): Promise<{ success: true }> {
    return this.objectOperationsService.addEmployeeToObject(
      user,
      objectId,
      payload,
    );
  }

  @Delete('employees/:employeeId')
  removeEmployeeFromObject(
    @CurrentUser() user: CurrentAuthUser,
    @Param('id') objectId: string,
    @Param('employeeId') employeeId: string,
  ): Promise<{ success: true }> {
    return this.objectOperationsService.removeEmployeeFromObject(
      user,
      objectId,
      employeeId,
    );
  }

  @Get('attendance/today')
  getTodayAttendance(
    @CurrentUser() user: CurrentAuthUser,
    @Param('id') objectId: string,
  ): Promise<ObjectAttendanceResponseDto> {
    return this.objectOperationsService.getTodayAttendance(user, objectId);
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
}
