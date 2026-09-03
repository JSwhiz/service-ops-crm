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
import { EquipmentScopeResponseDto } from '../equipment/dto/equipment-response.dto';
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
import { UpdateObjectEmployeeRatePolicyDto } from './dto/update-object-employee-rate-policy.dto';
import { UpsertDailyReportDto } from './dto/upsert-daily-report.dto';
import { UpsertObjectAttendanceDto } from './dto/upsert-object-attendance.dto';
import { ObjectAttendanceSubmissionService } from './object-attendance-submission.service';
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
    private readonly objectAttendanceSubmissionService: ObjectAttendanceSubmissionService,
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

  @Get('equipment')
  getObjectEquipment(
    @CurrentUser() user: CurrentAuthUser,
    @Param('id') objectId: string,
  ): Promise<EquipmentScopeResponseDto> {
    return this.objectOperationsService.getObjectEquipment(user, objectId);
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

  @Put('employees/:employeeId/rate-policy')
  updateEmployeeRatePolicy(
    @CurrentUser() user: CurrentAuthUser,
    @Param('id') objectId: string,
    @Param('employeeId') employeeId: string,
    @Body() payload: UpdateObjectEmployeeRatePolicyDto,
  ): Promise<ObjectEmployeeOptionDto> {
    return this.objectOperationsService.updateEmployeeRatePolicy(
      user,
      objectId,
      employeeId,
      payload,
    );
  }

  @Get('attendance/today')
  async getTodayAttendance(
    @CurrentUser() user: CurrentAuthUser,
    @Param('id') objectId: string,
  ): Promise<ObjectAttendanceResponseDto> {
    const [attendance, submission] = await Promise.all([
      this.objectOperationsService.getTodayAttendance(user, objectId),
      this.objectAttendanceSubmissionService.getTodaySubmission(objectId),
    ]);

    return {
      ...attendance,
      submittedAt: submission?.submittedAt ?? null,
      submittedBy: submission?.submittedBy ?? null,
    };
  }

  @Post('attendance')
  async upsertObjectAttendance(
    @CurrentUser() user: CurrentAuthUser,
    @Param('id') objectId: string,
    @Body() payload: UpsertObjectAttendanceDto,
  ): Promise<{ success: true }> {
    const result = await this.objectOperationsService.upsertObjectAttendance(
      user,
      objectId,
      payload,
    );

    await this.objectAttendanceSubmissionService.markSubmitted({
      objectId,
      actorUserId: user.id,
      operationDate: payload.operationDate,
      employeeCount: payload.employeeIds.length,
    });

    return result;
  }
}
