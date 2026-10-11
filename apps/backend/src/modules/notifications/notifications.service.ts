import {
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Notification, Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { CHAT_REDIS_CHANNEL } from '../chats/constants/chat.constants';
import { RedisService } from '../redis/redis.service';

import { ListNotificationsQueryDto } from './dto/list-notifications-query.dto';
import {
  NotificationListResponseDto,
  NotificationResponseDto,
} from './dto/notification-response.dto';

type NotificationDatabase = Pick<Prisma.TransactionClient, 'notification' | 'notificationOutbox' | 'user'>;

@Injectable()
export class NotificationsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NotificationsService.name);
  private outboxTimer: NodeJS.Timeout | null = null;
  private isFlushingOutbox = false;
  private consecutiveOutboxFailures = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
  ) {}

  async listActiveUserIdsByRoles(
    roleCodes: string[],
    database: Pick<Prisma.TransactionClient, 'user'> = this.prisma,
  ): Promise<string[]> {
    if (roleCodes.length === 0) return [];
    const users = await database.user.findMany({
      where: {
        isActive: true,
        deletedAt: null,
        roles: { some: { role: { code: { in: roleCodes } } } },
      },
      select: { id: true },
    });
    return users.map(({ id }) => id);
  }

  onModuleInit(): void {
    void this.flushOutbox();
  }

  onModuleDestroy(): void {
    if (this.outboxTimer) clearTimeout(this.outboxTimer);
    this.outboxTimer = null;
  }

  async create(params: {
    recipientUserId: string;
    type: string;
    title: string;
    body?: string | null;
    entityType?: string | null;
    entityId?: string | null;
    targetUrl?: string | null;
    dedupeKey?: string | null;
  }, database?: NotificationDatabase): Promise<Notification> {
    if (!database) {
      return this.prisma.$transaction((tx) => this.create(params, tx));
    }

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

    if (!params.dedupeKey) {
      const notification = await database.notification.create({ data });
      await database.notificationOutbox.create({
        data: {
          notificationId: notification.id,
          recipientUserId: notification.recipientUserId,
        },
      });
      return notification;
    }

    const created = await database.notification.createMany({
      data: [data],
      skipDuplicates: true,
    });
    const notification = await database.notification.findUniqueOrThrow({
      where: {
        recipientUserId_dedupeKey: {
          recipientUserId: params.recipientUserId,
          dedupeKey: params.dedupeKey,
        },
      },
    });
    if (created.count > 0) {
      await database.notificationOutbox.create({
        data: {
          notificationId: notification.id,
          recipientUserId: notification.recipientUserId,
        },
      });
    }
    return notification;
  }

  async createForRecipients(
    params: {
      recipientUserIds: string[];
      type: string;
      title: string;
      body?: string | null;
      entityType?: string | null;
      entityId?: string | null;
      targetUrl?: string | null;
      dedupeKey?: string | null;
    },
    database?: NotificationDatabase,
  ): Promise<Notification[]> {
    const recipientUserIds = [...new Set(params.recipientUserIds.filter(Boolean))];
    const notifications: Notification[] = [];

    for (const recipientUserId of recipientUserIds) {
      notifications.push(await this.create({
        recipientUserId,
        type: params.type,
        title: params.title,
        body: params.body,
        entityType: params.entityType,
        entityId: params.entityId,
        targetUrl: params.targetUrl,
        dedupeKey: params.dedupeKey,
      }, database));
    }

    return notifications;
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

  private async flushOutbox(): Promise<void> {
    if (this.isFlushingOutbox) return;
    this.isFlushingOutbox = true;
    let failed = false;
    let failureMessage = 'unknown error';

    try {
      const pending = await this.prisma.$transaction(async (tx) => {
        const records = await tx.$queryRaw<Array<{
          id: string;
          notificationId: string;
          recipientUserId: string;
        }>>`
          SELECT "id", "notificationId", "recipientUserId"
          FROM "notification_outbox"
          WHERE "publishedAt" IS NULL
            AND ("claimedAt" IS NULL OR "claimedAt" < NOW() - INTERVAL '30 seconds')
          ORDER BY "createdAt", "id"
          LIMIT 100
          FOR UPDATE SKIP LOCKED
        `;

        if (records.length === 0) return [];

        await tx.notificationOutbox.updateMany({
          where: { id: { in: records.map((record) => record.id) } },
          data: { claimedAt: new Date() },
        });
        return records;
      });

      for (const record of pending) {
        try {
          const notification = await this.prisma.notification.findUnique({
            where: { id: record.notificationId },
          });
          if (notification) {
            await this.redisService.getClient().publish(
              CHAT_REDIS_CHANNEL,
              JSON.stringify({
                type: 'notification.created',
                recipientUserIds: [record.recipientUserId],
                payload: {
                  id: notification.id,
                  type: notification.type,
                  title: notification.title,
                  body: notification.body,
                  entityType: notification.entityType,
                  entityId: notification.entityId,
                  targetUrl: notification.targetUrl,
                  readAt: null,
                  createdAt: notification.createdAt.toISOString(),
                },
              }),
            );
          }
          await this.prisma.notificationOutbox.update({
            where: { id: record.id },
            data: { publishedAt: new Date(), claimedAt: null },
          });
        } catch (error) {
          failed = true;
          failureMessage = error instanceof Error ? error.message : 'unknown error';
          await this.prisma.notificationOutbox.updateMany({
            where: { id: record.id, publishedAt: null },
            data: { claimedAt: null },
          }).catch(() => undefined);
        }
      }
    } catch (error) {
      failed = true;
      failureMessage = error instanceof Error ? error.message : 'unknown error';
    } finally {
      this.isFlushingOutbox = false;
      if (failed) {
        this.consecutiveOutboxFailures += 1;
        if (
          this.consecutiveOutboxFailures === 1 ||
          this.consecutiveOutboxFailures % 10 === 0
        ) {
          this.logger.warn(
            `Notification outbox delivery failed (${this.consecutiveOutboxFailures} consecutive attempt(s)): ${failureMessage}`,
          );
        }
      } else {
        this.consecutiveOutboxFailures = 0;
      }
      const retryDelay = failed
        ? Math.min(
            60_000,
            1_000 * 2 ** Math.min(this.consecutiveOutboxFailures - 1, 6),
          )
        : 1_000;
      this.outboxTimer = setTimeout(() => {
        this.outboxTimer = null;
        void this.flushOutbox();
      }, retryDelay);
      this.outboxTimer.unref();
    }
  }
}
