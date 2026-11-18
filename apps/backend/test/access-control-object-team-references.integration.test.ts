import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { PrismaClient } from '@prisma/client';
import type { SystemUserOptionDto } from '../src/modules/users-access/dto/system-user-option.dto';
import { canBeObjectManager } from '../src/modules/objects/utils/object-access.util';
import { loginAndGetCookieHeader } from './helpers/auth';
import { createTestApp } from './helpers/create-test-app';
import { usesIsolatedIntegrationDatabase } from './helpers/isolated-database';

test('existing-object team references follow card, leaf and delegation access', async t => {
  assert.equal(usesIsolatedIntegrationDatabase(), true);
  const url = new URL(process.env.DATABASE_URL!);
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname));
  assert.equal(url.port, '55432');
  assert.match(url.searchParams.get('schema') ?? '', /^integration_\d+_\d+$/);
  const prisma = new PrismaClient();
  const { app, baseUrl } = await createTestApp();
  t.after(async () => { try { await app.close(); } finally { await prisma.$disconnect(); } });
  const template = await prisma.user.findUniqueOrThrow({ where: { login: 'manager1' } });
  const managerRole = await prisma.role.findUniqueOrThrow({ where: { code: 'manager' } });
  const founderRole = await prisma.role.findUniqueOrThrow({ where: { code: 'founder' } });
  const user = (roleId: string) => prisma.user.create({ data: { login: `team-ref-${randomUUID()}`, fullName: 'Team reference fixture', passwordHash: template.passwordHash, isActive: true, roles: { create: { roleId } } } });
  const actor = await user(managerRole.id), borrower = await user(managerRole.id), principal = await user(founderRole.id);
  const target = await prisma.user.findUniqueOrThrow({ where: { login: 'manager2' } });
  const deniedTarget = await user(managerRole.id);
  const object = (status = 'active') => prisma.object.create({ data: { name: `team-ref-${randomUUID()}`, address: 'Isolated fixture', status, createdByUserId: principal.id, assignments: { create: { userId: principal.id, assignmentRoleCode: 'responsible', isActive: true } } } });
  const a = await object(), b = await object(), archived = await object('archived'), delegated = await object();
  const responsibleOnly = await prisma.object.create({ data: { name: `team-ref-${randomUUID()}`, address: 'Isolated fixture', status: 'active', createdByUserId: principal.id, assignments: { create: { userId: actor.id, assignmentRoleCode: 'responsible', isActive: true } } } });
  const cookie = await loginAndGetCookieHeader({ baseUrl, login: actor.login, password: 'manager123' });
  const borrowerCookie = await loginAndGetCookieHeader({ baseUrl, login: borrower.login, password: 'manager123' });
  const request = (path: string, auth = cookie, body?: unknown) => fetch(`${baseUrl}/api/v1${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { Cookie: auth, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(15_000) });
  const refs = (id: string, purpose: 'object_manager' | 'object_responsible', auth = cookie) => request(`/users-access/users?purpose=${purpose}&objectId=${id}`, auth);
  const expect = async (response: Response, status: number) => assert.equal(response.status, status, await response.clone().text());
  const snapshot = async () => ({
    objects: await prisma.object.findMany({ orderBy: { id: 'asc' } }),
    assignments: await prisma.objectAssignment.findMany({ orderBy: { id: 'asc' } }),
    objectAudit: await prisma.objectAuditLog.findMany({ orderBy: { id: 'asc' } }),
    audit: await prisma.auditEvent.findMany({ orderBy: { id: 'asc' } }),
    notifications: await prisma.notification.findMany({ orderBy: { id: 'asc' } }),
    orders: await prisma.oneTimeOrder.findMany({ orderBy: { id: 'asc' } }),
    orderAssignments: await prisma.oneTimeOrderAssignment.findMany({ orderBy: { id: 'asc' } }),
    approvals: await prisma.approvalRequest.findMany({ orderBy: { id: 'asc' } }),
    attachments: await prisma.fileAttachment.findMany({ orderBy: { id: 'asc' } }),
    rooms: await prisma.chatRoom.findMany({ orderBy: { id: 'asc' } }),
    participants: await prisma.chatRoomParticipant.findMany({ orderBy: { id: 'asc' } }),
    messages: await prisma.chatMessage.findMany({ orderBy: { id: 'asc' } }),
  });
  const deniedMutation = async (path: string, body: unknown, status: number) => {
    const before = await snapshot();
    await expect(await request(path, cookie, body), status);
    assert.deepEqual(await snapshot(), before, 'Denied write preserves complete assignment rows, object/order state, both audits, notifications, approvals, attachments and chat state');
  };
  const activeUsers = () => prisma.user.findMany({ where: { isActive: true, deletedAt: null },
    include: { roles: { include: { role: true } } } });
  const normalizedOptions = (items: SystemUserOptionDto[]) => items.map(item => ({
    id: item.id, login: item.login, fullName: item.fullName, isActive: item.isActive, roleCodes: [...item.roleCodes].sort(),
  })).sort((left, right) => left.id.localeCompare(right.id));
  const assertOptions = async (response: Response, purpose: 'object_manager' | 'object_responsible', intendedId = target.id) => {
    await expect(response, 200);
    const items = await response.json() as SystemUserOptionDto[];
    // Independent canonical role list: a production helper regression must not
    // become the sole oracle for its own returned directory.
    const managerRoles = ['manager', 'senior_manager', 'operation_manager', 'director', 'deputy_director', 'corporate_director', 'founder', 'deputy_founder'];
    const eligible = (await activeUsers()).filter(item => purpose === 'object_responsible' || item.roles.some(({ role }) => managerRoles.includes(role.code)));
    const expected = eligible.map(item => ({ id: item.id, login: item.login, fullName: item.fullName, isActive: item.isActive,
      roleCode: item.roles[0]?.role.code ?? 'unknown', roleCodes: item.roles.map(({ role }) => role.code) }));
    assert.deepEqual(normalizedOptions(items), normalizedOptions(expected));
    assert.equal(items.filter(item => item.id === intendedId).length, 1, 'The intended eligible target is actually selectable');
    assert.ok(items.every(item => item.isActive && item.roleCode === (item.roleCodes[0] ?? 'unknown') && (purpose !== 'object_manager' || canBeObjectManager(item.roleCodes))));
  };
  const positiveAssignment = async (kind: 'manager' | 'responsible') => {
    const before = await snapshot();
    assert.equal(before.assignments.some(row => row.objectId === a.id && row.userId === target.id && row.assignmentRoleCode === kind), false);
    await expect(await request(`/objects/${a.id}/${kind === 'manager' ? 'managers' : 'responsibles'}`, cookie, { userId: target.id }), 201);
    const after = await snapshot();
    const added = after.assignments.filter(row => !before.assignments.some(old => old.id === row.id));
    assert.equal(added.length, 1);
    assert.equal(added[0].objectId, a.id); assert.equal(added[0].userId, target.id);
    assert.equal(added[0].assignmentRoleCode, kind); assert.equal(added[0].isActive, true);
    for (const old of before.assignments) {
      const now = after.assignments.find(row => row.id === old.id)!;
      if (kind === 'responsible' && old.objectId === a.id && old.assignmentRoleCode === 'responsible' && old.isActive) {
        assert.ok(now.updatedAt.getTime() >= old.updatedAt.getTime());
        assert.deepEqual({ ...now, updatedAt: old.updatedAt }, { ...old, isActive: false }, 'Only active status and its automatic timestamp change on the previous responsible');
      } else assert.deepEqual(now, old, 'All other assignments are immutable');
    }
    const action = kind === 'manager' ? 'object.manager_added' : 'object.responsible_added';
    const payload = { userId: target.id, login: target.login, fullName: target.fullName };
    const audits = after.audit.filter(row => !before.audit.some(old => old.id === row.id));
    assert.equal(audits.length, 1); assert.equal(audits[0].entityType, 'object'); assert.equal(audits[0].entityId, a.id);
    assert.equal(audits[0].actorUserId, actor.id); assert.equal(audits[0].action, action); assert.deepEqual(audits[0].metadata, payload);
    assert.deepEqual(after.audit.filter(row => before.audit.some(old => old.id === row.id)), before.audit);
    const logs = after.objectAudit.filter(row => !before.objectAudit.some(old => old.id === row.id));
    assert.equal(logs.length, 1); assert.equal(logs[0].objectId, a.id); assert.equal(logs[0].actorUserId, actor.id);
    assert.equal(logs[0].actionCode, action); assert.deepEqual(logs[0].payload, payload);
    assert.deepEqual(after.objectAudit.filter(row => before.objectAudit.some(old => old.id === row.id)), before.objectAudit);
    for (const key of ['objects', 'notifications', 'orders', 'orderAssignments', 'approvals', 'attachments', 'rooms', 'participants', 'messages'] as const) assert.deepEqual(after[key], before[key]);
  };
  const rule = (userId: string, actionCode: string, effect: 'allow' | 'deny', selectedIds: string[]) => prisma.userAccessRule.create({ data: { userId, actionCode, effect, scope: 'selected', selectedIds } });
  await expect(await refs(a.id, 'object_manager'), 403);
  await expect(await refs(responsibleOnly.id, 'object_manager'), 403);
  const manager = await rule(actor.id, 'objects.managers.manage', 'allow', [a.id, archived.id]);
  const responsible = await rule(actor.id, 'objects.responsibles.manage', 'allow', [a.id, archived.id]);
  // A leaf grant alone is not a positive card-read grant.
  await expect(await refs(a.id, 'object_manager'), 404);
  const read = await rule(actor.id, 'objects.read', 'allow', [a.id, archived.id]);
  for (const purpose of ['object_manager', 'object_responsible'] as const) {
    await assertOptions(await refs(a.id, purpose), purpose);
    await expect(await refs(b.id, purpose), 403);
    await assertOptions(await refs(archived.id, purpose), purpose);
  }
  await positiveAssignment('manager');
  await positiveAssignment('responsible');
  await prisma.userAccessRule.update({ where: { id: manager.id }, data: { effect: 'deny' } });
  await expect(await refs(a.id, 'object_manager'), 403);
  await assertOptions(await refs(a.id, 'object_responsible'), 'object_responsible');
  assert.equal(await prisma.objectAssignment.count({ where: { objectId: a.id, userId: deniedTarget.id } }), 0);
  await deniedMutation(`/objects/${a.id}/managers`, { userId: deniedTarget.id }, 403);
  await prisma.userAccessRule.update({ where: { id: responsible.id }, data: { effect: 'deny' } });
  await deniedMutation(`/objects/${a.id}/responsibles`, { userId: deniedTarget.id }, 403);
  await prisma.userAccessRule.update({ where: { id: responsible.id }, data: { effect: 'allow' } });
  // B was the inaccessible grant-spillover control above. Independently give
  // this SAME actor actual delegated read/assign authority for B, not a role
  // change or a second conflicting rule for the denied A leaf.
  // Do this after the negative POST snapshots: mutation attempts with any live
  // delegation intentionally write interceptor attempt audits, even on denial.
  await prisma.userSubstitution.create({ data: { principalUserId: principal.id, replacementUserId: actor.id, createdByUserId: principal.id,
    startsAt: new Date(Date.now() - 1000), endsAt: new Date(Date.now() + 3600000), reason: 'Independent B team-reference control', objects: { create: { objectId: b.id } } } });
  await assertOptions(await refs(b.id, 'object_manager'), 'object_manager');
  await assertOptions(await refs(b.id, 'object_responsible'), 'object_responsible');
  await expect(await refs(a.id, 'object_manager'), 403);
  await prisma.userAccessRule.update({ where: { id: manager.id }, data: { effect: 'allow' } });
  const rootDeny = await rule(actor.id, 'objects.access', 'deny', [a.id]);
  await expect(await refs(a.id, 'object_manager'), 403);
  await expect(await refs(a.id, 'object_responsible'), 403);
  await assertOptions(await refs(b.id, 'object_manager'), 'object_manager');
  await assertOptions(await refs(b.id, 'object_responsible'), 'object_responsible');
  await prisma.userAccessRule.delete({ where: { id: rootDeny.id } });
  await prisma.userAccessRule.update({ where: { id: read.id }, data: { effect: 'deny' } });
  await expect(await refs(a.id, 'object_manager'), 404);
  await expect(await refs(a.id, 'object_responsible'), 404);
  await assertOptions(await refs(b.id, 'object_manager'), 'object_manager');
  await assertOptions(await refs(b.id, 'object_responsible'), 'object_responsible');
  await prisma.userAccessRule.delete({ where: { id: read.id } });
  await prisma.userAccessRule.delete({ where: { id: responsible.id } });
  await prisma.userAccessRule.delete({ where: { id: manager.id } });
  await expect(await refs(a.id, 'object_manager'), 403);
  await prisma.userSubstitution.create({ data: { principalUserId: principal.id, replacementUserId: borrower.id, createdByUserId: principal.id, startsAt: new Date(Date.now() - 1000), endsAt: new Date(Date.now() + 3600000), reason: 'Team reference fixture', objects: { create: { objectId: delegated.id } } } });
  await expect(await refs(delegated.id, 'object_manager', borrowerCookie), 200);
  await expect(await refs(delegated.id, 'object_responsible', borrowerCookie), 200);
  const principalDeny = await rule(principal.id, 'objects.managers.manage', 'deny', [delegated.id]);
  await expect(await refs(delegated.id, 'object_manager', borrowerCookie), 403);
  await expect(await refs(delegated.id, 'object_responsible', borrowerCookie), 200);
  await prisma.userAccessRule.delete({ where: { id: principalDeny.id } });
  await prisma.object.update({ where: { id: delegated.id }, data: { deletedAt: new Date() } });
  await expect(await refs(delegated.id, 'object_manager', borrowerCookie), 403);

  const objectTaskRefs = (purpose: string) => request(`/users-access/users?purpose=${purpose}&objectId=${a.id}`);
  const objectRead = await rule(actor.id, 'objects.read', 'allow', [a.id]);
  const assigneeOptions = await objectTaskRefs('task_assignee'); await expect(assigneeOptions, 200);
  const active = await activeUsers();
  assert.deepEqual(normalizedOptions(await assigneeOptions.json() as SystemUserOptionDto[]), normalizedOptions(active.map(item => ({
    id: item.id, login: item.login, fullName: item.fullName, isActive: item.isActive,
    roleCode: item.roles[0]?.role.code ?? 'unknown', roleCodes: item.roles.map(({ role }) => role.code),
  }))));
  const visibilityOptions = await objectTaskRefs('task_visibility'); await expect(visibilityOptions, 200);
  const visible = await visibilityOptions.json() as SystemUserOptionDto[];
  const activeAssignments = await prisma.objectAssignment.findMany({ where: { objectId: a.id, isActive: true, user: { isActive: true, deletedAt: null } }, select: { userId: true } });
  const expectedVisibleIds = [...new Set(activeAssignments.map(row => row.userId))].sort();
  assert.deepEqual(expectedVisibleIds, [target.id], 'Manager + responsible are two assignments of the same target; the old responsible is inactive');
  assert.deepEqual(visible.map(item => item.id).sort(), expectedVisibleIds);
  assert.deepEqual(normalizedOptions(visible), normalizedOptions(active.filter(item => expectedVisibleIds.includes(item.id)).map(item => ({
    id: item.id, login: item.login, fullName: item.fullName, isActive: item.isActive,
    roleCode: item.roles[0]?.role.code ?? 'unknown', roleCodes: item.roles.map(({ role }) => role.code),
  }))));
  await prisma.userAccessRule.update({ where: { id: objectRead.id }, data: { effect: 'deny' } });
  await expect(await objectTaskRefs('task_assignee'), 403);
  await expect(await objectTaskRefs('task_visibility'), 403);
  await prisma.userAccessRule.delete({ where: { id: objectRead.id } });
  const taskRoot = await prisma.userAccessRule.create({ data: { userId: actor.id, actionCode: 'tasks.access', effect: 'deny', scope: 'all', selectedIds: [] } });
  await expect(await request('/users-access/users?purpose=task_assignee'), 403);
  await expect(await request('/users-access/users?purpose=task_visibility'), 403);
  await expect(await request('/users-access/users?purpose=one_time_order_task_assignee'), 403);
  await prisma.userAccessRule.delete({ where: { id: taskRoot.id } });
  const chatRoot = await prisma.userAccessRule.create({ data: { userId: actor.id, actionCode: 'chat.access', effect: 'deny', scope: 'all', selectedIds: [] } });
  await expect(await request('/users-access/users?purpose=chat_participant'), 403);
  await prisma.userAccessRule.delete({ where: { id: chatRoot.id } });
  const order = await prisma.oneTimeOrder.create({ data: { title: `team-ref-${randomUUID()}`, executionAddress: 'Isolated fixture', contactName: 'Fixture', status: 'new', createdByUserId: actor.id } });
  const orderRefs = (purpose: string) => request(`/users-access/users?purpose=${purpose}&oneTimeOrderId=${order.id}`);
  for (const purpose of ['task_assignee', 'task_visibility', 'one_time_order_task_assignee', 'one_time_order_manager', 'one_time_order_payment_recipient']) await expect(await orderRefs(purpose), 200);
  const orderDeny = await rule(actor.id, 'one_time_orders.read', 'deny', [order.id]);
  for (const purpose of ['task_assignee', 'task_visibility', 'one_time_order_task_assignee', 'one_time_order_manager', 'one_time_order_payment_recipient']) await expect(await orderRefs(purpose), 403);
  await prisma.userAccessRule.delete({ where: { id: orderDeny.id } });
});
