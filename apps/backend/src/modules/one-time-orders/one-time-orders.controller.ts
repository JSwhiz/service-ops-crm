import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { EquipmentScopeResponseDto } from '../equipment/dto/equipment-response.dto';
import { TaskResponseDto } from '../tasks/dto/task-response.dto';

import { AssignOneTimeOrderManagerDto } from './dto/assign-one-time-order-manager.dto';
import { CheckOneTimeOrderConflictsDto } from './dto/check-one-time-order-conflicts.dto';
import {
  CreateOneTimeManagerAvailabilityDirectDto,
  CreateOneTimeManagerAvailabilityRequestDto,
} from './dto/create-one-time-manager-availability.dto';
import { ChangeOneTimeOrderStatusDto } from './dto/change-one-time-order-status.dto';
import { CreateOneTimeOrderCommentDto } from './dto/create-one-time-order-comment.dto';
import { CreateOneTimeOrderPhotoDto } from './dto/create-one-time-order-photo.dto';
import { CreateOneTimeOrderDto } from './dto/create-one-time-order.dto';
import { CreateOneTimeOrderSpecificationItemDto } from './dto/create-one-time-order-specification-item.dto';
import { DeleteOneTimeOrderPhotoDto } from './dto/delete-one-time-order-photo.dto';
import { ListOneTimeOrderCalendarQueryDto } from './dto/list-one-time-order-calendar-query.dto';
import { ListOneTimeOrdersQueryDto } from './dto/list-one-time-orders-query.dto';
import { OneTimeOrderAuditLogResponseDto } from './dto/one-time-order-audit-log-response.dto';
import { OneTimeOrderCommentResponseDto } from './dto/one-time-order-comment-response.dto';
import { OneTimeOrderDailyReportResponseDto } from './dto/one-time-order-daily-report-response.dto';
import { OneTimeOrderListResponseDto } from './dto/one-time-order-list-response.dto';
import { OneTimeOrderCalendarResponseDto } from './dto/one-time-order-calendar-response.dto';
import { OneTimeOrderConflictResponseDto } from './dto/one-time-order-conflict-response.dto';
import { OneTimeManagerAvailabilityResponseDto } from './dto/one-time-manager-availability-response.dto';
import { OneTimeOrderPhotoResponseDto } from './dto/one-time-order-photo-response.dto';
import { OneTimeOrderResponseDto } from './dto/one-time-order-response.dto';
import { OneTimeOrderSpecificationItemResponseDto } from './dto/one-time-order-specification-item-response.dto';
import { ReorderOneTimeOrderSpecificationItemsDto } from './dto/reorder-one-time-order-specification-items.dto';
import {
  ApproveOneTimeManagerAvailabilityDto,
  RejectOneTimeManagerAvailabilityDto,
} from './dto/resolve-one-time-manager-availability.dto';
import { UpsertOneTimeOrderDailyReportDto } from './dto/upsert-one-time-order-daily-report.dto';
import { UpdateOneTimeOrderDto } from './dto/update-one-time-order.dto';
import { UpdateOneTimeManagerAvailabilityDto } from './dto/update-one-time-manager-availability.dto';
import { UpdateOneTimeOrderReviewDto } from './dto/update-one-time-order-review.dto';
import { UpdateOneTimeOrderSpecificationItemDto } from './dto/update-one-time-order-specification-item.dto';
import { OneTimeOrdersService } from './one-time-orders.service';
import { OneTimeOrderCalendarService } from './one-time-order-calendar.service';
import { OneTimeOrderConflictService } from './one-time-order-conflict.service';
import { OneTimeManagerAvailabilityService } from './one-time-manager-availability.service';

interface CurrentAuthUser {
  id: string;
  login: string;
  fullName: string;
  roleCode: string;
  roleCodes?: string[];
  permissionCodes?: string[];
  isActive: boolean;
}

@UseGuards(JwtAuthGuard)
@Controller('one-time-orders')
export class OneTimeOrdersController {
  constructor(
    private readonly oneTimeOrdersService: OneTimeOrdersService,
    private readonly oneTimeManagerAvailabilityService: OneTimeManagerAvailabilityService,
    private readonly oneTimeOrderCalendarService: OneTimeOrderCalendarService,
    private readonly oneTimeOrderConflictService: OneTimeOrderConflictService,
  ) {}

