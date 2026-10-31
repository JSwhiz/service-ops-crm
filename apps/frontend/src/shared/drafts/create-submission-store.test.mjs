import test from 'node:test';
import assert from 'node:assert/strict';
import { CreateSubmissionStore } from './create-submission-store.ts';
import { createDraftKey } from './create-draft-key.ts';

const key = createDraftKey('u1', '/employees/new', 'q=Test', 'employee-create');

test('pending POST survives subscriber unmount/reopen and settles without a mounted consumer', async () => {
  const store = new CreateSubmissionStore();
  let resolve;
  let posts = 0;
  const unsubscribe = store.subscribe(() => {});
  const first = store.run(key, () => { posts++; return new Promise((done) => { resolve = done; }); });
  unsubscribe(); // native Back unmounts the original form; Forward gets the same store/key.
  assert.equal(store.isPending(key), true);
  await assert.rejects(store.run(key, async () => { posts++; }), /уже выполняется/);
  assert.equal(posts, 1);
  resolve('employee-id');
  assert.equal(await first, 'employee-id');
  assert.equal(store.isPending(key), false);
});

test('failure releases lock without effect cleanup; independent user/form/path/query keys remain independent', async () => {
  const store = new CreateSubmissionStore();
  let reject;
  const first = store.run(key, () => new Promise((_, fail) => { reject = fail; }));
  for (const other of [
    createDraftKey('u2', '/employees/new', 'q=Test', 'employee-create'),
    createDraftKey('u1', '/tasks/new', 'q=Test', 'employee-create'),
    createDraftKey('u1', '/employees/new', 'q=Other', 'employee-create'),
    createDraftKey('u1', '/employees/new', 'q=Test', 'other-form'),
  ]) assert.equal(await store.run(other, async () => 'independent'), 'independent');
  reject(new Error('known failure'));
  await assert.rejects(first, /known failure/);
  assert.equal(store.isPending(key), false);
  assert.equal(await store.run(key, async () => 'retry'), 'retry');
});

test('completed task receipt survives failed navigation and clears only at committed success destination', () => {
  const store = new CreateSubmissionStore();
  const file = new File(['retry'], 'retained.txt');
  const initial = { completed: false, createdTaskId: null, files: [] };
  let draft = { completed: true, createdTaskId: 'task-1', files: [file] };
  store.observePathname('/tasks/new');
  store.clearAfterNavigation('task-key', '/tasks/task-1', () => { draft = initial; });
  store.observePathname('/tasks'); // Back is not the proven successful transition.
  store.observePathname('/tasks/new');
  assert.equal(draft.completed, true);
  assert.equal(draft.files[0], file);
  store.observePathname('/tasks/task-1');
  store.observePathname('/tasks/new');
  assert.equal(draft, initial);
  assert.equal(draft.completed, false);
  draft = { ...initial, files: [file] };
  store.observePathname('/tasks/task-1');
  assert.equal(draft.files[0], file); // completion callback is one-shot, not a future draft eraser.
});

test('explicit draft discard cancels delayed completion and never erases a later draft', () => {
  const store = new CreateSubmissionStore();
  let erased = false;
  store.clearAfterNavigation('task-key', '/tasks/old', () => { erased = true; });
  store.cancelCompletion('task-key');
  store.observePathname('/tasks/old');
  assert.equal(erased, false);
});
