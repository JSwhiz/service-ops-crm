import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { PrismaClient } from '@prisma/client';
import type { SystemUserOptionDto } from '../src/modules/users-access/dto/system-user-option.dto';
import { canBeOneTimeOrderManager } from '../src/modules/one-time-orders/utils/one-time-order-access.util';
import { loginAndGetCookieHeader } from './helpers/auth';
import { createTestApp } from './helpers/create-test-app';
import { usesIsolatedIntegrationDatabase } from './helpers/isolated-database';

test('order team references follow selected, creator, assigned, deny and revoke policy', async t => {
  assert.equal(usesIsolatedIntegrationDatabase(), true);
  const url = new URL(process.env.DATABASE_URL!);
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname));
  assert.equal(url.port, '55432');
  assert.match(url.searchParams.get('schema') ?? '', /^integration_\d+_\d+$/);
  const prisma = new PrismaClient();
  const { app, baseUrl } = await createTestApp();
  t.after(async () => { try { await app.close(); } finally { await prisma.$disconnect(); } });
  const template = await prisma.user.findUniqueOrThrow({ where: { login: 'manager1' } });
  const manager = await prisma.role.findUniqueOrThrow({ where: { code: 'manager' } });
  const founder = await prisma.role.findUniqueOrThrow({ where: { code: 'founder' } });
  const user = (roleId: string) => prisma.user.create({ data: { login: `order-ref-${randomUUID()}`, fullName: 'Order reference fixture', passwordHash: template.passwordHash, isActive: true, roles: { create: { roleId } } } });
  const actor = await user(manager.id), owner = await user(founder.id), target = await user(manager.id);
  const deniedTarget = await user(manager.id);
  const order = (createdByUserId: string) => prisma.oneTimeOrder.create({ data: { title: `order-ref-${randomUUID()}`, executionAddress: 'Isolated fixture', contactName: 'Fixture', status: 'new', createdByUserId } });
  const a = await order(owner.id), b = await order(owner.id), own = await order(actor.id), assigned = await order(owner.id), inactive = await order(owner.id);
  const authorizedB = await order(actor.id); // Independent creator baseline; b remains the hidden grant-spillover control.
  await prisma.oneTimeOrderAssignment.createMany({ data: [
    { oneTimeOrderId: assigned.id, userId: actor.id, assignmentRoleCode: 'one_time_manager', isActive: true },
    { oneTimeOrderId: inactive.id, userId: actor.id, assignmentRoleCode: 'one_time_manager', isActive: false },
  ] });
  const cookie = await loginAndGetCookieHeader({ baseUrl, login: actor.login, password: 'manager123' });
  const founderCookie = await loginAndGetCookieHeader({ baseUrl, login: owner.login, password: 'manager123' });
  const request = (path: string, auth = cookie, body?: unknown) => fetch(`${baseUrl}/api/v1${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { Cookie: auth, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(15_000) });
  const refs = (id?: string, auth = cookie) => request(`/users-access/users?purpose=one_time_order_manager${id ? `&oneTimeOrderId=${id}` : ''}`, auth);
  const expect = async (response: Response, status: number) => assert.equal(response.status, status, await response.clone().text());
  const snapshot = async () => ({
    orders: await prisma.oneTimeOrder.findMany({ orderBy: { id: 'asc' } }),
    assignments: await prisma.oneTimeOrderAssignment.findMany({ orderBy: { id: 'asc' } }),
    audit: await prisma.auditEvent.findMany({ orderBy: { id: 'asc' } }),
    notifications: await prisma.notification.findMany({ orderBy: { id: 'asc' } }),
    objects: await prisma.object.findMany({ orderBy: { id: 'asc' } }),
    objectAssignments: await prisma.objectAssignment.findMany({ orderBy: { id: 'asc' } }),
    objectAudit: await prisma.objectAuditLog.findMany({ orderBy: { id: 'asc' } }),
    approvals: await prisma.approvalRequest.findMany({ orderBy: { id: 'asc' } }),
    attachments: await prisma.fileAttachment.findMany({ orderBy: { id: 'asc' } }),
    rooms: await prisma.chatRoom.findMany({ orderBy: { id: 'asc' } }),
    participants: await prisma.chatRoomParticipant.findMany({ orderBy: { id: 'asc' } }),
    messages: await prisma.chatMessage.findMany({ orderBy: { id: 'asc' } }),
    payments: await prisma.oneTimeOrderCompletionPayment.findMany({ orderBy: { id: 'asc' } }),
    completions: await prisma.oneTimeOrderCompletion.findMany({ orderBy: { id: 'asc' } }),
  });
  const deniedMutation = async (id: string, status: number) => {
    assert.equal(await prisma.oneTimeOrderAssignment.count({ where: { oneTimeOrderId: id, userId: deniedTarget.id } }), 0);
    const before = await snapshot();
    await expect(await request(`/one-time-orders/${id}/managers`, cookie, { userId: deniedTarget.id }), status);
    assert.deepEqual(await snapshot(), before, 'Denied write preserves complete assignments, both domains, audits, notifications, approvals, attachments, chat, completions and payments');
  };
  const assertTargetOptions = async (id: string | undefined, auth = cookie) => {
    const before = await snapshot();
    const path = `/users-access/users?purpose=one_time_order_manager${id ? `&oneTimeOrderId=${id}` : ''}&limit=1`;
    const expected: SystemUserOptionDto[] = [{ id: target.id, login: target.login, fullName: target.fullName, isActive: true, roleCode: 'manager', roleCodes: ['manager'] }];
    const noMatch = `no-synthetic-user-matches-${actor.id}`;
    // Query and selectedId must each work independently; the selected option
    // must also survive a different, nonmatching search term.
    for (const query of [
      `&q=${encodeURIComponent(target.login)}`,
      `&selectedId=${target.id}`,
      `&q=${noMatch}&selectedId=${target.id}`,
    ]) {
      const response = await request(`${path}${query}`, auth);
      await expect(response, 200);
      assert.deepEqual(await response.json() as SystemUserOptionDto[], expected);
    }
    const empty = await request(`${path}&q=${noMatch}`, auth);
    await expect(empty, 200); assert.deepEqual(await empty.json(), []);
    assert.deepEqual(await snapshot(), before, 'Reference GET does not create membership, audit, notifications or business side effects');
  };
  const rule = (actionCode: string, effect: 'allow' | 'deny', scope: 'selected' | 'assigned' | 'all', selectedIds: string[] = []) => prisma.userAccessRule.create({ data: { userId: actor.id, actionCode, effect, scope, selectedIds } });
  await expect(await refs(), 403);
  await expect(await refs(undefined, founderCookie), 200);
  await assertTargetOptions(undefined, founderCookie);
  await expect(await refs(a.id), 403);
  await expect(await refs(own.id), 200);
  await assertTargetOptions(own.id);
  const leaf = await rule('one_time_orders.managers.manage', 'allow', 'selected', [a.id]);
  await expect(await refs(a.id), 404);
  const read = await rule('one_time_orders.read', 'allow', 'selected', [a.id]);
  const response = await refs(a.id); await expect(response, 200);
  const options = await response.json() as SystemUserOptionDto[];
  assert.ok(options.length > 0);
  assert.ok(options.every(option => option.isActive && canBeOneTimeOrderManager(option.roleCodes)));
  await assertTargetOptions(a.id);
  // selectedId cannot smuggle an ineligible founder into a manager option set.
  const ineligible = await request(`/users-access/users?purpose=one_time_order_manager&oneTimeOrderId=${a.id}&q=${encodeURIComponent(owner.login)}&selectedId=${owner.id}&limit=1`);
  await expect(ineligible, 200); assert.deepEqual(await ineligible.json(), []);
  await expect(await refs(b.id), 403);
  await assertTargetOptions(authorizedB.id);
  await expect(await request(`/one-time-orders/${a.id}/managers`, cookie, { userId: target.id }), 201);
  assert.equal(await prisma.oneTimeOrderAssignment.count({ where: { oneTimeOrderId: a.id, userId: target.id, assignmentRoleCode: 'one_time_manager', isActive: true } }), 1);
  await prisma.userAccessRule.update({ where: { id: leaf.id }, data: { effect: 'deny', scope: 'selected', selectedIds: [a.id, own.id] } });
  await expect(await refs(a.id), 403);
  await expect(await refs(own.id), 403);
  await deniedMutation(a.id, 403);
  await assertTargetOptions(authorizedB.id);
  await prisma.userAccessRule.update({ where: { id: leaf.id }, data: { effect: 'allow', scope: 'assigned', selectedIds: [] } });
  await expect(await refs(assigned.id), 200);
  await assertTargetOptions(assigned.id);
  await expect(await refs(inactive.id), 403);
  await prisma.userAccessRule.update({ where: { id: read.id }, data: { effect: 'deny', scope: 'selected', selectedIds: [assigned.id] } });
  await expect(await refs(assigned.id), 403);
  await deniedMutation(assigned.id, 403);
  await assertTargetOptions(authorizedB.id);
  await prisma.userAccessRule.delete({ where: { id: read.id } });
  await prisma.userAccessRule.delete({ where: { id: leaf.id } });
  await expect(await refs(a.id), 403);
  await expect(await refs(assigned.id), 403);
  await expect(await refs(own.id), 200);
  await assertTargetOptions(authorizedB.id);
  const root = await rule('one_time_orders.access', 'deny', 'all');
  await expect(await refs(own.id), 403);
  await expect(await refs(), 403);
  await deniedMutation(authorizedB.id, 403);
  await prisma.userAccessRule.delete({ where: { id: root.id } });
  await expect(await refs(undefined, founderCookie), 200);
  await assertTargetOptions(authorizedB.id);
});
