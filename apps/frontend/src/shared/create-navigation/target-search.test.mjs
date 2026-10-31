import test from 'node:test';
import assert from 'node:assert/strict';
import { createTargetSearch } from './target-search.ts';

test('captured empty target never inherits manager/date/copy filters from the retained registry', () => {
  const target = createTargetSearch({ targetSearch: '' }, 'managerUserId=background&date=2026-11-01&copyFrom=background');
  assert.equal(target.size, 0);
});

test('explicit calendar and copy context survives; only missing capture falls back to direct URL', () => {
  const query = 'managerUserId=calendar&date=2026-11-03&copyFrom=order-1';
  for (const target of [createTargetSearch({ targetSearch: query }, 'managerUserId=background'), createTargetSearch(undefined, query)]) {
    assert.equal(target.get('managerUserId'), 'calendar');
    assert.equal(target.get('date'), '2026-11-03');
    assert.equal(target.get('copyFrom'), 'order-1');
  }
});
