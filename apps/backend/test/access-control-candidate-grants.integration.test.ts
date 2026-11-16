import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { PrismaClient } from '@prisma/client';

import { CandidatesService } from '../src/modules/candidates/candidates.service';
import type { CandidateCardResponseDto } from '../src/modules/candidates/dto/candidate-response.dto';
import { ACCESS_ACTION_CATALOG } from '../src/modules/users-access/access-action-catalog';
import { loginAndGetCookieHeader } from './helpers/auth';
import { createTestApp } from './helpers/create-test-app';
import { usesIsolatedIntegrationDatabase } from './helpers/isolated-database';

type Scope = 'own' | 'assigned' | 'selected' | 'all';

test('candidate grants enforce actual writes, assignment SLA and safe Employee conversion', async (t) => {
  // No connection or application startup unless the sequential local runner isolated the DB.
  assert.equal(usesIsolatedIntegrationDatabase(), true);
  const url = new URL(process.env.DATABASE_URL!);
  assert.match(url.searchParams.get('schema') ?? '', /^integration_\d+_\d+$/);
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname));
  assert.ok(['postgres:', 'postgresql:'].includes(url.protocol));
  const actions = ACCESS_ACTION_CATALOG.filter((action) => action.module === 'candidates');
  assert.deepEqual(actions.map((action) => action.code).sort(), [
    'access', 'view', 'manage', 'create', 'update', 'status', 'archive', 'restore',
    'assignments.manage', 'respond', 'convert_employee', 'denied',
  ].map((suffix) => `candidates.${suffix}`).sort());

  const prisma = new PrismaClient();
  let closeApp: (() => Promise<void>) | undefined = undefined;
  t.after(async () => {
    try { await closeApp?.(); } finally { await prisma.$disconnect(); }
  });
  const { app, baseUrl } = await createTestApp();
  closeApp = () => app.close();
  // Preserve the real service/transaction and filter response; expose no error.message.
  const candidatesService = app.get(CandidatesService);
  const originalCreate = candidatesService.create;
  let createFailure: { name?: string; code?: string; detail?: string } | undefined = undefined;
  const safeDetail = (value: unknown): string | undefined => typeof value === 'string'
    ? value.replace(/[a-z][a-z0-9+.-]*:\/\/[^\s"'<>]+/gi, '[redacted URL]')
      .replace(/\b(password|secret|token|authorization|cookie)\b\s*[:=]\s*[^\s,;]+/gi, '$1=[redacted]')
      .replace(/[\r\n\t]+/g, ' ').slice(0, 500)
    : undefined;
  candidatesService.create = async (...args: Parameters<CandidatesService['create']>) => {
    createFailure = undefined;
    try {
      return await originalCreate.apply(candidatesService, args);
    } catch (error: unknown) {
      const failure = error as { name?: unknown; code?: unknown; meta?: { error?: unknown } } | null;
      createFailure = {
        name: typeof failure?.name === 'string' && /^[a-zA-Z0-9_]{1,80}$/.test(failure.name) ? failure.name : undefined,
        code: typeof failure?.code === 'string' && /^[a-zA-Z0-9_]{1,40}$/.test(failure.code) ? failure.code : undefined,
        detail: safeDetail(failure?.meta?.error),
      };
      throw error;
    }
  };
  t.after(() => { candidatesService.create = originalCreate; });
  const credentials = [
    ['manager1', 'manager123'], ['manager2', 'manager123'], ['hr1', 'hr123'],
    ['founder', 'founder123'], ['stepanova', 'stepanova123'], ['nikitina', 'nikitina123'],
  ] as const;
  const cookies = new Map<string, string>();
  const users = new Map<string, string>();
  for (const [login, password] of credentials) {
    users.set(login, (await prisma.user.findUniqueOrThrow({ where: { login } })).id);
    cookies.set(login, await loginAndGetCookieHeader({ baseUrl, login, password }));
  }
  const actorId = users.get('manager1')!;
  const otherId = users.get('manager2')!;
  assert.equal(await prisma.userAccessRule.count({ where: { userId: { in: [...users.values()] } } }), 0);
  const marker = `acl-candidate-${randomUUID()}`;
  let sequence = 0;
  const request = (login: string, path: string, method = 'GET', body?: unknown) => fetch(
    `${baseUrl}/api/v1${path}`, {
      method, headers: { Cookie: cookies.get(login)!, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      // The measured create transaction has its own 15s bound; allow time for
      // response/card projection too. This is not a production latency target.
      signal: AbortSignal.timeout(45_000),
    },
  );
  const json = async <T,>(response: Response, status: number): Promise<T> => {
    const text = await response.text();
    const diagnostic = response.status === 500 && new URL(response.url).pathname === '/api/v1/candidates' && createFailure
      ? `\nCandidatesService.create failure: ${JSON.stringify(createFailure)}` : '';
    assert.equal(response.status, status, `${text}${diagnostic}`);
    return JSON.parse(text) as T;
  };
  const rule = (suffix: string, effect: 'allow' | 'deny', scope: Scope, selectedIds: string[] = [], login = 'manager1', module = 'candidates') => {
    const actionCode = `${module}.${suffix}`;
    assert.ok(ACCESS_ACTION_CATALOG.find((action) => action.code === actionCode)?.allowedScopes.includes(scope));
    const userId = users.get(login)!;
    return prisma.userAccessRule.upsert({
      where: { userId_actionCode: { userId, actionCode } },
      create: { userId, actionCode, effect, scope, selectedIds }, update: { effect, scope, selectedIds },
    });
  };
  const revoke = (suffix: string, login = 'manager1', module = 'candidates') => prisma.userAccessRule.delete({
    where: { userId_actionCode: { userId: users.get(login)!, actionCode: `${module}.${suffix}` } },
  });
  const reset = () => prisma.userAccessRule.deleteMany({ where: { userId: { in: [...users.values()] },
    OR: [{ actionCode: { startsWith: 'candidates.' } }, { actionCode: 'employees.create' }],
  } });
  const input = () => ({ fullName: `${marker}-${++sequence}`, phones: ['+79991234567', '+79997654321'],
    candidateType: 'reserve', comment: 'Candidate grant fixture' });
  const create = async (login = 'hr1', managers: string[] = [], objectId?: string) => json<CandidateCardResponseDto>(
    await request(login, '/candidates', 'POST', { ...input(),
      ...(objectId ? { candidateType: 'regular', objectId } : {}),
      assignments: managers.map((managerUserId) => ({ managerUserId })),
    }), 201,
  );
  const card = async (id: string, login = 'hr1') => json<CandidateCardResponseDto>(await request(login, `/candidates/${id}`), 200);
  const version = async (id: string) => (await prisma.candidate.findUniqueOrThrow({ where: { id } })).version;
  const snapshot = async () => ({
    candidates: await prisma.candidate.findMany({ where: { fullName: { startsWith: marker } }, orderBy: { id: 'asc' },
      include: { assignments: { orderBy: { id: 'asc' } }, responses: { orderBy: { id: 'asc' } } } }),
    audits: await prisma.auditEvent.findMany({ where: { entityType: { in: ['candidate', 'employee'] } }, orderBy: { id: 'asc' } }),
    notifications: await prisma.notification.findMany({ where: { entityType: 'candidate' }, orderBy: { id: 'asc' } }),
    employees: await prisma.employee.findMany({ orderBy: { id: 'asc' },
      include: { objectAssignments: { orderBy: { id: 'asc' } }, objectAssignmentHistory: { orderBy: { id: 'asc' } } } }),
    userIds: (await prisma.user.findMany({ select: { id: true }, orderBy: { id: 'asc' } })).map((user) => user.id),
    objectAssignments: await prisma.objectAssignment.findMany({ orderBy: { id: 'asc' } }),
  });
  const denied = async (login: string, path: string, method: string, body: unknown, status = 403) => {
    const before = await snapshot();
    const response = await request(login, path, method, body);
    assert.equal(response.status, status, await response.text());
    assert.deepEqual(await snapshot(), before, 'Denied requests must not change candidates, SLA, feedback, employees, users, assignments, notifications or audits');
  };
  const audit = async (id: string, action: string, login: string, beforeIds: string[]) => {
    const added = await prisma.auditEvent.findMany({ where: { entityType: 'candidate', entityId: id, id: { notIn: beforeIds } } });
    assert.equal(added.length, 1);
    assert.equal(added[0].action, action);
    assert.equal(added[0].actorUserId, users.get(login));
    return added[0];
  };

  await rule('create', 'allow', 'all');
  const own = await create('manager1');
  await revoke('create');
  const assigned = await create('hr1', [actorId, otherId]);
  const a = await create('hr1', [otherId]);
  const b = await create('hr1', [otherId]);
  const base = [own, assigned, a, b];

  await t.test('view scopes deny only their own/active-assigned/selected identities; default and revoke retain all-candidate reading', async () => {
    const visibility = async (visible: string[], hiddenStatus = 404) => {
      const before = await snapshot();
      const listing = await json<{ items: Array<{ id: string }>; total: number }>(
        await request('manager1', `/candidates?scope=all&q=${marker}&limit=100`), 200);
      assert.deepEqual(new Set(listing.items.map((item) => item.id)), new Set(visible));
      assert.equal(listing.total, visible.length);
      for (const candidate of base) {
        const response = await request('manager1', `/candidates/${candidate.id}`);
        assert.equal(response.status, visible.includes(candidate.id) ? 200 : hiddenStatus, await response.text());
      }
      assert.deepEqual(await snapshot(), before);
    };
    await visibility(base.map((item) => item.id));
    for (const scope of ['own', 'assigned', 'selected'] as const) {
      await rule('view', 'allow', scope, scope === 'selected' ? [a.id] : []);
      await visibility(base.map((item) => item.id)); // Allows are additive to seeded view permission.
      await rule('view', 'deny', scope, scope === 'selected' ? [a.id] : []);
      const hidden = scope === 'own' ? own.id : scope === 'assigned' ? assigned.id : a.id;
      await visibility(base.filter((item) => item.id !== hidden).map((item) => item.id));
      await revoke('view');
    }
    await rule('view', 'deny', 'all');
    await denied('manager1', '/candidates?scope=all', 'GET', undefined);
    await denied('manager1', `/candidates/${a.id}`, 'GET', undefined);
    await revoke('view');
    await visibility(base.map((item) => item.id));
    const mine = await json<{ items: Array<{ id: string }> }>(await request('manager1', `/candidates?q=${marker}`), 200);
    assert.deepEqual(mine.items.map((item) => item.id), [assigned.id]);
  });

  await t.test('access own/assigned/selected/all allows preserve leaf requirements and recover scoped parent denials', async () => {
    for (const [scope, target] of [['own', own], ['assigned', assigned], ['selected', a], ['all', b]] as const) {
      await reset();
      await rule('access', 'allow', scope, scope === 'selected' ? [target.id] : []);
      await card(target.id, 'manager1');
      await denied('manager1', `/candidates/${target.id}`, 'PATCH', {
        expectedVersion: await version(target.id), comment: 'Parent allow does not grant editing',
      });
      await rule('update', 'allow', 'selected', [target.id]);
      const before = await snapshot();
      const comment = `Allowed parent scope ${scope}`;
      const changed = await json<CandidateCardResponseDto>(await request('manager1', `/candidates/${target.id}`, 'PATCH', {
        expectedVersion: await version(target.id), comment,
      }), 200);
      const after = await snapshot();
      assert.equal(changed.comment, comment);
      assert.equal(after.candidates.find((item) => item.id === target.id)?.comment, comment);
      assert.deepEqual(after.candidates.filter((item) => item.id !== target.id), before.candidates.filter((item) => item.id !== target.id));
      await audit(target.id, 'candidate.updated', 'manager1', before.audits.map((item) => item.id));
      await rule('access', 'deny', scope, scope === 'selected' ? [target.id] : []);
      await denied('manager1', `/candidates/${target.id}`, 'GET', undefined, scope === 'all' ? 403 : 404);
      await denied('manager1', `/candidates/${target.id}`, 'PATCH', { expectedVersion: changed.version, comment: 'Parent denied' });
      const control = target.id === b.id ? a : b;
      if (scope !== 'all') await card(control.id, 'manager1');
      await revoke('access');
      assert.equal((await card(target.id, 'manager1')).capabilities.canEdit, true);
    }
    await reset();
  });

  await t.test('view all grants real list/card access without inherited candidate permissions in the existing cookie', async () => {
    await reset();
    // Change only this seeded user's permission sources in the isolated fixture,
    // never shared RolePermission rows; restore exact memberships in finally.
    const roles = await prisma.userRole.findMany({ where: { userId: otherId }, orderBy: { id: 'asc' } });
    const permissions = await prisma.userPermission.findMany({
      where: { userId: otherId, permission: { code: { startsWith: 'candidates.' } } }, orderBy: { id: 'asc' },
    });
    try {
      await prisma.userRole.deleteMany({ where: { id: { in: roles.map((item) => item.id) } } });
      await prisma.userPermission.deleteMany({ where: { id: { in: permissions.map((item) => item.id) } } });
      const me = await json<{ roleCodes: string[]; capabilities: { canAccessCandidates: boolean } }>(
        await request('manager2', '/auth/me'), 200);
      assert.deepEqual(me.roleCodes, []);
      assert.equal(me.capabilities.canAccessCandidates, false);
      await denied('manager2', '/candidates?scope=all', 'GET', undefined);
      await denied('manager2', `/candidates/${a.id}`, 'GET', undefined);
      await rule('access', 'allow', 'all', [], 'manager2');
      await denied('manager2', `/candidates/${a.id}`, 'GET', undefined);
      await rule('view', 'allow', 'all', [], 'manager2');
      const before = await snapshot();
      const listing = await json<{ items: Array<{ id: string }>; total: number }>(
        await request('manager2', `/candidates?scope=all&q=${marker}&limit=100`), 200);
      assert.deepEqual(new Set(listing.items.map((item) => item.id)), new Set(base.map((item) => item.id)));
      assert.equal(listing.total, base.length);
      for (const target of base) {
        const readable = await card(target.id, 'manager2');
        assert.equal(readable.capabilities.canEdit, false);
        assert.equal(readable.capabilities.canManageAssignments, false);
        assert.equal(readable.capabilities.canRespond, false);
        assert.equal(readable.capabilities.canConvert, false);
      }
      assert.deepEqual(await snapshot(), before);
      await denied('manager2', `/candidates/${a.id}`, 'PATCH', { expectedVersion: await version(a.id), comment: 'Read alone' });
      await revoke('view', 'manager2');
      await denied('manager2', `/candidates/${a.id}`, 'GET', undefined);
    } finally {
      await reset();
      if (roles.length) await prisma.userRole.createMany({ data: roles });
      if (permissions.length) await prisma.userPermission.createMany({ data: permissions });
    }
    assert.deepEqual(await prisma.userRole.findMany({ where: { userId: otherId }, orderBy: { id: 'asc' } }), roles);
    assert.deepEqual(await prisma.userPermission.findMany({
      where: { userId: otherId, permission: { code: { startsWith: 'candidates.' } } }, orderBy: { id: 'asc' },
    }), permissions);
    await card(a.id, 'manager2');
  });

  for (const operation of ['update', 'status', 'archive', 'restore'] as const) {
    await t.test(`${operation} leaf: own/assigned/selected/all writes, control B, revoke and management deny`, async () => {
      await reset();
      await rule('create', 'allow', 'all');
      const owned = await create('manager1');
      await revoke('create');
      const assignedTarget = await create('hr1', [actorId]);
      const target = await create();
      const control = await create();
      const attempt = async (id: string, allowed: boolean, login = 'manager1') => {
        // Put lifecycle in a valid state BEFORE capturing the authorization attempt.
        const existing = await card(id);
        if (operation === 'restore' && !existing.deletedAt) {
          await json(await request('hr1', `/candidates/${id}/archive`, 'POST', { expectedVersion: existing.version }), 201);
        } else if (operation !== 'restore' && existing.deletedAt) {
          await json(await request('hr1', `/candidates/${id}/restore`, 'POST', { expectedVersion: existing.version }), 201);
        }
        const current = await card(id);
        const body = { expectedVersion: current.version,
          ...(operation === 'update' ? { comment: `Changed ${++sequence}` } : {}),
          ...(operation === 'status' ? { status: current.status === 'new' ? 'in_progress' : 'new' } : {}),
        };
        const path = `/candidates/${id}${operation === 'update' ? '' : `/${operation}`}`;
        const method = operation === 'update' ? 'PATCH' : 'POST';
        if (!allowed) { await denied(login, path, method, body); return; }
        const before = await snapshot();
        const changed = await json<CandidateCardResponseDto>(await request(login, path, method, body), operation === 'update' ? 200 : 201);
        assert.equal(changed.version, current.version + 1);
        if (operation === 'update') assert.equal(changed.comment, body.comment);
        if (operation === 'status') assert.equal(changed.status, body.status);
        if (operation === 'archive') assert.ok(changed.deletedAt);
        if (operation === 'restore') assert.equal(changed.deletedAt, null);
        const after = await snapshot();
        const stored = after.candidates.find((item) => item.id === id)!;
        assert.equal(stored.version, changed.version);
        assert.equal(stored.comment, changed.comment);
        assert.equal(stored.status, changed.status);
        assert.equal(stored.deletedAt?.toISOString() ?? null, changed.deletedAt);
        assert.deepEqual(after.candidates.filter((item) => item.id !== id), before.candidates.filter((item) => item.id !== id));
        for (const key of ['employees', 'userIds', 'objectAssignments', 'notifications'] as const) assert.deepEqual(after[key], before[key]);
        await audit(id, `candidate.${operation === 'update' ? 'updated' : operation === 'status' ? 'status_changed' : operation === 'archive' ? 'archived' : 'restored'}`, login, before.audits.map((item) => item.id));
      };
      await attempt(target.id, false);
      await rule(operation, 'allow', 'own');
      await attempt(owned.id, true);
      await attempt(target.id, false);
      await rule(operation, 'allow', 'assigned');
      // Archive closes assignments; restore does not manufacture a new active one.
      await attempt(assignedTarget.id, operation !== 'restore');
      await rule(operation, 'allow', 'selected', [target.id]);
      await attempt(target.id, true);
      await attempt(control.id, false);
      await revoke(operation);
      await attempt(target.id, false);
      await rule(operation, 'allow', 'all');
      await attempt(control.id, true);
      await rule(operation, 'deny', 'selected', [target.id]);
      await attempt(target.id, false);
      await rule(operation, 'allow', 'all');
      await rule('manage', 'deny', 'selected', [target.id]);
      await attempt(target.id, false);
      await revoke('manage');
      await attempt(target.id, true);
    });
  }

  await t.test('manage grant is scoped, does not bypass leaf deny, and feedback without assignment preserves every SLA', async () => {
    await reset();
    await rule('manage', 'allow', 'selected', [a.id]);
    const before = await snapshot();
    const result = await json<CandidateCardResponseDto>(await request('manager1', `/candidates/${a.id}/responses`, 'POST', { text: 'Scoped management feedback' }), 201);
    const feedback = result.responses.at(-1)!;
    assert.equal(feedback.author.id, actorId);
    assert.equal(feedback.assignmentId, null);
    const after = await snapshot();
    assert.deepEqual(after.candidates.find((item) => item.id === a.id)!.assignments, before.candidates.find((item) => item.id === a.id)!.assignments);
    const storedFeedback = after.candidates.find((item) => item.id === a.id)!.responses;
    assert.equal(storedFeedback.length, before.candidates.find((item) => item.id === a.id)!.responses.length + 1);
    assert.ok(storedFeedback.some((item) => item.id === feedback.id && item.authorUserId === actorId && item.assignmentId === null));
    assert.deepEqual(after.candidates.filter((item) => item.id !== a.id), before.candidates.filter((item) => item.id !== a.id));
    await audit(a.id, 'candidate.manager_feedback_added', 'manager1', before.audits.map((item) => item.id));
    await denied('manager1', `/candidates/${b.id}`, 'PATCH', { expectedVersion: await version(b.id), comment: 'Control B denied' });
    await rule('update', 'deny', 'selected', [a.id]);
    await denied('manager1', `/candidates/${a.id}`, 'PATCH', { expectedVersion: await version(a.id), comment: 'Leaf deny' });
    await revoke('update');
    await revoke('manage');
    await denied('manager1', `/candidates/${a.id}/responses`, 'POST', { text: 'Revoked management' });
    for (const [scope, id] of [['own', own.id], ['assigned', assigned.id], ['all', b.id]] as const) {
      await rule('manage', 'allow', scope);
      const state = await snapshot();
      const comment = `Management scope ${scope}`;
      const updated = await json<CandidateCardResponseDto>(await request('manager1', `/candidates/${id}`, 'PATCH', {
        expectedVersion: await version(id), comment,
      }), 200);
      assert.equal(updated.comment, comment);
      assert.equal((await prisma.candidate.findUniqueOrThrow({ where: { id } })).comment, comment);
      const saved = await snapshot();
      assert.deepEqual(saved.candidates.filter((item) => item.id !== id), state.candidates.filter((item) => item.id !== id));
      await audit(id, 'candidate.updated', 'manager1', state.audits.map((item) => item.id));
      if (scope !== 'all') await denied('manager1', `/candidates/${b.id}`, 'PATCH', {
        expectedVersion: await version(b.id), comment: 'Management outside scope',
      });
    }
  });

  await t.test('assignments.manage persists independent SLA, cannot grant management, and removal revokes assigned scope', async () => {
    await reset();
    const target = await create('hr1', [actorId, otherId]);
    const original = await prisma.candidateManagerAssignment.findMany({ where: { candidateId: target.id }, orderBy: { id: 'asc' } });
    for (const item of original) assert.equal(item.responseDueAt.getTime() - item.assignedAt.getTime(), 7_200_000);
    await denied('manager1', `/candidates/${target.id}/assignments`, 'POST', { expectedVersion: target.version, managerUserIds: [otherId] });
    await rule('assignments.manage', 'allow', 'selected', [target.id]);
    await denied('manager1', `/candidates/${b.id}/assignments`, 'POST', { expectedVersion: await version(b.id), managerUserIds: [actorId] });
    const before = await snapshot();
    const changed = await json<CandidateCardResponseDto>(await request('manager1', `/candidates/${target.id}/assignments`, 'POST', { expectedVersion: target.version, managerUserIds: [otherId] }), 201);
    assert.equal(changed.version, target.version + 1);
    const rows = await prisma.candidateManagerAssignment.findMany({ where: { candidateId: target.id }, orderBy: { id: 'asc' } });
    assert.deepEqual(rows.find((item) => item.managerUserId === otherId), original.find((item) => item.managerUserId === otherId));
    const ended = rows.find((item) => item.managerUserId === actorId)!;
    assert.ok(ended.endedAt);
    assert.equal(ended.endedByUserId, actorId);
    assert.equal(ended.firstRespondedAt, null);
    await audit(target.id, 'candidate.manager_reassigned', 'manager1', before.audits.map((item) => item.id));
    await rule('update', 'allow', 'assigned');
    await denied('manager1', `/candidates/${target.id}`, 'PATCH', { expectedVersion: changed.version, comment: 'Ended assignment' });
    await revoke('assignments.manage');
    await denied('manager1', `/candidates/${target.id}/assignments`, 'POST', { expectedVersion: changed.version, managerUserIds: [actorId] });
    await json(await request('hr1', `/candidates/${target.id}/assignments`, 'POST', { expectedVersion: changed.version, managerUserIds: [actorId, otherId] }), 201);
    const restored = await card(target.id, 'manager1');
    assert.equal(restored.capabilities.canEdit, true);
    assert.equal(restored.capabilities.canManageAssignments, false);
    assert.equal(restored.assignments.filter((item) => item.manager.id === actorId).length, 2);
    const active = restored.currentAssignments.find((item) => item.manager.id === actorId)!;
    assert.equal(Date.parse(active.responseDueAt) - Date.parse(active.assignedAt), 7_200_000);
    assert.equal(active.firstRespondedAt, null);
    assert.notEqual(active.id, ended.id);
    assert.equal(await prisma.notification.count({ where: { entityType: 'candidate', entityId: target.id, recipientUserId: actorId, type: 'candidate.assigned' } }), 2);
  });

  await t.test('respond grant never supplies active assignment or satisfies a different manager SLA', async () => {
    await reset();
    const target = await create('hr1', [actorId, otherId]);
    await rule('respond', 'deny', 'assigned');
    await denied('manager1', `/candidates/${target.id}/responses`, 'POST', { text: 'Denied assigned responder' });
    await revoke('respond');
    const before = await snapshot();
    const result = await json<CandidateCardResponseDto>(await request('manager1', `/candidates/${target.id}/responses`, 'POST', { text: 'Own active SLA response' }), 201);
    const active = result.currentAssignments.find((item) => item.manager.id === actorId)!;
    const other = result.currentAssignments.find((item) => item.manager.id === otherId)!;
    assert.ok(active.firstRespondedAt);
    assert.equal(other.firstRespondedAt, null);
    assert.equal(result.responses.at(-1)?.assignmentId, active.id);
    assert.equal(result.status, 'in_progress');
    const after = await snapshot();
    assert.deepEqual(after.candidates.find((item) => item.id === target.id)!.assignments.find((item) => item.managerUserId === otherId),
      before.candidates.find((item) => item.id === target.id)!.assignments.find((item) => item.managerUserId === otherId));
    await audit(target.id, 'candidate.manager_feedback_added', 'manager1', before.audits.map((item) => item.id));
    await json(await request('hr1', `/candidates/${target.id}/assignments`, 'POST', { expectedVersion: result.version, managerUserIds: [otherId] }), 201);
    for (const scope of ['own', 'assigned', 'selected', 'all'] as const) {
      await rule('respond', 'allow', scope, scope === 'selected' ? [target.id, own.id] : []);
      await denied('manager1', `/candidates/${target.id}/responses`, 'POST', { text: 'Ended assignment must stay denied' });
      await denied('manager1', `/candidates/${own.id}/responses`, 'POST', { text: 'Authorship is not an active assignment' });
    }
    assert.equal((await card(target.id)).currentAssignments.find((item) => item.manager.id === otherId)?.firstRespondedAt, null);
  });

  await t.test('assignments.manage own/assigned/all grants persist new SLA rows without other candidate privileges', async () => {
    for (const scope of ['own', 'assigned', 'all'] as const) {
      await reset();
      let target: CandidateCardResponseDto;
      if (scope === 'own') {
        await rule('create', 'allow', 'all');
        target = await create('manager1');
        await revoke('create');
      } else {
        target = await create('hr1', scope === 'assigned' ? [actorId] : [otherId]);
      }
      const control = await create('hr1', [otherId]);
      const managers = scope === 'own' ? [otherId] : [actorId, otherId];
      const addedManagerId = scope === 'all' ? actorId : otherId;
      await denied('manager1', `/candidates/${target.id}/assignments`, 'POST', {
        expectedVersion: target.version, managerUserIds: managers,
      });
      await rule('assignments.manage', 'allow', scope);
      const before = await snapshot();
      const original = before.candidates.find((item) => item.id === target.id)!;
      assert.equal(original.createdByUserId === actorId, scope === 'own');
      assert.equal(original.assignments.some((item) => item.managerUserId === actorId && !item.endedAt), scope === 'assigned');
      const changed = await json<CandidateCardResponseDto>(await request('manager1', `/candidates/${target.id}/assignments`, 'POST', {
        expectedVersion: target.version, managerUserIds: managers,
      }), 201);
      const after = await snapshot();
      const saved = after.candidates.find((item) => item.id === target.id)!;
      assert.equal(changed.version, target.version + 1);
      assert.equal(saved.version, changed.version);
      assert.deepEqual(new Set(saved.assignments.filter((item) => !item.endedAt).map((item) => item.managerUserId)), new Set(managers));
      for (const previous of original.assignments) assert.deepEqual(saved.assignments.find((item) => item.id === previous.id), previous);
      const added = saved.assignments.filter((item) => !original.assignments.some((old) => old.id === item.id));
      assert.equal(added.length, 1);
      assert.equal(added[0].managerUserId, addedManagerId);
      assert.equal(added[0].assignedByUserId, actorId);
      assert.equal(added[0].responseDueAt.getTime() - added[0].assignedAt.getTime(), 7_200_000);
      assert.equal(added[0].firstRespondedAt, null);
      assert.equal(added[0].reminderSentAt, null);
      assert.equal(added[0].endedAt, null);
      assert.equal(saved.responses.length, 0);
      assert.deepEqual(after.candidates.filter((item) => item.id !== target.id), before.candidates.filter((item) => item.id !== target.id));
      for (const key of ['employees', 'userIds', 'objectAssignments'] as const) assert.deepEqual(after[key], before[key]);
      const notification = after.notifications.filter((item) => !before.notifications.some((old) => old.id === item.id));
      assert.equal(notification.length, 1);
      assert.equal(notification[0].recipientUserId, addedManagerId);
      assert.equal(notification[0].entityId, target.id);
      assert.equal(notification[0].type, 'candidate.assigned');
      await audit(target.id, original.assignments.length ? 'candidate.manager_reassigned' : 'candidate.manager_assigned',
        'manager1', before.audits.map((item) => item.id));
      assert.equal(changed.capabilities.canEdit, false);
      assert.equal(changed.capabilities.canConvert, false);
      await denied('manager1', `/candidates/${target.id}`, 'PATCH', { expectedVersion: changed.version, comment: 'Assignment grant is not edit' });
      if (scope !== 'all') await denied('manager1', `/candidates/${control.id}/assignments`, 'POST', {
        expectedVersion: control.version, managerUserIds: [actorId, otherId],
      });
      await revoke('assignments.manage');
      await denied('manager1', `/candidates/${target.id}/assignments`, 'POST', {
        expectedVersion: changed.version, managerUserIds: [],
      });
    }
    await reset();
  });

  await t.test('respond own/assigned/selected/all grants succeed only with a real active assignment and preserve peer SLA', async () => {
    for (const scope of ['own', 'assigned', 'selected', 'all'] as const) {
      await reset();
      let target: CandidateCardResponseDto;
      if (scope === 'own') {
        await rule('create', 'allow', 'all');
        await rule('assignments.manage', 'allow', 'all');
        target = await create('manager1', [actorId, otherId]);
        await revoke('create');
        await revoke('assignments.manage');
      } else {
        target = await create('hr1', [actorId, otherId]);
      }
      // Manager role retains its direct responder baseline. Do not misinterpret
      // an additive allow as an exclusive filter on other active assignments.
      await rule('respond', 'deny', scope, scope === 'selected' ? [target.id] : []);
      await denied('manager1', `/candidates/${target.id}/responses`, 'POST', { text: 'Scoped deny before grant' });
      await rule('respond', 'allow', scope, scope === 'selected' ? [target.id] : []);
      const before = await snapshot();
      const previous = before.candidates.find((item) => item.id === target.id)!;
      assert.equal(previous.createdByUserId === actorId, scope === 'own');
      const originalAssignment = previous.assignments.find((item) => item.managerUserId === actorId && !item.endedAt)!;
      assert.ok(originalAssignment);
      const text = `Positive responder scope ${scope}`;
      const result = await json<CandidateCardResponseDto>(await request('manager1', `/candidates/${target.id}/responses`, 'POST', { text }), 201);
      const after = await snapshot();
      const saved = after.candidates.find((item) => item.id === target.id)!;
      assert.equal(saved.status, 'in_progress');
      assert.equal(saved.version, target.version + 1);
      assert.equal(saved.responses.length, previous.responses.length + 1);
      const response = saved.responses.find((item) => !previous.responses.some((old) => old.id === item.id))!;
      assert.equal(response.text, text);
      assert.equal(response.authorUserId, actorId);
      assert.equal(response.assignmentId, originalAssignment.id);
      assert.equal(result.responses.at(-1)?.id, response.id);
      const ownAssignment = saved.assignments.find((item) => item.id === originalAssignment.id)!;
      assert.ok(ownAssignment.firstRespondedAt);
      assert.deepEqual(ownAssignment, { ...originalAssignment, firstRespondedAt: ownAssignment.firstRespondedAt });
      assert.deepEqual(saved.assignments.filter((item) => item.id !== originalAssignment.id), previous.assignments.filter((item) => item.id !== originalAssignment.id));
      assert.deepEqual(after.candidates.filter((item) => item.id !== target.id), before.candidates.filter((item) => item.id !== target.id));
      for (const key of ['employees', 'userIds', 'objectAssignments', 'notifications'] as const) assert.deepEqual(after[key], before[key]);
      await audit(target.id, 'candidate.manager_feedback_added', 'manager1', before.audits.map((item) => item.id));
      assert.equal(result.capabilities.canEdit, false);
      assert.equal(result.capabilities.canManageAssignments, false);
      assert.equal(result.capabilities.canConvert, false);
      await revoke('respond');
      // Revoking an additive grant returns to the legitimate assigned-manager baseline.
      assert.equal((await card(target.id, 'manager1')).capabilities.canRespond, true);
      await json(await request('hr1', `/candidates/${target.id}/assignments`, 'POST', {
        expectedVersion: saved.version, managerUserIds: [otherId],
      }), 201);
      await rule('respond', 'allow', scope, scope === 'selected' ? [target.id] : []);
      await denied('manager1', `/candidates/${target.id}/responses`, 'POST', { text: 'Grant cannot recreate ended assignment' });
    }
    await reset();
  });

  await t.test('convert_employee own/assigned/all grants preserve Employee/User separation and recheck assignment loss', async () => {
    await reset();
    const object = await prisma.object.create({ data: {
      id: randomUUID(), name: `${marker}-scope-conversion-object`, address: 'Isolated scope conversion fixture',
      status: 'active', createdByUserId: users.get('founder')!,
    } });
    for (const scope of ['own', 'assigned', 'all'] as const) {
      await reset();
      let target: CandidateCardResponseDto;
      if (scope === 'own') {
        await rule('create', 'allow', 'all');
        target = await create('manager1'); // Reserve candidate conversion is supported without object assignment.
        await revoke('create');
      } else {
        target = await create('founder', scope === 'assigned' ? [actorId, otherId] : [otherId], object.id);
      }
      const control = await create('founder', [otherId], object.id);
      const body = { expectedVersion: target.version, employeeType: 'substitution' };
      await rule('create', 'allow', 'all', [], 'manager1', 'employees');
      await denied('manager1', `/candidates/${target.id}/employee`, 'POST', body);
      await rule('convert_employee', 'allow', scope);
      if (scope !== 'all') await denied('manager1', `/candidates/${control.id}/employee`, 'POST', { expectedVersion: control.version });
      const before = await snapshot();
      const previous = before.candidates.find((item) => item.id === target.id)!;
      assert.equal(previous.createdByUserId === actorId, scope === 'own');
      assert.equal(previous.assignments.some((item) => item.managerUserId === actorId && !item.endedAt), scope === 'assigned');
      const result = await json<CandidateCardResponseDto>(await request('manager1', `/candidates/${target.id}/employee`, 'POST', body), 201);
      assert.ok(result.employeeId);
      const after = await snapshot();
      assert.equal(after.employees.length, before.employees.length + 1);
      const employee = after.employees.find((item) => item.id === result.employeeId)!;
      assert.equal(employee.fullName, target.fullName);
      assert.deepEqual(employee.phones, target.phones);
      assert.equal(employee.phone, target.phones[0]);
      assert.equal(employee.notes, target.comment);
      assert.equal(employee.employeeType, 'substitution');
      assert.deepEqual(employee.objectAssignments, []);
      assert.deepEqual(employee.objectAssignmentHistory, []);
      assert.deepEqual(after.employees.filter((item) => item.id !== employee.id), before.employees);
      assert.deepEqual(after.userIds, before.userIds);
      assert.deepEqual(after.objectAssignments, before.objectAssignments);
      assert.deepEqual(after.notifications, before.notifications);
      assert.deepEqual(after.candidates.filter((item) => item.id !== target.id), before.candidates.filter((item) => item.id !== target.id));
      const stored = after.candidates.find((item) => item.id === target.id)!;
      assert.equal(stored.employeeId, employee.id);
      assert.equal(stored.status, 'accepted');
      assert.equal(stored.version, target.version + 1);
      assert.equal(stored.assignments.length, previous.assignments.length);
      assert.ok(stored.assignments.every((item) => item.endedAt && item.endedByUserId === actorId));
      assert.equal(stored.responses.length, previous.responses.length);
      await audit(target.id, 'candidate.employee_created', 'manager1', before.audits.map((item) => item.id));
      const employeeAudits = after.audits.filter((item) => item.entityType === 'employee' && item.entityId === employee.id);
      assert.equal(employeeAudits.length, 1);
      assert.equal(employeeAudits[0].action, 'employee.created');
      assert.equal(employeeAudits[0].actorUserId, actorId);
      if (scope === 'assigned') {
        // Conversion ended the assignment; retry must reauthorize before its idempotent fast path.
        await denied('manager1', `/candidates/${target.id}/employee`, 'POST', body);
      } else {
        const replay = await json<CandidateCardResponseDto>(await request('manager1', `/candidates/${target.id}/employee`, 'POST', body), 201);
        assert.equal(replay.employeeId, employee.id);
        assert.deepEqual(await snapshot(), after);
      }
      await revoke('convert_employee');
      await denied('manager1', `/candidates/${target.id}/employee`, 'POST', body);
      await denied('manager1', `/candidates/${control.id}/employee`, 'POST', { expectedVersion: control.version });
    }
    await reset();
  });

  await t.test('convert_employee needs Employee creation, persists one Employee without a User/assignment, and rechecks revoked retries', async () => {
    await reset();
    const object = await prisma.object.create({ data: {
      id: randomUUID(), name: `${marker}-conversion-object`, address: 'Isolated candidate conversion fixture',
      status: 'active', createdByUserId: users.get('founder')!,
    } });
    const target = await create('founder', [actorId, otherId], object.id);
    const control = await create('founder', [otherId], object.id);
    await rule('convert_employee', 'allow', 'selected', [target.id]);
    const body = { expectedVersion: target.version, employeeType: 'substitution' };
    await denied('manager1', `/candidates/${target.id}/employee`, 'POST', body);
    await rule('create', 'allow', 'all', [], 'manager1', 'employees');
    await denied('manager1', `/candidates/${control.id}/employee`, 'POST', { expectedVersion: control.version });
    await denied('manager1', `/candidates/${target.id}/employee`, 'POST', { ...body, expectedVersion: target.version + 1 }, 409);
    const before = await snapshot();
    const converted = await json<CandidateCardResponseDto>(await request('manager1', `/candidates/${target.id}/employee`, 'POST', body), 201);
    assert.ok(converted.employeeId);
    const after = await snapshot();
    assert.equal(after.employees.length, before.employees.length + 1);
    assert.deepEqual(after.userIds, before.userIds);
    assert.deepEqual(after.objectAssignments, before.objectAssignments);
    assert.deepEqual(after.employees.filter((item) => item.id !== converted.employeeId), before.employees);
    const employee = after.employees.find((item) => item.id === converted.employeeId)!;
    assert.equal(employee.fullName, target.fullName);
    assert.deepEqual(employee.phones, target.phones);
    assert.equal(employee.phone, target.phones[0]);
    assert.equal(employee.notes, target.comment);
    assert.equal(employee.employeeType, 'substitution');
    assert.deepEqual(employee.objectAssignments, []);
    assert.deepEqual(employee.objectAssignmentHistory, []);
    const stored = after.candidates.find((item) => item.id === target.id)!;
    assert.equal(stored.employeeId, employee.id);
    assert.equal(stored.status, 'accepted');
    assert.equal(stored.version, target.version + 1);
    assert.ok(stored.assignments.every((item) => item.endedAt && item.endedByUserId === actorId));
    assert.deepEqual(after.candidates.filter((item) => item.id !== target.id), before.candidates.filter((item) => item.id !== target.id));
    await audit(target.id, 'candidate.employee_created', 'manager1', before.audits.map((item) => item.id));
    const employeeAudits = after.audits.filter((item) => item.entityType === 'employee' && item.entityId === employee.id);
    assert.equal(employeeAudits.length, 1);
    assert.equal(employeeAudits[0].actorUserId, actorId);
    assert.equal(employeeAudits[0].action, 'employee.created');
    const replay = await json<CandidateCardResponseDto>(await request('manager1', `/candidates/${target.id}/employee`, 'POST', body), 201);
    assert.equal(replay.employeeId, employee.id);
    assert.deepEqual(await snapshot(), after);
    await revoke('convert_employee');
    await denied('manager1', `/candidates/${target.id}/employee`, 'POST', body);
    await rule('convert_employee', 'allow', 'selected', [target.id]);
    await rule('create', 'deny', 'all', [], 'manager1', 'employees');
    await denied('manager1', `/candidates/${target.id}/employee`, 'POST', body);
  });

  await t.test('create uses its declared all scope, persists author/audit, and access/view/manage denies beat leaf grants', async () => {
    await reset();
    await denied('manager1', '/candidates', 'POST', input());
    await rule('create', 'allow', 'all');
    const before = await snapshot();
    const created = await create('manager1');
    const after = await snapshot();
    assert.equal(after.candidates.length, before.candidates.length + 1);
    assert.equal(after.candidates.find((item) => item.id === created.id)?.createdByUserId, actorId);
    assert.equal(created.currentAssignments.length, 0);
    assert.equal(created.employeeId, null);
    await audit(created.id, 'candidate.created', 'manager1', before.audits.map((item) => item.id));
    await revoke('create');
    await denied('manager1', '/candidates', 'POST', input());
    await rule('create', 'deny', 'all');
    await denied('manager1', '/candidates', 'POST', input());
    await rule('create', 'allow', 'all');
    await rule('update', 'allow', 'all');
    for (const parent of ['manage', 'view', 'access']) {
      await rule(parent, 'deny', 'selected', [a.id]);
      await denied('manager1', `/candidates/${a.id}`, 'PATCH', { expectedVersion: await version(a.id), comment: 'Ancestor denied' });
      if (parent !== 'manage') await denied('manager1', `/candidates/${a.id}`, 'GET', undefined, 404);
      await revoke(parent);
    }
    for (const parent of ['manage', 'view']) {
      await rule(parent, 'deny', 'all');
      await denied('manager1', '/candidates', 'POST', input());
      await revoke(parent);
    }
    await rule('access', 'deny', 'all');
    await denied('manager1', '/candidates', 'POST', input());
    await denied('manager1', '/candidates?scope=all', 'GET', undefined);
    await revoke('access');
    await create('manager1');
  });

  await t.test('existing candidates.denied dominates every allow without removing the seeded negative permission', async () => {
    await reset();
    const archived = await create();
    await json(await request('hr1', `/candidates/${archived.id}/archive`, 'POST', { expectedVersion: archived.version }), 201);
    for (const login of ['stepanova', 'nikitina']) {
      const negative = await prisma.userPermission.findFirst({ where: { userId: users.get(login), permission: { code: 'candidates.denied' } } });
      assert.ok(negative, 'Exercise the existing seeded negative permission, not a synthetic deny rule');
      for (const action of actions.filter((item) => item.manageable)) {
        await rule(action.code.slice('candidates.'.length), 'allow', 'all', [], login);
      }
      await rule('create', 'allow', 'all', [], login, 'employees');
      for (const path of ['/candidates?scope=all', `/candidates/${a.id}`, '/candidates/references/managers']) {
        await denied(login, path, 'GET', undefined);
      }
      await denied(login, '/candidates', 'POST', input());
      for (const [suffix, method, payload] of [
        ['', 'PATCH', { comment: 'Denied edit' }], ['/status', 'POST', { status: 'in_progress' }],
        ['/archive', 'POST', {}], ['/assignments', 'POST', { managerUserIds: [actorId] }],
        ['/employee', 'POST', {}],
      ] as const) {
        await denied(login, `/candidates/${a.id}${suffix}`, method, { expectedVersion: await version(a.id), ...payload });
      }
      await denied(login, `/candidates/${a.id}/responses`, 'POST', { text: 'Denied feedback' });
      await denied(login, `/candidates/${archived.id}/restore`, 'POST', { expectedVersion: await version(archived.id) });
      const search = await json<{ items: Array<{ id: string; type: string }> }>(await request(login, `/search?q=${encodeURIComponent(a.fullName)}`), 200);
      assert.ok(!search.items.some((item) => item.type === 'candidate' && item.id === a.id));
      const recent = await json<Array<{ id: string }>>(await request(login, '/search/recent', 'POST', { refs: [{ type: 'candidate', id: a.id }] }), 200);
      assert.deepEqual(recent, []);
      await denied('hr1', `/candidates/${b.id}/assignments`, 'POST', { expectedVersion: await version(b.id), managerUserIds: [users.get(login)] }, 400);
      assert.ok(await prisma.userPermission.findUnique({ where: { id: negative.id } }));
    }
    await reset();
    // Runner owns and drops all fixtures; no shared-schema cleanup or execution here.
  });
});