  @Get('calendar')
  getCalendar(
    @CurrentUser() user: CurrentAuthUser,
    @Query() query: ListOneTimeOrderCalendarQueryDto,
  ): Promise<OneTimeOrderCalendarResponseDto> {
    return this.oneTimeOrderCalendarService.getCalendar(user, query);
  }

  @Post('calendar/check-conflicts')
  checkCalendarConflicts(
    @CurrentUser() user: CurrentAuthUser,
    @Body() payload: CheckOneTimeOrderConflictsDto,
  ): Promise<OneTimeOrderConflictResponseDto> {
    return this.oneTimeOrderConflictService.checkConflicts(user, payload);
  }

  @Post('calendar/availability-requests')
  createOwnAvailabilityRequest(
    @CurrentUser() user: CurrentAuthUser,
    @Body() payload: CreateOneTimeManagerAvailabilityRequestDto,
  ): Promise<OneTimeManagerAvailabilityResponseDto> {
    return this.oneTimeManagerAvailabilityService.createOwnRequest(user, payload);
  }

  @Get('calendar/availability-requests/me')
  listOwnAvailabilityRequests(
    @CurrentUser() user: CurrentAuthUser,
  ): Promise<OneTimeManagerAvailabilityResponseDto[]> {
    return this.oneTimeManagerAvailabilityService.listOwnRequests(user);
  }

  @Post('calendar/availability/direct')
  createDirectAvailability(
    @CurrentUser() user: CurrentAuthUser,
    @Body() payload: CreateOneTimeManagerAvailabilityDirectDto,
  ): Promise<OneTimeManagerAvailabilityResponseDto> {
    return this.oneTimeManagerAvailabilityService.createDirect(user, payload);
  }

  @Post('calendar/availability/:id/approve')
  approveAvailability(
    @CurrentUser() user: CurrentAuthUser,
    @Param('id') id: string,
    @Body() payload: ApproveOneTimeManagerAvailabilityDto,
  ): Promise<OneTimeManagerAvailabilityResponseDto> {
    return this.oneTimeManagerAvailabilityService.approveAvailability(
      user,
      id,
      payload,
    );
  }

  @Post('calendar/availability/:id/reject')
  rejectAvailability(
    @CurrentUser() user: CurrentAuthUser,
    @Param('id') id: string,
    @Body() payload: RejectOneTimeManagerAvailabilityDto,
  ): Promise<OneTimeManagerAvailabilityResponseDto> {
    return this.oneTimeManagerAvailabilityService.rejectAvailability(
      user,
      id,
      payload,
    );
  }

  @Post('calendar/availability/:id/cancel')
  cancelAvailability(
    @CurrentUser() user: CurrentAuthUser,
    @Param('id') id: string,
  ): Promise<OneTimeManagerAvailabilityResponseDto> {
    return this.oneTimeManagerAvailabilityService.cancelAvailability(user, id);
  }

  @Patch('calendar/availability/:id')
  updateAvailability(
    @CurrentUser() user: CurrentAuthUser,
    @Param('id') id: string,
    @Body() payload: UpdateOneTimeManagerAvailabilityDto,
  ): Promise<OneTimeManagerAvailabilityResponseDto> {
    return this.oneTimeManagerAvailabilityService.updateApprovedAvailability(
      user,
      id,
      payload,
    );
  }

  @Get()
  listOrders(
    @CurrentUser() user: CurrentAuthUser,
    @Query() query: ListOneTimeOrdersQueryDto,
  ): Promise<OneTimeOrderListResponseDto> {
    return this.oneTimeOrdersService.listOrders(user, query);
  }

  @Get(':id')
  getOrderById(
    @CurrentUser() user: CurrentAuthUser,
    @Param('id') id: string,
  ): Promise<OneTimeOrderResponseDto> {
    return this.oneTimeOrdersService.getOrderById(user, id);
  }

  @Post()
  createOrder(
    @CurrentUser() user: CurrentAuthUser,
    @Body() payload: CreateOneTimeOrderDto,
  ): Promise<OneTimeOrderResponseDto> {
    return this.oneTimeOrdersService.createOrder(user, payload);
  }

