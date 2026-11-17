import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { ConflictException, ForbiddenException } from '@nestjs/common';

import { TasksService } from '../src/modules/tasks/tasks.service';
import type { AccessRule } from '../src/modules/users-access/types/access-policy.type';

type Operation = 'undo' | 'cancel' | 'add' | 'remove';
type Row = Record<string, unknown>;
type User = Parameters<TasksService['getTaskById']>[0];
const leaf = (operation: Operation) => operation === 'undo' ? 'tasks.completion.undo' : operation === 'cancel' ? 'tasks.cancel' : 'tasks.assignees.manage';
const rule = (actionCode: string, effect: 'allow' | 'deny', scope: AccessRule['scope'], selectedIds: string[] = []): AccessRule => ({ actionCode, effect, scope, selectedIds });
const record = (value: unknown): value is Row => value !== null && typeof value === 'object' && !Array.isArray(value);
// This is a controlled predicate interpreter, not SQL/HTTP/DB proof. The actual
// TasksService methods, scope builders, policy and domain assertions run as-is.
function matches(where: unknown, row: Row): boolean {
  assert.ok(record(where));
  return Object.entries(where).every(([key, value]) => {
    if (key === 'AND') return (Array.isArray(value) ? value : [value]).every((part) => matches(part, row));
    if (key === 'OR') { assert.ok(Array.isArray(value)); return value.some((part) => matches(part, row)); }
    if (key === 'NOT') return !(Array.isArray(value) ? value : [value]).some((part) => matches(part, row));
    const actual = row[key];
    if (!record(value)) return actual === value;
    if ('in' in value) { assert.ok(Array.isArray(value.in)); return value.in.includes(actual); }
    if ('not' in value) return actual !== value.not;
    if ('some' in value) { assert.ok(Array.isArray(actual)); return actual.some((child) => matches(value.some, child)); }
    return record(actual) && matches(value, actual);
  });
}

function fixture(operation: Operation, rules: AccessRule[], own = false) {
  const actor: User = { id: randomUUID(), login: 'actor', fullName: 'Actor', roleCode: 'manager', isActive: true, accessRules: rules };
  const otherId = randomUUID(), addId = randomUUID();
  const task = {
    id: 'task-a', title: 'Controlled task', createdByUserId: own ? actor.id : 'original-author',
    objectId: null as string | null, oneTimeOrderId: null as string | null, object: null, oneTimeOrder: null,
    status: operation === 'undo' ? 'awaiting_confirmation' : 'in_progress', workCycle: 1,
    requiresConfirmation: true, completionRequirement: 'comment_required', visibilityType: 'private',
    visibilityUsers: [{ userId: actor.id }],
    assignees: [
      { id: 'assignment-a', userId: actor.id, isActive: true, isCompleted: operation === 'undo', completions: operation === 'undo' ? [{ id: 'result-a', workCycle: 1, attemptNumber: 1, status: 'submitted' }] : [] },
      { id: 'assignment-b', userId: otherId, isActive: true, isCompleted: operation === 'undo', completions: operation === 'undo' ? [{ id: 'result-b', workCycle: 1, attemptNumber: 1, status: 'submitted' }] : [] },
    ],
  };
  const effects: string[] = [];
  const queries: Array<{ transaction: boolean; where: unknown }> = [];
  const reachedWrite = new Error('Reached first effect after authorization and domain invariants');
  let committed = false;
  let beforeTransaction: (() => void) | undefined;
  const sourceReads: Array<{ transaction: boolean; objectId: string | null; oneTimeOrderId: string | null }> = [];
  const readSource = (transaction: boolean) => {
    const source = { objectId: task.objectId, oneTimeOrderId: task.oneTimeOrderId };
    sourceReads.push({ transaction, ...source });
    return source;
  };
  const firstEffect = async () => { effects.push('attempt'); throw reachedWrite; };
  const tx = {
    $queryRaw: async () => [{ id: task.id }],
    task: { findUnique: async (query: { select: Record<string, unknown> }) =>
      Object.keys(query.select).length === 2 ? readSource(true) : task, findFirst: async ({ where }: { where: unknown }) => {
      queries.push({ transaction: true, where });
      return matches(where, task) ? { id: task.id } : null;
    }, update: firstEffect },
    taskAssignee: { create: firstEffect, update: firstEffect },
    taskAssigneeCompletion: { update: firstEffect, updateMany: firstEffect },
  };
  const database = {
    user: { count: async () => 1 },
    task: { findUnique: async (query: unknown) => {
      assert.deepEqual(query, { where: { id: task.id }, select: { objectId: true, oneTimeOrderId: true } });
      return readSource(false);
    }, findFirst: async ({ where }: { where: unknown }) => {
      queries.push({ transaction: false, where });
      return matches(where, task) ? { id: task.id } : null;
    } },
    $transaction: async (work: (client: typeof tx) => Promise<unknown>) => { beforeTransaction?.(); const result = await work(tx); committed = true; return result; },
  };
  const service = new TasksService(database as never, {} as never, {} as never, {} as never);
  const internals = service as unknown as { taskActionWhere(user: User, code: string): unknown };
  const invoke = () => operation === 'undo' ? service.undoMyCompletion(actor, task.id)
    : operation === 'cancel' ? service.cancelTask(actor, task.id, { reason: 'Authorized reason' })
      : operation === 'add' ? service.addAssignees(actor, task.id, { userIds: [addId] })
        : service.removeAssignee(actor, task.id, otherId);
  return { actor, task, service, internals, effects, queries, sourceReads, reachedWrite, invoke, isCommitted: () => committed,
    setBeforeTransaction: (callback: () => void) => { beforeTransaction = callback; } };
}

