import assert from 'node:assert/strict';
import test from 'node:test';
import { completeTaskCreation } from './complete-task-creation.ts';

const payload = { title: 'Task', priority: 'important_not_urgent', assigneeUserIds: ['user'], visibilityType: 'private', requiresConfirmation: true, completionRequirement: 'comment_or_file', dueDate: '2026-11-10', dueTime: null };

test('upload failure and restored draft retry never recreate task and retain exact File refs', async () => {
  const files = [new File(['one'], 'one.txt'), new File(['two'], 'two.txt')];
  let receipt = { createdTaskId: null, createdPayload: null, completed: false };
  let creates = 0;
  let uploads = 0;
  const dependencies = {
    create: async () => { creates++; return { id: 'created-task' }; },
    persist: (value) => { receipt = value; },
    upload: async (id, nextFiles) => {
      assert.equal(receipt.createdTaskId, 'created-task');
      assert.equal(id, 'created-task');
      assert.equal(nextFiles, files);
      assert.equal(nextFiles[0], files[0]);
      return ++uploads === 1 ? [{ status: 'fulfilled' }, { status: 'rejected' }] : [{ status: 'fulfilled' }, { status: 'fulfilled' }];
    },
  };
  await assert.rejects(completeTaskCreation(payload, files, receipt, dependencies), /не все вложения/);
  assert.equal(receipt.completed, false);
  assert.equal(await completeTaskCreation(payload, files, { ...receipt }, dependencies), 'created-task');
  assert.equal(creates, 1);
  assert.equal(uploads, 2);
  await completeTaskCreation(payload, files, receipt, dependencies);
  assert.equal(uploads, 2);
});

test('changed fields after a confirmed create cannot silently create or upload again', async () => {
  const receipt = { createdTaskId: 'existing', createdPayload: JSON.stringify(payload), completed: false };
  let called = false;
  await assert.rejects(completeTaskCreation({ ...payload, title: 'Changed' }, [], receipt, {
    create: async () => { called = true; return { id: 'duplicate' }; },
    upload: async () => { called = true; return []; },
    persist: () => { called = true; },
  }), /Задача уже создана/);
  assert.equal(called, false);
});

for (const mode of ['minimal-ack', 'late-access-generation']) test(`known committed create ${mode} stops before upload and cannot create again`, async () => {
  let receipt = { createdTaskId: null, createdPayload: null, completed: false };
  let creates = 0, uploads = 0;
  const dependencies = {
    create: async () => { creates++; return mode === 'minimal-ack' ? { outcome: 'saved_without_access' } : { id: 'private-created-id' }; },
    isCurrent: () => mode !== 'late-access-generation',
    upload: async () => { uploads++; return []; },
    persist: (next) => { receipt = next; },
  };
  const ack = await completeTaskCreation(payload, [new File(['private'], 'private.txt')], receipt, dependencies);
  assert.deepEqual(ack, { outcome: 'saved_without_access' });
  assert.deepEqual(receipt, { createdTaskId: null, createdPayload: null, completed: true });
  assert.deepEqual(await completeTaskCreation(payload, [], receipt, dependencies), ack);
  assert.equal(creates, 1);
  assert.equal(uploads, 0);
});

import { readFileSync } from 'node:fs';
import ts from 'typescript';

test('actual create ACK dialog clears private draft and supplies the real clearDraft consumer', async () => {
  const slots = []; let cursor = 0; const once = new Set();
  const React = {
    createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = initial; return [slots[i], value => { slots[i] = typeof value === 'function' ? value(slots[i]) : value; }]; },
    useRef(initial) { return slots[cursor++] ??= { current: initial }; },
    useEffect(effect) { const i = cursor++; if (!once.has(i)) { once.add(i); effect(); } },
  }; React.default = React;
  let creates = 0, uploads = 0, reads = 0, cleared = 0, navigated = 0;
  const emptyForm = { title: '', objectId: '', oneTimeOrderId: '' };
  const draft = {
    value: { form: { ...emptyForm, title: 'Private entered title' }, files: [new File(['private'], 'private.txt')], createdTaskId: null, createdPayload: null, completed: false, pending: false },
    submitting: false, dirty: true,
    setValue(next) { draft.value = typeof next === 'function' ? next(draft.value) : next; },
    setDirty(next) { draft.dirty = next; },
    async submit(operation) { return operation(); },
    clear() { cleared++; draft.value = { form: emptyForm, files: [], createdTaskId: null, createdPayload: null, completed: false, pending: false }; draft.dirty = false; },
    clearAfterNavigation() { throw Error('ACK has no private destination ID'); },
  };
  const exports = {}, primitives = new Proxy({}, { get: (_, key) => key });
  const mocks = {
    react: React,
    'next/navigation': { useRouter: () => ({ push() { navigated++; } }) },
    '@/shared/auth/use-auth': { useAuth: () => ({ user: { id: 'actor-a', capabilities: { canCreateTask: true, canUploadFile: true } } }) },
    '@/shared/auth/access-generation': { getAccessGeneration: () => 1, isAccessGenerationCurrent: value => value === 1 },
    '@/shared/drafts': { useCreateDraft: () => draft },
    '@/shared/create-navigation': { useCreateNavigation: () => ({ getTargetSearchParams: () => new URLSearchParams(), closeContext: () => ({}) }) },
    '@/entities/object/api/object-client': { listObjects: async () => [] },
    '@/entities/one-time-order/api/one-time-order-client': { listOneTimeOrders: async () => ({ items: [] }) },
    '@/entities/user/api/user-client': { listSystemUsers: async () => [] },
    '@/entities/task/api/task-client': { createTask: async () => { creates++; return { outcome: 'saved_without_access' }; }, getTaskById: async () => { reads++; throw Error('ACK must not reread'); } },
    '@/entities/file/api/file-client': { uploadFileBatch: async () => { uploads++; return []; } },
    '@/features/task-form/ui/task-form': { TaskForm: 'TaskForm', EMPTY_TASK_VALUE: emptyForm },
    '../model/complete-task-creation': { completeTaskCreation },
  };
  const source = ts.transpileModule(readFileSync(new URL('../ui/task-create-dialog.tsx', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React } }).outputText;
  new Function('require', 'exports', source)(name => mocks[name] ?? primitives, exports);
  const render = () => { cursor = 0; return exports.TaskCreateDialog(); };
  render(); await new Promise(resolve => setImmediate(resolve));
  let tree = render(); const form = tree.props.children.flat(Infinity).find(child => child?.type === 'TaskForm');
  await form.props.onSubmit(payload, draft.value.files);
  tree = render();
  assert.equal(tree.props.title, 'Задача сохранена');
  assert.equal(tree.props.clearDraft, draft.clear);
  assert.equal(tree.props.dirty, false);
  assert.equal(cleared, 1); assert.equal(creates, 1); assert.equal(uploads, 0); assert.equal(reads, 0); assert.equal(navigated, 0);
  assert.deepEqual(draft.value.files, []); assert.equal(draft.value.form.title, '');
  tree.props.clearDraft(); assert.equal(cleared, 2); assert.equal(creates, 1);
});
