import { Injectable, NotFoundException } from '@nestjs/common';
import { Notification, Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';

import { ListNotificationsQueryDto } from './dto/list-notifications-query.dto';
import {
  NotificationListResponseDto,
  NotificationResponseDto,
} from './dto/notification-response.dto';

type NotificationDatabase = Pick<Prisma.TransactionClient, 'notification'>;

@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(params: {
    recipientUserId: string;
    type: string;
    title: string;
    body?: string | null;
    entityType?: string | null;
    entityId?: string | null;
    targetUrl?: string | null;
    dedupeKey?: string | null;
  }, database: NotificationDatabase = this.prisma): Promise<Notification> {
    const data = {
      recipientUserId: params.recipientUserId,
      type: params.type,
      title: params.title,
      body: params.body ?? null,
      entityType: params.entityType ?? null,
      entityId: params.entityId ?? null,
      targetUrl: params.targetUrl ?? null,
      dedupeKey: params.dedupeKey ?? null,
    };

    if (!params.dedupeKey) return database.notification.create({ data });

    await database.notification.createMany({
      data: [data],
      skipDuplicates: true,
    });
    return database.notification.findUniqueOrThrow({
      where: {
        recipientUserId_dedupeKey: {
          recipientUserId: params.recipientUserId,
          dedupeKey: params.dedupeKey,
        },
      },
    });
  }

  async list(recipientUserId: string, query: ListNotificationsQueryDto): Promise<NotificationListResponseDto> {
    const where = { recipientUserId };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.notification.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.notification.count({ where }),
    ]);

    return {
      items: items.map((item) => this.map(item)),
      page: query.page,
      limit: query.limit,
      total,
      totalPages: Math.ceil(total / query.limit),
    };
  }

  async unreadCount(recipientUserId: string): Promise<{ count: number }> {
    return {
      count: await this.prisma.notification.count({
        where: { recipientUserId, readAt: null },
      }),
    };
  }

  async markRead(recipientUserId: string, notificationId: string): Promise<NotificationResponseDto> {
    const result = await this.prisma.notification.updateMany({
      where: { id: notificationId, recipientUserId, readAt: null },
      data: { readAt: new Date() },
    });
    const notification = await this.prisma.notification.findFirst({
      where: { id: notificationId, recipientUserId },
    });
    if (!notification) throw new NotFoundException('Notification not found');
    if (result.count === 0 && !notification.readAt) {
      throw new NotFoundException('Notification not found');
    }
    return this.map(notification);
  }

  async markAllRead(recipientUserId: string): Promise<{ updated: number }> {
    const result = await this.prisma.notification.updateMany({
      where: { recipientUserId, readAt: null },
      data: { readAt: new Date() },
    });
    return { updated: result.count };
  }

  private map(notification: Notification): NotificationResponseDto {
    return {
      id: notification.id,
      type: notification.type,
      title: notification.title,
      body: notification.body,
      entityType: notification.entityType,
      entityId: notification.entityId,
      targetUrl: notification.targetUrl,
      readAt: notification.readAt?.toISOString() ?? null,
      createdAt: notification.createdAt.toISOString(),
    };
  }
}
