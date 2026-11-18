import assert from 'node:assert/strict';
import { createECDH, randomBytes } from 'node:crypto';
import { afterEach, mock, test } from 'node:test';
import { ConfigService } from '@nestjs/config';
import type { PrismaService } from '../src/modules/prisma/prisma.service';
import { isSupportedPushEndpoint, readWebPushConfig, validateSubscriptionKeys } from '../src/modules/notifications/push/web-push.config';
import { WebPushService } from '../src/modules/notifications/push/web-push.service';
import { WebPushWorker } from '../src/modules/notifications/push/web-push.worker';
import { WebPushTransport } from '../src/modules/notifications/push/web-push.transport';
import type { PushTransport } from '../src/modules/notifications/push/web-push.transport';

import * as access from '../src/common/access/notification-access';
import * as fence from '../src/common/access/lock-actor-access-revision';
type WebPushSend = typeof import('web-push').sendNotification;
afterEach(() => mock.restoreAll());
const pair = createECDH('prime256v1'); pair.generateKeys();
const publicKey = pair.getPublicKey().toString('base64url');
const privateKey = pair.getPrivateKey().toString('base64url');
const settings = { WEB_PUSH_ENABLED: 'true', WEB_PUSH_VAPID_PUBLIC_KEY: publicKey, WEB_PUSH_VAPID_PRIVATE_KEY: privateKey, WEB_PUSH_VAPID_SUBJECT: 'mailto:unit-test@example.invalid' };
const config = new ConfigService(settings);
const endpoint = 'https://fcm.googleapis.com/fcm/send/unit-fixture-never-a-real-device';
const deliveryId = 'ae6ae657-e1fd-40a7-83b1-551eb4cf09c4';

test('push disabled/malformed/mismatched VAPID does not enable outbound work', () => {
  assert.equal(readWebPushConfig(new ConfigService({})), null);
  assert.equal(readWebPushConfig(new ConfigService({ ...settings, WEB_PUSH_VAPID_PRIVATE_KEY: randomBytes(32).toString('base64url') })), null);
  assert.equal(readWebPushConfig(new ConfigService({ ...settings, WEB_PUSH_VAPID_SUBJECT: 'http://localhost' })), null);
  assert.equal(readWebPushConfig(config)?.publicKey, publicKey);
});
test('client-supplied push URLs cannot target local/custom hosts, credentials, redirects or non-HTTPS', () => {
  for (const value of ['http://127.0.0.1/a', 'https://127.0.0.1/a', 'https://fcm.googleapis.com.attacker.invalid/a', 'https://fcm.googleapis.com@127.0.0.1/a', 'https://fcm.googleapis.com:444/a', 'https://fcm.googleapis.com/a#x', 'https://localhost/a']) assert.equal(isSupportedPushEndpoint(value), false, value);
  assert.equal(isSupportedPushEndpoint(endpoint), true);
  assert.equal(isSupportedPushEndpoint('https://web.push.apple.com/unit-fixture'), true);
  assert.equal(isSupportedPushEndpoint('https://updates.push.services.mozilla.com/wpush/v2/unit-fixture'), true);
  assert.equal(validateSubscriptionKeys(publicKey, randomBytes(16).toString('base64url')), true);
  assert.equal(validateSubscriptionKeys('!', 'bad'), false);
});