for (const operation of ['undo', 'cancel', 'add', 'remove'] as const) {
  for (const scope of ['own', 'assigned', 'selected', 'all'] as const) {
    test(`${operation}: task read ${scope} deny dominates leaf allow inside caller transaction before any effect`, async () => {
      const f = fixture(operation, [rule(leaf(operation), 'allow', 'all'), rule('tasks.read', 'deny', scope, ['task-a'])], scope === 'own');
      const before = structuredClone(f.task);
      assert.equal(matches(f.internals.taskActionWhere(f.actor, leaf(operation)), f.task), true, 'The original leaf-only predicate cannot enforce tasks.read denial');
      await assert.rejects(f.invoke(), ForbiddenException);
      assert.equal(f.queries.length, 1, 'No post-commit DTO query is used as admission');
      assert.equal(f.queries[0].transaction, true);
      assert.deepEqual(f.sourceReads, [
        { transaction: false, objectId: null, oneTimeOrderId: null },
        { transaction: true, objectId: null, oneTimeOrderId: null },
      ]);
      assert.deepEqual(f.effects, []);
      assert.equal(f.isCommitted(), false);
      assert.deepEqual(f.task, before);
    });
  }

  test(`${operation}: changed source after preflight is rejected inside the transaction before any effect`, async () => {
    const f = fixture(operation, [rule(leaf(operation), 'allow', 'all')]);
    f.setBeforeTransaction(() => { f.task.objectId = 'new-source'; });
    await assert.rejects(f.invoke(), ConflictException);
    assert.deepEqual(f.sourceReads, [
      { transaction: false, objectId: null, oneTimeOrderId: null },
      { transaction: true, objectId: 'new-source', oneTimeOrderId: null },
    ]);
    assert.deepEqual(f.queries, []);
    assert.deepEqual(f.effects, []);
    assert.equal(f.isCommitted(), false);
  });

  test(`${operation}: default read plus a valid leaf allow still reaches the original domain mutation`, async () => {
    const f = fixture(operation, [rule(leaf(operation), 'allow', 'all')]);
    await assert.rejects(f.invoke(), (error) => error === f.reachedWrite);
    assert.deepEqual(f.effects, ['attempt']);
  });

  test(`${operation}: read allow cannot replace a denied leaf`, async () => {
    const f = fixture(operation, [rule('tasks.read', 'allow', 'all'), rule(leaf(operation), 'deny', 'selected', ['task-a'])]);
    await assert.rejects(f.invoke(), ForbiddenException);
    assert.deepEqual(f.effects, []);
  });

  test(`${operation}: a leaf grant alone cannot open a task outside positive read visibility`, async () => {
    const f = fixture(operation, [rule(leaf(operation), 'allow', 'all')]);
    f.task.visibilityUsers = [];
    for (const assignment of f.task.assignees) if (assignment.userId === f.actor.id) assignment.isActive = false;
    assert.equal(matches(f.internals.taskActionWhere(f.actor, leaf(operation)), f.task), true);
    await assert.rejects(f.invoke(), ForbiddenException);
    assert.deepEqual(f.effects, []);
  });
}

test('central read guard preserves active assignee and terminal-task invariants', async () => {
  const rules = [rule('tasks.read', 'allow', 'all'), rule('tasks.completion.undo', 'allow', 'all')];
  const inactive = fixture('undo', rules);
  inactive.task.assignees[0].isActive = false;
  await assert.rejects(inactive.invoke(), ForbiddenException);
  assert.deepEqual(inactive.effects, []);
  for (const operation of ['undo', 'cancel', 'add'] as const) {
    const f = fixture(operation, [rule('tasks.read', 'allow', 'all'), rule(leaf(operation), 'allow', 'all')]);
    f.task.status = 'completed';
    await assert.rejects(f.invoke(), ConflictException);
    assert.deepEqual(f.effects, []);
  }
});

test('central read guard does not permit removing the last active assignee', async () => {
  const f = fixture('remove', [rule('tasks.read', 'allow', 'all'), rule('tasks.assignees.manage', 'allow', 'all')]);
  f.task.assignees[0].isActive = false;
  await assert.rejects(f.invoke(), ConflictException);
  assert.deepEqual(f.effects, []);
});
