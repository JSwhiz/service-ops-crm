import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { PrismaClient } from '@prisma/client';

import { notificationAccessWhere } from '../src/common/access/notification-access';
import type { NotificationListResponseDto, NotificationResponseDto } from '../src/modules/notifications/dto/notification-response.dto';
import { PrismaService } from '../src/modules/prisma/prisma.service';
import { ACCESS_ACTION_CATALOG } from '../src/modules/users-access/access-action-catalog';
import { loginAndGetCookieHeader } from './helpers/auth';
import { createTestApp } from './helpers/create-test-app';
import { usesIsolatedIntegrationDatabase } from './helpers/isolated-database';

test('inventory movement notification sources enforce fresh item/leaf/parent denies across HTTP state and DB eligibility', async (t) => {
  assert.equal(usesIsolatedIntegrationDatabase(), true);
  const url = new URL(process.env.DATABASE_URL!);
  assert.ok(['postgres:', 'postgresql:'].includes(url.protocol));
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname));
  assert.equal(url.port, '55432');
  assert.match(url.searchParams.get('schema') ?? '', /^integration_\d+_\d+$/);
  const prisma = new PrismaClient();
  let closeApp: (() => Promise<void>) | undefined = undefined;
  const ruleIds = new Set<string>();
  const resetRules = async () => {
    await prisma.userAccessRule.deleteMany({ where: { id: { in: [...ruleIds] } } });
    ruleIds.clear();
  };
  t.after(async () => {
    try { await resetRules(); } finally { try { await closeApp?.(); } finally { await prisma.$disconnect(); } }
  });
  const { app, baseUrl } = await createTestApp();
  closeApp = () => app.close();
  const database = app.get(PrismaService);
  const marker = `notification-inventory-${randomUUID()}`;
  const template = await prisma.user.findUniqueOrThrow({ where: { login: 'manager1' } });
  const founder = await prisma.user.findUniqueOrThrow({ where: { login: 'founder' } });
  const role = await prisma.role.findUniqueOrThrow({ where: { code: 'deputy_director' } });
  // Canonical global inventory-history readers: positive controls do not rely on
  // a synthetic role or on bypassing the public inventory controller's guard.
  const actors = await Promise.all(['owner', 'other'].map(async (label) => {
    const user = await prisma.user.create({ data: {
      login: `${marker}-${label}`, fullName: `${marker}-${label}`, passwordHash: template.passwordHash,
      isActive: true, roles: { create: { roleId: role.id } },
    } });
    return { ...user, cookie: await loginAndGetCookieHeader({ baseUrl, login: user.login, password: 'manager123' }) };
  }));
  const [owner, other] = actors;
  const objects = await Promise.all(['A', 'B'].map((label) => prisma.object.create({ data: {
    name: `${marker}-object-${label}`, address: 'Isolated notification source', status: 'active', createdByUserId: founder.id,
  } })));
  const orders = await Promise.all(['A', 'B'].map((label) => prisma.oneTimeOrder.create({ data: {
    title: `${marker}-order-${label}`, executionAddress: 'Isolated order source', status: 'in_progress', contactName: 'Fixture', createdByUserId: founder.id,
  } })));
  const items = await Promise.all(['A', 'B'].map((label) => prisma.inventoryItem.create({ data: {
    name: `${marker}-item-${label}`, category: 'Notification boundary fixture', unit: 'шт', currentUnitPrice: 10, createdByUserId: founder.id,
  } })));
  const sources = await Promise.all(['receipt-A', 'receipt-B', 'object-A', 'object-B', 'order-A', 'order-B'].map(async (key, index) => {
    const targetIndex = key.endsWith('A') ? 0 : 1;
    const item = items[targetIndex]!;
    const object = key.startsWith('object') ? objects[targetIndex]! : null;
    const order = key.startsWith('order') ? orders[targetIndex]! : null;
    const movement = await prisma.inventoryMovement.create({ data: {
      inventoryItemId: item.id, movementType: object ? 'issue_to_object' : order ? 'issue_to_one_time_order' : 'receipt',
      status: 'applied', quantity: object || order ? 1 : 100, unitPriceSnapshot: 10, totalAmountSnapshot: object || order ? 10 : 1000,
      relatedObjectId: object?.id, relatedOneTimeOrderId: order?.id, createdByUserId: founder.id, comment: `${marker}-${key}`,
    } });
    return { key, index, item, object, order, movement };
  }));
  const records = [] as Array<{ id: string; key: string; recipientUserId: string; originallyRead: boolean }>;
  for (const source of sources) for (const read of [false, true]) {
    // Direct retained-inbox fixtures: no createForRecipients/outbox/publication.
    const notification = await prisma.notification.create({ data: {
      recipientUserId: owner.id, type: 'acl.inventory_source', entityType: 'inventory_movement', entityId: source.movement.id,
      title: `${marker}-${source.key}-${read ? 'read' : 'unread'}`,
      body: `${source.item.name} ${source.object?.name ?? source.order?.title ?? 'central receipt'}`,
      targetUrl: `/inventory?movementId=${source.movement.id}`,
      readAt: read ? new Date('2026-01-01T12:00:00Z') : null,
      // Denied A sources are newer, so an unfiltered first page cannot pass by luck.
      createdAt: new Date(Date.UTC(2034, 0, source.key.endsWith('A') ? 3 : 2, source.index, read ? 1 : 0)),
    } });
    records.push({ id: notification.id, key: source.key, recipientUserId: owner.id, originallyRead: read });
  }
  for (const recipient of actors) for (const read of [false, true]) {
    const notification = await prisma.notification.create({ data: {
      recipientUserId: recipient.id, type: 'acl.control', title: `${marker}-${recipient.id}-generic-${read}`,
      body: 'Unrelated personal control', readAt: read ? new Date('2026-01-01T12:00:00Z') : null,
      createdAt: new Date('2034-01-01T12:00:00Z'),
    } });
    records.push({ id: notification.id, key: 'generic', recipientUserId: recipient.id, originallyRead: read });
  }
  const notificationIds = records.map(({ id }) => id);
  const objectIds = objects.map(({ id }) => id);
  const orderIds = orders.map(({ id }) => id);
  const itemIds = items.map(({ id }) => id);
  const request = (path: string, post = false, cookie = owner.cookie) => fetch(`${baseUrl}/api/v1/notifications${path}`, {
    method: post ? 'POST' : 'GET', headers: { Cookie: cookie }, signal: AbortSignal.timeout(15_000),
  });
  const json = async <T,>(response: Response, expected = 200): Promise<T> => {
    assert.equal(response.status, expected, await response.clone().text());
    return await response.json() as T;
  };
  const rule = async (actionCode: string, effect: 'allow' | 'deny', ids?: string[], userId = owner.id) => {
    const scope = ids ? 'selected' : 'all';
    assert.ok(ACCESS_ACTION_CATALOG.find(({ code }) => code === actionCode)?.allowedScopes.includes(scope));
    const row = await prisma.userAccessRule.upsert({
      where: { userId_actionCode: { userId, actionCode } },
      create: { userId, actionCode, effect, scope, selectedIds: ids ?? [] }, update: { effect, scope, selectedIds: ids ?? [] },
    });
    ruleIds.add(row.id);
  };
  const revoke = async (actionCode: string, userId = owner.id) => {
    const row = await prisma.userAccessRule.delete({ where: { userId_actionCode: { userId, actionCode } } });
    ruleIds.delete(row.id);
  };
  const snapshot = async () => ({
    notifications: await prisma.notification.findMany({ where: { id: { in: notificationIds } }, orderBy: { id: 'asc' } }),
    items: await prisma.inventoryItem.findMany({ where: { id: { in: itemIds } }, orderBy: { id: 'asc' } }),
    movements: await prisma.inventoryMovement.findMany({ where: { inventoryItemId: { in: itemIds } }, orderBy: { id: 'asc' } }),
    objects: await prisma.object.findMany({ where: { id: { in: objectIds } }, orderBy: { id: 'asc' } }),
    orders: await prisma.oneTimeOrder.findMany({ where: { id: { in: orderIds } }, orderBy: { id: 'asc' } }),
    assignments: await prisma.objectAssignment.findMany({ where: { objectId: { in: objectIds } }, orderBy: { id: 'asc' } }),
    orderAssignments: await prisma.oneTimeOrderAssignment.findMany({ where: { oneTimeOrderId: { in: orderIds } }, orderBy: { id: 'asc' } }),
    approvals: await prisma.approvalRequest.findMany({ where: { sourceEntityType: 'inventory_movement' }, orderBy: { id: 'asc' } }),
    audits: await prisma.auditEvent.findMany({ orderBy: { id: 'asc' } }),
  });
  type Snapshot = Awaited<ReturnType<typeof snapshot>>;
  const sourcesUnchanged = (before: Snapshot, after: Snapshot) => {
    for (const key of ['items', 'movements', 'objects', 'orders', 'assignments', 'orderAssignments', 'approvals', 'audits'] as const) assert.deepEqual(after[key], before[key]);
  };
  const restoreInbox = async () => {
    for (const read of [false, true]) await prisma.notification.updateMany({
      where: { id: { in: records.filter(({ originallyRead }) => originallyRead === read).map(({ id }) => id) } },
      data: { readAt: read ? new Date('2026-01-01T12:00:00Z') : null, dismissedAt: null },
    });
  };
  // Keep the actual eligibility query explicit: no service authorization mocks,
  // queued-recipient assumptions, worker trigger or publication is involved.
  const eligibleIds = async (userId = owner.id) => (await database.notification.findMany({
    where: await notificationAccessWhere(database, userId, 'notifications.realtime'), select: { id: true }, orderBy: { id: 'asc' },
  })).map(({ id }) => id);
  const inbox = async (hiddenKeys: string[] = []) => {
    const before = await snapshot();
    const expected = before.notifications.filter((row) => row.recipientUserId === owner.id && row.dismissedAt === null
      && !hiddenKeys.includes(records.find(({ id }) => id === row.id)!.key));
    const result = await json<NotificationListResponseDto>(await request('?page=1&limit=100'));
    assert.equal(result.total, expected.length);
    assert.deepEqual(result.items.map(({ id }) => id).sort(), expected.map(({ id }) => id).sort());
    const unread = await json<{ count: number }>(await request('/unread-count'));
    assert.equal(unread.count, expected.filter(({ readAt }) => readAt === null).length);
    for (const page of [1, 2, expected.length + 1]) {
      const paged = await json<NotificationListResponseDto>(await request(`?page=${page}&limit=1`));
      assert.equal(paged.total, expected.length);
      assert.equal(paged.totalPages, expected.length);
      assert.deepEqual(paged.items.map(({ id }) => id), result.items.slice(page - 1, page).map(({ id }) => id));
    }
    const wire = JSON.stringify(result.items);
    for (const source of sources.filter(({ key }) => hiddenKeys.includes(key))) {
      assert.equal(wire.includes(source.movement.id), false, 'Hidden source ID/targetUrl must not survive');
      for (const record of records.filter(({ key }) => key === source.key)) {
        assert.equal(wire.includes(record.id), false);
        assert.equal(wire.includes(before.notifications.find(({ id }) => id === record.id)!.title), false);
      }
    }
    assert.deepEqual((await eligibleIds()).sort(), expected.map(({ id }) => id).sort(),
      'This proves real DB delivery eligibility only, not outbox/Redis/WebSocket delivery');
    assert.deepEqual(await snapshot(), before);
    return result;
  };
  const rejected = async (id: string, action: 'read' | 'dismiss', expected = 404) => {
    const before = await snapshot();
    const response = await request(`/${id}/${action}`, true);
    assert.equal(response.status, expected, await response.text());
    assert.deepEqual(await snapshot(), before, 'A hidden source cannot be read/dismissed by guessing notification ID');
  };
  const singleMark = async (id: string) => {
    const before = await snapshot();
    const result = await json<NotificationResponseDto>(await request(`/${id}/read`, true), 201);
    const after = await snapshot();
    const stored = after.notifications.find((row) => row.id === id)!;
    assert.ok(stored.readAt);
    assert.equal(result.id, id);
    assert.equal(result.readAt, stored.readAt.toISOString());
    assert.deepEqual(stored, { ...before.notifications.find((row) => row.id === id)!, readAt: stored.readAt });
    assert.deepEqual(after.notifications.filter((row) => row.id !== id), before.notifications.filter((row) => row.id !== id));
    sourcesUnchanged(before, after);
  };
  const dismiss = async (id: string) => {
    const before = await snapshot();
    assert.deepEqual(await json(await request(`/${id}/dismiss`, true), 201), { id, dismissed: true });
    const after = await snapshot();
    const stored = after.notifications.find((row) => row.id === id)!;
    assert.ok(stored.dismissedAt);
    assert.deepEqual(stored, { ...before.notifications.find((row) => row.id === id)!, dismissedAt: stored.dismissedAt });
    assert.deepEqual(after.notifications.filter((row) => row.id !== id), before.notifications.filter((row) => row.id !== id));
    sourcesUnchanged(before, after);
  };
  const genericUnread = records.find((row) => row.recipientUserId === owner.id && row.key === 'generic' && !row.originallyRead)!;
  const genericRead = records.find((row) => row.recipientUserId === owner.id && row.key === 'generic' && row.originallyRead)!;

  await t.test('real inventory source defaults are visible; recipient ownership and unread-dismiss invariant remain intact', async () => {
    const before = await snapshot();
    await inbox();
    const foreign = records.filter(({ recipientUserId }) => recipientUserId === other.id);
    for (const row of foreign) await rejected(row.id, row.originallyRead ? 'dismiss' : 'read');
    await rejected(genericUnread.id, 'dismiss', 400);
    assert.equal(await prisma.notificationOutbox.count({ where: { notificationId: { in: notificationIds } } }), 0);
    assert.deepEqual(await snapshot(), before);
  });

  const cases = [
    ...['inventory.read', 'inventory.movements.read'].flatMap((code) => [
      { code, scope: 'selected', ids: [items[0]!.id], hidden: sources.filter(({ item }) => item.id === items[0]!.id).map(({ key }) => key) },
      { code, scope: 'all', ids: undefined, hidden: sources.map(({ key }) => key) },
    ]),
    { code: 'inventory.access', scope: 'all', ids: undefined, hidden: sources.map(({ key }) => key) },
    ...['objects.read', 'objects.access', 'one_time_orders.read', 'one_time_orders.access'].map((code) => {
      const object = code.startsWith('objects.');
      return { code, scope: 'selected', ids: [object ? objects[0]!.id : orders[0]!.id], hidden: [object ? 'object-A' : 'order-A'] };
    }),
  ];
  for (const scenario of cases) await t.test(`${scenario.code} ${scenario.scope}: inbox/count/bulk/mark/dismiss and DB eligibility observe source revoke`, async (suite) => {
    suite.after(resetRules);
    await restoreInbox();
    // Positive notification grants must never override a denied domain source.
    for (const suffix of ['access', 'read', 'mark_read', 'dismiss', 'realtime']) await rule(`notifications.${suffix}`, 'allow');
    await inbox();
    await rule(scenario.code, 'deny', scenario.ids);
    await inbox(scenario.hidden);
    const hiddenUnread = records.find((row) => row.recipientUserId === owner.id && scenario.hidden.includes(row.key) && !row.originallyRead)!;
    const hiddenRead = records.find((row) => row.recipientUserId === owner.id && scenario.hidden.includes(row.key) && row.originallyRead)!;
    await rejected(hiddenUnread.id, 'read');
    await rejected(hiddenRead.id, 'dismiss');
    await singleMark(genericUnread.id); // Allowed control changes exactly one row.
    const afterMark = await snapshot();
    await singleMark(genericUnread.id); // Idempotent; preserves the original readAt.
    assert.deepEqual(await snapshot(), afterMark);
    const visible = await inbox(scenario.hidden);
    const unreadIds = new Set(visible.items.filter(({ readAt }) => readAt === null).map(({ id }) => id));
    const beforeBulk = await snapshot();
    assert.deepEqual(await json(await request('/read-all', true), 201), { updated: unreadIds.size });
    const afterBulk = await snapshot();
    for (const row of afterBulk.notifications) {
      const old = beforeBulk.notifications.find(({ id }) => id === row.id)!;
      if (unreadIds.has(row.id)) {
        assert.ok(row.readAt);
        assert.deepEqual(row, { ...old, readAt: row.readAt });
      } else assert.deepEqual(row, old, 'Bulk must leave hidden sources and the other recipient unchanged');
    }
    sourcesUnchanged(beforeBulk, afterBulk);
    assert.deepEqual(await json(await request('/read-all', true), 201), { updated: 0 });
    assert.deepEqual(await snapshot(), afterBulk);
    assert.equal(afterBulk.notifications.find(({ id }) => id === hiddenUnread.id)!.readAt, null);
    await dismiss(genericRead.id);
    await inbox(scenario.hidden);
    await revoke(scenario.code);
    await inbox(); // Retained source rows reappear with their untouched unread state.
    await singleMark(hiddenUnread.id);
    await dismiss(hiddenRead.id);
    await inbox();
  });
  await t.test('retained notifications require positive parent visibility, independently of positive inventory and inbox grants', async (suite) => {
    suite.after(resetRules);
    const managerRole = await prisma.role.findUniqueOrThrow({ where: { code: 'manager' } });
    const manager = await prisma.user.create({ data: {
      login: `${marker}-scoped`, fullName: `${marker}-scoped`, passwordHash: template.passwordHash,
      isActive: true, roles: { create: { roleId: managerRole.id } },
    } });
    const cookie = await loginAndGetCookieHeader({ baseUrl, login: manager.login, password: 'manager123' });
    for (const code of ['inventory.read', 'inventory.movements.read', ...['access', 'read', 'mark_read', 'dismiss', 'realtime'].map((suffix) => `notifications.${suffix}`)]) {
      await rule(code, 'allow', undefined, manager.id);
    }
    const object = await prisma.object.create({ data: {
      name: `${marker}-formerly-assigned-object`, address: 'Retained notification fixture', status: 'active', createdByUserId: founder.id,
      assignments: { create: { userId: manager.id, assignmentRoleCode: 'manager', isActive: true } },
    } });
    const order = await prisma.oneTimeOrder.create({ data: {
      title: `${marker}-formerly-assigned-order`, executionAddress: 'Retained notification fixture', contactName: 'Fixture', status: 'in_progress', createdByUserId: founder.id,
      assignments: { create: { userId: manager.id, assignmentRoleCode: 'one_time_manager', isActive: true } },
    } });
    objectIds.push(object.id);
    orderIds.push(order.id);
    const retained: Array<{ id: string; kind: 'object' | 'order'; read: boolean }> = [];
    for (const kind of ['object', 'order'] as const) {
      const movement = await prisma.inventoryMovement.create({ data: {
        inventoryItemId: items[0]!.id, movementType: kind === 'object' ? 'issue_to_object' : 'issue_to_one_time_order',
        status: 'applied', quantity: 1, unitPriceSnapshot: 10, totalAmountSnapshot: 10, createdByUserId: founder.id,
        relatedObjectId: kind === 'object' ? object.id : null, relatedOneTimeOrderId: kind === 'order' ? order.id : null,
      } });
      for (const read of [false, true]) {
        // Legitimate retained inbox: persist while the real assignment still makes the parent visible.
        const row = await prisma.notification.create({ data: {
          recipientUserId: manager.id, type: 'acl.inventory_source', entityType: 'inventory_movement', entityId: movement.id,
          title: `${marker}-retained-${kind}-${read}`, body: kind === 'object' ? object.name : order.title,
          targetUrl: `/inventory?movementId=${movement.id}`, readAt: read ? new Date('2026-01-01T12:00:00Z') : null,
        } });
        notificationIds.push(row.id);
        retained.push({ id: row.id, kind, read });
      }
    }
    const control = await prisma.notification.create({ data: {
      recipientUserId: manager.id, type: 'acl.inventory_source', entityType: 'inventory_movement',
      entityId: sources.find(({ key }) => key === 'receipt-A')!.movement.id, title: `${marker}-retained-receipt-control`,
    } });
    notificationIds.push(control.id);
    const check = async (visibleKinds: Array<'object' | 'order'>) => {
      const before = await snapshot();
      const expectedIds = [control.id, ...retained.filter(({ kind }) => visibleKinds.includes(kind)).map(({ id }) => id)].sort();
      const result = await json<NotificationListResponseDto>(await request('?page=1&limit=100', false, cookie));
      assert.deepEqual(result.items.map(({ id }) => id).sort(), expectedIds);
      assert.equal(result.total, expectedIds.length);
      assert.deepEqual(await json(await request('/unread-count', false, cookie)), {
        count: before.notifications.filter(({ id, readAt }) => expectedIds.includes(id) && readAt === null).length,
      });
      assert.deepEqual((await eligibleIds(manager.id)).sort(), expectedIds);
      const wire = JSON.stringify(result.items);
      for (const row of retained.filter(({ kind }) => !visibleKinds.includes(kind))) assert.equal(wire.includes(row.id), false);
      if (!visibleKinds.includes('object')) assert.equal(wire.includes(object.name), false);
      if (!visibleKinds.includes('order')) assert.equal(wire.includes(order.title), false);
      assert.deepEqual(await snapshot(), before);
    };
    await check(['object', 'order']);
    // Revoke the actual source relationship, not a personal negative rule. The
    // persisted notifications were genuinely readable before this change.
    await prisma.objectAssignment.updateMany({ where: { objectId: object.id, userId: manager.id }, data: { isActive: false } });
    await prisma.oneTimeOrderAssignment.updateMany({ where: { oneTimeOrderId: order.id, userId: manager.id }, data: { isActive: false } });
    assert.equal(await prisma.userAccessRule.count({ where: { userId: manager.id, effect: 'deny' } }), 0);
    await check([]);
    for (const row of retained) {
      const before = await snapshot();
      const response = await request(`/${row.id}/${row.read ? 'dismiss' : 'read'}`, true, cookie);
      assert.equal(response.status, 404, await response.text());
      assert.deepEqual(await snapshot(), before);
    }
    const beforeBulk = await snapshot();
    assert.deepEqual(await json(await request('/read-all', true, cookie), 201), { updated: 1 });
    const afterBulk = await snapshot();
    for (const row of afterBulk.notifications) {
      const old = beforeBulk.notifications.find(({ id }) => id === row.id)!;
      if (row.id === control.id) {
        assert.ok(row.readAt);
        assert.deepEqual(row, { ...old, readAt: row.readAt });
      } else assert.deepEqual(row, old);
    }
    sourcesUnchanged(beforeBulk, afterBulk);
    await rule('objects.read', 'allow', [object.id], manager.id);
    await check(['object']);
    await revoke('objects.read', manager.id);
    await check([]);
    await rule('one_time_orders.read', 'allow', [order.id], manager.id);
    await check(['order']);
    await revoke('one_time_orders.read', manager.id);
    await check([]);
    assert.equal(await prisma.objectAssignment.count({ where: { objectId: object.id, userId: manager.id, isActive: true } }), 0);
    assert.equal(await prisma.oneTimeOrderAssignment.count({ where: { oneTimeOrderId: order.id, userId: manager.id, isActive: true } }), 0);
    assert.equal(await prisma.notification.count({ where: { id: { in: retained.map(({ id }) => id) } } }), 4);
  });

  for (const operation of ['inbox', 'count', 'bulk', 'eligibility'] as const) await t.test(`${operation}: insert after exclusion/source lookup cannot enter unchecked inventory membership`, async (suite) => {
    suite.after(resetRules);
    await restoreInbox();
    for (const suffix of ['access', 'read', 'mark_read', 'dismiss', 'realtime']) await rule(`notifications.${suffix}`, 'allow');
    await rule('inventory.read', 'deny', [items[0]!.id]);
    let enter!: () => void;
    let release!: () => void;
    const entered = new Promise<void>((resolve) => { enter = resolve; });
    const gate = new Promise<void>((resolve) => { release = resolve; });
    // Only the exact reference lookup is paused, AFTER its actual DB result.
    // All other calls retain the original PrismaPromise (including list's
    // transaction array); no authorization result/predicate is manufactured.
    const delegate = database.notification as unknown as { findMany(args: unknown): Promise<unknown> };
    const original = delegate.findMany;
    let claimed = false;
    let refs: Array<{ entityType: string | null; entityId: string | null }> = [];
    delegate.findMany = (args) => {
      const query = args as { where?: { recipientUserId?: string }; distinct?: string[]; select?: { entityType?: boolean; entityId?: boolean } };
      const result = original.call(delegate, args);
      if (!claimed && query.where?.recipientUserId === owner.id && query.distinct?.length === 2
        && query.distinct.includes('entityType') && query.distinct.includes('entityId')
        && query.select?.entityType === true && query.select.entityId === true) {
        claimed = true;
        return result.then(async (rows) => {
          refs = rows as typeof refs;
          enter();
          await gate;
          return rows;
        });
      }
      return result;
    };
    const pending = operation === 'eligibility' ? eligibleIds()
      : request(operation === 'inbox' ? '?page=1&limit=100' : operation === 'count' ? '/unread-count' : '/read-all', operation === 'bulk');
    void pending.catch(() => undefined);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([entered, new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Exact notification source reference barrier was not reached')), 5_000);
      })]);
      clearTimeout(timer);
      const beforeInsert = await snapshot();
      // Independent client: commit a source and retained inbox row only after
      // existing-ID exclusions and reference membership have both been read.
      const movement = await prisma.inventoryMovement.create({ data: {
        inventoryItemId: items[0]!.id, movementType: 'receipt', status: 'applied', quantity: 1,
        unitPriceSnapshot: 10, totalAmountSnapshot: 10, createdByUserId: founder.id,
      } });
      const inserted = await prisma.notification.create({ data: {
        recipientUserId: owner.id, type: 'acl.inventory_source', entityType: 'inventory_movement', entityId: movement.id,
        title: `${marker}-racing-${operation}`, body: items[0]!.name, targetUrl: `/inventory?movementId=${movement.id}`,
        createdAt: new Date('2035-01-01T12:00:00Z'),
      } });
      notificationIds.push(inserted.id);
      assert.equal(refs.some(({ entityId }) => entityId === movement.id), false);
      const afterInsert = await snapshot();
      assert.equal(afterInsert.notifications.length, beforeInsert.notifications.length + 1);
      assert.equal(afterInsert.movements.length, beforeInsert.movements.length + 1);
      const deniedSources = new Set(afterInsert.movements.filter(({ inventoryItemId }) => inventoryItemId === items[0]!.id).map(({ id }) => id));
      const visible = afterInsert.notifications.filter((row) => row.recipientUserId === owner.id && row.dismissedAt === null
        && !(row.entityType === 'inventory_movement' && deniedSources.has(row.entityId!)));
      const expectedIds = visible.map(({ id }) => id).sort();
      const unreadIds = new Set(visible.filter(({ readAt }) => readAt === null).map(({ id }) => id));
      release();
      const response = await pending;
      assert.equal(claimed, true);
      if (operation === 'eligibility') assert.deepEqual((response as string[]).sort(), expectedIds);
      else if (operation === 'inbox') {
        const result = await json<NotificationListResponseDto>(response as Response);
        assert.equal(result.total, expectedIds.length);
        assert.deepEqual(result.items.map(({ id }) => id).sort(), expectedIds);
        for (const secret of [inserted.id, inserted.title, movement.id]) assert.equal(JSON.stringify(result.items).includes(secret), false);
      } else if (operation === 'count') assert.deepEqual(await json(response as Response), { count: unreadIds.size });
      else assert.deepEqual(await json(response as Response, 201), { updated: unreadIds.size });
      const after = await snapshot();
      if (operation !== 'bulk') assert.deepEqual(after, afterInsert);
      else {
        for (const row of after.notifications) {
          const old = afterInsert.notifications.find(({ id }) => id === row.id)!;
          if (unreadIds.has(row.id)) {
            assert.ok(row.readAt);
            assert.deepEqual(row, { ...old, readAt: row.readAt });
          } else assert.deepEqual(row, old, 'Late denied source and other recipients must remain untouched');
        }
        sourcesUnchanged(afterInsert, after);
      }
      assert.equal(after.notifications.find(({ id }) => id === inserted.id)!.readAt, null);
    } finally {
      clearTimeout(timer);
      release();
      await pending.catch(() => undefined);
      delegate.findMany = original;
    }
  });
  assert.equal(await prisma.notificationOutbox.count({ where: { notificationId: { in: notificationIds } } }), 0);
  // Main owns execution and disposable-schema cleanup. No external calls,
  // createForRecipients/outbox worker, enqueue, Redis publication, socket/realtime
  // delivery or browser/admin-save is claimed. Concurrency coverage is only the
  // controlled insert window above, not general concurrent mutation safety.
});