function fixture() {
  const events: string[] = [];
  const now = new Date();
  const delivery = { id: deliveryId, subscriptionId: 'subscription', notificationId: 'notification', status: 'pending', attempts: 0, nextAttemptAt: now, claimedAt: null as Date | null, claimToken: null as string | null, finishedAt: null as Date | null, createdAt: now, lastErrorCode: null as string | null };
  const subscription = { id: 'subscription', userId: 'owner', authSessionId: 'session', endpoint, p256dh: publicKey, auth: randomBytes(16).toString('base64url'), vapidPublicKey: publicKey, disabledAt: null as Date | null, lastSuccessAt: null as Date | null };
  const sessions: Record<string, { id: string; userId: string; replacedBySessionId: string | null; revokedAt: Date | null; expiresAt: Date }> = { session: { id: 'session', userId: 'owner', replacedBySessionId: null, revokedAt: null, expiresAt: new Date(Date.now() + 3_600_000) } };
  let visible = true;
  let denied = false;
  function matches(where: Record<string, any>) { return (!where.status || where.status === delivery.status) && (!where.claimToken || where.claimToken === delivery.claimToken) && (!where.id || typeof where.id !== 'object' || where.id.in.includes(delivery.id)); }
  function update(data: Record<string, any>) { for (const [key, value] of Object.entries(data)) (delivery as any)[key] = value && typeof value === 'object' && 'increment' in value ? (delivery as any)[key] + value.increment : value; }
  const tx: any = {
    $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const sql = strings.join('?');
      if (sql.includes('web_push_deliveries')) return delivery.status === 'pending' ? [{ id: delivery.id }] : [];
      if (sql.includes('web_push_subscriptions')) return [{ id: subscription.id }];
      if (sql.includes('auth_sessions')) { const s = sessions[String(values[0])]; return s && !s.revokedAt && s.expiresAt > new Date() ? [{ id: s.id }] : []; }
      throw Error('Unexpected query');
    },
    webPushDelivery: {
      findFirst: async ({ where }: any) => matches(where) ? { ...delivery } : null,
      updateMany: async ({ where, data }: any) => { if (!matches(where)) return { count: 0 }; update(data); return { count: 1 }; },
    },
    webPushSubscription: {
      findUnique: async () => ({ ...subscription }),
      update: async ({ data }: any) => Object.assign(subscription, data),
      updateMany: async ({ data }: any) => { Object.assign(subscription, data); return { count: 1 }; },
    },
    authSession: { findUnique: async ({ where }: any) => sessions[where.id] ?? null },
    notification: { findFirst: async () => { events.push('fresh-source-query'); return visible ? { id: 'notification' } : null; } },
  };
  const db = { ...tx, $transaction: async (job: (database: typeof tx) => unknown) => job(tx) } as unknown as PrismaService;
  const push = new WebPushService(db, config);
  mock.method(push, 'assertAllowed', async () => { events.push('fresh-recipient-policy'); if (denied) throw Error('denied'); return { id: 'owner', isActive: true, accessVersion: 1 }; });
  mock.method(access, 'notificationAccessWhere', async () => { events.push('fresh-source-policy'); return {}; });
  mock.method(fence, 'lockActorAccessRevision', async () => { events.push('actor-version-fence'); });
  const calls: string[] = [];
  let transportError: unknown = null;
  const transport: PushTransport = { send: async (_address, id) => { events.push('outbound'); if (transportError) throw transportError; calls.push(id); } };
  const worker = new WebPushWorker(db, config, push, transport);
  return { worker, push, db, delivery, subscription, sessions, calls, events, hideSource: () => { visible = false; }, deny: () => { denied = true; }, failTransport: (e: unknown) => { transportError = e; } };
}

