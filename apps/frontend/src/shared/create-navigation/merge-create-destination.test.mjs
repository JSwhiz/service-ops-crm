import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeCreateDestination } from './merge-create-destination.ts';
import { getPageExitTarget } from '../lib/page-exit-target.ts';

test('keeps source search first so retained registry readers keep their filters', () => {
  const result = mergeCreateDestination(
    '/orders/new?managerUserId=target&copyFrom=123',
    'https://crm.test/orders?status=planned&managerUserId=registry&page=3',
  );
  assert.ok(result);
  const url = new URL(result.href, 'https://crm.test');
  assert.equal(url.searchParams.get('status'), 'planned');
  assert.equal(url.searchParams.get('managerUserId'), 'registry');
  assert.deepEqual(url.searchParams.getAll('managerUserId'), ['registry', 'target']);
  assert.equal(new URLSearchParams(result.targetSearch).get('managerUserId'), 'target');
  assert.equal(result.href, '/orders/new?status=planned&managerUserId=registry&page=3&managerUserId=target&copyFrom=123');
});

test('preserves source query exactly when the create URL has no contextual query', () => {
  const result = mergeCreateDestination('/counterparties/new', 'https://crm.test/counterparties?q=a%20b&slash=%2f&plus=a+b&page=2');
  assert.ok(result);
  assert.equal(result.href, '/counterparties/new?q=a%20b&slash=%2f&plus=a+b&page=2');
  assert.equal(result.targetSearch, '');
});

test('rejects external and malformed destinations', () => {
  assert.equal(mergeCreateDestination('https://other.test/new', 'https://crm.test/list'), null);
  assert.equal(mergeCreateDestination('//other.test/new', 'https://crm.test/list'), null);
});

test('accepts only safe same-origin return targets and retains the exact query', () => {
  const current = 'https://crm.test/counterparties/new?status=active';
  assert.equal(
    getPageExitTarget('/counterparties?q=a%20b&status=archived', current),
    '/counterparties?q=a%20b&status=archived',
  );
  assert.equal(getPageExitTarget('https://other.test/counterparties', current), null);
  assert.equal(getPageExitTarget('//other.test/counterparties', current), null);
  assert.equal(getPageExitTarget('javascript:alert(1)', current), null);
  assert.equal(getPageExitTarget('http://[invalid', current), null);
});
