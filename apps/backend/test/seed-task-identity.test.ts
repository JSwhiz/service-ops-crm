import assert from 'node:assert/strict';
import test from 'node:test';
import { isUUID } from 'class-validator';
import { chooseDemoTaskId, FRESH_DEMO_TASK_ID, LEGACY_DEMO_TASK_ID } from '../prisma/seed-task-identity';
test('fresh seed chooses a UUID accepted by selected access DTO', () => {
  assert.equal(chooseDemoTaskId(null), FRESH_DEMO_TASK_ID);
  assert.equal(isUUID(chooseDemoTaskId(null), 'all'), true);
});
test('repeated fresh seed keeps the same task identity without making another ID', () => {
  const first = chooseDemoTaskId(null);
  const repeated = chooseDemoTaskId(null);
  assert.equal(repeated, first);
});
test('legacy schema keeps its existing identity and does not create a replacement', () => {
  assert.equal(chooseDemoTaskId(LEGACY_DEMO_TASK_ID), LEGACY_DEMO_TASK_ID);
  assert.notEqual(chooseDemoTaskId(LEGACY_DEMO_TASK_ID), FRESH_DEMO_TASK_ID);
  // Legacy API selection remains a documented gap, not a silently repaired row.
  assert.equal(isUUID(chooseDemoTaskId(LEGACY_DEMO_TASK_ID), 'all'), false);
});
