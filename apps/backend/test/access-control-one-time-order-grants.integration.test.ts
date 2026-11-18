import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { PrismaClient } from '@prisma/client';

import type { OneTimeOrderResponseDto } from '../src/modules/one-time-orders/dto/one-time-order-response.dto';
import { ACCESS_ACTION_CATALOG } from '../src/modules/users-access/access-action-catalog';
import { loginAndGetCookieHeader } from './helpers/auth';
import { createTestApp } from './helpers/create-test-app';
import { usesIsolatedIntegrationDatabase } from './helpers/isolated-database';

// Run only through the main agent's sequential isolated integration runner.
// This file does not certify workforce, finance, payouts, calendar, copy, reviews,
// manager administration, inventory/equipment or actual file storage delivery.
// Completion below is a lifecycle regression with a real zero-payment record,
// not acceptance of complete/reopen/payment grants across all supported scopes.
const covered = [
  'access', 'read', 'create', 'update', 'status', 'comments.read',
  'comments.create', 'reports.read', 'reports.update', 'photos.read', 'history',
  'specification.read', 'specification.execute', 'specification.comments',
  'specification.detach',
] as const;
type Scope = 'selected' | 'all';
type Entity = { id: string };

test('one-time order grants use live HTTP sessions, persisted effects and parent boundaries', { timeout: 180_000 }, async (t) => {
  // All guards precede Prisma/app initialization. Never fall back to a shared DB.
  assert.equal(usesIsolatedIntegrationDatabase(), true);
  const databaseUrl = new URL(process.env.DATABASE_URL!);
  assert.ok(['postgres:', 'postgresql:'].includes(databaseUrl.protocol));
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(databaseUrl.hostname));
  assert.equal(databaseUrl.port, '55432');
  assert.match(databaseUrl.searchParams.get('schema') ?? '', /^integration_\d+_\d+$/);
  // App initialization pings storage even though this suite uses metadata only.
  assert.ok(['localhost', '127.0.0.1', '::1'].includes(process.env.MINIO_ENDPOINT ?? ''));
  assert.equal(process.env.MINIO_USE_SSL, 'false');
  for (const suffix of covered) {
    const action = ACCESS_ACTION_CATALOG.find((entry) => entry.code === `one_time_orders.${suffix}`);
    assert.ok(action?.manageable, suffix);
    assert.ok(action.allowedScopes.includes('all'), suffix);
    if (suffix !== 'create') assert.ok(action.allowedScopes.includes('selected'), suffix);
  }

  const prisma = new PrismaClient();
  let closeApp: (() => Promise<void>) | undefined = undefined;
  t.after(async () => {
    try { await closeApp?.(); } finally { await prisma.$disconnect(); }
    // The isolated runner owns schema disposal; no seed/shared-data cleanup.
  });
  const { app, baseUrl } = await createTestApp();
  closeApp = () => app.close();
  const marker = `acl-oto-${randomUUID()}`;
  const founder = await prisma.user.findUniqueOrThrow({ where: { login: 'founder' } });
  const template = await prisma.user.findUniqueOrThrow({ where: { login: 'manager1' } });
  const newUser = async (label: string, roleCode: string) => {
    const role = await prisma.role.findUniqueOrThrow({ where: { code: roleCode } });
    return prisma.user.create({ data: {
      login: `${marker}-${label}`, fullName: `${marker} ${label}`,
      passwordHash: template.passwordHash, isActive: true,
      roles: { create: { roleId: role.id } },
    } });
  };
  // The unassigned operator can read orders only after a personal grant. The
  // executor supplies the independent, mandatory active-manager R2 invariant.
  const actor = await newUser('operator', 'operation_manager');
  const executor = await newUser('executor', 'manager');
  const userIds = [actor.id, executor.id];
  const identities = () => prisma.user.findMany({ where: { id: { in: userIds } },
    include: { roles: true, permissions: true }, orderBy: { id: 'asc' } });
  const initialIdentities = await identities();
  const founderCookie = await loginAndGetCookieHeader({ baseUrl, login: founder.login, password: 'founder123' });
  const actorCookie = await loginAndGetCookieHeader({ baseUrl, login: actor.login, password: 'manager123' });
  const executorCookie = await loginAndGetCookieHeader({ baseUrl, login: executor.login, password: 'manager123' });
  // Cookies are deliberately never refreshed after grant/deny/default changes.
  const request = (path: string, method = 'GET', body?: unknown, cookie = actorCookie) => fetch(`${baseUrl}/api/v1${path}`, {
    method, headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(15_000),
  });
  const json = async <T,>(response: Response, status = 200): Promise<T> => {
    const body = await response.text();
    assert.equal(response.status, status, body);
    return JSON.parse(body) as T;
  };
  const rule = (suffix: string, effect: 'allow' | 'deny', scope: Scope, selectedIds: string[] = [], userId = actor.id) => {
    assert.ok(userIds.includes(userId), 'Rules belong only to synthetic users');
    const actionCode = `one_time_orders.${suffix}`;
    assert.ok(ACCESS_ACTION_CATALOG.find((entry) => entry.code === actionCode)?.allowedScopes.includes(scope));
    return prisma.userAccessRule.upsert({ where: { userId_actionCode: { userId, actionCode } },
      create: { userId, actionCode, effect, scope, selectedIds }, update: { effect, scope, selectedIds } });
  };
  const revoke = (suffix: string, userId = actor.id) => prisma.userAccessRule.deleteMany({
    where: { userId, actionCode: `one_time_orders.${suffix}` },
  });
  const reset = () => prisma.userAccessRule.deleteMany({ where: { userId: { in: userIds }, actionCode: { startsWith: 'one_time_orders.' } } });
  let sequence = 0;
  const input = () => ({ title: `${marker}-${++sequence}`, executionAddress: 'Isolated integration address',
    contactName: 'Synthetic client', status: 'in_progress', plannedPaymentMethod: 'cash', agreedSum: 0 });
  const object = await prisma.object.create({ data: { name: marker, address: 'Synthetic linked object', status: 'active', createdByUserId: founder.id } });
  const a = await json<OneTimeOrderResponseDto>(await request('/one-time-orders', 'POST', {
    ...input(), linkedObjectId: object.id, managerUserIds: [executor.id],
  }, founderCookie), 201);
  const b = await json<OneTimeOrderResponseDto>(await request('/one-time-orders', 'POST', {
    ...input(), managerUserIds: [executor.id],
  }, founderCookie), 201);
  const root = (id: string) => `/one-time-orders/${id}`;
  const card = (id: string, cookie = actorCookie) => request(root(id), 'GET', undefined, cookie).then((response) => json<OneTimeOrderResponseDto>(response));
  const items = new Map<string, Entity>();
  for (const order of [a, b]) {
    items.set(order.id, await json<Entity>(await request(`${root(order.id)}/specification-items`, 'POST', { title: `Task ${order.id}` }, founderCookie), 201));
    await json(await request(`${root(order.id)}/comments`, 'POST', { content: `Initial ${order.id}` }, executorCookie), 201);
    await json(await request(`${root(order.id)}/daily-report/today`, 'PUT', { content: `Report ${order.id}` }, executorCookie));
    // Synthetic metadata is enough for read authorization; no object is uploaded.
    await prisma.oneTimeOrderPhoto.create({ data: { oneTimeOrderId: order.id, photoCategory: 'before', createdByUserId: executor.id } });
  }
  const itemIds = [...items.values()].map((item) => item.id);
  const file = await prisma.file.create({ data: {
    bucket: 'integration-metadata-only', objectKey: `${marker}/never-uploaded.txt`, originalName: `${marker}.txt`,
    mimeType: 'text/plain', sizeBytes: 1, uploadedByUserId: executor.id,
    attachments: { create: { entityType: 'one_time_order_specification_item', entityId: items.get(a.id)!.id, uploadedByUserId: executor.id } },
  } });
  const snapshot = async () => {
    const orders = await prisma.oneTimeOrder.findMany({ where: { title: { startsWith: marker } }, orderBy: { id: 'asc' } });
    const ids = orders.map((entry) => entry.id);
    const [assignments, comments, reports, photos, specifications, specificationComments, audits, completions, payments, funding, expenses, files, attachments, parent] = await Promise.all([
      prisma.oneTimeOrderAssignment.findMany({ where: { oneTimeOrderId: { in: ids } }, orderBy: { id: 'asc' } }),
      prisma.oneTimeOrderComment.findMany({ where: { oneTimeOrderId: { in: ids } }, orderBy: { id: 'asc' } }),
      prisma.oneTimeOrderDailyReport.findMany({ where: { oneTimeOrderId: { in: ids } }, orderBy: { id: 'asc' } }),
      prisma.oneTimeOrderPhoto.findMany({ where: { oneTimeOrderId: { in: ids } }, orderBy: { id: 'asc' } }),
      prisma.oneTimeOrderSpecificationItem.findMany({ where: { oneTimeOrderId: { in: ids } }, orderBy: { id: 'asc' } }),
      prisma.oneTimeOrderSpecificationComment.findMany({ where: { itemId: { in: itemIds } }, orderBy: { id: 'asc' } }),
      prisma.auditEvent.findMany({ where: { OR: [{ entityType: 'one_time_order', entityId: { in: ids } }, { actorUserId: { in: userIds } }] }, orderBy: { id: 'asc' } }),
      prisma.oneTimeOrderCompletion.findMany({ where: { oneTimeOrderId: { in: ids } }, orderBy: { id: 'asc' } }),
      prisma.oneTimeOrderCompletionPayment.findMany({ where: { oneTimeOrderId: { in: ids } }, orderBy: { id: 'asc' } }),
      prisma.accountabilityFunding.findMany({ where: { oneTimeOrderId: { in: ids } }, orderBy: { id: 'asc' } }),
      prisma.accountabilityExpense.findMany({ where: { oneTimeOrderId: { in: ids } }, orderBy: { id: 'asc' } }),
      prisma.file.findMany({ where: { objectKey: { startsWith: marker } }, orderBy: { id: 'asc' } }),
      prisma.fileAttachment.findMany({ where: { fileId: file.id }, orderBy: { id: 'asc' } }),
      prisma.object.findUniqueOrThrow({ where: { id: object.id } }),
    ]);
    return { orders, assignments, comments, reports, photos, specifications, specificationComments, audits, completions, payments, funding, expenses, files, attachments, parent };
  };
  type Snapshot = Awaited<ReturnType<typeof snapshot>>;
  const rejected = async (path: string, method = 'GET', body?: unknown, status = 403, cookie = actorCookie) => {
    const before = await snapshot();
    const response = await request(path, method, body, cookie);
    const text = await response.text();
    const after = await snapshot();
    // Check effects first so an unexpected HTTP success still exposes persistence.
    assert.deepEqual(after, before, `${method} ${path}: rejected requests must have no domain, audit, file or money effects (${response.status}: ${text})`);
    assert.equal(response.status, status, `${method} ${path}: ${text}`);
  };
  const audit = async (before: Snapshot, id: string, action: string, actorUserId = actor.id) => {
    const added = (await snapshot()).audits.filter((entry) => entry.entityType === 'one_time_order' && entry.entityId === id &&
      !before.audits.some((old) => old.id === entry.id));
    assert.equal(added.length, 1, action);
    assert.equal(added[0]!.entityType, 'one_time_order');
    assert.equal(added[0]!.entityId, id);
    assert.equal(added[0]!.action, action);
    assert.equal(added[0]!.actorUserId, actorUserId);
    return added[0]!;
  };
  const unchanged = (before: Snapshot, after: Snapshot, except: Array<keyof Snapshot>) => {
    for (const key of Object.keys(before) as Array<keyof Snapshot>) {
      if (!except.includes(key)) assert.deepEqual(after[key], before[key], key);
    }
  };

  await t.test('access/read selected A, control B, all, default and revoke filter before pagination', async () => {
    try {
      const listing = async (expected: string[], cookie = actorCookie) => {
        const before = await snapshot();
        const page = await json<{ items: Entity[]; total: number }>(await request(`/one-time-orders?q=${marker}&limit=1`, 'GET', undefined, cookie));
        assert.equal(page.total, expected.length);
        assert.equal(page.items.length, Math.min(1, expected.length));
        assert.ok(page.items.every((entry) => expected.includes(entry.id)));
        assert.deepEqual(await snapshot(), before);
      };
      await listing([]);
      await rejected(root(a.id), 'GET', undefined, 404);
      await rule('access', 'allow', 'all');
      await listing([]); // Section access is independent from card read access.
      await rule('read', 'allow', 'selected', [a.id]);
      await listing([a.id]);
      assert.equal((await card(a.id)).id, a.id);
      await rejected(root(b.id), 'GET', undefined, 404);
      await revoke('read');
      await listing([]);
      await rule('read', 'allow', 'all');
      await listing([a.id, b.id]);
      for (const parent of ['read', 'access']) {
        if (parent === 'read') {
          // A user/action has only one rule. Replacing the unassigned actor's
          // read allow with a deny also removes its positive grant for B.
          await rule('read', 'deny', 'selected', [a.id]);
          await listing([]);
          await rejected(root(a.id));
          await rejected(root(b.id), 'GET', undefined, 404);
          await rule('read', 'allow', 'all');
          // Use actual assignment inheritance to test subtraction A/control B.
          await rule('read', 'deny', 'selected', [a.id], executor.id);
          await listing([b.id], executorCookie);
          await rejected(root(a.id), 'GET', undefined, 403, executorCookie);
          assert.equal((await card(b.id, executorCookie)).id, b.id);
          await revoke('read', executor.id);
        } else {
          await rule(parent, 'deny', 'selected', [a.id]);
          await listing([b.id]);
          await rejected(root(a.id));
          assert.equal((await card(b.id)).id, b.id);
          await revoke(parent);
        }
      }
      await rule('access', 'deny', 'all');
      await rejected(`/one-time-orders?q=${marker}`);
      await rejected(root(a.id));
      await rejected(root(b.id));
      await revoke('access');
      await listing([a.id, b.id]);
      // A linked order grant must not grant the independent object card.
      await rejected(`/objects/${object.id}`, 'GET', undefined, 404);
      assert.equal((await card(a.id)).linkedObject?.canOpenObjectCard, false);
      const objectRule = { userId: actor.id, actionCode: 'objects.read' };
      try {
        await prisma.userAccessRule.create({ data: { ...objectRule, effect: 'allow', scope: 'selected', selectedIds: [object.id] } });
        await json(await request(`/objects/${object.id}`));
        assert.equal((await card(a.id)).linkedObject?.canOpenObjectCard, true);
        await prisma.userAccessRule.update({ where: { userId_actionCode: objectRule }, data: { effect: 'deny' } });
        await rejected(`/objects/${object.id}`, 'GET', undefined, 404);
        assert.equal((await card(a.id)).linkedObject?.canOpenObjectCard, false);
        assert.equal((await card(b.id)).id, b.id);
      } finally {
        await prisma.userAccessRule.deleteMany({ where: objectRule });
      }
    } finally { await reset(); }
  });

  await t.test('create is independent from section access and keeps author, audit and lifecycle', async () => {
    try {
      await rejected('/one-time-orders', 'POST', input());
      await rule('access', 'allow', 'all');
      await rejected('/one-time-orders', 'POST', input());
      await rule('create', 'allow', 'all');
      const before = await snapshot();
      const payload = input();
      const created = await json<OneTimeOrderResponseDto>(await request('/one-time-orders', 'POST', payload), 201);
      const after = await snapshot();
      assert.equal(created.createdBy.id, actor.id);
      const stored = after.orders.find((entry) => entry.id === created.id)!;
      assert.equal(stored.title, payload.title);
      assert.equal(stored.createdByUserId, actor.id);
      assert.equal(stored.status, 'in_progress');
      assert.equal(stored.workCycle, 1);
      assert.deepEqual(after.orders.filter((entry) => entry.id !== created.id), before.orders);
      unchanged(before, after, ['orders', 'assignments', 'audits']);
      assert.ok(after.assignments.filter((entry) => entry.oneTimeOrderId === created.id).every((entry) => entry.userId === actor.id));
      await audit(before, created.id, 'one_time_order.created');
      await rejected('/one-time-orders', 'POST', { ...input(), status: 'completed' }, 409);
      await rule('create', 'deny', 'all');
      await rejected('/one-time-orders', 'POST', input());
      await revoke('create');
      await rejected('/one-time-orders', 'POST', input());
      await rule('create', 'allow', 'all');
      await rule('access', 'deny', 'all');
      await rejected('/one-time-orders', 'POST', input());
    } finally { await reset(); }
  });

  for (const leaf of ['update', 'status', 'comments.create', 'reports.update'] as const) {
    await t.test(`${leaf}: additive selected/all writes, live deny/revoke, read and section parents`, async () => {
      try {
        await rule('read', 'allow', 'all');
        const attempt = async (id: string, allowed: boolean, cookie = actorCookie) => {
          const previous = await prisma.oneTimeOrder.findUniqueOrThrow({ where: { id } });
          const content = `${marker} changed ${++sequence}`;
          const nextStatus = previous.status === 'in_progress' ? 'new' : 'in_progress';
          const path = `${root(id)}${leaf === 'update' ? '' : leaf === 'status' ? '/status' : leaf === 'comments.create' ? '/comments' : '/daily-report/today'}`;
          const method = leaf === 'comments.create' ? 'POST' : leaf === 'reports.update' ? 'PUT' : 'PATCH';
          const body = leaf === 'update' ? { description: content } : leaf === 'status' ? { status: nextStatus } : { content };
          if (!allowed) { await rejected(path, method, body, 403, cookie); return; }
          const before = await snapshot();
          const changed = await json<Entity>(await request(path, method, body, cookie), method === 'POST' ? 201 : 200);
          const after = await snapshot();
          const stored = after.orders.find((entry) => entry.id === id)!;
          if (leaf === 'update' || leaf === 'status') {
            assert.equal(changed.id, id);
            assert.deepEqual(stored, { ...previous, updatedAt: stored.updatedAt,
              ...(leaf === 'update' ? { description: content } : { status: nextStatus }) });
            assert.deepEqual(after.orders.filter((entry) => entry.id !== id), before.orders.filter((entry) => entry.id !== id));
            unchanged(before, after, ['orders', 'audits']);
          } else if (leaf === 'comments.create') {
            const row = after.comments.find((entry) => entry.id === changed.id)!;
            assert.equal(row.oneTimeOrderId, id);
            assert.equal(row.content, content);
            assert.equal(row.createdByUserId, cookie === executorCookie ? executor.id : actor.id);
            assert.deepEqual(after.comments.filter((entry) => entry.id !== changed.id), before.comments);
            unchanged(before, after, ['comments', 'audits']);
          } else {
            const row = after.reports.find((entry) => entry.id === changed.id)!;
            assert.equal(row.oneTimeOrderId, id);
            assert.equal(row.content, content);
            assert.equal(row.updatedByUserId, cookie === executorCookie ? executor.id : actor.id);
            assert.deepEqual(after.reports.filter((entry) => entry.oneTimeOrderId !== id), before.reports.filter((entry) => entry.oneTimeOrderId !== id));
            unchanged(before, after, ['reports', 'audits']);
          }
          await audit(before, id, `one_time_order.${leaf === 'update' ? 'updated' : leaf === 'status' ? 'status_changed' : leaf === 'comments.create' ? 'comment_created' : 'daily_report_upserted'}`,
            cookie === executorCookie ? executor.id : actor.id);
        };
        await attempt(a.id, false);
        await rule(leaf, 'allow', 'selected', [a.id]);
        await attempt(a.id, true);
        await attempt(b.id, false);
        await rule(leaf, 'deny', 'selected', [a.id]);
        await attempt(a.id, false);
        await revoke(leaf);
        await attempt(a.id, false);
        await rule(leaf, 'allow', 'all');
        await attempt(b.id, true);
        for (const parent of ['read', 'access']) {
          // Keep B's positive read source while denying A: read allow/deny
          // cannot coexist on the unassigned actor's unique rule row.
          const userId = parent === 'read' ? executor.id : actor.id;
          const cookie = parent === 'read' ? executorCookie : actorCookie;
          if (parent === 'read') await rule(leaf, 'allow', 'all', [], executor.id);
          await rule(parent, 'deny', 'selected', [a.id], userId);
          await attempt(a.id, false, cookie);
          await attempt(b.id, true, cookie);
          await revoke(parent, userId);
          if (parent === 'read') await revoke(leaf, executor.id);
        }
        await rule(leaf, 'deny', 'all');
        await attempt(a.id, false);
        await attempt(b.id, false);
      } finally { await reset(); }
    });
  }

  for (const leaf of ['comments.read', 'reports.read', 'photos.read', 'specification.read', 'history'] as const) {
    await t.test(`${leaf}: real child rows, additive grants, deny/default and parent denial`, async () => {
      try {
        await rule('read', 'allow', 'all');
        const paths = (id: string) => leaf === 'history' ? [`${root(id)}/history`, `${root(id)}/history-page?limit=1`]
          : [`${root(id)}/${leaf === 'comments.read' ? 'comments' : leaf === 'reports.read' ? 'daily-report/today' : leaf === 'photos.read' ? 'photos' : 'specification-items'}`];
        const readable = async (id: string, cookie = actorCookie) => {
          const before = await snapshot();
          for (const path of paths(id)) {
            const response = await request(path, 'GET', undefined, cookie);
            if (leaf === 'reports.read') {
              const body = await json<Entity & { content: string }>(response);
              assert.ok(before.reports.some((entry) => entry.id === body.id && entry.oneTimeOrderId === id && entry.content === body.content));
            } else {
              const body = await json<Entity[] | { items: Entity[]; total: number }>(response);
              const rows = Array.isArray(body) ? body : body.items;
              assert.ok(rows.length > 0, path);
              const expected = leaf === 'comments.read' ? before.comments.filter((entry) => entry.oneTimeOrderId === id)
                : leaf === 'photos.read' ? before.photos.filter((entry) => entry.oneTimeOrderId === id)
                : leaf === 'specification.read' ? before.specifications.filter((entry) => entry.oneTimeOrderId === id)
                : before.audits.filter((entry) => entry.entityId === id);
              assert.ok(rows.every((row) => expected.some((entry) => entry.id === row.id)), path);
              if (!Array.isArray(body)) assert.equal(body.total, expected.length);
            }
          }
          assert.deepEqual(await snapshot(), before);
        };
        await readable(a.id);
        await rule(leaf, 'allow', 'selected', [a.id]);
        await readable(a.id);
        await readable(b.id); // Allow is additive to the child's legacy read.
        await rule(leaf, 'deny', 'selected', [a.id]);
        for (const path of paths(a.id)) await rejected(path);
        await readable(b.id);
        await revoke(leaf);
        await readable(a.id);
        await rule(leaf, 'deny', 'all');
        for (const order of [a, b]) for (const path of paths(order.id)) await rejected(path);
        await rule(leaf, 'allow', 'all');
        for (const parent of ['read', 'access']) {
          const userId = parent === 'read' ? executor.id : actor.id;
          const cookie = parent === 'read' ? executorCookie : actorCookie;
          if (parent === 'read') await rule(leaf, 'allow', 'all', [], executor.id);
          await rule(parent, 'deny', 'selected', [a.id], userId);
          for (const path of paths(a.id)) await rejected(path, 'GET', undefined, 403, cookie);
          await readable(b.id, cookie);
          await revoke(parent, userId);
          if (parent === 'read') await revoke(leaf, executor.id);
        }
      } finally { await reset(); }
    });
  }

  await t.test('specification execution/comments require assignment; grants preserve idempotency, deny and control B', async () => {
    try {
      await rule('read', 'allow', 'all');
      const path = `${root(a.id)}/specification-items/${items.get(a.id)!.id}`;
      for (const [leaf, suffix, body] of [
        ['specification.execute', 'complete', undefined],
        ['specification.comments', 'comments', { requestId: randomUUID(), content: 'Unassigned actor' }],
      ] as const) {
        await rule(leaf, 'allow', 'all');
        await rejected(`${path}/${suffix}`, 'POST', body);
      }
      await rule('specification.manage', 'allow', 'all');
      await rejected(`${root(a.id)}/specification-items`, 'POST', { title: 'No leadership role' });
      await revoke('specification.manage');
      for (const leaf of ['specification.execute', 'specification.comments'] as const) {
        const attempt = async (id: string, allowed: boolean) => {
          const itemId = items.get(id)!.id;
          const prior = await prisma.oneTimeOrderSpecificationItem.findUniqueOrThrow({ where: { id: itemId } });
          const suffix = leaf === 'specification.comments' ? 'comments' : prior.isCompleted ? 'reopen' : 'complete';
          const target = `${root(id)}/specification-items/${itemId}/${suffix}`;
          const body = leaf === 'specification.comments' ? { requestId: randomUUID(), content: `R2 ${++sequence}` } : undefined;
          if (!allowed) { await rejected(target, 'POST', body, 403, executorCookie); return; }
          const before = await snapshot();
          const result = await json<Entity>(await request(target, 'POST', body, executorCookie), 201);
          const after = await snapshot();
          if (leaf === 'specification.execute') {
            const stored = after.specifications.find((entry) => entry.id === itemId)!;
            assert.equal(stored.isCompleted, !prior.isCompleted);
            assert.equal(stored.completedByUserId, stored.isCompleted ? executor.id : null);
            assert.equal(stored.completedAt !== null, stored.isCompleted);
            assert.equal(stored.title, prior.title);
            assert.deepEqual(after.specifications.filter((entry) => entry.id !== itemId), before.specifications.filter((entry) => entry.id !== itemId));
            unchanged(before, after, ['specifications', 'audits']);
          } else {
            const stored = after.specificationComments.find((entry) => entry.id === result.id)!;
            assert.equal(stored.itemId, itemId);
            assert.equal(stored.createdByUserId, executor.id);
            assert.equal(stored.content, body!.content);
            assert.equal(stored.requestId, body!.requestId);
            assert.deepEqual(after.specificationComments.filter((entry) => entry.id !== result.id), before.specificationComments);
            unchanged(before, after, ['specificationComments', 'audits']);
          }
          await audit(before, id, `one_time_order.specification_item_${leaf === 'specification.comments' ? 'comment_created' : suffix === 'complete' ? 'completed' : 'reopened'}`, executor.id);
          if (body) {
            const replay = await json<Entity>(await request(target, 'POST', body, executorCookie), 201);
            assert.equal(replay.id, result.id);
            assert.deepEqual(await snapshot(), after, 'Identical request creates no duplicate comment/audit');
          }
        };
        await attempt(a.id, true);
        await rule(leaf, 'allow', 'selected', [a.id], executor.id);
        await attempt(a.id, true);
        await attempt(b.id, true);
        await rule(leaf, 'deny', 'selected', [a.id], executor.id);
        await attempt(a.id, false);
        await attempt(b.id, true);
        await revoke(leaf, executor.id);
        await attempt(a.id, true);
        await rule(leaf, 'allow', 'all', [], executor.id);
        for (const parent of ['read', 'access']) {
          await rule(parent, 'deny', 'selected', [a.id], executor.id);
          await attempt(a.id, false);
          await attempt(b.id, true);
          await revoke(parent, executor.id);
        }
        await rule(leaf, 'deny', 'all', [], executor.id);
        await attempt(a.id, false);
        await attempt(b.id, false);
        await revoke(leaf, executor.id);
      }
      await prisma.oneTimeOrderAssignment.updateMany({ where: { oneTimeOrderId: a.id, userId: executor.id }, data: { isActive: false } });
      await rule('read', 'allow', 'all', [], executor.id);
      await rule('specification.execute', 'allow', 'all', [], executor.id);
      await rule('specification.comments', 'allow', 'all', [], executor.id);
      await rejected(`${path}/complete`, 'POST', undefined, 403, executorCookie);
      await rejected(`${path}/comments`, 'POST', { requestId: randomUUID(), content: 'Removed assignment' }, 403, executorCookie);
    } finally {
      await prisma.oneTimeOrderAssignment.updateMany({ where: { oneTimeOrderId: a.id, userId: executor.id }, data: { isActive: true } });
      await reset();
    }
  });

  await t.test('file metadata follows order/specification parents; detach deletes only the link and audits the actor', async () => {
    try {
      const itemId = items.get(a.id)!.id;
      const list = `/files/entity/one_time_order_specification_item/${itemId}`;
      const detach = `${root(a.id)}/specification-items/${itemId}/attachments/${file.id}`;
      const beforeRead = await snapshot();
      const rows = await json<Entity[]>(await request(list, 'GET', undefined, executorCookie));
      assert.deepEqual(rows.map((entry) => entry.id), [file.id]);
      assert.equal((await json<Entity>(await request(`/files/${file.id}`, 'GET', undefined, executorCookie))).id, file.id);
      assert.deepEqual(await snapshot(), beforeRead);
      for (const parent of ['specification.read', 'read', 'access']) {
        await rule(parent, 'deny', 'selected', [a.id], executor.id);
        await rejected(list, 'GET', undefined, 403, executorCookie);
        await rejected(`/files/${file.id}`, 'GET', undefined, 403, executorCookie);
        await revoke(parent, executor.id);
      }
      await rule('read', 'allow', 'all');
      await rule('specification.detach', 'allow', 'all');
      await rejected(detach, 'DELETE'); // Assignment remains mandatory.
      await rule('specification.detach', 'deny', 'selected', [a.id], executor.id);
      await rejected(detach, 'DELETE', undefined, 403, executorCookie);
      await revoke('specification.detach', executor.id);
      await rule('specification.detach', 'allow', 'selected', [a.id], executor.id);
      for (const parent of ['read', 'access']) {
        await rule(parent, 'deny', 'selected', [a.id], executor.id);
        await rejected(detach, 'DELETE', undefined, 403, executorCookie);
        await revoke(parent, executor.id);
      }
      const before = await snapshot();
      await json(await request(detach, 'DELETE', undefined, executorCookie));
      const after = await snapshot();
      assert.equal(after.attachments.length, 0);
      unchanged(before, after, ['attachments', 'audits']);
      const event = await audit(before, a.id, 'one_time_order.specification_item_attachment_detached', executor.id);
      assert.equal((event.oldValues as { fileId: string }).fileId, file.id);
      assert.equal((event.oldValues as { originalName: string }).originalName, file.originalName);
      assert.deepEqual(await prisma.file.findUniqueOrThrow({ where: { id: file.id } }), file);
      await rejected(detach, 'DELETE', undefined, 404, executorCookie);
    } finally { await reset(); }
  });

  await t.test('status grants never bypass dedicated completion/reopen or closed-order R2 invariants', async () => {
    try {
      await rule('read', 'allow', 'all');
      await rule('status', 'allow', 'all');
      await rejected(`${root(a.id)}/status`, 'PATCH', { status: 'completed' }, 409);
      const workCycle = (await card(a.id)).workCycle;
      const completion = { workCycle, clientRequestId: randomUUID(), payments: [{ amount: 0, zeroReason: 'free_order' }] };
      await rejected(`${root(a.id)}/complete`, 'POST', completion);
      await rule('complete', 'allow', 'selected', [a.id]);
      await rule('payments.create', 'deny', 'selected', [a.id]);
      await rejected(`${root(a.id)}/complete`, 'POST', completion);
      // The actual workflow is exercised by its existing authorized founder;
      // no direct DB status/completion fabrication and no real money movement.
      const before = await snapshot();
      const result = await json<Entity>(await request(`${root(a.id)}/complete`, 'POST', completion, founderCookie), 201);
      const after = await snapshot();
      const stored = after.orders.find((entry) => entry.id === a.id)!;
      assert.equal(stored.status, 'completed');
      assert.equal(stored.workCycle, workCycle);
      assert.equal(stored.completedByUserId, founder.id);
      assert.ok(stored.completedAt);
      assert.ok(after.completions.some((entry) => entry.id === result.id && entry.oneTimeOrderId === a.id && entry.workCycle === workCycle));
      const payment = after.payments.filter((entry) => entry.completionId === result.id);
      assert.equal(payment.length, 1);
      assert.equal(payment[0]!.amount.toString(), '0');
      assert.equal(payment[0]!.zeroReason, 'free_order');
      unchanged(before, after, ['orders', 'completions', 'payments', 'audits']);
      await audit(before, a.id, 'one_time_order.completed', founder.id);
      const replay = await json<Entity>(await request(`${root(a.id)}/complete`, 'POST', completion, founderCookie), 201);
      assert.equal(replay.id, result.id);
      assert.deepEqual(await snapshot(), after);
      await rejected(`${root(a.id)}/status`, 'PATCH', { status: 'in_progress' }, 409);
      for (const leaf of ['specification.execute', 'specification.comments', 'specification.detach']) {
        await rule(leaf, 'allow', 'all', [], executor.id);
      }
      const spec = `${root(a.id)}/specification-items/${items.get(a.id)!.id}`;
      await rejected(`${spec}/complete`, 'POST', undefined, 409, executorCookie);
      await rejected(`${spec}/comments`, 'POST', { requestId: randomUUID(), content: 'Closed order' }, 409, executorCookie);
      await rejected(`${spec}/attachments/${file.id}`, 'DELETE', undefined, 409, executorCookie);
      const beforeReopen = await snapshot();
      const reopened = await json<OneTimeOrderResponseDto>(await request(`${root(a.id)}/reopen`, 'POST', undefined, founderCookie), 201);
      assert.equal(reopened.workCycle, workCycle + 1);
      assert.notEqual(reopened.status, 'completed');
      assert.equal(reopened.completedAt, null);
      const afterReopen = await snapshot();
      assert.deepEqual(afterReopen.payments, beforeReopen.payments);
      assert.deepEqual(afterReopen.funding, beforeReopen.funding);
      assert.deepEqual(afterReopen.expenses, beforeReopen.expenses);
      assert.deepEqual(afterReopen.orders.find((entry) => entry.id === b.id), beforeReopen.orders.find((entry) => entry.id === b.id));
      await audit(beforeReopen, a.id, 'one_time_order.reopened', founder.id);
    } finally { await reset(); }
  });

  assert.deepEqual(await identities(), initialIdentities, 'Personal rules never rewrite roles, legacy permissions or identities');
});
