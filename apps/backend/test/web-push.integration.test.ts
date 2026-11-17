import assert from 'node:assert/strict';
import { createECDH, randomBytes, randomUUID } from 'node:crypto';
import test, { mock } from 'node:test';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { FilePreviewService } from '../src/modules/files/file-preview.service';
import { NotificationsService } from '../src/modules/notifications/notifications.service';
import { WebPushWorker } from '../src/modules/notifications/push/web-push.worker';
import { WEB_PUSH_TRANSPORT, type PushTransport } from '../src/modules/notifications/push/web-push.transport';
import { loginAndGetCookieHeader } from './helpers/auth';

test('web push: authenticated own-device lifecycle, committed queue dedupe, fresh source/session checks; injected transport never contacts a public endpoint', async t => {
  assert.equal(process.env.TEST_ISOLATED_DATABASE, 'true');
  const url = new URL(process.env.DATABASE_URL!);
  assert(['localhost', '127.0.0.1'].includes(url.hostname));
  assert.match(url.searchParams.get('schema') ?? '', /^integration_\d+_\d+$/);
  const prisma = new PrismaClient();
  const outbound: Array<{ deliveryId: string; endpoint: string }> = [];
  const transport: PushTransport = { send: async (address, deliveryId) => { outbound.push({ deliveryId, endpoint: address.endpoint }); } };
  const module = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(WEB_PUSH_TRANSPORT).useValue(transport)
    .overrideProvider(FilePreviewService).useValue({ onModuleInit() {}, onModuleDestroy() {} }).compile();
  const pair = createECDH('prime256v1'); pair.generateKeys();
  const config = module.get(ConfigService);
  // Nest ConfigModule validates env before process/internal config: set() cannot
  // override a validated WEB_PUSH_ENABLED=false. Overlay only test push reads;
  // preserve real DB/JWT/app configuration and the production-disabled default.
  const fixturePushConfig: Record<string, string> = {
    WEB_PUSH_ENABLED: 'true',
    WEB_PUSH_VAPID_PUBLIC_KEY: pair.getPublicKey().toString('base64url'),
    WEB_PUSH_VAPID_PRIVATE_KEY: pair.getPrivateKey().toString('base64url'),
    WEB_PUSH_VAPID_SUBJECT: 'mailto:local-fixture@example.invalid',
  };
  const originalGet = config.get.bind(config);
  const fixtureConfigRead = mock.method(config, 'get', ((...args: unknown[]) => {
    const name = String(args[0]);
    return Object.hasOwn(fixturePushConfig, name) ? fixturePushConfig[name] : Reflect.apply(originalGet, config, args);
  }) as ConfigService['get']);
  const worker = module.get(WebPushWorker);
  // Drive only explicit bounded worker phases, no timer race with assertions.
  const stopAutomaticStart = mock.method(worker, 'onModuleInit', () => undefined);
  const stopUnrelatedRealtimeTimer = mock.method(module.get(NotificationsService), 'onModuleInit', () => undefined);
  const app = module.createNestApplication();
  await configureApp(app); await app.listen(0);
  const base = `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}/api/v1`;
  t.after(async () => { stopAutomaticStart.mock.restore(); stopUnrelatedRealtimeTimer.mock.restore(); try { await app.close(); } finally { fixtureConfigRead.mock.restore(); await prisma.$disconnect(); } });
  const origin = new URL(config.get<string>('app.baseUrl')!).origin;
  const owner = await prisma.user.findUniqueOrThrow({ where: { login: 'manager1' } });
  const [cookie, otherCookie] = await Promise.all([
    loginAndGetCookieHeader({ baseUrl: base.replace('/api/v1', ''), login: 'manager1', password: 'manager123' }),
    loginAndGetCookieHeader({ baseUrl: base.replace('/api/v1', ''), login: 'manager2', password: 'manager123' }),
  ]);
  const request = (path: string, body?: unknown, auth = cookie, overrideOrigin = origin) => fetch(base + '/auth/push' + path, { method: body === undefined ? 'GET' : 'POST', headers: { Cookie: auth, Origin: overrideOrigin, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const key = createECDH('prime256v1'); key.generateKeys();
  // Syntactically supported but nonexistent fixture capability. The injected
  // transport cannot perform HTTP; this is not a real browser registration.
  const dto = { endpoint: `https://fcm.googleapis.com/fcm/send/local-fixture-${randomUUID()}`, keys: { p256dh: key.getPublicKey().toString('base64url'), auth: randomBytes(16).toString('base64url') }, deviceName: 'Isolated local fixture, no mobile delivery claim' };
  const configuration = await request('/config'); assert.equal(configuration.status, 200);
  const visibleConfig = await configuration.json() as { enabled: boolean; publicKey: string | null }; assert.deepEqual(Object.keys(visibleConfig).sort(), ['enabled', 'publicKey']); assert.equal(visibleConfig.enabled, true);
  assert.equal((await request('/config', undefined, '')).status, 401);
  assert.equal((await request('/subscriptions', dto, cookie, 'https://foreign.example.invalid')).status, 403);
  assert.equal((await request('/subscriptions', { ...dto, endpoint: 'https://127.0.0.1/private' })).status, 400);
  const connected = await request('/subscriptions', dto); assert.equal(connected.status, 201);
  const device = await connected.json() as { id: string; connected: boolean }; assert(device.connected);
  assert.equal((await prisma.webPushSubscription.findUniqueOrThrow({ where: { id: device.id } })).userId, owner.id);
  assert.equal((await request('/subscriptions', dto, otherCookie)).status, 409, 'Endpoint possession cannot move another user subscription');
  assert.equal((await request(`/subscriptions/${device.id}/disconnect`, {}, otherCookie)).status, 404);
  const foreignState = await (await request('/status', { endpoint: dto.endpoint }, otherCookie)).json() as { connected: boolean; id: string | null };
  assert.equal(foreignState.connected, false);
  const object = await prisma.object.create({ data: { name: 'Private object name must not become push text', address: 'Isolated fixture', status: 'active', createdByUserId: owner.id, assignments: { create: { userId: owner.id, assignmentRoleCode: 'manager', isActive: true } } } });
  const notifications = app.get(NotificationsService);
  const create = (dedupeKey: string) => notifications.create({ recipientUserId: owner.id, type: 'object.created', title: 'Private object title', body: 'Private financial reason', entityType: 'object', entityId: object.id, targetUrl: `/objects/${object.id}`, dedupeKey });
  const first = await create('push-fixture-first'); await create('push-fixture-first');
  assert.equal(await prisma.webPushDelivery.count({ where: { notificationId: first.id, subscriptionId: device.id } }), 1);
  await worker.runOnce(); assert.equal(outbound.length, 1);
  const firstDelivery = await prisma.webPushDelivery.findFirstOrThrow({ where: { notificationId: first.id, subscriptionId: device.id } }); assert.equal(firstDelivery.status, 'sent');
  assert.equal((await request(`/open/${firstDelivery.id}`)).status, 200);
  assert.equal((await request(`/open/${firstDelivery.id}`, undefined, otherCookie)).status, 404);
  const second = await create('push-fixture-before-source-deny');
  const deny = await prisma.$transaction(async tx => {
    await tx.user.update({ where: { id: owner.id }, data: { accessVersion: { increment: 1 } } });
    return tx.userAccessRule.create({ data: { userId: owner.id, actionCode: 'objects.read', effect: 'deny', scope: 'selected', selectedIds: [object.id] } });
  }); // Explicit isolated policy fixture, not a personal-grant workflow acceptance.
  await worker.runOnce(); assert.equal(outbound.length, 1);
  assert.equal((await prisma.webPushDelivery.findFirstOrThrow({ where: { notificationId: second.id, subscriptionId: device.id } })).status, 'skipped');
  assert.equal((await request(`/open/${firstDelivery.id}`)).status, 404, 'Fresh deep link policy after a successful delivery');
  await prisma.$transaction(async tx => { await tx.userAccessRule.delete({ where: { id: deny.id } }); await tx.user.update({ where: { id: owner.id }, data: { accessVersion: { increment: 1 } } }); });
  await worker.runOnce(); assert.equal(outbound.length, 1, 'Skipped notifications do not replay on regrant');
  assert.equal((await request(`/subscriptions/${device.id}/test`, {})).status, 201);
  assert.equal((await request(`/subscriptions/${device.id}/test`, {})).status, 429);
  await worker.runOnce(); assert.equal(outbound.length, 2);
  const testDelivery = await prisma.webPushDelivery.findFirstOrThrow({ where: { subscriptionId: device.id, notificationId: null } });
  assert.deepEqual(await (await request(`/open/${testDelivery.id}`)).json(), { targetUrl: null, test: true });
  const third = await create('push-fixture-before-logout');
  const logout = await fetch(base + '/auth/logout', { method: 'POST', headers: { Cookie: cookie, Origin: origin } }); assert.equal(logout.status, 201);
  await worker.runOnce(); assert.equal(outbound.length, 2);
  assert.equal((await prisma.webPushDelivery.findFirstOrThrow({ where: { subscriptionId: device.id, notificationId: third.id } })).status, 'skipped');
  assert((await prisma.webPushSubscription.findUniqueOrThrow({ where: { id: device.id } })).disabledAt);
  const relogin = await loginAndGetCookieHeader({ baseUrl: base.replace('/api/v1', ''), login: 'manager1', password: 'manager123' });
  assert.equal((await request(`/subscriptions/${device.id}/disconnect`, {}, relogin)).status, 201);
  assert.equal((await request(`/subscriptions/${device.id}/test`, {}, relogin)).status, 404);
  assert.equal(await prisma.webPushSubscription.count({ where: { endpoint: dto.endpoint } }), 1);
});
