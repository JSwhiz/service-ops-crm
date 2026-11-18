import assert from 'node:assert/strict';
import test from 'node:test';
import { objectArchiveCounts, parseObjectArchiveState } from './object-registry-archive.ts';

test('registry starts in active, preserves explicit archive and old archived status links', () => {
  assert.equal(parseObjectArchiveState(null), 'active');
  assert.equal(parseObjectArchiveState('invalid'), 'active');
  assert.equal(parseObjectArchiveState('archived'), 'archived');
  assert.equal(parseObjectArchiveState(null, 'archived'), 'archived');
  assert.equal(parseObjectArchiveState('active', 'archived'), 'active');
});

test('full filtered result counts frozen as operational, not archived; no page-sized count', () => {
  assert.deepEqual(objectArchiveCounts([{ status: 'frozen' }, { status: 'active' }, { status: 'archived' }, { status: 'archived' }]), { active: 2, archived: 2 });
  assert.deepEqual(objectArchiveCounts([]), { active: 0, archived: 0 });
});
