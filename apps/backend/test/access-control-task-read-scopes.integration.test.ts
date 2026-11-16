import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import test from 'node:test';
import { PrismaClient } from '@prisma/client';

import type { TaskListResponseDto, TaskResponseDto } from '../src/modules/tasks/dto/task-response.dto';
import type { TaskHistoryEventResponseDto } from '../src/modules/tasks/dto/task-history-response.dto';
import { TASK_LEADERSHIP_ROLE_CODES } from '../src/modules/tasks/utils/task-access.util';
import { ACCESS_ACTION_CATALOG } from '../src/modules/users-access/access-action-catalog';
import type { AccessChange, AccessScope } from '../src/modules/users-access/types/access-policy.type';
import { loginAndGetCookieHeader } from './helpers/auth';
import { createTestApp } from './helpers/create-test-app';
import { usesIsolatedIntegrationDatabase } from './helpers/isolated-database';

const codes = ['tasks.access', 'tasks.read', 'tasks.history'] as const;
const scopes: AccessScope[] = ['own', 'assigned', 'selected', 'all'];
const labels = ['A', 'B', 'C', 'D'] as const;
type Label = typeof labels[number];
type TaskSet = { prefix: string; actorId: string; rows: Record<Label, TaskResponseDto> };
const ordinaryProfiles = [
  ['manager1', 'manager123', 'manager'], ['hr1', 'hr123', 'hr'],
  ['berendyakov', 'berendyakov123', 'operation_manager'], ['deputy1', 'deputy123', 'deputy_director'],
] as const;
const wideProfiles = [
  ['founder', 'founder123', 'founder'], ['director', 'director123', 'director'],
  ['stepanova', 'stepanova123', 'deputy_founder'], ['nikitina', 'nikitina123', 'corporate_director'],
] as const;

