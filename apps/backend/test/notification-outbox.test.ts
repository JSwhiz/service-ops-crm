import assert from 'node:assert/strict';
import test from 'node:test';

import { NotificationsService } from '../src/modules/notifications/notifications.service';

test('notification outbox retries with a bounded delay after database errors', async () => {
  const prisma = {
    $transaction: async () => {
      throw new Error('database unavailable');
    },
  };
  const service = new NotificationsService(prisma as never, {} as never);
  const internals = service as unknown as {
    flushOutbox: () => Promise<void>;
    consecutiveOutboxFailures: number;
    outboxTimer: NodeJS.Timeout | null;
  };

  try {
    await internals.flushOutbox();
    assert.equal(internals.consecutiveOutboxFailures, 1);
    assert.ok(internals.outboxTimer);
  } finally {
    service.onModuleDestroy();
  }
});

test('notification outbox publishes a user-addressed realtime event then marks it sent', async () => {
  const createdAt = new Date('2026-10-09T00:00:00.000Z');
  const record = {
    id: 'outbox-id',
    notificationId: 'notification-id',
    recipientUserId: 'recipient-id',
  };
  const notification = {
    id: record.notificationId,
    type: 'task.overdue',
    title: 'Срок задачи истёк',
    body: 'Проверить объект',
    entityType: 'task',
    entityId: 'task-id',
    targetUrl: '/tasks?taskId=task-id',
    createdAt,
  };
  const sentFrames: Array<{ channel: string; message: string }> = [];
  const updates: Array<{ id: string; data: Record<string, unknown> }> = [];
  const tx = {
    $queryRaw: async () => [record],
    notificationOutbox: {
      updateMany: async () => ({ count: 1 }),
    },
  };
  const prisma = {
    $transaction: async (work: (client: typeof tx) => Promise<unknown>) => work(tx),
    notification: { findFirst: async ({ where }: { where: { id: string; dismissedAt: null } }) => {
      assert.equal(where.id, notification.id);
      assert.equal(where.dismissedAt, null);
      return notification;
    } },
    notificationOutbox: {
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        updates.push({ id: where.id, data });
        return {};
      },
      updateMany: async () => ({ count: 0 }),
    },
  };
  const redis = {
    getClient: () => ({
      publish: async (channel: string, message: string) => {
        sentFrames.push({ channel, message });
        return 1;
      },
    }),
  };
  const service = new NotificationsService(prisma as never, redis as never);
  const internals = service as unknown as {
    flushOutbox: () => Promise<void>;
  };

  try {
    await internals.flushOutbox();
    assert.equal(sentFrames.length, 1);
    assert.equal(sentFrames[0]?.channel, 'service_ops:chat_events');
    assert.deepEqual(JSON.parse(sentFrames[0]!.message), {
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
        createdAt: createdAt.toISOString(),
      },
    });
    assert.equal(updates.length, 1);
    assert.equal(updates[0]?.id, record.id);
    assert.ok(updates[0]?.data.publishedAt instanceof Date);
    assert.equal(updates[0]?.data.claimedAt, null);
  } finally {
    service.onModuleDestroy();
  }
});
