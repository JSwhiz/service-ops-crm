import 'reflect-metadata';
import assert from 'node:assert/strict';
import test from 'node:test';

import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';

import { TasksService } from '../src/modules/tasks/tasks.service';
import type { TaskResponseDto } from '../src/modules/tasks/dto/task-response.dto';
import type { TaskCompletionAttachmentDto } from '../src/modules/tasks/dto/task-completion-response.dto';
import type { AccessRule } from '../src/modules/users-access/types/access-policy.type';

type Row = Record<string, unknown>;
type Actor = Parameters<TasksService['getTaskById']>[0];
type Internals = {
  loadCompletionFiles(user: Actor, taskId: string, ids: string[]): Promise<Map<string, TaskCompletionAttachmentDto[]>>;
  taskActionWhere(user: Actor, code: string): unknown;
  assertTaskAction(client: unknown, user: Actor, taskId: string, code: string): Promise<void>;
};
const date = new Date('2040-01-01T00:00:00Z');
const rule = (actionCode: string, scope: AccessRule['scope'] = 'all', selectedIds: string[] = [], effect: AccessRule['effect'] = 'deny'): AccessRule => ({ actionCode, scope, selectedIds, effect });
const actor = (rules: AccessRule[] = []): Actor => ({ id: 'reader', login: 'reader', fullName: 'Reader', roleCode: 'manager', isActive: true, accessRules: rules });
const record = (value: unknown): value is Row => value !== null && typeof value === 'object' && !Array.isArray(value);
// Controlled predicate evaluation, NOT Prisma SQL truth. Real policy builders
// and resourceAccessTarget run unchanged; no client/socket/application is opened.
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
    if ('is' in value) return record(actual) && matches(value.is, actual);
    return record(actual) && matches(value, actual);
  });
}

function metadataFixture() {
  const calls = { files: 0, taskContext: 0, objectContext: 0, orderContext: 0, pages: 0, counts: 0 };
  const task = {
    id: 'task', createdByUserId: 'task-author', objectId: 'object', oneTimeOrderId: 'order',
    assignees: [{ userId: 'reader', isActive: true }], visibilityUsers: [] as Array<{ userId: string }>,
  };
  const object = { id: 'object', createdByUserId: 'object-author', assignments: [{ userId: 'reader', isActive: true }] };
  const order = { id: 'order', createdByUserId: 'order-author', assignments: [{ userId: 'reader', assignmentRoleCode: 'one_time_manager', isActive: true }] };
  const related = (): Row => ({ ...task, object, oneTimeOrder: order });
  let missingTarget = false;
  const rows = [
    { entityId: 'completion-a', file: { id: 'file-own', uploadedByUserId: 'reader', originalName: 'own-secret.txt', mimeType: 'text/plain', sizeBytes: 3, createdAt: date } },
    { entityId: 'completion-b', file: { id: 'file-other', uploadedByUserId: 'different-uploader', originalName: 'other-secret.txt', mimeType: 'text/plain', sizeBytes: 5, createdAt: date } },
  ];
  const completions = rows.map((row) => ({ id: row.entityId, workCycle: 1, attemptNumber: 1, status: 'submitted', completionText: 'Visible result text', submittedAt: date, cancelledAt: null, cancellationReason: null, taskAssignee: { user: { id: 'reader', login: 'reader', fullName: 'Reader' } } }));
  const dto = () => ({ id: task.id, assignees: completions.map((row) => ({ id: 'reader', currentCompletion: { id: row.id, attachments: [] } })), myAssignment: { currentCompletion: { id: 'completion-a', attachments: [] } } } as unknown as TaskResponseDto);
  const db = {
    task: {
      findFirst: async ({ where }: { where: unknown }) => matches(where, related()) ? { id: task.id } : null,
      findUnique: async (query: { select: { assignees: { where: { isActive: boolean } } } }) => {
        calls.taskContext++;
        assert.equal(query.select.assignees.where.isActive, true);
        return missingTarget ? null : { ...task, assignees: task.assignees.filter((row) => row.isActive) };
      },
    },
    object: { findFirst: async () => { calls.objectContext++; return object; } },
    oneTimeOrder: { findUnique: async () => { calls.orderContext++; return order; } },
    fileAttachment: { findMany: async (query: { where: { entityId: { in: string[] }; file: { deletedAt: null } }; select: { file: { select: { uploadedByUserId: boolean } } } }) => {
      calls.files++;
      assert.equal(query.where.file.deletedAt, null);
      assert.equal(query.select.file.select.uploadedByUserId, true);
      return rows.filter((row) => query.where.entityId.in.includes(row.entityId));
    } },
    taskAssigneeCompletion: {
      findMany: async (query: { skip: number; take: number }) => { calls.pages++; assert.equal(query.skip, 2); assert.equal(query.take, 2); return completions; },
      count: async () => { calls.counts++; return 5; },
    },
    $transaction: async (work: Array<Promise<unknown>>) => Promise.all(work),
  };
  const service = new TasksService(db as never, {} as never, {} as never, {} as never);
  // Only the unrelated base DTO mapper is stubbed. Public GET and pagination
  // execute the actual attachment loader, canonical context and policy helper.
  Object.assign(service, { mapTasksWithDraftCapability: async () => [dto()] });
  return { service, internals: service as unknown as Internals, calls, task, rows, setMissing: () => { missingTarget = true; } };
}

