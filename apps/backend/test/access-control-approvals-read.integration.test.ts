import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { PrismaClient } from '@prisma/client';

import type { ApprovalRequestListResponseDto } from '../src/modules/approvals/dto/approval-request-list-response.dto';
import type { ApprovalRequestResponseDto } from '../src/modules/approvals/dto/approval-request-response.dto';

import { loginAndGetCookieHeader } from './helpers/auth';
import { createTestApp } from './helpers/create-test-app';
import { usesIsolatedIntegrationDatabase } from './helpers/isolated-database';

// OQ-153: approvals.read expands reading only. It never supplies decision or
// foreign cancellation authority and never overrides an explicit source deny.
// HTTP contract only: intentionally independent of B's unpublished helper API.
test('OQ-153 selected/all foreign approval reads preserve baseline and decision/source boundaries', async (t) => {
  assert.equal(usesIsolatedIntegrationDatabase(), true);
  assert.match(new URL(process.env.DATABASE_URL!).searchParams.get('schema') ?? '', /^integration_\d+_\d+$/);
  const prisma = new PrismaClient();
  t.after(() => prisma.$disconnect());
  const { app, baseUrl } = await createTestApp();
  t.after(() => app.close());
  const [template, role, founder] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { login: 'manager1' } }),
    prisma.role.findUniqueOrThrow({ where: { code: 'manager' } }),
    prisma.user.findUniqueOrThrow({ where: { login: 'founder' } }),
  ]);
  const marker = `acl-approval-read-${randomUUID()}`;
  const reader = await prisma.user.create({ data: {
    login: marker, fullName: marker, passwordHash: template.passwordHash, isActive: true,
    roles: { create: { roleId: role.id } },
  } });
  // Log in before every change and keep this exact cookie throughout the test.
  const oldCookie = await loginAndGetCookieHeader({ baseUrl, login: reader.login, password: 'manager123' });
  const sources = await Promise.all(['shared', 'control'].map((suffix) => prisma.object.create({ data: {
    name: `${marker}-${suffix}`, address: 'Bounded OQ-153 source', status: 'active', createdByUserId: founder.id,
    assignments: { create: { userId: reader.id, assignmentRoleCode: 'manager', isActive: true } },
  } })));
  const approvals = await Promise.all(['own', 'selected', 'unselected-newest', 'control'].map((suffix, index) => prisma.approvalRequest.create({ data: {
    approvalType: 'object_change_confirmation', sourceEntityType: 'object',
    sourceEntityId: sources[index === 3 ? 1 : 0].id,
    status: 'pending', createdByUserId: index === 0 ? reader.id : founder.id,
    createdAt: new Date(Date.UTC(2026, 10, 1, 0, index)),
    payloadSnapshot: { summaryTitle: `${marker}-${suffix}`, summarySubtitle: marker, comment: marker },
  } })));
  const request = (path: string, body?: unknown) => fetch(`${baseUrl}/api/v1${path}`, {
    method: body === undefined ? 'GET' : 'POST', headers: { Cookie: oldCookie, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const reset = () => prisma.userAccessRule.deleteMany({ where: { userId: reader.id } });
  const grant = (scope: 'selected' | 'all') => prisma.userAccessRule.create({ data: {
    userId: reader.id, actionCode: 'approvals.read', effect: 'allow', scope,
    selectedIds: scope === 'selected' ? [approvals[1].id, approvals[3].id] : [],
  } });
  const detail = async (index: number) => {
    const response = await request(`/approvals/${approvals[index].id}`);
    assert.equal(response.status, 200, await response.clone().text());
    return await response.json() as ApprovalRequestResponseDto;
  };
  const page = async (extra: Record<string, string> = {}) => {
    const query = new URLSearchParams({ sourceEntityType: 'object', sourceEntityId: sources[0].id, page: '1', limit: '1', ...extra });
    const response = await request(`/approvals?${query}`);
    assert.equal(response.status, 200, await response.clone().text());
    return await response.json() as ApprovalRequestListResponseDto;
  };
  const assertPage = (result: ApprovalRequestListResponseDto, total: number, ids: string[]) => {
    assert.equal(result.total, total, JSON.stringify(result));
    assert.equal(result.totalPages, total, 'Every page has limit=1');
    assert.deepEqual(result.items.map((row) => row.id), ids, JSON.stringify(result));
  };
  await t.test('zero overrides retain own pending read/cancel but no foreign read or decision authority', async () => {
    const own = await detail(0);
    assert.deepEqual(own.capabilities, { canApprove: false, canReject: false, canCancel: true });
    for (const index of [1, 2, 3]) assert.equal((await request(`/approvals/${approvals[index].id}`)).status, 404);
    assertPage(await page(), 1, [approvals[0].id]);
  });

  for (const scope of ['selected', 'all'] as const) {
    await t.test(`${scope} read adds foreign IDs, retains own and filters before SQL count/pagination and search`, async () => {
      await reset();
      await grant(scope);
      await detail(0);
      for (const index of [1, 3]) {
        const row = await detail(index);
        assert.deepEqual(row.capabilities, { canApprove: false, canReject: false, canCancel: false });
      }
      const foreign = await request(`/approvals/${approvals[2].id}`);
      assert.equal(foreign.status, scope === 'all' ? 200 : 404);
      const expected = scope === 'all' ? [approvals[2].id, approvals[1].id, approvals[0].id] : [approvals[1].id, approvals[0].id];
      for (let index = 0; index < expected.length; index += 1) {
        assertPage(await page({ page: String(index + 1) }), expected.length, [expected[index]]);
      }
      assertPage(await page({ page: String(expected.length + 1) }), expected.length, []);
      // Same source filter + search must not reveal the unselected newest row
      // or count hidden matches before permissions have been applied.
      assertPage(await page({ search: marker }), expected.length, [expected[0]]);
      const unpaged = await request(`/approvals?${new URLSearchParams({ sourceEntityType: 'object', sourceEntityId: sources[0].id })}`);
      assert.equal(unpaged.status, 200);
      assert.deepEqual(((await unpaged.json()) as ApprovalRequestResponseDto[]).map((row) => row.id), expected);
    });
    await t.test(`${scope} read cannot approve/reject/cancel another author's request or mutate it`, async () => {
      await reset();
      await grant(scope);
      const before = await prisma.approvalRequest.findUniqueOrThrow({ where: { id: approvals[1].id } });
      assert.deepEqual((await detail(1)).capabilities, { canApprove: false, canReject: false, canCancel: false });
      for (const action of ['approve', 'reject', 'cancel']) {
        const response = await request(`/approvals/${approvals[1].id}/${action}`, { comment: 'Read-only grant must not authorize this decision' });
        assert.equal(response.status, 403, `${action}: ${await response.clone().text()}`);
        assert.deepEqual(await prisma.approvalRequest.findUniqueOrThrow({ where: { id: approvals[1].id } }), before);
      }
      assert.equal(await prisma.auditEvent.count({ where: {
        entityType: 'approval_request', entityId: approvals[1].id,
        action: { in: ['approval.request.approved', 'approval.request.rejected', 'approval.request.cancelled'] },
      } }), 0);
    });
  }

  for (const actionCode of ['objects.read', 'objects.access']) {
    await t.test(`${actionCode} selected source deny wins over all approval read, including own request`, async () => {
      await reset();
      await grant('all');
      assertPage(await page(), 3, [approvals[2].id]);
      const deny = await prisma.userAccessRule.create({ data: {
        userId: reader.id, actionCode, effect: 'deny', scope: 'selected', selectedIds: [sources[0].id],
      } });
      for (const index of [0, 1, 2]) assert.equal((await request(`/approvals/${approvals[index].id}`)).status, 404);
      assertPage(await page(), 0, []);
      assertPage(await page({ search: marker }), 0, []);
      await detail(3);
      await prisma.userAccessRule.delete({ where: { id: deny.id } });
      assertPage(await page(), 3, [approvals[2].id]);
    });
  }
  await t.test('explicit approval selected deny narrows real inherited authority without hiding own/control approvals', async () => {
    await reset();
    // UserAccessRule is unique by user/action: allow+deny for the same action
    // cannot coexist. Exercise subtraction from genuine legacy inheritance.
    const permission = await prisma.permission.findUniqueOrThrow({ where: { code: 'approval.resolve_object_change' } });
    const inherited = await prisma.userPermission.create({ data: { userId: reader.id, permissionId: permission.id } });
    try {
      await detail(2);
      assertPage(await page(), 3, [approvals[2].id]);
      const deny = await prisma.userAccessRule.create({ data: {
        userId: reader.id, actionCode: 'approvals.read', effect: 'deny', scope: 'selected', selectedIds: [approvals[2].id],
      } });
      try {
        assert.equal((await request(`/approvals/${approvals[2].id}`)).status, 404);
        assertPage(await page(), 2, [approvals[1].id]);
        await detail(0);
        await detail(3);
      } finally {
        await prisma.userAccessRule.delete({ where: { id: deny.id } });
      }
      await detail(2);
    } finally {
      await prisma.userPermission.delete({ where: { id: inherited.id } });
    }
    assert.equal((await request(`/approvals/${approvals[2].id}`)).status, 404,
      'Temporary resolver permission must not leak into later read-only cases');
  });
  await t.test('the pre-grant cookie sees live grant/revoke/reset and never acquires resolver authority', async () => {
    await reset();
    assert.equal((await request(`/approvals/${approvals[1].id}`)).status, 404);
    const allow = await grant('selected');
    assert.equal((await detail(1)).capabilities.canApprove, false);
    await prisma.userAccessRule.delete({ where: { id: allow.id } });
    assert.equal((await request(`/approvals/${approvals[1].id}`)).status, 404);
    await detail(0);
    await grant('all');
    await detail(2);
    await reset();
    assertPage(await page(), 1, [approvals[0].id]);
  });
  await t.test('persisted approval notifications track selected/all read, live revoke and source deny before count/page', async () => {
    await reset();
    const saved = await Promise.all(approvals.map((approval, index) => prisma.notification.create({ data: {
      recipientUserId: reader.id, type: 'approval.request.created', title: `${marker}-notification-${index}`,
      entityType: 'approval_request', entityId: approval.id, targetUrl: `/approvals/${approval.id}`,
      createdAt: new Date(Date.UTC(2026, 10, 1, 0, index)),
    } })));
    const visible = async (indices: number[]) => {
      const response = await request('/notifications?page=1&limit=1');
      assert.equal(response.status, 200, await response.clone().text());
      const result = await response.json() as { total: number; items: Array<{ id: string }> };
      assert.equal(result.total, indices.length, JSON.stringify(result));
      assert.deepEqual(result.items.map((row) => row.id), indices.length ? [saved[indices[0]].id] : [], JSON.stringify(result));
      const count = await request('/notifications/unread-count');
      assert.equal(count.status, 200, await count.clone().text());
      assert.deepEqual(await count.json(), { count: indices.length });
      for (let index = 0; index < indices.length; index += 1) {
        const page = await request(`/notifications?page=${index + 1}&limit=1`);
        assert.equal(page.status, 200);
        const body = await page.json() as { total: number; items: Array<{ id: string }> };
        assert.equal(body.total, indices.length);
        assert.deepEqual(body.items.map((row) => row.id), [saved[indices[index]].id]);
      }
    };
    await visible([0]);
    const selected = await grant('selected');
    await visible([3, 1, 0]);
    await prisma.userAccessRule.delete({ where: { id: selected.id } });
    await visible([0]);
    const hiddenRead = await request(`/notifications/${saved[1].id}/read`, {});
    assert.equal(hiddenRead.status, 404, await hiddenRead.clone().text());
    assert.equal((await prisma.notification.findUniqueOrThrow({ where: { id: saved[1].id } })).readAt, null);
    await grant('all');
    await visible([3, 2, 1, 0]);
    const sourceDeny = await prisma.userAccessRule.create({ data: {
      userId: reader.id, actionCode: 'objects.read', effect: 'deny', scope: 'selected', selectedIds: [sources[0].id],
    } });
    await visible([3]);
    assert.equal((await request(`/notifications/${saved[0].id}/read`, {})).status, 404,
      'Even an own approval notification retains its explicit source denial');
    await prisma.userAccessRule.delete({ where: { id: sourceDeny.id } });
    await visible([3, 2, 1, 0]);
    await reset();
    await visible([0]);
    assert.equal(await prisma.notification.count({ where: { id: { in: saved.map((row) => row.id) }, readAt: null, dismissedAt: null } }), 4,
      'Revocation hides retained notifications; it must not acknowledge, delete or recreate them');
  });
  const notificationSnapshot = async () => {
    const response = await request('/notifications?page=1&limit=100');
    assert.equal(response.status, 200, await response.clone().text());
    return await response.json() as { total: number; items: Array<{ id: string }> };
  };
  const savedNotification = (approvalId: string) => prisma.notification.create({ data: {
    recipientUserId: reader.id, type: 'approval.request.created', title: `${marker}-source-regression`,
    entityType: 'approval_request', entityId: approvalId,
  } });
  await t.test('soft-deleted object retains ancestor identity so root deny hides its linked task approval and notification', async () => {
    await reset();
    await grant('all');
    const object = await prisma.object.create({ data: {
      name: `${marker}-archived-ancestor`, address: 'Archived ancestor regression', status: 'active', createdByUserId: founder.id,
    } });
    const task = await prisma.task.create({ data: {
      title: `${marker}-archived-task`, priority: 'normal', status: 'new', scopeType: 'object',
      objectId: object.id, createdByUserId: reader.id,
    } });
    const approval = await prisma.approvalRequest.create({ data: {
      approvalType: 'task_result_confirmation', sourceEntityType: 'task', sourceEntityId: task.id,
      createdByUserId: founder.id, payloadSnapshot: { summaryTitle: `${marker}-task-result` },
    } });
    const notification = await savedNotification(approval.id);
    assert.equal((await request(`/approvals/${approval.id}`)).status, 200);
    assert.ok((await notificationSnapshot()).items.some((row) => row.id === notification.id));
    await prisma.object.update({ where: { id: object.id }, data: { deletedAt: new Date() } });
    const deny = await prisma.userAccessRule.create({ data: {
      userId: reader.id, actionCode: 'objects.read', effect: 'deny', scope: 'selected', selectedIds: [object.id],
    } });
    assert.equal((await request(`/approvals/${approval.id}`)).status, 404,
      'Soft deletion cannot discard the real object identity and its explicit deny');
    const list = await request(`/approvals?${new URLSearchParams({ sourceEntityType: 'task', sourceEntityId: task.id, page: '1', limit: '1' })}`);
    assert.equal(list.status, 200);
    const body = await list.json() as ApprovalRequestListResponseDto;
    assert.equal(body.total, 0, JSON.stringify(body));
    assert.deepEqual(body.items, []);
    assert.equal((await notificationSnapshot()).items.some((row) => row.id === notification.id), false);
    await prisma.object.update({ where: { id: object.id }, data: { deletedAt: null } });
    await prisma.userAccessRule.delete({ where: { id: deny.id } });
    assert.equal((await request(`/approvals/${approval.id}`)).status, 200);
    assert.ok((await notificationSnapshot()).items.some((row) => row.id === notification.id));
  });
  await t.test('compensation payload employee/rate denials hide approval detail/list and saved notification, not unrelated approvals', async () => {
    await reset();
    await grant('all');
    const object = await prisma.object.create({ data: {
      name: `${marker}-compensation-source`, address: 'Bounded sensitive payload', status: 'active', createdByUserId: founder.id,
    } });
    const employees = await Promise.all(['primary', 'replacement'].map((suffix) => prisma.employee.create({ data: {
      fullName: `${marker}-${suffix}`, employmentStatus: 'active',
    } })));
    // Persist real source facts; no business adjustment is applied by this
    // read-only regression and no financial formula is asserted or changed.
    const adjustment = await prisma.objectCompensationAdjustment.create({ data: {
      objectId: object.id, requestKey: randomUUID(), kind: 'replacement', operationDate: new Date('2026-11-01T00:00:00Z'),
      employeeId: employees[0].id, reason: marker, createdByUserId: founder.id,
      payload: { employeeId: employees[0].id, replacementEmployeeId: employees[1].id },
      beforeSnapshot: [{ employeeId: employees[0].id, amount: 700 }],
    } });
    const approval = await prisma.approvalRequest.create({ data: {
      approvalType: 'object_compensation_confirmation', sourceEntityType: 'object_compensation_adjustment', sourceEntityId: adjustment.id,
      createdByUserId: founder.id, payloadSnapshot: {
        summaryTitle: `${marker}-sensitive-compensation`, employeeName: employees[0].fullName,
        replacementEmployeeName: employees[1].fullName, beforeAmount: 700, afterAmount: 800,
        independentLeadershipRequired: true,
      },
    } });
    const notification = await savedNotification(approval.id);
    const filters = new URLSearchParams({ sourceEntityType: 'object_compensation_adjustment', sourceEntityId: adjustment.id, page: '1', limit: '1' });
    const beforeAdjustment = await prisma.objectCompensationAdjustment.findUniqueOrThrow({ where: { id: adjustment.id } });
    const cases = [
      { actionCode: 'employees.view', selectedIds: [employees[0].id] },
      { actionCode: 'employees.view', selectedIds: [employees[1].id] },
      { actionCode: 'objects.rates.read', selectedIds: [object.id] },
    ];
    for (const rule of cases) {
      assert.equal((await request(`/approvals/${approval.id}`)).status, 200);
      const before = await notificationSnapshot();
      assert.ok(before.items.some((row) => row.id === notification.id));
      const deny = await prisma.userAccessRule.create({ data: { userId: reader.id, effect: 'deny', scope: 'selected', ...rule } });
      assert.equal((await request(`/approvals/${approval.id}`)).status, 404, JSON.stringify(rule));
      const response = await request(`/approvals?${filters}`);
      assert.equal(response.status, 200);
      const list = await response.json() as ApprovalRequestListResponseDto;
      assert.equal(list.total, 0, JSON.stringify(list));
      assert.deepEqual(list.items, []);
      const after = await notificationSnapshot();
      assert.equal(after.items.some((row) => row.id === notification.id), false, JSON.stringify(rule));
      assert.equal(after.total, before.total - 1, 'Only the sensitive approval notification is removed');
      const count = await request('/notifications/unread-count');
      assert.equal(count.status, 200);
      assert.deepEqual(await count.json(), { count: after.total });
      await detail(3);
      await prisma.userAccessRule.delete({ where: { id: deny.id } });
    }
    assert.deepEqual(await prisma.objectCompensationAdjustment.findUniqueOrThrow({ where: { id: adjustment.id } }), beforeAdjustment);
  });
  await t.test('materials read deny leaves readable root object-change approval and notification intact', async () => {
    await reset();
    await grant('all');
    const notification = await savedNotification(approvals[1].id);
    const before = await notificationSnapshot();
    assert.ok(before.items.some((row) => row.id === notification.id));
    await prisma.userAccessRule.create({ data: {
      userId: reader.id, actionCode: 'objects.materials.read', effect: 'deny', scope: 'selected', selectedIds: [sources[0].id],
    } });
    const card = await request(`/objects/${sources[0].id}`);
    assert.equal(card.status, 200, await card.clone().text());
    await detail(1);
    const after = await notificationSnapshot();
    assert.equal(after.total, before.total, 'Materials leaf denial must not be converted to a broad approval-source exclusion');
    assert.ok(after.items.some((row) => row.id === notification.id), JSON.stringify(after));
    const count = await request('/notifications/unread-count');
    assert.equal(count.status, 200);
    assert.deepEqual(await count.json(), { count: before.total });
  });
});