// Main's serial isolated runner only. All tasks are private, unlinked and
// synthetic: owner A != assignee B != nonmember C/control D. Real founder
// preview/save/default is exercised for manager1; other canonical role controls
// use explicit schema-local ACL rows, NOT claimed as admin API coverage.
test('task read scopes preserve legacy membership, add nonmembers explicitly and filter before pagination', { timeout: 360_000 }, async (t) => {
  assert.equal(usesIsolatedIntegrationDatabase(), true);
  const db = new URL(process.env.DATABASE_URL!);
  assert.ok(['postgres:', 'postgresql:'].includes(db.protocol));
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(db.hostname));
  assert.equal(db.port, '55432');
  assert.match(db.searchParams.get('schema') ?? '', /^integration_\d+_\d+$/);
  assert.ok(['localhost', '127.0.0.1', '::1'].includes(process.env.MINIO_ENDPOINT ?? ''));
  assert.equal(process.env.MINIO_USE_SSL, 'false');
  for (const code of codes) {
    const definition = ACCESS_ACTION_CATALOG.find(action => action.code === code);
    assert.ok(definition); assert.equal(definition.manageable, true); assert.equal(definition.resourceType, 'task');
    assert.deepEqual(definition.allowedScopes, scopes);
  }
  assert.deepEqual([...TASK_LEADERSHIP_ROLE_CODES].sort(), wideProfiles.map(profile => profile[2]).sort());
  const prisma = new PrismaClient();
  const lifecycle: { close?: () => Promise<void> } = {};
  t.after(async () => { try { await lifecycle.close?.(); } finally { await prisma.$disconnect(); } });
  const { app, baseUrl } = await createTestApp(); lifecycle.close = () => app.close();
  const marker = `task-read-scopes-${randomUUID()}`;
  const users = new Map<string, string>(), cookies = new Map<string, string>();
  for (const [login, password, role] of [...ordinaryProfiles, ...wideProfiles, ['manager2', 'manager123', 'manager'] as const]) {
    const user = await prisma.user.findUniqueOrThrow({ where: { login }, include: { roles: { include: { role: true } } } });
    assert.equal(user.isActive, true); assert.deepEqual(user.roles.map(entry => entry.role.code), [role]);
    assert.equal(await prisma.userAccessRule.count({ where: { userId: user.id } }), 0);
    users.set(login, user.id); cookies.set(login, await loginAndGetCookieHeader({ baseUrl, login, password }));
  }
  const actorId = users.get('manager1')!, founderId = users.get('founder')!, performerId = users.get('manager2')!;
  // These recipient cookies never change during allow/deny/default/revoke.
  const request = (login: string, path: string, method = 'GET', body?: unknown) => fetch(`${baseUrl}/api/v1${path}`, {
    method, redirect: 'error', headers: { Cookie: cookies.get(login)!, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(25_000),
  });
  const json = async <T,>(response: Response, status = 200): Promise<T> => {
    const text = await response.text(); assert.equal(response.status, status, text); return JSON.parse(text) as T;
  };
  const identities = () => prisma.user.findMany({ where: { id: { in: [...users.values()] } }, orderBy: { id: 'asc' },
    select: { id: true, login: true, isActive: true,
      roles: { orderBy: { roleId: 'asc' }, select: { roleId: true } },
      permissions: { orderBy: { permissionId: 'asc' }, select: { permissionId: true } } } });
  const originalIdentities = await identities();
  const capture = async () => ({
    tasks: await prisma.task.findMany({ where: { title: { startsWith: marker } }, orderBy: { id: 'asc' }, include: {
      assignees: { orderBy: { id: 'asc' }, include: { completions: { orderBy: { id: 'asc' } } } },
      visibilityUsers: { orderBy: { id: 'asc' } }, historyEvents: { orderBy: { id: 'asc' } },
    } }),
    audit: await prisma.auditEvent.findMany({ orderBy: { id: 'asc' } }),
    notifications: await prisma.notification.findMany({ orderBy: { id: 'asc' } }),
    attachments: await prisma.fileAttachment.findMany({ where: { entityType: { in: ['task', 'task_assignee_completion'] } }, orderBy: { id: 'asc' } }),
    approvals: await prisma.approvalRequest.findMany({ where: { sourceEntityType: 'task' }, orderBy: { id: 'asc' } }),
    identities: await identities(),
  });
  const access = async () => ({
    version: (await prisma.user.findUniqueOrThrow({ where: { id: actorId }, select: { accessVersion: true } })).accessVersion,
    rules: await prisma.userAccessRule.findMany({ where: { userId: actorId }, select: { actionCode: true, effect: true, scope: true, selectedIds: true }, orderBy: { actionCode: 'asc' } }),
    audit: await prisma.userAccessAudit.findMany({ where: { userId: actorId }, orderBy: { id: 'asc' } }),
  });
  const change = (actionCode: typeof codes[number], effect: AccessChange['effect'], scope: AccessScope = 'all', selectedIds: string[] = []): AccessChange => {
    assert.ok(ACCESS_ACTION_CATALOG.find(action => action.code === actionCode)?.allowedScopes.includes(scope));
    assert.equal(selectedIds.length > 0, scope === 'selected');
    return { actionCode, effect, scope, ...(scope === 'selected' ? { selectedIds: [...selectedIds].sort() } : {}) };
  };
  const admin = async (changes: AccessChange[]) => {
    const before = await capture(), state = await access();
    const endpoint = `/users-access/admin/users/${actorId}`;
    const normalized = [...changes].sort((a, b) => a.actionCode.localeCompare(b.actionCode)).map(entry => ({ ...entry, selectedIds: entry.selectedIds ?? [] }));
    const payload = { expectedVersion: state.version, reason: marker, changes };
    const preview = await json<{ previewToken: string; previewHash: string; changes: AccessChange[] }>(await request('founder', `${endpoint}/preview`, 'POST', payload), 201);
    assert.deepEqual(preview.changes, normalized); assert.deepEqual(await capture(), before);
    const saved = await json<{ accessVersion: number }>(await request('founder', `${endpoint}/save`, 'POST', { ...payload, previewToken: preview.previewToken, previewHash: preview.previewHash }), 201);
    const after = await access();
    assert.equal(saved.accessVersion, state.version + 1); assert.equal(after.version, saved.accessVersion);
    const expected = new Map(state.rules.map(entry => [entry.actionCode, entry]));
    for (const entry of normalized) {
      if (entry.effect === 'default') expected.delete(entry.actionCode); else expected.set(entry.actionCode, { ...entry });
    }
    assert.deepEqual(after.rules, [...expected.values()].sort((a, b) => a.actionCode.localeCompare(b.actionCode)));
    const audits = after.audit.filter(entry => !state.audit.some(({ id }) => id === entry.id));
    assert.equal(audits.length, 1); assert.deepEqual(after.audit.filter(entry => state.audit.some(({ id }) => id === entry.id)), state.audit);
    assert.equal(audits[0].actorUserId, founderId); assert.equal(audits[0].userId, actorId);
    assert.equal(audits[0].versionBefore, state.version); assert.equal(audits[0].versionAfter, saved.accessVersion);
    assert.equal(audits[0].reason, marker); assert.equal(audits[0].previewHash, preview.previewHash);
    assert.deepEqual(audits[0].changes, normalized); assert.deepEqual(audits[0].before, state.rules); assert.deepEqual(audits[0].after, after.rules);
    const consumed = await prisma.userAccessPreview.findUniqueOrThrow({ where: { tokenHash: createHash('sha256').update(JSON.stringify(preview.previewToken)).digest('hex') } });
    assert.ok(consumed.usedAt); assert.equal(consumed.userId, actorId); assert.equal(consumed.actorUserId, founderId);
    assert.deepEqual(await capture(), before, 'Admin preview/save changes ACL only, never membership, task history or business events');
  };
  const reset = async () => {
    const state = await access();
    if (state.rules.length) await admin(state.rules.map(rule => {
      assert.ok(codes.includes(rule.actionCode as typeof codes[number]));
      return change(rule.actionCode as typeof codes[number], 'default');
    }));
  };
  const sets = new Map<string, TaskSet>();
  for (const [login] of ordinaryProfiles) {
    const prefix = `${marker}-${login}-`;
    const rows = {} as Record<Label, TaskResponseDto>;
    for (const label of labels) rows[label] = await json<TaskResponseDto>(await request(label === 'A' ? login : 'founder', '/tasks', 'POST', {
      title: `${prefix}${label}`, description: 'Private unlinked isolated task read-scope control',
      priority: 'important_not_urgent', dueDate: '2040-01-15', visibilityType: 'private', visibleUserIds: [],
      assigneeUserIds: [label === 'B' ? users.get(login)! : performerId],
    }), 201);
    sets.set(login, { prefix, rows, actorId: users.get(login)! });
  }
  const initialBusiness = await capture();
  for (const set of sets.values()) for (const label of labels) {
    const row = initialBusiness.tasks.find(task => task.id === set.rows[label].id)!;
    assert.equal(row.createdByUserId, label === 'A' ? set.actorId : founderId);
    assert.equal(row.objectId, null); assert.equal(row.oneTimeOrderId, null); assert.equal(row.visibilityType, 'private');
    assert.equal(row.scopeType, 'personal'); assert.deepEqual(row.visibilityUsers, []);
    assert.deepEqual(row.assignees.map(entry => [entry.userId, entry.isActive]), [[label === 'B' ? set.actorId : performerId, true]]);
    assert.equal(row.historyEvents.length, 1); assert.equal(row.historyEvents[0].eventType, 'task.created');
  }
  const expectedHistory = async (id: string): Promise<TaskHistoryEventResponseDto[]> => (await prisma.taskHistoryEvent.findMany({
    where: { taskId: id }, include: { actor: true }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  })).map(event => ({ id: event.id, eventType: event.eventType, payload: event.payload, createdAt: event.createdAt.toISOString(),
    actor: event.actor ? { id: event.actor.id, login: event.actor.login, fullName: event.actor.fullName } : null }));
  const assertReads = async (login: string, set: TaskSet, readable: readonly Label[], historyReadable: readonly Label[]) => {
    const before = await capture();
    const sorted = labels.filter(label => readable.includes(label));
    const expectedIds = sorted.map(label => set.rows[label].id);
    const query = new URLSearchParams({ q: set.prefix, sortBy: 'title', sortDirection: 'asc', status: 'in_progress' });
    const plain = await json<TaskResponseDto[]>(await request(login, `/tasks?${query}`));
    assert.deepEqual(plain.map(row => row.id), expectedIds);
    // Both pages and an empty overflow page must count the ACL-filtered set,
    // rather than filtering an already-paginated broader result in memory.
    for (const page of [1, 2, 3]) {
      const result = await json<TaskListResponseDto>(await request(login, `/tasks?${query}&page=${page}&limit=2`));
      assert.equal(result.page, page); assert.equal(result.limit, 2);
      assert.equal(result.total, sorted.length); assert.equal(result.totalPages, Math.ceil(sorted.length / 2));
      assert.deepEqual(result.items.map(row => row.id), expectedIds.slice((page - 1) * 2, page * 2));
    }
    for (const [filter, expected] of [['createdByMe', sorted.filter(label => label === 'A')], ['assignedToMe', sorted.filter(label => label === 'B')]] as const) {
      // Wide-role checks use manager1's set: their ownership differs, and is
      // derived from persisted facts rather than inferred from label A/B.
      const actual = initialBusiness.tasks.filter(row => expectedIds.includes(row.id) && (filter === 'createdByMe'
        ? row.createdByUserId === users.get(login) : row.assignees.some(entry => entry.isActive && entry.userId === users.get(login))));
      if (users.get(login) === set.actorId) assert.deepEqual(actual.map(row => row.id).sort(), expected.map(label => set.rows[label].id).sort());
      const result = await json<TaskListResponseDto>(await request(login, `/tasks?${query}&${filter}=true&page=1&limit=1`));
      const ids = labels.map(label => set.rows[label].id).filter(id => actual.some(row => row.id === id));
      assert.equal(result.total, ids.length); assert.equal(result.totalPages, ids.length);
      assert.deepEqual(result.items.map(row => row.id), ids.slice(0, 1));
    }
    for (const label of labels) {
      const id = set.rows[label].id;
      const response = await request(login, `/tasks/${id}`);
      if (readable.includes(label)) assert.equal((await json<TaskResponseDto>(response)).id, id);
      else assert.equal(response.status, 404, await response.text());
      const history = await request(login, `/tasks/${id}/history`);
      if (historyReadable.includes(label)) assert.deepEqual(await json<TaskHistoryEventResponseDto[]>(history), await expectedHistory(id));
      else assert.equal(history.status, readable.includes(label) ? 403 : 404, await history.text());
    }
    assert.deepEqual(await capture(), before, 'All detail/list/count/history reads preserve exact tasks, memberships, history, audit, notifications and identities');
  };
  const manager = sets.get('manager1')!;
  const baseline: Label[] = ['A', 'B'];
  const mask = (scope: AccessScope): Label[] => scope === 'own' ? ['A'] : scope === 'assigned' ? ['B'] : scope === 'selected' ? ['A', 'C'] : [...labels];
  const add = (scope: AccessScope) => labels.filter(label => baseline.includes(label) || mask(scope).includes(label));
  const subtract = (from: readonly Label[], scope: AccessScope) => from.filter(label => !mask(scope).includes(label));
  const selectedIds = (scope: AccessScope) => scope === 'selected' ? [manager.rows.A.id, manager.rows.C.id] : [];

  await t.test('canonical manager/HR/operation_manager/deputy_director default to membership; selected/all independently add private nonmember C', async () => {
    for (const [login] of ordinaryProfiles) {
      const set = sets.get(login)!;
      await assertReads(login, set, baseline, baseline);
      if (login === 'manager1') continue; // Its real admin sequence is below.
      const userId = users.get(login)!;
      const clear = () => prisma.userAccessRule.deleteMany({ where: { userId, actionCode: { in: [...codes] } } });
      try {
        for (const scope of ['selected', 'all'] as const) {
          const before = await capture();
          for (const actionCode of ['tasks.read', 'tasks.history']) await prisma.userAccessRule.upsert({
            where: { userId_actionCode: { userId, actionCode } },
            create: { userId, actionCode, effect: 'allow', scope, selectedIds: scope === 'selected' ? [set.rows.C.id] : [] },
            update: { effect: 'allow', scope, selectedIds: scope === 'selected' ? [set.rows.C.id] : [] },
          });
          assert.deepEqual(await capture(), before);
          const visible: Label[] = scope === 'selected' ? ['A', 'B', 'C'] : [...labels];
          await assertReads(login, set, visible, visible);
        }
        await clear(); await assertReads(login, set, baseline, baseline);
      } finally { await clear(); }
    }
  });
  await t.test('root positive grant is not read or history membership; selected read/history independently widen private C without exposing D', async () => {
    try {
      for (const scope of ['selected', 'all'] as const) {
        await admin([change('tasks.access', 'allow', scope, selectedIds(scope))]);
        await assertReads('manager1', manager, baseline, baseline);
      }
      await admin([change('tasks.read', 'allow', 'selected', [manager.rows.C.id])]);
      await assertReads('manager1', manager, ['A', 'B', 'C'], baseline);
      await admin([change('tasks.history', 'allow', 'selected', [manager.rows.C.id])]);
      await assertReads('manager1', manager, ['A', 'B', 'C'], ['A', 'B', 'C']);
      await admin([change('tasks.read', 'default')]);
      await assertReads('manager1', manager, baseline, baseline);
    } finally { await reset(); }
  });
  for (const code of codes) for (const scope of scopes) await t.test(`${code} ${scope}: real founder allow/deny/default keeps the original cookie and broader legacy baseline`, async () => {
    try {
      // Isolate the tested leaf: history tests preallow reading all four, while
      // read/root tests preallow history so failures cannot be its missing leaf.
      if (code === 'tasks.access') await admin([change('tasks.read', 'allow'), change('tasks.history', 'allow')]);
      if (code === 'tasks.read') await admin([change('tasks.history', 'allow')]);
      if (code === 'tasks.history') await admin([change('tasks.read', 'allow')]);
      await admin([change(code, 'allow', scope, selectedIds(scope))]);
      const visible = code === 'tasks.read' ? add(scope) : [...labels];
      await assertReads('manager1', manager, visible, code === 'tasks.history' ? add(scope) : visible);
      await admin([change(code, 'deny', scope, selectedIds(scope))]);
      const deniedRead = code === 'tasks.access' ? subtract(labels, scope) : code === 'tasks.read' ? subtract(baseline, scope) : [...labels];
      await assertReads('manager1', manager, deniedRead, code === 'tasks.history' ? subtract(baseline, scope) : deniedRead);
      await admin([change(code, 'default')]);
      const defaultRead = code === 'tasks.read' ? baseline : [...labels];
      await assertReads('manager1', manager, defaultRead, code === 'tasks.history' ? baseline : defaultRead);
    } finally { await reset(); }
  });
  await t.test('all four canonical leadership roles retain wide legacy rows under selected grants, and obey all denies/default', async () => {
    for (const [login] of wideProfiles) {
      const userId = users.get(login)!;
      const clear = () => prisma.userAccessRule.deleteMany({ where: { userId, actionCode: { in: [...codes] } } });
      try {
        await assertReads(login, manager, labels, labels);
        for (const code of codes) {
          const set = (effect: 'allow' | 'deny', scope: 'selected' | 'all') => prisma.userAccessRule.upsert({
            where: { userId_actionCode: { userId, actionCode: code } },
            create: { userId, actionCode: code, effect, scope, selectedIds: scope === 'selected' ? selectedIds(scope) : [] },
            update: { effect, scope, selectedIds: scope === 'selected' ? selectedIds(scope) : [] },
          });
          const before = await capture(); await set('allow', 'selected'); assert.deepEqual(await capture(), before);
          await assertReads(login, manager, labels, labels);
          await set('deny', 'all');
          await assertReads(login, manager, code === 'tasks.history' ? labels : [], []);
          await clear(); await assertReads(login, manager, labels, labels);
        }
      } finally { await clear(); }
    }
  });
  assert.deepEqual(await capture(), initialBusiness, 'No grant, deny, default or read fabricated membership or rewrote any task/event');
  assert.deepEqual(await identities(), originalIdentities);
  // Limits: unlinked interactive HTTP only; no source/delegation, lifecycle,
  // browser/socket or notification-delivery acceptance. Own/assigned positive
  // rules overlap real legacy memberships: scope/additivity evidence, not an
  // invented forbidden baseline or proof of widening those memberships.
});
