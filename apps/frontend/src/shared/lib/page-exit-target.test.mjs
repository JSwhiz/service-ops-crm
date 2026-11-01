import assert from 'node:assert/strict';
import test from 'node:test';

import { getPageExitTarget } from './page-exit-target.ts';

const current = 'https://crm.example/one-time-orders/42?section=overview';

test('accepts same-origin route, query, and hash navigation targets', () => {
  assert.equal(getPageExitTarget('/one-time-orders/43', current), '/one-time-orders/43');
  assert.equal(getPageExitTarget('?section=history', current), '/one-time-orders/42?section=history');
  assert.equal(getPageExitTarget('#payments', current), '/one-time-orders/42?section=overview#payments');
});

test('does not require confirmation for the same location or external destination', () => {
  assert.equal(getPageExitTarget(current, current), null);
  assert.equal(getPageExitTarget('https://other.example/path', current), null);
});

test('rejects malformed URLs without throwing', () => {
  assert.equal(getPageExitTarget('http://[invalid', current), null);
});
