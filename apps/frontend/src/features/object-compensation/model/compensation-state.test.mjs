import assert from 'node:assert/strict';
import test from 'node:test';
import { effectiveCompensationVersion, expectedCompensationVersion } from './compensation-state.ts';

const version = (id, version, effectiveFrom, extra = {}) => ({ id, version, effectiveFrom, scope: 'contour', scopeId: 'day', terms: { ratePolicyType: 'monthly_fixed', baseAmount: 20000 }, cancelledAt: null, ...extra });

test('current terms respect operation date, scope and cancellation without rewriting the list', () => {
  const rows = [version('future', 3, '2026-12-01'), version('other-line', 9, '2026-11-01', { scopeId: 'night' }), version('cancelled', 4, '2026-11-02', { cancelledAt: '2026-11-01T00:00:00Z' }), version('current', 2, '2026-11-01'), version('old', 1, '2026-10-01')];
  const order = rows.map((v) => v.id);
  assert.equal(effectiveCompensationVersion(rows, 'contour', 'day', '2026-11-03')?.id, 'current');
  assert.equal(effectiveCompensationVersion(rows, 'contour', 'day', '2026-12-01')?.id, 'future');
  assert.equal(effectiveCompensationVersion(rows, 'contour', 'day', '2026-10-15')?.id, 'old');
  assert.equal(effectiveCompensationVersion(rows, 'defaults', 'day', '2026-11-03'), undefined);
  assert.deepEqual(rows.map((v) => v.id), order);
});

test('expected revision includes cancelled and future versions, independently of the displayed current terms', () => {
  const rows = [version('current', 1, '2026-11-01'), version('cancelled', 5, '2027-01-01', { cancelledAt: '2026-11-03T00:00:00Z' }), version('other', 10, '2026-11-01', { scopeId: 'night' })];
  assert.equal(expectedCompensationVersion(rows, 'contour', 'day'), 5);
  assert.equal(expectedCompensationVersion(rows, 'defaults', 'object'), 0);
  assert.equal(effectiveCompensationVersion(rows, 'contour', 'day', '2026-11-03')?.version, 1);
});
