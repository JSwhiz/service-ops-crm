import test from 'node:test';
import assert from 'node:assert/strict';
import { createDraftKey } from './create-draft-key.ts';

test('isolates drafts by authenticated user, pathname, and query', () => {
  const base = createDraftKey('user-a', '/objects/new', 'source=registry&page=2', 'object');
  assert.notEqual(base, createDraftKey('user-b', '/objects/new', 'source=registry&page=2', 'object'));
  assert.notEqual(base, createDraftKey('user-a', '/employees/new', 'source=registry&page=2', 'object'));
  assert.notEqual(base, createDraftKey('user-a', '/objects/new', 'source=registry&page=3', 'object'));
  assert.notEqual(base, createDraftKey('user-a', '/objects/new', 'source=registry&page=2', 'another-form'));
});

test('length-prefixes route parts to prevent delimiter collisions', () => {
  assert.notEqual(
    createDraftKey('a::b', '/c', 'd', 'e'),
    createDraftKey('a', 'b::/c', 'd', 'e'),
  );
});
