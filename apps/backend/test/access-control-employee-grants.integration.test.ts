import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { PrismaClient } from '@prisma/client';

import { AuditService } from '../src/modules/audit/audit.service';
import { EmployeeResponseDto } from '../src/modules/employees/dto/employee-response.dto';
import { loginAndGetCookieHeader } from './helpers/auth';
import { createTestApp } from './helpers/create-test-app';
import { usesIsolatedIntegrationDatabase } from './helpers/isolated-database';

// Nine catalog actions: access, view, attendance.read, create, edit,
// documents.edit, assignments.manage, availability.manage, substitutions.manage.
// Not covered: archive, restore, delete_permanently, assignments.delete_as_error.
test('employee personal grants enforce HTTP scope and live revocation without unrelated HR rights', async (t) => {
  // Guard before any client/app: this file must never touch a shared schema.
  assert.equal(usesIsolatedIntegrationDatabase(), true);
  const databaseUrl = new URL(process.env.DATABASE_URL!);
  assert.match(databaseUrl.searchParams.get('schema') ?? '', /^integration_\d+_\d+$/);
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(databaseUrl.hostname));
  assert.ok(['postgres:', 'postgresql:'].includes(databaseUrl.protocol));

  const prisma = new PrismaClient();
  let closeApp: (() => Promise<void>) | undefined = undefined;
  t.after(async () => {
    try { await closeApp?.(); } finally { await prisma.$disconnect(); }
  });
  const { app, baseUrl } = await createTestApp();
  closeApp = () => app.close();
  const actor = await prisma.user.findUniqueOrThrow({ where: { login: 'manager1' }, include: {
    roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } },
    permissions: { include: { permission: true } },
  } });
  const founder = await prisma.user.findUniqueOrThrow({ where: { login: 'founder' } });
  const permissions = [...actor.permissions.map((row) => row.permission.code),
    ...actor.roles.flatMap((row) => row.role.permissions.map((item) => item.permission.code))];
  assert.deepEqual(actor.roles.map((row) => row.role.code), ['manager']);
  assert.deepEqual(permissions.filter((code) => code.startsWith('employees.')).sort(), ['employees.view']);
  assert.equal(await prisma.userAccessRule.count({ where: { userId: actor.id, actionCode: { startsWith: 'employees.' } } }), 0);
  // Reuse the seeded account, without changing roles or legacy permissions.
  // Every request below uses this one session, including grant/deny/default/revoke.
  const cookie = await loginAndGetCookieHeader({ baseUrl, login: 'manager1', password: 'manager123' });
  const marker = `acl-employee-${randomUUID()}`;
  const object = await prisma.object.create({ data: {
    name: marker, address: 'Isolated employee ACL fixture', status: 'active', createdByUserId: founder.id,
  } });
  assert.equal(await prisma.objectAssignment.count({ where: { objectId: object.id, userId: actor.id } }), 0);
  const request = (path: string, method = 'GET', body?: unknown) => fetch(`${baseUrl}/api/v1/employees${path}`, {
    method, headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const expectStatus = async (response: Response, status: number) => {
    assert.equal(response.status, status, await response.clone().text());
  };
  const read = async (id: string) => {
    const response = await request(`/${id}`);
    await expectStatus(response, 200);
    return await response.json() as EmployeeResponseDto;
  };
  const employee = (label: string) => prisma.employee.create({ data: {
    fullName: `${marker}-${label}`, employmentStatus: 'active',
  } });
  const rules = new Set<string>();
  const rule = async (actionCode: string, effect: 'allow' | 'deny', ids?: string[]) => {
    const saved = await prisma.userAccessRule.create({ data: {
      userId: actor.id, actionCode, effect, scope: ids ? 'selected' : 'all', selectedIds: ids ?? [],
    } });
    rules.add(saved.id);
    return saved;
  };
  const removeRule = async (id: string) => {
    await prisma.userAccessRule.delete({ where: { id } });
    rules.delete(id);
  };
  const resetRules = async () => {
    // Only rules created by this file; never clear pre-existing actor permissions.
    for (const id of [...rules]) await removeRule(id);
  };
  const capture = async () => {
    const employees = await prisma.employee.findMany({ where: { fullName: { startsWith: marker } }, orderBy: { id: 'asc' } });
    const employeeIds = employees.map(({ id }) => id);
    const [availability, substitutions, assignments, history, audit, attendance, timesheet, credits] = await Promise.all([
      prisma.employeeAvailabilityWindow.findMany({ where: { employeeId: { in: employeeIds } }, orderBy: { id: 'asc' } }),
      prisma.employeeSubstitution.findMany({ where: { OR: [{ employeeId: { in: employeeIds } }, { substituteEmployeeId: { in: employeeIds } }] }, orderBy: { id: 'asc' } }),
      prisma.objectEmployeeAssignment.findMany({ where: { employeeId: { in: employeeIds } }, orderBy: { id: 'asc' } }),
      prisma.employeeObjectAssignmentHistory.findMany({ where: { employeeId: { in: employeeIds } }, orderBy: { id: 'asc' } }),
      prisma.auditEvent.findMany({ where: { entityType: 'employee', entityId: { in: employeeIds } }, orderBy: { id: 'asc' } }),
      prisma.objectAttendanceFact.findMany({ where: { employeeId: { in: employeeIds } }, orderBy: { id: 'asc' } }),
      prisma.timesheetEmployeeRow.findMany({ where: { employeeId: { in: employeeIds } }, include: { entries: { orderBy: { id: 'asc' } } }, orderBy: { id: 'asc' } }),
      prisma.objectPayrollCredit.findMany({ where: { employeeId: { in: employeeIds } }, orderBy: { id: 'asc' } }),
    ]);
    return { employees, availability, substitutions, assignments, history, audit, attendance, timesheet, credits };
  };
  const denied = async (path: string, method: string, body?: unknown) => {
    const before = await capture();
    await expectStatus(await request(path, method, body), 403);
    assert.deepEqual(await capture(), before, `${method} ${path}: denied request must not mutate records or audit`);
  };
  const audit = async (employeeId: string, action: string, count = 1) => {
    const rows = await prisma.auditEvent.findMany({ where: { entityType: 'employee', entityId: employeeId, action } });
    assert.equal(rows.length, count, action);
    assert.ok(rows.every((row) => row.actorUserId === actor.id), action);
    return rows;
  };

  await t.test('employees.view / access / attendance.read: scoped denies, default and parent deny preserve control B', async (suite) => {
    suite.after(resetRules);
    const a = await employee('read-A');
    const b = await employee('read-B');
    for (const person of [a, b]) await prisma.objectAttendanceFact.create({ data: {
      objectId: object.id, employeeId: person.id, operationDate: new Date('2030-04-12T12:00:00Z'),
      workedHours: 4, dailyRateSnapshot: 0, createdByUserId: founder.id,
    } });
    const before = await capture();
    const attendancePath = (id: string) => `/${id}/attendance?year=2030&month=4`;
    const list = async (ids: string[]) => {
      const response = await request(`?search=${encodeURIComponent(`${marker}-read-`)}`);
      await expectStatus(response, 200);
      const result = await response.json() as { items: Array<{ id: string }>; total: number };
      assert.equal(result.total, ids.length);
      assert.deepEqual(result.items.map(({ id }) => id).sort(), [...ids].sort());
    };
    await list([a.id, b.id]);
    const response = await request(attendancePath(a.id));
    await expectStatus(response, 200);
    const calendar = await response.json() as { days: Array<{ date: string; objects: Array<{ objectId: string; workedHours: number }> }> };
    assert.equal(calendar.days.length, 1);
    assert.equal(calendar.days[0].date, '2030-04-12');
    assert.equal(calendar.days[0].objects[0].objectId, object.id);
    assert.equal(calendar.days[0].objects[0].workedHours, 4);
    const leaf = await rule('employees.attendance.read', 'deny', [a.id]);
    await denied(attendancePath(a.id), 'GET');
    await expectStatus(await request(attendancePath(b.id)), 200);
    await read(a.id);
    await removeRule(leaf.id);
    await expectStatus(await request(attendancePath(a.id)), 200);
    for (const code of ['employees.view', 'employees.access']) {
      const parent = await rule(code, 'deny', [a.id]);
      await rule('employees.attendance.read', 'allow', [a.id]);
      await list([b.id]);
      await denied(`/${a.id}`, 'GET');
      await denied(attendancePath(a.id), 'GET');
      await read(b.id);
      await expectStatus(await request(attendancePath(b.id)), 200);
      await removeRule(parent.id);
      await resetRules();
      await list([a.id, b.id]);
      await expectStatus(await request(attendancePath(a.id)), 200);
    }
    assert.deepEqual(await capture(), before, 'All reads and denied reads are side-effect free');
  });

  await t.test('employees.create: global grant, explicit deny, default/revoke and section deny in one cookie', async (suite) => {
    suite.after(resetRules);
    const body = { fullName: `${marker}-created`, notes: 'Personal create only' };
    await denied('', 'POST', body);
    const allow = await rule('employees.create', 'allow');
    const before = await capture();
    const response = await request('', 'POST', body);
    await expectStatus(response, 201);
    const saved = await response.json() as EmployeeResponseDto;
    const row = await prisma.employee.findUniqueOrThrow({ where: { id: saved.id } });
    assert.equal(row.fullName, body.fullName);
    assert.equal(row.notes, body.notes);
    assert.equal(row.version, 1);
    assert.equal(row.passportReceived, false);
    assert.equal(row.contractReceived, false);
    assert.equal((await audit(row.id, 'employee.created'))[0].newValues !== null, true);
    const after = await capture();
    assert.deepEqual(after.employees.filter(({ id }) => id !== row.id), before.employees);
    assert.deepEqual(after.audit.filter(({ entityId }) => entityId !== row.id), before.audit);
    for (const key of ['availability', 'substitutions', 'assignments', 'history', 'attendance', 'timesheet', 'credits'] as const)
      assert.deepEqual(after[key], before[key], 'Create must not create staffing, calendar or payroll records');
    await denied(`/${row.id}`, 'PATCH', { expectedVersion: row.version, notes: 'Create must not grant edit' });
    await prisma.userAccessRule.update({ where: { id: allow.id }, data: { effect: 'deny' } });
    await denied('', 'POST', { ...body, fullName: `${marker}-denied-create` });
    await removeRule(allow.id);
    await denied('', 'POST', { ...body, fullName: `${marker}-revoked-create` });
    await rule('employees.create', 'allow');
    await rule('employees.access', 'deny');
    await denied('', 'POST', { ...body, fullName: `${marker}-parent-denied-create` });
    await resetRules();
  });

  // Selected grants below use fresh A/B records and no role/direct legacy write
  // permissions. B stays readable so failures cannot be mistaken for missing IDs.
  for (const operation of ['edit', 'documents', 'availability', 'substitutions', 'assignments'] as const) {
    const code = { edit: 'employees.edit', documents: 'employees.documents.edit',
      availability: 'employees.availability.manage', substitutions: 'employees.substitutions.manage',
      assignments: 'employees.assignments.manage' }[operation];
    await t.test(`${code}: selected A, deny/default/revoke, parent deny and persisted effects`, async (suite) => {
      suite.after(resetRules);
      const a = await employee(`${operation}-A`);
      const b = await employee(`${operation}-B`);
      const replacement = await employee(`${operation}-replacement`);
      const windowIds = new Map<string, string>();
      const substitutionIds = new Map<string, string>();
      if (operation === 'availability') for (const person of [a, b]) {
        const window = await prisma.employeeAvailabilityWindow.create({ data: {
          employeeId: person.id, startDate: new Date('2030-05-01T10:00:00Z'), endDate: new Date('2030-05-01T11:00:00Z'),
          availabilityMode: 'timed', availabilityStatus: 'unavailable', createdByUserId: founder.id,
        } });
        windowIds.set(person.id, window.id);
      }
      if (operation === 'substitutions') for (const person of [a, b]) {
        const substitution = await prisma.employeeSubstitution.create({ data: {
          employeeId: person.id, substituteEmployeeId: replacement.id, startDate: new Date('2030-06-01T10:00:00Z'),
          endDate: new Date('2030-06-01T11:00:00Z'), status: 'cancelled', reason: 'Existing cancelled fixture', createdByUserId: founder.id,
        } });
        substitutionIds.set(person.id, substitution.id);
      }
      if (operation === 'assignments') await prisma.objectEmployeeAssignment.create({ data: {
        employeeId: b.id, objectId: object.id, isActive: true, startDate: new Date('2030-01-01T00:00:00Z'),
      } });
      // The PATCH endpoint requires edit as well as the documents leaf. Do not
      // conceal that prerequisite with an HR role or a global permission.
      if (operation === 'documents') await rule('employees.edit', 'allow', [a.id, b.id]);
      // Edit's legacy document fallback is false for this manager, so even a
      // selected employees.edit grant cannot silently change receipt flags.
      const body = async (id: string) => ({ expectedVersion: (await prisma.employee.findUniqueOrThrow({ where: { id } })).version,
        ...(operation === 'documents' ? { passportReceived: true, contractReceived: true } : { notes: 'Selected personal edit' }) });
      const denyAll = async (id: string) => {
        await read(id);
        if (operation === 'edit' || operation === 'documents') await denied(`/${id}`, 'PATCH', await body(id));
        if (operation === 'availability') {
          await denied(`/${id}/availability`, 'POST', { startDate: '2030-05-02T10:00:00Z', endDate: '2030-05-02T11:00:00Z', availabilityMode: 'timed', availabilityStatus: 'unavailable' });
          await denied(`/${id}/availability/${windowIds.get(id)}`, 'PATCH', { endDate: '2030-05-01T12:00:00Z' });
          await denied(`/${id}/availability/${windowIds.get(id)}`, 'DELETE');
        }
        if (operation === 'substitutions') {
          await denied(`/${id}/substitutions`, 'POST', { substituteEmployeeId: replacement.id, startDate: '2030-06-02T10:00:00Z', endDate: '2030-06-02T11:00:00Z', reason: 'Personal substitution', status: 'planned' });
          await denied(`/${id}/substitutions/${substitutionIds.get(id)}`, 'PATCH', { status: 'completed' });
        }
        if (operation === 'assignments') {
          await denied(`/${id}/object-assignments`, 'POST', { objectId: object.id });
          // A may not yet have an assignment, but B always has a real active row.
          await denied(`/${id}/object-assignments/${object.id}`, 'DELETE');
        }
      };
      await denyAll(a.id);
      await denyAll(b.id);
      let allow = await rule(code, 'allow', [a.id]);
      if (!['edit', 'documents'].includes(operation)) await denied(`/${a.id}`, 'PATCH', {
        expectedVersion: a.version, notes: 'A schedule/assignment leaf must not grant profile edit',
      });
      await denied(`/${a.id}/archive`, 'POST', { expectedVersion: a.version });
      const beforeB = (await capture()).employees.find(({ id }) => id === b.id);
      const before = await capture();
      if (operation === 'edit' || operation === 'documents') {
        await expectStatus(await request(`/${a.id}`, 'PATCH', await body(a.id)), 200);
        const saved = await prisma.employee.findUniqueOrThrow({ where: { id: a.id } });
        assert.equal(saved.version, a.version + 1);
        if (operation === 'documents') {
          assert.equal(saved.passportReceived, true);
          assert.equal(saved.contractReceived, true);
          assert.equal(saved.passportReceivedByUserId, actor.id);
          assert.equal(saved.contractReceivedByUserId, actor.id);
          assert.ok(saved.passportReceivedAt);
          assert.ok(saved.contractReceivedAt);
        } else {
          assert.equal(saved.notes, 'Selected personal edit');
          await denied(`/${a.id}`, 'PATCH', { expectedVersion: saved.version, passportReceived: true });
        }
        const events = await audit(a.id, 'employee.updated');
        assert.equal((events[0].oldValues as { version: number }).version, a.version);
        assert.equal((events[0].newValues as { version: number }).version, saved.version);
      }
      if (operation === 'availability') {
        await expectStatus(await request(`/${a.id}/availability`, 'POST', { startDate: '2030-05-02T10:00:00Z', endDate: '2030-05-02T11:00:00Z', availabilityMode: 'timed', availabilityStatus: 'unavailable', comment: marker }), 201);
        const created = await prisma.employeeAvailabilityWindow.findMany({ where: { employeeId: a.id, comment: marker } });
        assert.equal(created.length, 1);
        assert.equal(created[0].createdByUserId, actor.id);
        assert.equal(created[0].availabilityStatus, 'unavailable');
        const creationAudit = await audit(a.id, 'employee.availability.created');
        assert.deepEqual(creationAudit[0].newValues, {
          availabilityWindowId: created[0].id,
          startDate: created[0].startDate.toISOString(),
          endDate: created[0].endDate?.toISOString() ?? null,
          availabilityMode: 'timed', availabilityStatus: 'unavailable', comment: marker,
        });
        await expectStatus(await request(`/${a.id}/availability/${windowIds.get(a.id)}`, 'PATCH', { endDate: '2030-05-01T12:00:00Z' }), 200);
        assert.equal((await prisma.employeeAvailabilityWindow.findUniqueOrThrow({ where: { id: windowIds.get(a.id)! } })).endDate?.toISOString(), '2030-05-01T12:00:00.000Z');
        await audit(a.id, 'employee.availability.updated');
        await expectStatus(await request(`/${a.id}/availability/${created[0].id}`, 'DELETE'), 200);
        assert.equal(await prisma.employeeAvailabilityWindow.findUnique({ where: { id: created[0].id } }), null);
        await audit(a.id, 'employee.availability.deleted');
      }
      if (operation === 'substitutions') {
        await expectStatus(await request(`/${a.id}/substitutions`, 'POST', { substituteEmployeeId: replacement.id, startDate: '2030-06-02T10:00:00Z', endDate: '2030-06-02T11:00:00Z', reason: marker, status: 'planned' }), 201);
        const created = await prisma.employeeSubstitution.findMany({ where: { employeeId: a.id, reason: marker } });
        assert.equal(created.length, 1);
        assert.equal(created[0].createdByUserId, actor.id);
        assert.equal(created[0].substituteEmployeeId, replacement.id);
        assert.equal(created[0].status, 'planned');
        await audit(a.id, 'employee.substitution.created');
        await expectStatus(await request(`/${a.id}/substitutions/${created[0].id}`, 'PATCH', { status: 'cancelled' }), 200);
        assert.equal((await prisma.employeeSubstitution.findUniqueOrThrow({ where: { id: created[0].id } })).status, 'cancelled');
        await audit(a.id, 'employee.substitution.updated');
      }
      if (operation === 'assignments') {
        await expectStatus(await request(`/${a.id}/object-assignments`, 'POST', { objectId: object.id }), 201);
        const assignment = await prisma.objectEmployeeAssignment.findUniqueOrThrow({ where: { objectId_employeeId: { employeeId: a.id, objectId: object.id } } });
        assert.equal(assignment.isActive, true);
        const history = await prisma.employeeObjectAssignmentHistory.findMany({ where: { employeeId: a.id, objectId: object.id } });
        assert.equal(history.length, 1);
        assert.equal(history[0].createdByUserId, actor.id);
        await audit(a.id, 'employee.object_assignment.created');
        await expectStatus(await request(`/${a.id}/object-assignments/${object.id}`, 'DELETE'), 200);
        assert.equal((await prisma.objectEmployeeAssignment.findUniqueOrThrow({ where: { id: assignment.id } })).isActive, false);
        const ended = await prisma.employeeObjectAssignmentHistory.findUniqueOrThrow({ where: { id: history[0].id } });
        assert.equal(ended.closedByUserId, actor.id);
        assert.ok(ended.endedAt);
        await audit(a.id, 'employee.object_assignment.ended');
      }
      await denyAll(b.id);
      await prisma.userAccessRule.update({ where: { id: allow.id }, data: { effect: 'deny' } });
      await denyAll(a.id);
      await removeRule(allow.id); // default == revoke, same session
      await denyAll(a.id);
      allow = await rule(code, 'allow', [a.id]);
      const capability = { edit: 'canEdit', documents: 'canEdit', availability: 'canManageAvailability',
        substitutions: 'canManageSubstitutions', assignments: 'canManageAssignments' }[operation] as keyof EmployeeResponseDto['capabilities'];
      assert.equal((await read(a.id)).capabilities[capability], true, 'Original cookie sees restored permission');
      for (const parentCode of ['employees.access', 'employees.view']) {
        const parent = await rule(parentCode, 'deny', [a.id]);
        // Read itself is blocked here, so exercise writes directly with fresh versions.
        if (operation === 'edit' || operation === 'documents') await denied(`/${a.id}`, 'PATCH', await body(a.id));
        if (operation === 'availability') await denied(`/${a.id}/availability/${windowIds.get(a.id)}`, 'DELETE');
        if (operation === 'substitutions') await denied(`/${a.id}/substitutions/${substitutionIds.get(a.id)}`, 'PATCH', { status: 'completed' });
        if (operation === 'assignments') await denied(`/${a.id}/object-assignments`, 'POST', { objectId: object.id });
        await denied(`/${a.id}`, 'GET');
        await read(b.id);
        await removeRule(parent.id);
        await read(a.id);
      }
      const after = await capture();
      assert.deepEqual(after.employees.find(({ id }) => id === b.id), beforeB);
      assert.deepEqual(after.employees.filter(({ id }) => id !== a.id), before.employees.filter(({ id }) => id !== a.id), 'Other employee profiles stay unchanged');
      for (const key of ['availability', 'substitutions', 'assignments', 'history'] as const)
        assert.deepEqual(after[key].filter((row) => row.employeeId === b.id), before[key].filter((row) => row.employeeId === b.id));
      assert.deepEqual(after.audit.filter((row) => row.entityId === b.id), before.audit.filter((row) => row.entityId === b.id));
      for (const key of ['attendance', 'timesheet', 'credits'] as const) assert.deepEqual(after[key], before[key], `${code} must not change attendance/payroll`);
      await removeRule(allow.id);
      await resetRules();
    });
  }
  await t.test('availability create rolls back the row when the audit writer fails inside the transaction', async (suite) => {
    suite.after(resetRules);
    const person = await employee('audit-rollback');
    await rule('employees.availability.manage', 'allow', [person.id]);
    const before = await capture();
    const service = app.get(AuditService);
    const original = service.writeAuditEvent;
    let attempted = 0;
    service.writeAuditEvent = async (...args: Parameters<AuditService['writeAuditEvent']>) => {
      if (args[0].entityId === person.id && args[0].action === 'employee.availability.created') {
        attempted += 1;
        throw new Error('Controlled availability audit failure for isolated rollback acceptance');
      }
      return original.apply(service, args);
    };
    try {
      await expectStatus(await request(`/${person.id}/availability`, 'POST', {
        startDate: '2035-05-02T10:00:00Z', endDate: '2035-05-02T11:00:00Z',
        availabilityMode: 'timed', availabilityStatus: 'unavailable', comment: marker,
      }), 500);
      assert.equal(attempted, 1);
      assert.deepEqual(await capture(), before, 'Audit failure must roll back the new row and preserve all existing effects');
    } finally { service.writeAuditEvent = original; }
  });
  const finalActor = await prisma.user.findUniqueOrThrow({ where: { id: actor.id }, include: {
    roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } },
    permissions: { include: { permission: true } },
  } });
  assert.deepEqual(finalActor, actor, 'No role, user or legacy permission changes');
  assert.equal(await prisma.objectAssignment.count({ where: { objectId: object.id, userId: actor.id } }), 0);
  // The runner owns and drops integration_PID_index, including these fixtures.
});
