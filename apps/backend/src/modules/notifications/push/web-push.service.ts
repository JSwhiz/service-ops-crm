import { createHmac } from 'node:crypto';
import { BadRequestException, ConflictException, ForbiddenException, HttpException, Injectable, NotFoundException, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Notification, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { loadAccessSubject, notificationAccessWhere } from '../../../common/access/notification-access';
import { lockActorAccessRevision } from '../../../common/access/lock-actor-access-revision';
import { decideAccess } from '../../users-access/utils/access-policy.util';
import { isSupportedPushEndpoint, readWebPushConfig, validateSubscriptionKeys } from './web-push.config';
import type { ConnectWebPushDto } from './web-push.dto';

type Database = Prisma.TransactionClient;

@Injectable()
export class WebPushService {
  constructor(private readonly prisma: PrismaService, private readonly config: ConfigService) {}

  configuration(): { enabled: boolean; publicKey: string | null } {
    const config = readWebPushConfig(this.config);
    return { enabled: !!config, publicKey: config?.publicKey ?? null };
  }

  async assertAllowed(userId: string, db: Database = this.prisma) {
    const actor = await loadAccessSubject(db, userId);
    const context = { resourceType: 'notification' as const, ownerUserId: userId };
    if (!actor?.isActive || !decideAccess(actor, 'auth.access', true, { resourceType: 'user', resourceId: userId, ownerUserId: userId })
      || !decideAccess(actor, 'notifications.read', true, context)
      || !decideAccess(actor, 'notifications.realtime', true, context)) {
      throw new ForbiddenException('Уведомления сейчас недоступны для вашей учётной записи.');
    }
    return actor;
  }

  /** Called within Notification's transaction; no change to realtime publishing. */
  async enqueue(notification: Notification, db: Database): Promise<void> {
    if (!readWebPushConfig(this.config)) return;
    const allowed = await db.notification.findFirst({ where: { AND: [{ id: notification.id }, await notificationAccessWhere(db as PrismaService, notification.recipientUserId, 'notifications.realtime')] }, select: { id: true } });
    if (!allowed) return;
    const subscriptions = await db.webPushSubscription.findMany({ where: { userId: notification.recipientUserId, disabledAt: null }, select: { id: true } });
    if (!subscriptions.length) return;
    await db.webPushDelivery.createMany({ data: subscriptions.map(s => ({ notificationId: notification.id, subscriptionId: s.id, status: 'pending' })), skipDuplicates: true });
  }

  /** Follow only this device's refresh rotation chain, never another login. */
  async liveSession(db: Database, id: string, userId: string): Promise<string | null> {
    const seen = new Set<string>();
    for (let count = 0; count < 100; count++) {
      if (seen.has(id)) return null;
      seen.add(id);
      const row = await db.authSession.findUnique({ where: { id } });
      if (!row || row.userId !== userId) return null;
      if (row.replacedBySessionId) { id = row.replacedBySessionId; continue; }
      if (row.revokedAt || row.expiresAt.getTime() <= Date.now()) return null;
      // Order logout/revocation against the actual outbound send transaction.
      const locked = await db.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "auth_sessions" WHERE "id"=${id} AND "revokedAt" IS NULL AND "expiresAt">NOW() FOR SHARE`;
      return locked.length ? id : null;
    }
    return null;
  }

  async connect(userId: string, refreshToken: string | null, dto: ConnectWebPushDto) {
    const config = readWebPushConfig(this.config);
    if (!config) throw new ServiceUnavailableException('Push-уведомления пока не настроены. Обратитесь к администратору.');
    if (!refreshToken) throw new UnauthorizedException('Сеанс завершён. Войдите заново, чтобы подключить устройство.');
    if (!dto.deviceName.trim() || !isSupportedPushEndpoint(dto.endpoint) || !dto.keys || !validateSubscriptionKeys(dto.keys.p256dh, dto.keys.auth)) throw new BadRequestException('Браузер передал неподдерживаемую подписку. Обновите браузер и попробуйте ещё раз.');
    const secret = this.config.get<string>('jwt.refreshSecret');
    if (!secret) throw new ServiceUnavailableException('Не удалось проверить сеанс.');
    const hash = createHmac('sha256', secret).update(refreshToken).digest('hex');
    const actor = await this.assertAllowed(userId);
    try {
      return await this.prisma.$transaction(async tx => {
        await lockActorAccessRevision(tx, actor);
        const session = await tx.authSession.findUnique({ where: { tokenHash: hash } });
        if (!session || session.userId !== userId || !await this.liveSession(tx, session.id, userId)) throw new UnauthorizedException('Сеанс завершён. Войдите заново.');
        const old = await tx.webPushSubscription.findUnique({ where: { endpoint: dto.endpoint } });
        if (old && old.userId !== userId) throw new ConflictException('Это устройство подключено к другой учётной записи. Отключите его в браузере и подключите заново.');
        if (!old && await tx.webPushSubscription.count({ where: { userId, disabledAt: null } }) >= 20) throw new BadRequestException('Достигнут предел подключённых устройств. Отключите одно из них.');
        if (old) await tx.webPushDelivery.updateMany({ where: { subscriptionId: old.id, status: 'pending' }, data: { status: 'skipped', finishedAt: new Date(), lastErrorCode: 'subscription_reconnected', claimedAt: null, claimToken: null } });
        const data = { userId, authSessionId: session.id, endpoint: dto.endpoint, p256dh: dto.keys.p256dh, auth: dto.keys.auth, vapidPublicKey: config.publicKey, deviceName: dto.deviceName.trim(), disabledAt: null };
        const row = old ? await tx.webPushSubscription.update({ where: { id: old.id }, data }) : await tx.webPushSubscription.create({ data });
        return { id: row.id, connected: true as const, deviceName: row.deviceName };
      });
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') throw new ConflictException('Подписка уже изменилась. Обновите состояние устройства.');
      throw error;
    }
  }

  async status(userId: string, endpoint: string) {
    const row = await this.prisma.webPushSubscription.findFirst({ where: { userId, endpoint }, select: { id: true, deviceName: true, authSessionId: true, disabledAt: true } });
    if (!row) return { connected: false as const, id: null, lastTest: null };
    const [live, lastTest] = await Promise.all([
      row.disabledAt ? null : this.prisma.$transaction(tx => this.liveSession(tx, row.authSessionId, userId)),
      this.prisma.webPushDelivery.findFirst({ where: { subscriptionId: row.id, notificationId: null }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], select: { status: true, lastErrorCode: true, finishedAt: true } }),
    ]);
    return { connected: !!live, id: row.id, deviceName: row.deviceName, lastTest: lastTest ? { status: lastTest.status, errorCode: lastTest.lastErrorCode, finishedAt: lastTest.finishedAt?.toISOString() ?? null } : null };
  }

  async disconnect(userId: string, id: string): Promise<{ disconnected: true }> {
    // Cleanup remains possible after a delivery/read deny.
    await this.prisma.$transaction(async tx => {
      const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "web_push_subscriptions" WHERE "id"=${id} AND "userId"=${userId} FOR UPDATE`;
      if (!rows.length) throw new NotFoundException('Устройство не найдено.');
      await tx.webPushSubscription.update({ where: { id }, data: { disabledAt: new Date() } });
      await tx.webPushDelivery.updateMany({ where: { subscriptionId: id, status: 'pending' }, data: { status: 'skipped', finishedAt: new Date(), claimedAt: null, claimToken: null, lastErrorCode: 'disconnected' } });
    });
    return { disconnected: true };
  }

  async test(userId: string, id: string): Promise<{ queued: true }> {
    if (!readWebPushConfig(this.config)) throw new ServiceUnavailableException('Push-уведомления пока не настроены.');
    const actor = await this.assertAllowed(userId);
    await this.prisma.$transaction(async tx => {
      await lockActorAccessRevision(tx, actor);
      const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "web_push_subscriptions" WHERE "id"=${id} AND "userId"=${userId} AND "disabledAt" IS NULL FOR UPDATE`;
      if (!rows.length) throw new NotFoundException('Сначала подключите это устройство.');
      const subscription = await tx.webPushSubscription.findUniqueOrThrow({ where: { id } });
      if (!await this.liveSession(tx, subscription.authSessionId, userId)) throw new UnauthorizedException('Войдите заново и подключите устройство.');
      if (await tx.webPushDelivery.count({ where: { subscriptionId: id, notificationId: null, createdAt: { gt: new Date(Date.now() - 60_000) } } })) throw new HttpException('Подождите минуту перед следующей проверкой.', 429);
      await tx.webPushDelivery.create({ data: { subscriptionId: id, status: 'pending' } });
    });
    return { queued: true };
  }

  async open(userId: string, deliveryId: string): Promise<{ targetUrl: string | null; test: boolean }> {
    const actor = await this.assertAllowed(userId);
    return this.prisma.$transaction(async tx => {
      await lockActorAccessRevision(tx, actor);
      const delivery = await tx.webPushDelivery.findFirst({ where: { id: deliveryId, subscription: { userId, disabledAt: null }, status: 'sent' } });
      if (!delivery) throw new NotFoundException('Уведомление больше недоступно.');
      if (!delivery.notificationId) return { targetUrl: null, test: true };
      const visible = await notificationAccessWhere(tx as PrismaService, userId);
      const notification = await tx.notification.findFirst({ where: { AND: [visible, { id: delivery.notificationId }] } });
      if (!notification) throw new NotFoundException('Запись больше недоступна. Откройте список уведомлений.');
      const fallback = notification.entityId && notification.entityType === 'object' ? `/objects/${encodeURIComponent(notification.entityId)}`
        : notification.entityId && notification.entityType === 'one_time_order' ? `/one-time-orders/${encodeURIComponent(notification.entityId)}` : null;
      return { targetUrl: notification.targetUrl ?? fallback, test: false };
    });
  }
}