test('worker sends only after fresh source, recipient/session and actor fence; second poll cannot replay completed delivery', async () => {
  const f = fixture(); await f.worker.runOnce();
  assert.equal(f.delivery.status, 'sent'); assert.deepEqual(f.calls, [deliveryId]);
  assert(f.events.indexOf('fresh-source-query') < f.events.indexOf('outbound'));
  assert(f.events.indexOf('actor-version-fence') < f.events.indexOf('outbound'));
  await f.worker.runOnce(); assert.deepEqual(f.calls, [deliveryId]);
});
test('queued source access revoked before worker is skipped without outbound call', async () => {
  const f = fixture(); f.hideSource(); await f.worker.runOnce();
  assert.equal(f.delivery.status, 'skipped'); assert.equal(f.delivery.lastErrorCode, 'source_unavailable'); assert.deepEqual(f.calls, []);
});
test('queued recipient deny and disconnected device do not send', async () => {
  const f = fixture(); f.deny(); await f.worker.runOnce(); assert.equal(f.delivery.status, 'skipped'); assert.deepEqual(f.calls, []);
  const g = fixture(); g.subscription.disabledAt = new Date(); await g.worker.runOnce(); assert.equal(g.delivery.status, 'skipped'); assert.deepEqual(g.calls, []);
});
test('rotation follows only same-user successor; logout terminal prevents delivery', async () => {
  const f = fixture(); f.sessions.session.revokedAt = new Date(); f.sessions.session.replacedBySessionId = 'next'; f.sessions.next = { ...f.sessions.session, id: 'next', revokedAt: null, replacedBySessionId: null };
  await f.worker.runOnce(); assert.equal(f.subscription.authSessionId, 'next'); assert.equal(f.delivery.status, 'sent');
  const g = fixture(); g.sessions.session.revokedAt = new Date(); await g.worker.runOnce(); assert.equal(g.delivery.status, 'skipped'); assert(g.subscription.disabledAt); assert.deepEqual(g.calls, []);
});
test('cross-user or cyclic rotation cannot attach another login session', async () => {
  const f = fixture(); f.sessions.session.replacedBySessionId = 'other'; f.sessions.other = { ...f.sessions.session, id: 'other', userId: 'other-user', replacedBySessionId: null };
  assert.equal(await f.push.liveSession(f.db, 'session', 'owner'), null);
  const g = fixture(); g.sessions.session.replacedBySessionId = 'session'; assert.equal(await g.push.liveSession(g.db, 'session', 'owner'), null);
});
test('410 disables endpoint, terminates pending queue and records only human-safe error code', async () => {
  const f = fixture(); f.failTransport({ statusCode: 410, body: 'provider private diagnostic not logged' }); await f.worker.runOnce();
  assert.equal(f.delivery.status, 'failed'); assert.equal(f.delivery.lastErrorCode, 'endpoint_expired'); assert(f.subscription.disabledAt); assert.deepEqual(f.calls, []);
});
test('temporary provider error retries with bounded attempts; no immortal queue', async () => {
  const f = fixture(); f.failTransport({ statusCode: 503 });
  for (let i = 1; i <= 5; i++) { await f.worker.runOnce(); assert.equal(f.delivery.attempts, i); assert.equal(f.delivery.status, i < 5 ? 'pending' : 'failed'); }
});
test('outbound transport uses generic opaque payload; no notification source text or URL sent (network replaced)', async () => {
  let captured: { payload: unknown; options: any } | null = null;
  const transport = new WebPushTransport();
  mock.method(transport as unknown as { request: WebPushSend }, 'request', async (_subscription: unknown, payload: unknown, options: unknown) => { captured = { payload, options }; return { statusCode: 201, body: '', headers: {} }; });
  await transport.send({ endpoint, p256dh: publicKey, auth: randomBytes(16).toString('base64url') }, deliveryId, readWebPushConfig(config)!);
  assert(captured); const actual = captured as { payload: string; options: any };
  assert.deepEqual(JSON.parse(actual.payload), { deliveryId }); assert.equal(actual.options.TTL, 60); assert.equal(actual.options.timeout, 8000);
});
test('cannot disconnect another owner subscription or resolve another owner delivery', async () => {
  const tx: any = { $queryRaw: async () => [], webPushDelivery: { findFirst: async ({ where }: any) => { assert.equal(where.subscription.userId, 'intruder'); return null; } } };
  const db = { $transaction: async (job: any) => job(tx) } as unknown as PrismaService;
  const service = new WebPushService(db, config);
  mock.method(service, 'assertAllowed', async () => ({ id: 'intruder', isActive: true }));
  mock.method(fence, 'lockActorAccessRevision', async () => undefined);
  await assert.rejects(service.disconnect('intruder', 'foreign'), /Устройство не найдено/);
  await assert.rejects(service.open('intruder', deliveryId), /Уведомление больше недоступно/);
});

test('push mutations require configured CRM Origin, including test/disconnect; no arbitrary request-host trust', async () => {
  const { WebPushOriginGuard } = await import('../src/modules/notifications/push/web-push-origin.guard');
  const guard = new WebPushOriginGuard(new ConfigService({ app: { baseUrl: 'https://crm.example.invalid' } }));
  const context = (method: string, origin?: string) => ({ switchToHttp: () => ({ getRequest: () => ({ method, headers: { origin, host: 'attacker.invalid' } }) }) }) as import('@nestjs/common').ExecutionContext;
  assert.equal(guard.canActivate(context('POST', 'https://crm.example.invalid')), true);
  assert.throws(() => guard.canActivate(context('POST', 'https://attacker.invalid')), /Откройте настройки/);
  assert.throws(() => guard.canActivate(context('POST')), /Откройте настройки/);
  assert.equal(guard.canActivate(context('GET')), true);
});
