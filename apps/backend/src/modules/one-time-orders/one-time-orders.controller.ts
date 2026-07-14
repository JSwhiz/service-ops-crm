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
import { ChangeOneTimeOrderStatusDto } from './dto/change-one-time-order-status.dto';
import { CreateOneTimeOrderCommentDto } from './dto/create-one-time-order-comment.dto';
import { CreateOneTimeOrderPhotoDto } from './dto/create-one-time-order-photo.dto';
import { CreateOneTimeOrderDto } from './dto/create-one-time-order.dto';
import { ListOneTimeOrdersQueryDto } from './dto/list-one-time-orders-query.dto';
import { OneTimeOrderAuditLogResponseDto } from './dto/one-time-order-audit-log-response.dto';
import { OneTimeOrderCommentResponseDto } from './dto/one-time-order-comment-response.dto';
import { OneTimeOrderDailyReportResponseDto } from './dto/one-time-order-daily-report-response.dto';
import { OneTimeOrderPhotoResponseDto } from './dto/one-time-order-photo-response.dto';
import { OneTimeOrderResponseDto } from './dto/one-time-order-response.dto';
import { UpsertOneTimeOrderDailyReportDto } from './dto/upsert-one-time-order-daily-report.dto';
import { UpdateOneTimeOrderDto } from './dto/update-one-time-order.dto';
import { UpdateOneTimeOrderReviewDto } from './dto/update-one-time-order-review.dto';
import { OneTimeOrdersService } from './one-time-orders.service';

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
  constructor(private readonly oneTimeOrdersService: OneTimeOrdersService) {}

  @Get()
  listOrders(
    @CurrentUser() user: CurrentAuthUser,
    @Query() query: ListOneTimeOrdersQueryDto,
  ): Promise<OneTimeOrderResponseDto[]> {
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
  ): Promise<OneTimeOrderPhotoResponseDto[]> {
    return this.oneTimeOrdersService.listPhotos(user, id);
  }

  @Post(':id/photos')
  createPhoto(
    @CurrentUser() user: CurrentAuthUser,
    @Param('id') id: string,
    @Body() payload: CreateOneTimeOrderPhotoDto,
  ): Promise<OneTimeOrderPhotoResponseDto> {
    return this.oneTimeOrdersService.createPhoto(user, id, payload);
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
