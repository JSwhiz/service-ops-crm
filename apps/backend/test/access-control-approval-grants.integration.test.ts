import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { PrismaClient } from '@prisma/client';

import type { ApprovalRequestResponseDto } from '../src/modules/approvals/dto/approval-request-response.dto';
import { ACCESS_ACTION_CATALOG } from '../src/modules/users-access/access-action-catalog';
import { loginAndGetCookieHeader } from './helpers/auth';
import { createTestApp } from './helpers/create-test-app';
import { usesIsolatedIntegrationDatabase } from './helpers/isolated-database';

// Main sequential isolated runner only. This suite does not enable the five
// resolver actions marked policy_decision_required by the current catalog.
// Their denies/defaults narrow existing resolvers; injected allows must never
// invent a new resolver. "Own" means author inheritance, not an unsupported
// personal-rule scope (approvals currently supports only selected/all).
const resolvers = [
  'resolve_task_result', 'resolve_object_change', 'resolve_inventory_exception',
  'resolve_accountability', 'resolve_timesheet',
] as const;
type Resolver = (typeof resolvers)[number];
type Fixture = {
  id: string; sourceEntityId: string; sourceEntityType: string; createdByUserId: string;
  action: Resolver; sourceAction: string; sourceId: string;
};

test('all eight approval actions preserve OQ-153 reading, real source decisions, revocation and independent approval', { timeout: 180_000 }, async (t) => {
  assert.equal(usesIsolatedIntegrationDatabase(), true);
  const url = new URL(process.env.DATABASE_URL!);
  assert.ok(['postgres:', 'postgresql:'].includes(url.protocol));
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname));
  assert.equal(url.port, '55432');
  assert.match(url.searchParams.get('schema') ?? '', /^integration_\d+_\d+$/);
  assert.ok(['localhost', '127.0.0.1', '::1'].includes(process.env.MINIO_ENDPOINT ?? ''));
  assert.equal(process.env.MINIO_USE_SSL, 'false');
  const actions = ACCESS_ACTION_CATALOG.filter((entry) => entry.module === 'approvals');
  assert.deepEqual(actions.map((entry) => entry.code).sort(), ['access', 'read', 'cancel', ...resolvers].map((suffix) => `approvals.${suffix}`).sort());
  for (const action of actions) {
    assert.deepEqual(action.allowedScopes, ['selected', 'all']);
    if (resolvers.some((suffix) => action.code === `approvals.${suffix}`)) {
      assert.equal(action.manageable, false);
      assert.equal(action.constraint, 'policy_decision_required');
    } else assert.equal(action.manageable, true);
  }
  const prisma = new PrismaClient();
  let closeApp: (() => Promise<void>) | undefined = undefined;
  t.after(async () => { try { await closeApp?.(); } finally { await prisma.$disconnect(); } });
  const { app, baseUrl } = await createTestApp();
  closeApp = () => app.close();
  const marker = `acl-approval-${randomUUID()}`;
  const seedFounder = await prisma.user.findUniqueOrThrow({ where: { login: 'founder' }, include: { permissions: true } });
  const template = await prisma.user.findUniqueOrThrow({ where: { login: 'manager1' } });
  const newUser = async (label: string, leader: boolean) => {
    const role = await prisma.role.findUniqueOrThrow({ where: { code: leader ? 'founder' : 'manager' } });
    return prisma.user.create({ data: {
      login: `${marker}-${label}`, fullName: `${marker} ${label}`, passwordHash: template.passwordHash, isActive: true,
      roles: { create: { roleId: role.id } },
      // Existing canonical founder permissions are fixture inheritance only.
      ...(leader ? { permissions: { create: seedFounder.permissions.map((permission) => ({ permissionId: permission.permissionId })) } } : {}),
    } });
  };
  const author = await newUser('author', true);
  const reviewer = await newUser('reviewer', true);
  const reader = await newUser('reader', false);
  const userIds = [author.id, reviewer.id, reader.id];
  const identities = () => prisma.user.findMany({ where: { id: { in: userIds } }, include: { roles: true, permissions: true }, orderBy: { id: 'asc' } });
  const originalIdentities = await identities();
  const authorCookie = await loginAndGetCookieHeader({ baseUrl, login: author.login, password: 'manager123' });
  const reviewerCookie = await loginAndGetCookieHeader({ baseUrl, login: reviewer.login, password: 'manager123' });
  const readerCookie = await loginAndGetCookieHeader({ baseUrl, login: reader.login, password: 'manager123' });
  // Keep the exact pre-grant cookies, including after allow/deny/default changes.
  const request = (path: string, method = 'GET', body?: unknown, cookie = readerCookie) => fetch(`${baseUrl}/api/v1${path}`, {
    method, headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(15_000),
  });
  const json = async <T,>(response: Response, status = 200): Promise<T> => {
    const text = await response.text();
    assert.equal(response.status, status, text);
    return JSON.parse(text) as T;
  };
  const rule = (actionCode: string, effect: 'allow' | 'deny', scope: 'selected' | 'all', selectedIds: string[] = [], userId = reader.id) => {
    assert.ok(userIds.includes(userId));
    assert.ok(ACCESS_ACTION_CATALOG.find((entry) => entry.code === actionCode)?.allowedScopes.includes(scope));
    return prisma.userAccessRule.upsert({ where: { userId_actionCode: { userId, actionCode } },
      create: { userId, actionCode, effect, scope, selectedIds }, update: { effect, scope, selectedIds } });
  };
  const revoke = (actionCode: string, userId = reader.id) => prisma.userAccessRule.deleteMany({ where: { userId, actionCode } });
  const reset = () => prisma.userAccessRule.deleteMany({ where: { userId: { in: userIds } } });
  const employee = await prisma.employee.create({ data: { fullName: `${marker}-employee`, employmentStatus: 'active', baseDailyRate: 5 } });
  const fixtures: Fixture[] = [];
  const objectIds: string[] = [];
  const itemIds: string[] = [];
  let sequence = 0;
  const makeObject = async () => {
    const object = await prisma.object.create({ data: {
      name: `${marker}-${++sequence}`, address: 'Synthetic approval source', status: 'active', createdByUserId: author.id,
      paymentType: 'daily', dailyRate: 5,
      assignments: { create: [{ userId: author.id, assignmentRoleCode: 'responsible', isActive: true }, { userId: reader.id, assignmentRoleCode: 'manager', isActive: true }] },
      employeeAssignments: { create: { employeeId: employee.id, isActive: true } },
    } });
    objectIds.push(object.id);
    return object;
  };
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const part = (name: string) => parts.find((entry) => entry.type === name)!.value;
  const yesterday = new Date(Date.parse(`${part('year')}-${part('month')}-${part('day')}T00:00:00Z`) - 86_400_000);
  const target = { year: yesterday.getUTCFullYear(), month: yesterday.getUTCMonth() + 1, dayOfMonth: yesterday.getUTCDate() };
  const makeFixture = async (action: Resolver, ownReader = false): Promise<Fixture> => {
    let sourceEntityType: string;
    let sourceEntityId: string;
    let sourceAction: string;
    let sourceId: string;
    if (action === 'resolve_task_result') {
      const object = await makeObject();
      const cookie = ownReader ? readerCookie : authorCookie;
      const userId = ownReader ? reader.id : author.id;
      const task = await json<{ id: string }>(await request('/tasks', 'POST', {
        title: `${marker}-task-${++sequence}`, priority: 'important_not_urgent', objectId: object.id,
        assigneeUserIds: [userId], requiresConfirmation: true, completionRequirement: 'comment_required', dueDate: '2040-01-15',
      }, authorCookie), 201);
      const submitted = await json<{ status: string }>(await request(`/tasks/${task.id}/assignees/me/complete`, 'POST', { completionText: marker }, cookie), 201);
      assert.equal(submitted.status, 'awaiting_confirmation');
      sourceEntityType = 'task'; sourceEntityId = task.id; sourceAction = 'tasks.read'; sourceId = task.id;
    } else if (action === 'resolve_object_change') {
      const object = await makeObject();
      await json(await request(`/objects/${object.id}/status`, 'PATCH', { status: 'frozen' }, authorCookie));
      sourceEntityType = 'object'; sourceEntityId = object.id; sourceAction = 'objects.read'; sourceId = object.id;
    } else if (action === 'resolve_inventory_exception') {
      const item = await json<{ id: string }>(await request('/inventory/items', 'POST', { name: `${marker}-item-${++sequence}`, category: 'Isolated approval', unit: 'шт' }, authorCookie), 201);
      itemIds.push(item.id);
      await json(await request('/inventory/movements', 'POST', { inventoryItemId: item.id, movementType: 'receipt', quantity: 3, unitPrice: 2, evidenceRequired: false }, authorCookie), 201);
      const movement = await json<{ id: string }>(await request('/inventory/movements', 'POST', { inventoryItemId: item.id, movementType: 'writeoff', quantity: 1, comment: marker }, authorCookie), 201);
      sourceEntityType = 'inventory_movement'; sourceEntityId = movement.id; sourceAction = 'inventory.movements.read'; sourceId = item.id;
    } else if (action === 'resolve_accountability') {
      // A zero-money, fully synthetic requested closure. We intentionally do
      // not issue funds or resolve expenses just to construct a source fixture.
      const owner = ownReader ? reader : author;
      const account = await prisma.accountabilityAccount.create({ data: { userId: owner.id, status: 'closing_requested' } });
      const closure = await prisma.accountabilityClosure.create({ data: { accountabilityAccountId: account.id, requestedByUserId: owner.id, status: 'requested' } });
      await prisma.approvalRequest.create({ data: {
        approvalType: 'accountability_closure_confirmation', sourceEntityType: 'accountability_closure', sourceEntityId: closure.id,
        createdByUserId: owner.id, payloadSnapshot: { summaryTitle: marker, accountabilityAccountId: account.id, requestedByUserId: owner.id },
      } });
      sourceEntityType = 'accountability_closure'; sourceEntityId = closure.id; sourceAction = 'accountability.read'; sourceId = owner.id;
    } else {
      const object = await makeObject();
      const approval = await json<ApprovalRequestResponseDto>(await request('/timesheets/exceptions', 'POST', {
        objectId: object.id, employeeId: employee.id, ...target, dayValue: 7, comment: marker,
      }, authorCookie), 201);
      assert.equal(approval.payloadSnapshot.independentLeadershipRequired, true);
      sourceEntityType = 'timesheet_exception'; sourceEntityId = approval.sourceEntityId; sourceAction = 'timesheet.read'; sourceId = object.id;
    }
    const approval = await prisma.approvalRequest.findFirstOrThrow({ where: { sourceEntityType, sourceEntityId, status: 'pending' } });
    const fixture = { id: approval.id, sourceEntityType, sourceEntityId, action, sourceAction, sourceId, createdByUserId: approval.createdByUserId };
    fixtures.push(fixture);
    return fixture;
  };
  const pairs = new Map<Resolver, [Fixture, Fixture]>();
  for (const action of resolvers) pairs.set(action, [await makeFixture(action, action === 'resolve_task_result'), await makeFixture(action, action === 'resolve_accountability')]);
  const snapshot = async () => {
    const approvalIds = fixtures.map((entry) => entry.id);
    const sourceIds = fixtures.map((entry) => entry.sourceEntityId);
    const [approvals, objects, objectAudits, tasks, items, movements, exceptions, months, accounts, closures, expenses, funding, audits, notifications, users] = await Promise.all([
      prisma.approvalRequest.findMany({ where: { id: { in: approvalIds } }, orderBy: { id: 'asc' } }),
      prisma.object.findMany({ where: { id: { in: objectIds } }, orderBy: { id: 'asc' } }),
      prisma.objectAuditLog.findMany({ where: { objectId: { in: objectIds } }, orderBy: { id: 'asc' } }),
      prisma.task.findMany({ where: { id: { in: sourceIds } }, include: { assignees: { orderBy: { id: 'asc' }, include: { completions: { orderBy: { id: 'asc' } } } }, historyEvents: { orderBy: { id: 'asc' } } }, orderBy: { id: 'asc' } }),
      prisma.inventoryItem.findMany({ where: { id: { in: itemIds } }, orderBy: { id: 'asc' } }),
      prisma.inventoryMovement.findMany({ where: { inventoryItemId: { in: itemIds } }, orderBy: { id: 'asc' } }),
      prisma.timesheetManualException.findMany({ where: { objectId: { in: objectIds } }, orderBy: { id: 'asc' } }),
      prisma.timesheetMonth.findMany({ where: { objectId: { in: objectIds } }, include: { rows: { orderBy: { id: 'asc' }, include: { entries: { orderBy: { id: 'asc' } } } } }, orderBy: { id: 'asc' } }),
      prisma.accountabilityAccount.findMany({ where: { userId: { in: userIds } }, orderBy: { id: 'asc' } }),
      prisma.accountabilityClosure.findMany({ where: { requestedByUserId: { in: userIds } }, orderBy: { id: 'asc' } }),
      prisma.accountabilityExpense.findMany({ where: { accountabilityAccount: { userId: { in: userIds } } }, orderBy: { id: 'asc' } }),
      prisma.accountabilityFunding.findMany({ where: { accountabilityAccount: { userId: { in: userIds } } }, orderBy: { id: 'asc' } }),
      prisma.auditEvent.findMany({ where: { OR: [{ actorUserId: { in: userIds } }, { entityId: { in: [...approvalIds, ...sourceIds, ...objectIds] } }] }, orderBy: { id: 'asc' } }),
      prisma.notification.findMany({ where: { OR: [{ recipientUserId: { in: userIds } }, { entityId: { in: [...approvalIds, ...sourceIds] } }] }, orderBy: { id: 'asc' } }),
      identities(),
    ]);
    return { approvals, objects, objectAudits, tasks, items, movements, exceptions, months, accounts, closures, expenses, funding, audits, notifications, users };
  };
  type Snapshot = Awaited<ReturnType<typeof snapshot>>;
  const rejected = async (path: string, method = 'GET', body?: unknown, status = 403, cookie = readerCookie) => {
    const before = await snapshot();
    const response = await request(path, method, body, cookie);
    const text = await response.text();
    assert.deepEqual(await snapshot(), before, `${method} ${path}: denied/invalid request has no source, audit, money or notification effects (${response.status}: ${text})`);
    assert.equal(response.status, status, `${method} ${path}: ${text}`);
  };
  const path = (fixture: Fixture, operation = '') => `/approvals/${fixture.id}${operation ? `/${operation}` : ''}`;
  const detail = (fixture: Fixture, cookie = readerCookie) => request(path(fixture), 'GET', undefined, cookie).then((response) => json<ApprovalRequestResponseDto>(response));
  const unchanged = (before: Snapshot, after: Snapshot, except: Array<keyof Snapshot>) => {
    for (const key of Object.keys(before) as Array<keyof Snapshot>) if (!except.includes(key)) assert.deepEqual(after[key], before[key], key);
  };
  const list = async (expected: Fixture[]) => {
    const before = await snapshot();
    const query = new URLSearchParams({ search: marker, page: '1', limit: '100' });
    const body = await json<{ total: number; items: ApprovalRequestResponseDto[] }>(await request(`/approvals?${query}`));
    assert.equal(body.total, expected.length);
    assert.deepEqual(new Set(body.items.map((entry) => entry.id)), new Set(expected.map((entry) => entry.id)));
    query.set('limit', '1');
    const first = await json<{ total: number; items: Array<{ id: string }> }>(await request(`/approvals?${query}`));
    assert.equal(first.total, expected.length);
    assert.equal(first.items.length, Math.min(1, expected.length));
    if (first.items.length) assert.ok(expected.some((entry) => entry.id === first.items[0]!.id));
    assert.deepEqual(await snapshot(), before);
  };

  await t.test('access/read preserve actual own requests and OQ-153 selected/all read never grants decisions or foreign cancellation', async () => {
    try {
      const own = fixtures.filter((entry) => entry.createdByUserId === reader.id);
      assert.ok(own.length > 0);
      const foreign = fixtures.filter((entry) => entry.createdByUserId !== reader.id);
      const a = foreign[0]!;
      const b = foreign[1]!;
      await list(own);
      await rejected(path(a), 'GET', undefined, 404);
      await rule('approvals.access', 'allow', 'all');
      await list(own);
      await rejected(path(a), 'GET', undefined, 404);
      await rule('approvals.read', 'allow', 'selected', [a.id]);
      await list([...own, a]);
      assert.deepEqual((await detail(a)).capabilities, { canApprove: false, canReject: false, canCancel: false });
      await rejected(path(b), 'GET', undefined, 404);
      for (const operation of ['approve', 'reject', 'cancel']) await rejected(path(a, operation), 'POST', { comment: marker });
      await revoke('approvals.read');
      await list(own);
      await rejected(path(a), 'GET', undefined, 404);
      await rule('approvals.read', 'allow', 'all');
      await list(fixtures);
      for (const entry of fixtures) {
        const view = await detail(entry);
        assert.equal(view.capabilities.canApprove, false);
        assert.equal(view.capabilities.canReject, false);
      }
      await rule('approvals.cancel', 'allow', 'all');
      await rejected(path(a, 'cancel'), 'POST', {});
      await revoke('approvals.cancel');
      await rule('approvals.access', 'deny', 'selected', [a.id]);
      await list(fixtures.filter((entry) => entry.id !== a.id));
      await rejected(path(a), 'GET', undefined, 404);
      await detail(b);
      await revoke('approvals.access');
      await rule('approvals.access', 'deny', 'all');
      await list([]);
      for (const entry of [a, b, ...own]) await rejected(path(entry), 'GET', undefined, 404);
      await revoke('approvals.access');
      await list(fixtures);
      await reset();
      await list(own);
    } finally { await reset(); }
  });

  for (const action of resolvers) {
    await t.test(`${action}: persisted source A/control B, deny/default, source/root boundaries and no resolver escalation`, async () => {
      try {
        const [a, b] = pairs.get(action)!;
        const code = `approvals.${action}`;
        await rule('approvals.read', 'allow', 'all');
        // Deliberately inject an allow for a nonmanageable resolver into this
        // synthetic DB: it must not replace the existing resolver invariant.
        await rule(code, 'allow', 'all');
        assert.equal((await detail(a)).capabilities.canApprove, false);
        await rejected(path(a, 'approve'), 'POST', { comment: marker });
        await rejected(path(a, 'reject'), 'POST', { comment: marker });
        await revoke(code);
        assert.equal((await detail(a, reviewerCookie)).capabilities.canApprove, true);
        await rule(code, 'deny', 'selected', [a.id], reviewer.id);
        assert.equal((await detail(a, reviewerCookie)).capabilities.canApprove, false);
        assert.equal((await detail(b, reviewerCookie)).capabilities.canApprove, true);
        for (const operation of ['approve', 'reject']) await rejected(path(a, operation), 'POST', { comment: marker }, 403, reviewerCookie);
        await revoke(code, reviewer.id);
        assert.equal((await detail(a, reviewerCookie)).capabilities.canApprove, true);
        await rule(code, 'deny', 'all', [], reviewer.id);
        for (const entry of [a, b]) await rejected(path(entry, 'approve'), 'POST', {}, 403, reviewerCookie);
        await revoke(code, reviewer.id);
        for (const parent of ['approvals.read', 'approvals.access', a.sourceAction]) {
          const selectedId = parent.startsWith('approvals.') ? a.id : a.sourceId;
          await rule(parent, 'deny', 'selected', [selectedId], reviewer.id);
          await rejected(path(a), 'GET', undefined, 404, reviewerCookie);
          const beforeList = await snapshot();
          const sourceQuery = new URLSearchParams({ sourceEntityType: a.sourceEntityType, sourceEntityId: a.sourceEntityId, page: '1', limit: '1' });
          const hidden = await json<{ total: number; items: unknown[] }>(await request(`/approvals?${sourceQuery}`, 'GET', undefined, reviewerCookie));
          assert.equal(hidden.total, 0, 'Explicit approval/source deny applies before count and pagination');
          assert.deepEqual(hidden.items, []);
          assert.deepEqual(await snapshot(), beforeList);
          for (const operation of ['approve', 'reject']) await rejected(path(a, operation), 'POST', { comment: marker }, 403, reviewerCookie);
          await detail(b, reviewerCookie);
          await revoke(parent, reviewer.id);
        }
        if (action === 'resolve_timesheet' || action === 'resolve_accountability') {
          // This author is already an eligible founder, so rejection tests the
          // actual independence invariant rather than a missing resolver role.
          assert.equal(a.createdByUserId, author.id);
          await rule('approvals.read', 'allow', 'all', [], author.id);
          await rule(code, 'allow', 'all', [], author.id);
          await rejected(path(a, 'approve'), 'POST', {}, 403, authorCookie);
          await revoke(code, author.id);
          await revoke('approvals.read', author.id);
        }
        // Real decision B proves the selected deny did not become a global
        // denial. Restore A's rule before approving its independent source.
        await rule(code, 'deny', 'selected', [a.id], reviewer.id);
        const beforeB = await snapshot();
        const decidedB = await json<ApprovalRequestResponseDto>(await request(path(b, 'reject'), 'POST', { comment: 'Bounded control rejection' }, reviewerCookie));
        assert.equal(decidedB.status, 'rejected');
        assert.equal(decidedB.resolvedBy?.id, reviewer.id);
        const afterB = await snapshot();
        assert.deepEqual(afterB.approvals.find((entry) => entry.id === a.id), beforeB.approvals.find((entry) => entry.id === a.id));
        await revoke(code, reviewer.id);
        const before = await snapshot();
        const decided = await json<ApprovalRequestResponseDto>(await request(path(a, 'approve'), 'POST', { comment: marker }, reviewerCookie));
        assert.equal(decided.status, 'approved');
        assert.equal(decided.resolvedBy?.id, reviewer.id);
        assert.ok(decided.resolvedAt);
        const after = await snapshot();
        const event = after.audits.filter((entry) => !before.audits.some((old) => old.id === entry.id) && entry.entityId === a.id && entry.action === 'approval.request.approved');
        assert.equal(event.length, 1);
        assert.equal(event[0]!.actorUserId, reviewer.id);
        assert.deepEqual(after.approvals.filter((entry) => entry.id !== a.id), before.approvals.filter((entry) => entry.id !== a.id));
        assert.deepEqual(after.funding, before.funding);
        assert.deepEqual(after.expenses, before.expenses);
        assert.deepEqual(after.users, before.users);
        if (action === 'resolve_task_result') {
          assert.equal(after.tasks.find((entry) => entry.id === a.sourceEntityId)!.status, 'completed');
          assert.notEqual(after.tasks.find((entry) => entry.id === b.sourceEntityId)!.status, 'completed');
        } else if (action === 'resolve_object_change') {
          assert.equal(after.objects.find((entry) => entry.id === a.sourceEntityId)!.status, 'frozen');
          assert.equal(after.objects.find((entry) => entry.id === b.sourceEntityId)!.status, 'active');
        } else if (action === 'resolve_inventory_exception') {
          const movement = after.movements.find((entry) => entry.id === a.sourceEntityId)!;
          assert.equal(movement.status, 'applied');
          assert.equal(Number(movement.quantity), 1);
          assert.equal(Number(movement.unitPriceSnapshot), 2);
          assert.notEqual(after.movements.find((entry) => entry.id === b.sourceEntityId)!.status, 'applied');
          const stock = await json<{ currentStock: number }>(await request(`/inventory/items/${a.sourceId}`, 'GET', undefined, reviewerCookie));
          assert.equal(stock.currentStock, 2);
        } else if (action === 'resolve_accountability') {
          const closure = after.closures.find((entry) => entry.id === a.sourceEntityId)!;
          assert.equal(closure.status, 'approved');
          assert.equal(closure.approvedByUserId, reviewer.id);
          assert.equal(after.accounts.find((entry) => entry.id === closure.accountabilityAccountId)!.status, 'active');
          assert.equal(after.closures.find((entry) => entry.id === b.sourceEntityId)!.status, 'rejected');
        } else {
          assert.equal(after.exceptions.find((entry) => entry.id === a.sourceEntityId)!.status, 'approved');
          const month = after.months.find((entry) => entry.objectId === a.sourceId)!;
          const row = month.rows.find((entry) => entry.employeeId === employee.id)!;
          const cell = row.entries.find((entry) => entry.dayOfMonth === target.dayOfMonth)!;
          assert.equal(cell.dayValue, 7);
          assert.equal(cell.isChangedManually, true);
          assert.equal(after.exceptions.find((entry) => entry.id === b.sourceEntityId)!.status, 'rejected');
        }
        await rejected(path(a, 'approve'), 'POST', {}, 409, reviewerCookie);
        await rejected(path(a, 'reject'), 'POST', { comment: marker }, 409, reviewerCookie);
        // No second application, ledger movement, audit or notification on retry.
        assert.deepEqual(await snapshot(), after);
      } finally { await reset(); }
    });
  }

  await t.test('cancel applies only to own pending source, selected/all denies and live revoke never grant foreign ownership', async () => {
    try {
      // Both requests are created through real task execution by their assignee.
      const ownA = await makeFixture('resolve_task_result', true);
      const ownB = await makeFixture('resolve_task_result', true);
      assert.equal(ownA.createdByUserId, reader.id);
      assert.equal(ownB.createdByUserId, reader.id);
      await rule('approvals.cancel', 'deny', 'selected', [ownA.id]);
      await rejected(path(ownA, 'cancel'), 'POST', {});
      assert.equal((await detail(ownB)).capabilities.canCancel, true);
      await revoke('approvals.cancel');
      assert.equal((await detail(ownA)).capabilities.canCancel, true);
      await rule('approvals.cancel', 'deny', 'all');
      for (const entry of [ownA, ownB]) await rejected(path(entry, 'cancel'), 'POST', {});
      await rule('approvals.cancel', 'allow', 'selected', [ownA.id]);
      for (const parent of ['approvals.access', 'approvals.read', ownA.sourceAction]) {
        await rule(parent, 'deny', 'selected', [parent.startsWith('approvals.') ? ownA.id : ownA.sourceId]);
        await rejected(path(ownA, 'cancel'), 'POST', {});
        assert.equal((await detail(ownB)).capabilities.canCancel, true);
        await revoke(parent);
      }
      await rule('approvals.cancel', 'allow', 'all');
      for (const entry of [ownA, ownB]) {
        const before = await snapshot();
        const cancelled = await json<ApprovalRequestResponseDto>(await request(path(entry, 'cancel'), 'POST', { comment: marker }));
        assert.equal(cancelled.status, 'cancelled');
        assert.equal(cancelled.cancelledBy?.id, reader.id);
        assert.ok(cancelled.cancelledAt);
        const after = await snapshot();
        const row = after.approvals.find((item) => item.id === entry.id)!;
        assert.equal(row.resolvedByUserId, null);
        assert.notEqual(after.tasks.find((item) => item.id === entry.sourceEntityId)!.status, 'completed');
        assert.deepEqual(after.approvals.filter((item) => item.id !== entry.id), before.approvals.filter((item) => item.id !== entry.id));
        unchanged(before, after, ['approvals', 'tasks', 'audits', 'notifications']);
        const events = after.audits.filter((item) => item.entityId === entry.id && item.action === 'approval.request.cancelled');
        assert.equal(events.length, 1);
        assert.equal(events[0]!.actorUserId, reader.id);
        await rejected(path(entry, 'cancel'), 'POST', {}, 409);
      }
    } finally { await reset(); }
  });

  assert.deepEqual(await identities(), originalIdentities, 'Reading or personal rules never rewrite roles/legacy permissions');
  // Isolated runner owns schema disposal. No seed/shared fixture deletion.
});