  @Patch(':id')
  updateOrder(
    @CurrentUser() user: CurrentAuthUser,
    @Param('id') id: string,
    @Body() payload: UpdateOneTimeOrderDto,
  ): Promise<OneTimeOrderResponseDto> {
    return this.oneTimeOrdersService.updateOrder(user, id, payload);
  }

  @Patch(':id/review')
  updateReview(
    @CurrentUser() user: CurrentAuthUser,
    @Param('id') id: string,
    @Body() payload: UpdateOneTimeOrderReviewDto,
  ): Promise<OneTimeOrderResponseDto> {
    return this.oneTimeOrdersService.updateReview(user, id, payload);
  }

  @Delete(':id/review')
  clearReview(
    @CurrentUser() user: CurrentAuthUser,
    @Param('id') id: string,
  ): Promise<OneTimeOrderResponseDto> {
    return this.oneTimeOrdersService.clearReview(user, id);
  }

  @Get(':id/specification-items')
  listSpecificationItems(
    @CurrentUser() user: CurrentAuthUser,
    @Param('id') id: string,
  ): Promise<OneTimeOrderSpecificationItemResponseDto[]> {
    return this.oneTimeOrdersService.listSpecificationItems(user, id);
  }

  @Post(':id/specification-items')
  createSpecificationItem(
    @CurrentUser() user: CurrentAuthUser,
    @Param('id') id: string,
    @Body() payload: CreateOneTimeOrderSpecificationItemDto,
  ): Promise<OneTimeOrderSpecificationItemResponseDto> {
    return this.oneTimeOrdersService.createSpecificationItem(user, id, payload);
  }

  @Patch(':id/specification-items/reorder')
  reorderSpecificationItems(
    @CurrentUser() user: CurrentAuthUser,
    @Param('id') id: string,
    @Body() payload: ReorderOneTimeOrderSpecificationItemsDto,
  ): Promise<OneTimeOrderSpecificationItemResponseDto[]> {
    return this.oneTimeOrdersService.reorderSpecificationItems(
      user,
      id,
      payload,
    );
  }

  @Patch(':id/specification-items/:itemId')
  updateSpecificationItem(
    @CurrentUser() user: CurrentAuthUser,
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @Body() payload: UpdateOneTimeOrderSpecificationItemDto,
  ): Promise<OneTimeOrderSpecificationItemResponseDto> {
    return this.oneTimeOrdersService.updateSpecificationItem(
      user,
      id,
      itemId,
      payload,
    );
  }

  @Delete(':id/specification-items/:itemId')
  deleteSpecificationItem(
    @CurrentUser() user: CurrentAuthUser,
    @Param('id') id: string,
    @Param('itemId') itemId: string,
  ): Promise<OneTimeOrderSpecificationItemResponseDto> {
    return this.oneTimeOrdersService.deleteSpecificationItem(user, id, itemId);
  }

  @Post(':id/specification-items/:itemId/complete')
  completeSpecificationItem(
    @CurrentUser() user: CurrentAuthUser,
    @Param('id') id: string,
    @Param('itemId') itemId: string,
  ): Promise<OneTimeOrderSpecificationItemResponseDto> {
    return this.oneTimeOrdersService.completeSpecificationItem(
      user,
      id,
      itemId,
    );
  }

  @Post(':id/specification-items/:itemId/reopen')
  reopenSpecificationItem(
    @CurrentUser() user: CurrentAuthUser,
    @Param('id') id: string,
    @Param('itemId') itemId: string,
  ): Promise<OneTimeOrderSpecificationItemResponseDto> {
    return this.oneTimeOrdersService.reopenSpecificationItem(user, id, itemId);
  }

  @Patch(':id/status')
  changeStatus(
    @CurrentUser() user: CurrentAuthUser,
    @Param('id') id: string,
    @Body() payload: ChangeOneTimeOrderStatusDto,
  ): Promise<OneTimeOrderResponseDto> {
    return this.oneTimeOrdersService.changeStatus(user, id, payload);
  }

