import { Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

import { ListNotificationsQueryDto } from './dto/list-notifications-query.dto';
import { NotificationListResponseDto, NotificationResponseDto } from './dto/notification-response.dto';
import { NotificationsService } from './notifications.service';

@UseGuards(JwtAuthGuard)
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  list(@CurrentUser() user: { id: string }, @Query() query: ListNotificationsQueryDto): Promise<NotificationListResponseDto> {
    return this.notificationsService.list(user.id, query);
  }

  @Get('unread-count')
  unreadCount(@CurrentUser() user: { id: string }): Promise<{ count: number }> {
    return this.notificationsService.unreadCount(user.id);
  }

  @Post('read-all')
  markAllRead(@CurrentUser() user: { id: string }): Promise<{ updated: number }> {
    return this.notificationsService.markAllRead(user.id);
  }

  @Post(':id/read')
  markRead(@CurrentUser() user: { id: string }, @Param('id') id: string): Promise<NotificationResponseDto> {
    return this.notificationsService.markRead(user.id, id);
  }
}
