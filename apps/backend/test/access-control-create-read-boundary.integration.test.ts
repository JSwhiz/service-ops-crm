import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { PrismaClient } from '@prisma/client';

import type { MeResponseDto } from '../src/modules/auth/dto/me-response.dto';
import { ACCESS_ACTION_CATALOG } from '../src/modules/users-access/access-action-catalog';
import { loginAndGetCookieHeader } from './helpers/auth';
import { createTestApp } from './helpers/create-test-app';
import { usesIsolatedIntegrationDatabase } from './helpers/isolated-database';

type Domain = 'employee' | 'candidate' | 'order';
type Card = { id: string; fullName?: string; title?: string };

test('create/read boundaries reject unreadable generated cards atomically and reauthorize order creation replay', async (t) => {
  assert.equal(usesIsolatedIntegrationDatabase(), true);
  const database = new URL(process.env.DATABASE_URL!);
  assert.ok(['postgres:', 'postgresql:'].includes(database.protocol));
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(database.hostname));
  assert.equal(database.port, '55432');
  assert.match(database.searchParams.get('schema') ?? '', /^integration_\d+_\d+$/);
  assert.ok(['localhost', '127.0.0.1', '::1'].includes(process.env.MINIO_ENDPOINT ?? ''));
  assert.equal(process.env.MINIO_USE_SSL, 'false');
  const prisma = new PrismaClient();
  let closeApp: (() => Promise<void>) | undefined = undefined;
  let restoreViewSource = async (): Promise<void> => {};
  const ruleIds = new Set<string>();
  const reset = async () => {
    await prisma.userAccessRule.deleteMany({ where: { id: { in: [...ruleIds] } } });
    ruleIds.clear();
  };
  t.after(async () => {
    try { await restoreViewSource(); await reset(); } finally {
      try { await closeApp?.(); } finally { await prisma.$disconnect(); }
    }
  });
  const { app, baseUrl } = await createTestApp();
  closeApp = () => app.close();
  const actorQuery = { where: { login: 'manager1' }, include: {
    roles: { orderBy: { id: 'asc' }, include: { role: { include: { permissions: { orderBy: { id: 'asc' }, include: { permission: true } } } } } },
    permissions: { orderBy: { id: 'asc' }, include: { permission: true } },
  } } as const;
  const actor = await prisma.user.findUniqueOrThrow(actorQuery);
  const founder = await prisma.user.findUniqueOrThrow({ where: { login: 'founder' } });
  assert.deepEqual(actor.roles.map(({ role }) => role.code), ['manager']);
  assert.equal(await prisma.userAccessRule.count({ where: { userId: actor.id } }), 0);
  const cookie = await loginAndGetCookieHeader({ baseUrl, login: actor.login, password: 'manager123' });
  const marker = `acl-create-read-${randomUUID()}`;
  let sequence = 0;
  const definitions = {
    employee: { path: '/employees', create: 'employees.create', read: 'employees.view', entity: 'employee', action: 'employee.created' },
    candidate: { path: '/candidates', create: 'candidates.create', read: 'candidates.view', entity: 'candidate', action: 'candidate.created' },
    order: { path: '/one-time-orders', create: 'one_time_orders.create', read: 'one_time_orders.read', entity: 'one_time_order', action: 'one_time_order.created' },
  } as const;
  const input = (domain: Domain): Record<string, unknown> => domain === 'employee'
    ? { fullName: `${marker}-employee-${++sequence}`, employmentStatus: 'active', notes: 'Synthetic boundary fixture' }
    : domain === 'candidate' ? { fullName: `${marker}-candidate-${++sequence}`, phones: ['+79991234567'], candidateType: 'reserve', comment: 'No conversion or assignments' }
      : { creationRequestId: randomUUID(), title: `${marker}-order-${++sequence}`, executionAddress: 'Synthetic integration address',
        contactName: 'Synthetic contact', status: 'new', plannedPaymentMethod: 'cash' };
  // Payment method is required order metadata; no paid completion, amount,
  // receipt, expense, workforce assignment, upload or external storage write.
  const request = (path: string, method = 'GET', body?: unknown) => fetch(`${baseUrl}/api/v1${path}`, {
    method, headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(30_000),
  });
  const json = async <T,>(response: Response, expected = 200): Promise<T> => {
    const text = await response.text();
    assert.equal(response.status, expected, text);
    return JSON.parse(text) as T;
  };
  const rule = async (actionCode: string, effect: 'allow' | 'deny') => {
    const definition = ACCESS_ACTION_CATALOG.find((entry) => entry.code === actionCode)!;
    assert.equal(definition.manageable, true);
    assert.ok(definition.allowedScopes.includes('all'));
    const saved = await prisma.userAccessRule.upsert({ where: { userId_actionCode: { userId: actor.id, actionCode } },
      create: { userId: actor.id, actionCode, effect, scope: 'all', selectedIds: [] }, update: { effect, scope: 'all', selectedIds: [] } });
    ruleIds.add(saved.id);
  };
  const revoke = async (actionCode: string) => {
    const saved = await prisma.userAccessRule.delete({ where: { userId_actionCode: { userId: actor.id, actionCode } } });
    ruleIds.delete(saved.id);
  };
  const controlEmployee = await prisma.employee.create({ data: { fullName: `${marker}-control-employee`, employmentStatus: 'active' } });
  const controlCandidate = await prisma.candidate.create({ data: {
    fullName: `${marker}-control-candidate`, candidateType: 'reserve', createdByUserId: founder.id,
    phone: '+79991234568', phones: ['+79991234568'], phoneSearchText: '+79991234568',
  } });
  const controlOrder = await prisma.oneTimeOrder.create({ data: {
    title: `${marker}-control-order`, executionAddress: 'Synthetic control address', contactName: 'Synthetic control',
    status: 'new', plannedPaymentMethod: 'cash', createdByUserId: founder.id,
  } });
  const controls = { employee: controlEmployee.id, candidate: controlCandidate.id, order: controlOrder.id };
  const capture = async () => {
    const [employees, candidates, candidateAssignments, responses, orders, orderAssignments, specifications, audits,
      notifications, outbox, rooms, members, messages, assignments, history, facts, payments, funding, expenses, attachments,
      users, roles, directPermissions, rolePermissions, rules] = await Promise.all([
      prisma.employee.findMany({ orderBy: { id: 'asc' } }),
      prisma.candidate.findMany({ orderBy: { id: 'asc' } }),
      prisma.candidateManagerAssignment.findMany({ orderBy: { id: 'asc' } }),
      prisma.candidateResponse.findMany({ orderBy: { id: 'asc' } }),
      prisma.oneTimeOrder.findMany({ orderBy: { id: 'asc' } }),
      prisma.oneTimeOrderAssignment.findMany({ orderBy: { id: 'asc' } }),
      prisma.oneTimeOrderSpecificationItem.findMany({ orderBy: { id: 'asc' } }),
      prisma.auditEvent.findMany({ orderBy: { id: 'asc' } }),
      prisma.notification.findMany({ orderBy: { id: 'asc' } }),
      // Background delivery timestamps are not business state. Keep durable
      // outbox identities/content, including rows referencing leaked new IDs.
      prisma.notificationOutbox.findMany({ orderBy: { id: 'asc' }, select: { id: true, notificationId: true, recipientUserId: true, createdAt: true } }),
      prisma.chatRoom.findMany({ orderBy: { id: 'asc' } }),
      prisma.chatRoomParticipant.findMany({ orderBy: { id: 'asc' } }),
      prisma.chatMessage.findMany({ orderBy: { id: 'asc' } }),
      prisma.objectEmployeeAssignment.findMany({ orderBy: { id: 'asc' } }),
      prisma.employeeObjectAssignmentHistory.findMany({ orderBy: { id: 'asc' } }),
      prisma.objectAttendanceFact.findMany({ orderBy: { id: 'asc' } }),
      prisma.oneTimeOrderCompletionPayment.findMany({ orderBy: { id: 'asc' } }),
      prisma.accountabilityFunding.findMany({ orderBy: { id: 'asc' } }),
      prisma.accountabilityExpense.findMany({ orderBy: { id: 'asc' } }),
      prisma.fileAttachment.findMany({ orderBy: { id: 'asc' } }),
      prisma.user.findMany({ orderBy: { id: 'asc' }, select: { id: true, login: true, isActive: true, accessVersion: true } }),
      prisma.userRole.findMany({ orderBy: { id: 'asc' } }),
      prisma.userPermission.findMany({ orderBy: { id: 'asc' } }),
      prisma.rolePermission.findMany({ orderBy: { id: 'asc' } }),
      prisma.userAccessRule.findMany({ where: { userId: actor.id }, orderBy: { id: 'asc' } }),
    ]);
    return { employees, candidates, candidateAssignments, responses, orders, orderAssignments, specifications, audits,
      notifications, outbox, rooms, members, messages, assignments, history, facts, payments, funding, expenses, attachments,
      users, roles, directPermissions, rolePermissions, rules };
  };
  type State = Awaited<ReturnType<typeof capture>>;
  const denied = async (path: string, method = 'GET', body?: unknown) => {
    const before = await capture();
    const response = await request(path, method, body);
    const text = await response.text();
    assert.deepEqual(await capture(), before, `${method} ${path}: unreadable create/replay must leave no entity, audit, notification/outbox, system chat, assignment or money effects; status=${response.status}`);
    assert.equal(response.status, 403, text);
    const error = JSON.parse(text) as Record<string, unknown>;
    for (const key of ['id', 'fullName', 'title', 'phones', 'createdBy', 'assignments', 'capabilities']) assert.equal(Object.hasOwn(error, key), false, `403 cannot return card field ${key}`);
    if (body) {
      const name = (body as Record<string, unknown>).fullName ?? (body as Record<string, unknown>).title;
      if (typeof name === 'string') assert.equal(text.includes(name), false, 'Denied response cannot leak the card through its error body');
    }
  };
  const unchangedIndependent = (before: State, after: State) => {
    for (const key of ['candidateAssignments', 'responses', 'orderAssignments', 'specifications', 'assignments', 'history', 'facts',
      'payments', 'funding', 'expenses', 'attachments', 'users', 'roles', 'directPermissions', 'rolePermissions', 'rules'] as const) assert.deepEqual(after[key], before[key], `${key}: creation cannot add implicit assignments, Users or financial effects`);
    assert.deepEqual(after.employees.find(({ id }) => id === controls.employee), before.employees.find(({ id }) => id === controls.employee));
    assert.deepEqual(after.candidates.find(({ id }) => id === controls.candidate), before.candidates.find(({ id }) => id === controls.candidate));
    assert.deepEqual(after.orders.find(({ id }) => id === controls.order), before.orders.find(({ id }) => id === controls.order));
  };
  const validCreate = async (domain: Domain, body: Record<string, unknown>) => {
    const definition = definitions[domain];
    const before = await capture();
    const card = await json<Card>(await request(definition.path, 'POST', body), 201);
    const after = await capture();
    assert.ok(card.id);
    const name = domain === 'order' ? body.title : body.fullName;
    assert.equal(domain === 'order' ? card.title : card.fullName, name);
    assert.equal((await json<Card>(await request(`${definition.path}/${card.id}`))).id, card.id);
    if (domain === 'employee') {
      assert.equal(after.employees.filter((entry) => entry.fullName === name).length, 1);
      assert.deepEqual(after.employees.filter((entry) => entry.id !== card.id), before.employees);
      assert.deepEqual(after.candidates, before.candidates);
      assert.deepEqual(after.orders, before.orders);
    } else if (domain === 'candidate') {
      assert.equal(after.candidates.filter((entry) => entry.fullName === name).length, 1);
      const saved = after.candidates.find((entry) => entry.id === card.id)!;
      assert.equal(saved.createdByUserId, actor.id);
      assert.equal(saved.employeeId, null);
      assert.equal(saved.objectId, null);
      assert.deepEqual(after.candidates.filter((entry) => entry.id !== card.id), before.candidates);
      assert.deepEqual(after.employees, before.employees);
      assert.deepEqual(after.orders, before.orders);
    } else {
      assert.equal(after.orders.filter((entry) => entry.title === name).length, 1);
      const saved = after.orders.find((entry) => entry.id === card.id)!;
      assert.equal(saved.createdByUserId, actor.id);
      assert.equal(saved.creationRequestId, body.creationRequestId);
      assert.equal(saved.linkedObjectId, null);
      assert.deepEqual(after.orders.filter((entry) => entry.id !== card.id), before.orders);
      assert.deepEqual(after.employees, before.employees);
      assert.deepEqual(after.candidates, before.candidates);
    }
    assert.equal(after.audits.filter((entry) => entry.entityType === definition.entity && entry.entityId === card.id && entry.action === definition.action && entry.actorUserId === actor.id).length, 1);
    unchangedIndependent(before, after);
    return card;
  };

  for (const domain of ['employee', 'candidate', 'order'] as const) {
    await t.test(`${domain}: create all plus view/read deny all returns 403 with zero effects; same-payload valid retry commits once`, async (suite) => {
      suite.after(reset);
      const definition = definitions[domain];
      await rule(definition.create, 'allow');
      await rule(definition.read, 'deny');
      await denied(`${definition.path}/${controls[domain]}`); // Existing cookie observes the real deny.
      const body = input(domain);
      await denied(definition.path, 'POST', body);
      await revoke(definition.read);
      await rule(definition.read, 'allow');
      await validCreate(domain, body);
    });
  }

  await t.test('Employee create alone without inherited/direct/positive view cannot return or persist a full generated card', async (suite) => {
    suite.after(reset);
    const memberships = await prisma.userRole.findMany({ where: { userId: actor.id }, orderBy: { id: 'asc' } });
    const permission = await prisma.permission.findUniqueOrThrow({ where: { code: 'employees.view' } });
    const roleIds = memberships.map(({ roleId }) => roleId);
    const inherited = await prisma.rolePermission.findMany({ where: { roleId: { in: roleIds }, permissionId: permission.id }, orderBy: { id: 'asc' } });
    const direct = await prisma.userPermission.findMany({ where: { userId: actor.id, permissionId: permission.id }, orderBy: { id: 'asc' } });
    assert.ok(inherited.length > 0, 'A canonical manager actually inherits view; do not pretend a selected allow removes it');
    restoreViewSource = async () => {
      await prisma.$transaction([
        prisma.rolePermission.createMany({ data: inherited, skipDuplicates: true }),
        prisma.userPermission.createMany({ data: direct, skipDuplicates: true }),
      ]);
      assert.deepEqual(await prisma.rolePermission.findMany({ where: { roleId: { in: roleIds }, permissionId: permission.id }, orderBy: { id: 'asc' } }), inherited);
      assert.deepEqual(await prisma.userPermission.findMany({ where: { userId: actor.id, permissionId: permission.id }, orderBy: { id: 'asc' } }), direct);
      assert.deepEqual(await prisma.userRole.findMany({ where: { userId: actor.id }, orderBy: { id: 'asc' } }), memberships);
      assert.deepEqual(await prisma.user.findUniqueOrThrow(actorQuery), actor, 'Restore the exact seeded permission sources without role changes');
    };
    try {
      await prisma.$transaction([
        prisma.rolePermission.deleteMany({ where: { id: { in: inherited.map(({ id }) => id) } } }),
        prisma.userPermission.deleteMany({ where: { id: { in: direct.map(({ id }) => id) } } }),
      ]);
      await rule('employees.create', 'allow');
      assert.equal(await prisma.userAccessRule.count({ where: { userId: actor.id, actionCode: 'employees.view' } }), 0, 'No negative or positive view rule: this tests missing authority, not deny precedence');
      const reduced = await prisma.user.findUniqueOrThrow(actorQuery);
      assert.equal(reduced.permissions.some(({ permission }) => permission.code === 'employees.view'), false);
      assert.equal(reduced.roles.some(({ role }) => role.permissions.some(({ permission }) => permission.code === 'employees.view')), false);
      const me = await json<MeResponseDto>(await request('/auth/me'));
      assert.deepEqual(me.roleCodes, ['manager']);
      assert.equal(me.capabilities.canCreateEmployee, true, 'The real session retains only the independent create grant');
      assert.equal(me.capabilities.canAccessEmployeesHr, false, 'The real session must see that legacy and positive view authority are absent');
      await denied(`/employees/${controlEmployee.id}`);
      const body = input('employee');
      await denied('/employees', 'POST', body);
      await rule('employees.view', 'allow');
      await validCreate('employee', body);
    } finally {
      await restoreViewSource();
      restoreViewSource = async () => {};
    }
  });

  await t.test('order creation replay rechecks current read deny and cannot return a committed card or repeat any effects', async (suite) => {
    suite.after(reset);
    await rule('one_time_orders.create', 'allow');
    await rule('one_time_orders.read', 'allow');
    const body = input('order');
    const original = await validCreate('order', body);
    await rule('one_time_orders.read', 'deny');
    await denied(`/one-time-orders/${original.id}`);
    await denied('/one-time-orders', 'POST', body);
    await revoke('one_time_orders.read');
    await rule('one_time_orders.read', 'allow');
    const beforeReplay = await capture();
    const replay = await json<Card>(await request('/one-time-orders', 'POST', body), 201);
    assert.equal(replay.id, original.id);
    assert.deepEqual(await capture(), beforeReplay, 'Authorized replay returns the existing card without a second order/audit/notification/system message');
    assert.equal(await prisma.oneTimeOrder.count({ where: { createdByUserId: actor.id, creationRequestId: body.creationRequestId as string } }), 1);
  });
});