  @Post(':id/managers')
  assignManager(
    @CurrentUser() user: CurrentAuthUser,
    @Param('id') id: string,
    @Body() payload: AssignOneTimeOrderManagerDto,
  ): Promise<OneTimeOrderResponseDto> {
    return this.oneTimeOrdersService.assignManager(user, id, payload);
  }

  @Delete(':id/managers/:userId')
  removeManager(
    @CurrentUser() user: CurrentAuthUser,
    @Param('id') id: string,
    @Param('userId') userId: string,
  ): Promise<OneTimeOrderResponseDto> {
    return this.oneTimeOrdersService.removeManager(user, id, userId);
  }

  @Get(':id/comments')
  listComments(
    @CurrentUser() user: CurrentAuthUser,
    @Param('id') id: string,
  ): Promise<OneTimeOrderCommentResponseDto[]> {
    return this.oneTimeOrdersService.listComments(user, id);
  }

  @Get(':id/daily-report/today')
  getTodayDailyReport(
    @CurrentUser() user: CurrentAuthUser,
    @Param('id') id: string,
  ): Promise<OneTimeOrderDailyReportResponseDto | null> {
    return this.oneTimeOrdersService.getTodayDailyReport(user, id);
  }

  @Put(':id/daily-report/today')
  upsertTodayDailyReport(
    @CurrentUser() user: CurrentAuthUser,
    @Param('id') id: string,
    @Body() payload: UpsertOneTimeOrderDailyReportDto,
  ): Promise<OneTimeOrderDailyReportResponseDto> {
    return this.oneTimeOrdersService.upsertTodayDailyReport(user, id, payload);
  }

  @Get(':id/photos')
  listPhotos(
    @CurrentUser() user: CurrentAuthUser,
    @Param('id') id: string,
    @Query('includeDeleted') includeDeleted?: string,
  ): Promise<OneTimeOrderPhotoResponseDto[]> {
    return this.oneTimeOrdersService.listPhotos(
      user,
      id,
      includeDeleted === 'true',
    );
  }

  @Post(':id/photos')
  createPhoto(
    @CurrentUser() user: CurrentAuthUser,
    @Param('id') id: string,
    @Body() payload: CreateOneTimeOrderPhotoDto,
  ): Promise<OneTimeOrderPhotoResponseDto> {
    return this.oneTimeOrdersService.createPhoto(user, id, payload);
  }

  @Delete(':id/photos/:photoId')
  deletePhoto(
    @CurrentUser() user: CurrentAuthUser,
    @Param('id') id: string,
    @Param('photoId') photoId: string,
    @Body() payload: DeleteOneTimeOrderPhotoDto,
  ): Promise<OneTimeOrderPhotoResponseDto> {
    return this.oneTimeOrdersService.deletePhoto(user, id, photoId, payload);
  }

  @Post(':id/photos/:photoId/restore')
  restorePhoto(
    @CurrentUser() user: CurrentAuthUser,
    @Param('id') id: string,
    @Param('photoId') photoId: string,
  ): Promise<OneTimeOrderPhotoResponseDto> {
    return this.oneTimeOrdersService.restorePhoto(user, id, photoId);
  }

  @Post(':id/comments')
  createComment(
    @CurrentUser() user: CurrentAuthUser,
    @Param('id') id: string,
    @Body() payload: CreateOneTimeOrderCommentDto,
  ): Promise<OneTimeOrderCommentResponseDto> {
    return this.oneTimeOrdersService.createComment(user, id, payload);
  }

  @Get(':id/history')
  listHistory(
    @CurrentUser() user: CurrentAuthUser,
    @Param('id') id: string,
  ): Promise<OneTimeOrderAuditLogResponseDto[]> {
    return this.oneTimeOrdersService.listHistory(user, id);
  }

  @Get(':id/tasks')
  listTasks(
    @CurrentUser() user: CurrentAuthUser,
    @Param('id') id: string,
  ): Promise<TaskResponseDto[]> {
    return this.oneTimeOrdersService.listTasks(user, id);
  }

  @Get(':id/equipment')
  listEquipment(
    @CurrentUser() user: CurrentAuthUser,
    @Param('id') id: string,
  ): Promise<EquipmentScopeResponseDto> {
    return this.oneTimeOrdersService.listEquipment(user, id);
  }
}