const fileCases: Array<{ name: string; rules: AccessRule[]; expected: string[]; assigned?: boolean }> = [
  { name: 'legacy default', rules: [], expected: ['file-own', 'file-other'] },
  { name: 'selected file read deny', rules: [rule('files.read', 'selected', ['file-own'])], expected: ['file-other'] },
  { name: 'selected file root deny beats read all', rules: [rule('files.read', 'all', [], 'allow'), rule('files.access', 'selected', ['file-other'])], expected: ['file-own'] },
  { name: 'own matches actual uploader, not task author', rules: [rule('files.read', 'own')], expected: ['file-other'] },
  { name: 'assigned uses canonical source membership, not uploader', rules: [rule('files.read', 'assigned')], expected: [] },
  { name: 'uploader ownership alone is not source assignment', rules: [rule('files.read', 'assigned')], expected: ['file-own', 'file-other'], assigned: false },
  { name: 'all file read deny', rules: [rule('files.read')], expected: [] },
  { name: 'all file root deny', rules: [rule('files.access')], expected: [] },
  ...['tasks.access', 'tasks.read', 'objects.access', 'objects.read', 'one_time_orders.access', 'one_time_orders.read'].map((code) => ({ name: `${code} real ancestor deny`, rules: [rule('files.read', 'all', [], 'allow'), rule(code, 'selected', [code.startsWith('tasks.') ? 'task' : code.startsWith('objects.') ? 'object' : 'order'])], expected: [] })),
  { name: 'unrelated parent selection does not hide files', rules: [rule('objects.read', 'selected', ['other-object'])], expected: ['file-own', 'file-other'] },
];
for (const entry of fileCases) {
  test(`nested files current GET and paginated results: ${entry.name}`, async () => {
    const f = metadataFixture();
    if (entry.assigned === false) f.task.assignees = [];
    const user = actor(entry.rules);
    // Ancestor denied rows cannot pass GET's own SQL read. Test the attachment
    // loader separately to establish its independent canonical ancestor filter.
    const parentDenied = entry.name.includes('ancestor deny');
    const detail = parentDenied
      ? await f.internals.loadCompletionFiles(user, 'task', ['completion-a', 'completion-b'])
      : await f.service.getTaskById(user, 'task');
    if (detail instanceof Map) assert.equal(detail.size, 0);
    else {
      assert.deepEqual(detail.assignees.flatMap((row) => row.currentCompletion!.attachments.map((file) => file.id)), entry.expected);
      assert.deepEqual(detail.myAssignment!.currentCompletion!.attachments.map((file) => file.id), entry.expected.includes('file-own') ? ['file-own'] : []);
      assert.equal(JSON.stringify(detail).includes('uploadedByUserId'), false);
    }
    if (!parentDenied) {
      const page = await f.service.listTaskCompletions(user, 'task', { page: 2, limit: 2 });
      assert.deepEqual(page.items.flatMap((row) => row.attachments.map((file) => file.id)), entry.expected);
      assert.equal(page.total, 5);
      assert.equal(page.page, 2);
      assert.equal(page.totalPages, 3);
      assert.ok(page.items.every((row) => row.completionText === 'Visible result text'));
      assert.equal(JSON.stringify(page).includes('uploadedByUserId'), false);
      for (const row of f.rows.filter((row) => !entry.expected.includes(row.file.id))) {
        assert.equal(JSON.stringify({ detail, page }).includes(row.file.id), false);
        assert.equal(JSON.stringify({ detail, page }).includes(row.file.originalName), false);
      }
    }
  });
}

