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
