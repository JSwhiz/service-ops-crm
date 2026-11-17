import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { lockActorAccessRevision } from '../../../common/access/lock-actor-access-revision';
import { notificationAccessWhere } from '../../../common/access/notification-access';
import { WebPushService } from './web-push.service';
import { isSupportedPushEndpoint, readWebPushConfig } from './web-push.config';
import { WEB_PUSH_TRANSPORT, type PushTransport } from './web-push.transport';

@Injectable()
export class WebPushWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WebPushWorker.name);
  private timer: NodeJS.Timeout | null = null;
  private stopped = true;
  private running: Promise<void> | null = null;
  constructor(private readonly prisma: PrismaService, private readonly config: ConfigService, private readonly push: WebPushService, @Inject(WEB_PUSH_TRANSPORT) private readonly transport: PushTransport) {}
  onModuleInit(): void { this.stopped = false; if (readWebPushConfig(this.config)) this.schedule(); }
  async onModuleDestroy(): Promise<void> { this.stopped = true; if (this.timer) clearTimeout(this.timer); this.timer = null; await this.running; }
  private schedule(): void {
    if (this.stopped) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.running = this.runOnce().catch(() => { this.logger.warn('Push delivery is temporarily unavailable; pending records retained.'); }).finally(() => { this.running = null; this.schedule(); });
    }, 2_000);
    this.timer.unref();
  }
  /** Exposed for bounded local tests; default-disabled without VAPID config. */
  async runOnce(): Promise<void> {
    const config = readWebPushConfig(this.config);
    if (!config) return;
    const token = randomUUID();
    const records = await this.prisma.$transaction(async tx => {
      const rows = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "web_push_deliveries" WHERE "status"='pending' AND "nextAttemptAt"<=NOW()
          AND ("claimedAt" IS NULL OR "claimedAt"<NOW()-INTERVAL '2 minutes')
        ORDER BY "createdAt", "id" LIMIT 10 FOR UPDATE SKIP LOCKED`;
      await tx.webPushDelivery.updateMany({ where: { id: { in: rows.map(r => r.id) }, status: 'pending' }, data: { claimedAt: new Date(), claimToken: token } });
      return rows;
    });
    for (const row of records) {
      if (this.stopped && this.running) break;
      try {
        await this.prisma.$transaction(async tx => {
          const delivery = await tx.webPushDelivery.findFirst({ where: { id: row.id, claimToken: token, status: 'pending' } });
          if (!delivery) return;
          const locked = await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "web_push_subscriptions" WHERE "id"=${delivery.subscriptionId} FOR UPDATE`;
          const subscription = locked.length ? await tx.webPushSubscription.findUnique({ where: { id: delivery.subscriptionId } }) : null;
          let skip: string | null = null;
          if (!subscription || subscription.disabledAt || subscription.vapidPublicKey !== config.publicKey || !isSupportedPushEndpoint(subscription.endpoint)) skip = 'subscription_unavailable';
          else if (delivery.createdAt.getTime() < Date.now() - 24 * 60 * 60 * 1000) skip = 'expired';
          else {
            let actor;
            try { actor = await this.push.assertAllowed(subscription.userId, tx); } catch { skip = 'access_unavailable'; }
            if (actor) {
              await lockActorAccessRevision(tx, actor);
              const live = await this.push.liveSession(tx, subscription.authSessionId, subscription.userId);
              if (!live) { skip = 'session_unavailable'; await tx.webPushSubscription.update({ where: { id: subscription.id }, data: { disabledAt: new Date() } }); }
              else {
                if (live !== subscription.authSessionId) await tx.webPushSubscription.update({ where: { id: subscription.id }, data: { authSessionId: live } });
                if (delivery.notificationId && !await tx.notification.findFirst({ where: { AND: [{ id: delivery.notificationId, readAt: null }, await notificationAccessWhere(tx as PrismaService, subscription.userId, 'notifications.realtime')] }, select: { id: true } })) skip = 'source_unavailable';
              }
            }
          }
          if (skip || !subscription) {
            await tx.webPushDelivery.updateMany({ where: { id: row.id, claimToken: token, status: 'pending' }, data: { status: 'skipped', finishedAt: new Date(), claimedAt: null, claimToken: null, lastErrorCode: skip } });
            return;
          }
          // External I/O ordered after fresh session/access/source checks; no payload from Notification.
          await this.transport.send(subscription, delivery.id, config);
          await tx.webPushDelivery.updateMany({ where: { id: row.id, claimToken: token, status: 'pending' }, data: { status: 'sent', attempts: { increment: 1 }, finishedAt: new Date(), claimedAt: null, claimToken: null, lastErrorCode: null } });
          await tx.webPushSubscription.update({ where: { id: subscription.id }, data: { lastSuccessAt: new Date() } });
        }, { timeout: 15_000 });
      } catch (error) {
        const status = Number((error as { statusCode?: number }).statusCode);
        const gone = status === 404 || status === 410;
        const delivery = await this.prisma.webPushDelivery.findFirst({ where: { id: row.id, status: 'pending', claimToken: token } });
        if (!delivery) continue;
        const attempts = delivery.attempts + 1;
        const retry = !gone && (!status || status === 429 || status >= 500) && attempts < 5;
        await this.prisma.$transaction(async tx => {
          await tx.webPushDelivery.updateMany({ where: { id: row.id, status: 'pending', claimToken: token }, data: { status: retry ? 'pending' : 'failed', attempts, nextAttemptAt: new Date(Date.now() + Math.min(60 * 60_000, 30_000 * 2 ** attempts)), finishedAt: retry ? null : new Date(), claimedAt: null, claimToken: null, lastErrorCode: gone ? 'endpoint_expired' : status ? `push_http_${status}` : 'transport_unavailable' } });
          if (gone) {
            await tx.webPushSubscription.updateMany({ where: { id: delivery.subscriptionId }, data: { disabledAt: new Date() } });
            await tx.webPushDelivery.updateMany({ where: { subscriptionId: delivery.subscriptionId, status: 'pending' }, data: { status: 'skipped', finishedAt: new Date(), claimedAt: null, claimToken: null, lastErrorCode: 'endpoint_expired' } });
          }
        });
        // Do not log provider response, endpoint, keys or encrypted payload.
      }
    }
  }
}