test('completion file context resolves once for a batch, fails closed if target disappears, and skips empty batches', async () => {
  const f = metadataFixture();
  for (let i = 0; i < 100; i++) f.rows.push({ entityId: 'completion-a', file: { ...f.rows[0].file, id: `extra-${i}` } });
  const result = await f.internals.loadCompletionFiles(actor(), 'task', ['completion-a', 'completion-b']);
  assert.equal([...result.values()].flat().length, 102);
  assert.deepEqual({ files: f.calls.files, task: f.calls.taskContext, object: f.calls.objectContext, order: f.calls.orderContext }, { files: 1, task: 1, object: 1, order: 1 });
  const before = { ...f.calls };
  assert.equal((await f.internals.loadCompletionFiles(actor(), 'task', [])).size, 0);
  assert.deepEqual(f.calls, before);
  f.setMissing();
  assert.equal((await f.internals.loadCompletionFiles(actor(), 'task', ['completion-a'])).size, 0);
});

for (const scope of ['own', 'assigned', 'selected', 'all'] as const) {
  test(`/completions requires tasks.history ${scope} before page/count/file queries despite positive task read`, async () => {
    const f = metadataFixture();
    if (scope === 'own') f.task.createdByUserId = 'reader';
    await assert.rejects(f.service.listTaskCompletions(actor([rule('tasks.read', 'all', [], 'allow'), rule('tasks.history', scope, ['task'])]), 'task', { page: 2, limit: 2 }), ForbiddenException);
    assert.deepEqual(f.calls, { files: 0, taskContext: 0, objectContext: 0, orderContext: 0, pages: 0, counts: 0 });
    const restored = await f.service.listTaskCompletions(actor(), 'task', { page: 2, limit: 2 });
    assert.equal(restored.total, 5);
  });
}

function mutationFixture(rules: AccessRule[], owner = 'author') {
  const writes: string[] = [];
  const queries: Array<{ transaction: boolean; code: string }> = [];
  const calls = { transactions: 0 };
  let beforeTransaction: (() => void) | undefined;
  const task = {
    id: 'task', title: 'Task', status: 'in_progress', workCycle: 1, createdByUserId: owner,
    objectId: null as string | null, oneTimeOrderId: null as string | null, object: null, oneTimeOrder: null, visibilityType: 'private', visibilityUsers: [{ userId: 'reader' }],
    requiresConfirmation: true, completionRequirement: 'comment_required',
    assignees: [{ id: 'assignment', userId: 'reader', isActive: true, isCompleted: false, completions: [] as Array<{ id: string; workCycle: number; status: string }> }],
  };
  const findFirst = async ({ where }: { where: unknown }) => matches(where, task) ? { id: task.id } : null;
  const sourceReads: Array<{ transaction: boolean; objectId: string | null; oneTimeOrderId: string | null }> = [];
  const readSource = (transaction: boolean) => {
    const source = { objectId: task.objectId, oneTimeOrderId: task.oneTimeOrderId };
    sourceReads.push({ transaction, ...source });
    return source;
  };
  const tx = {
    $queryRaw: async () => [{ id: 'task' }],
    task: { findUnique: async (query: { select: Record<string, unknown> }) =>
      Object.keys(query.select).length === 2 ? readSource(true) : task, findFirst },
    taskAssigneeCompletion: { create: async () => { writes.push('completion'); throw new Error('unexpected write'); } },
  };
  const db = {
    task: { findFirst, findUnique: async (query: unknown) => {
      assert.deepEqual(query, { where: { id: task.id }, select: { objectId: true, oneTimeOrderId: true } });
      return readSource(false);
    } },
    user: { findFirst: async ({ where }: { where: { id: string } }) => {
      assert.equal(where.id, 'reader');
      return { id: 'reader', isActive: true, accessVersion: 1, accessRules: rules,
        roles: [{ role: { code: 'manager', permissions: [] } }], permissions: [] };
    } },
    userSubstitution: { findMany: async () => [] },
    taskAssigneeCompletion: { findFirst: async ({ where }: { where: unknown }) => {
      const drafts = task.assignees.flatMap((assignment) => assignment.completions.map((completion) => ({
        ...completion, taskAssignee: { ...assignment, taskId: task.id, task },
      })));
      const draft = drafts.find((completion) => matches(where, completion));
      return draft ? { id: draft.id } : null;
    } },
    $transaction: async (work: (client: typeof tx) => Promise<unknown>) => {
    calls.transactions++;
    beforeTransaction?.();
    return work(tx);
  } };
  const service = new TasksService(db as never, {} as never, {} as never, {} as never);
  const internals = service as unknown as Internals;
  const assertAction = internals.assertTaskAction.bind(service);
  Object.assign(service, { assertTaskAction: async (client: unknown, user: Actor, id: string, code: string) => {
    queries.push({ transaction: client === tx, code });
    await assertAction(client, user, id, code);
  } });
  const user = actor(rules);
  const invoke = (operation: 'draft' | 'submit' | 'result', completionId?: string) => operation === 'draft'
    ? service.createCompletionDraft(user, 'task') : operation === 'result'
      ? service.submitResult(user, 'task', { resultText: 'Result' })
      : service.completeMyAssignment(user, 'task', { completionText: 'Result', completionId });
  return { service, internals, user, task, writes, queries, sourceReads, calls, invoke,
    setBeforeTransaction: (callback: () => void) => { beforeTransaction = callback; } };
}

for (const operation of ['draft', 'submit', 'result'] as const) {
  for (const scope of ['own', 'assigned', 'selected', 'all'] as const) {
    test(`${operation}: real task read predicate denies ${scope} ${operation === 'result' ? 'at compatibility preflight' : 'inside transaction'} before any completion effect`, async () => {
      const leaf = operation === 'draft' ? 'tasks.completion.draft' : 'tasks.completion.submit';
      const f = mutationFixture([rule(leaf, 'all', [], 'allow'), rule('tasks.result.submit', 'all', [], 'allow'), rule('tasks.read', scope, ['task'])], scope === 'own' ? 'reader' : 'author');
      assert.equal(matches(f.internals.taskActionWhere(f.user, leaf), f.task), true, 'Leaf-only legacy predicate is insufficient to enforce the separate read deny');
      await assert.rejects(f.invoke(operation), ForbiddenException);
      if (operation === 'result') {
        assert.deepEqual(f.queries, [{ transaction: false, code: 'tasks.result.submit' }]);
        assert.equal(f.calls.transactions, 0, 'The central read intersection rejects compatibility preflight without opening a transaction');
      } else {
        assert.ok(f.queries.some((entry) => entry.transaction && entry.code === 'tasks.read'));
        assert.equal(f.calls.transactions, 1);
      }
      assert.deepEqual(f.sourceReads, operation === 'result' ? [] : [
        { transaction: false, objectId: null, oneTimeOrderId: null },
        { transaction: true, objectId: null, oneTimeOrderId: null },
      ]);
      assert.deepEqual(f.writes, []);
      assert.equal(f.task.status, 'in_progress');
      assert.equal(f.task.workCycle, 1);
    });
  }
  test(`${operation}: read/leaf all grants do not replace a real active assignment or allow closed tasks`, async () => {
    const rules = ['tasks.read', 'tasks.result.submit', 'tasks.completion.draft', 'tasks.completion.submit'].map((code) => rule(code, 'all', [], 'allow'));
    const unassigned = mutationFixture(rules);
    unassigned.task.assignees = [];
    await assert.rejects(unassigned.invoke(operation), ForbiddenException);
    assert.deepEqual(unassigned.writes, []);
    const closed = mutationFixture(rules);
    closed.task.status = 'completed';
    await assert.rejects(closed.invoke(operation), ConflictException);
    assert.deepEqual(closed.writes, []);
  });
}

test('compatibility result allows preflight but rechecks changed assignment read context inside the transaction', async () => {
  const f = mutationFixture([
    rule('tasks.result.submit', 'all', [], 'allow'),
    rule('tasks.completion.submit', 'all', [], 'allow'),
    rule('tasks.read', 'assigned'),
  ]);
  // Visibility membership supplies real positive read at preflight; the read
  // deny starts matching only after another operation activates an assignment.
  // This is a controlled context transition, not a claim of a SQL race proof.
  f.task.assignees[0].isActive = false;
  assert.equal(matches(f.internals.taskActionWhere(f.user, 'tasks.read'), f.task), true);
  f.setBeforeTransaction(() => { f.task.assignees[0].isActive = true; });
  await assert.rejects(f.invoke('result'), ForbiddenException);
  assert.equal(f.calls.transactions, 1);
  assert.deepEqual(f.queries, [
    { transaction: false, code: 'tasks.result.submit' },
    { transaction: true, code: 'tasks.read' },
  ]);
  assert.equal(matches(f.internals.taskActionWhere(f.user, 'tasks.read'), f.task), false);
  assert.deepEqual(f.writes, []);
  assert.deepEqual(f.task.assignees[0].completions, []);
  assert.equal(f.task.status, 'in_progress');
  assert.equal(f.task.workCycle, 1);
});

test('compatibility result rechecks its own leaf and completion.submit in the locked transaction', async () => {
  const f = mutationFixture([]);
  const stop = new Error('after guards, before any effect');
  Object.assign(f.service, { getCurrentAssignment: () => { throw stop; } });
  await assert.rejects(f.invoke('result'), (error) => error === stop);
  assert.deepEqual(f.queries, [
    { transaction: false, code: 'tasks.result.submit' },
    { transaction: true, code: 'tasks.read' },
    { transaction: true, code: 'tasks.result.submit' },
    { transaction: true, code: 'tasks.completion.submit' },
  ]);
  assert.deepEqual(f.writes, []);
});

test('read guard does not bypass draft retry identity or old workCycle validation', async () => {
  const f = mutationFixture([]);
  f.task.assignees[0].completions.push({ id: 'retained-draft', workCycle: 1, status: 'draft' });
  assert.deepEqual(await f.invoke('draft'), { id: 'retained-draft', workCycle: 1 });
  assert.deepEqual(f.writes, []);
  f.task.assignees[0].completions[0].workCycle = 0;
  await assert.rejects(f.invoke('submit', 'retained-draft'), BadRequestException);
  assert.deepEqual(f.writes, []);
});

for (const field of ['objectId', 'oneTimeOrderId'] as const) {
  test(`completion draft: a changed ${field} between source preflight and lock stops before ACL/domain effects`, async () => {
    const f = mutationFixture([]);
    f.setBeforeTransaction(() => { f.task[field] = 'new-source'; });
    await assert.rejects(f.invoke('draft'), ConflictException);
    assert.equal(f.calls.transactions, 1);
    assert.equal(f.sourceReads[0][field], null, 'Preflight is an immutable source snapshot');
    assert.equal(f.sourceReads[1][field], 'new-source');
    assert.deepEqual(f.queries, []);
    assert.deepEqual(f.writes, []);
    assert.deepEqual(f.task.assignees[0].completions, []);
  });
}
