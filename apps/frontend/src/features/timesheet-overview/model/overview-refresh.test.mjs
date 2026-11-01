import assert from 'node:assert/strict';
import test from 'node:test';
import { getOverviewRefreshState } from './overview-refresh.ts';

test('successful mutation → refetch retains the matrix identity while blocking another correction', () => {
  const data = { rows: [{ employeeId: 'employee', entries: [{ finalValue: 1000 }] }] };
  const snapshot = { data, scope: 'object:employee:2026-11', revision: 0 };
  assert.equal(getOverviewRefreshState(snapshot, snapshot.scope, 0, false).mutationsBlocked, false);
  const refreshing = getOverviewRefreshState(snapshot, snapshot.scope, 1, true);
  assert.equal(refreshing.overview, data);
  assert.equal(refreshing.mutationsBlocked, true);
  // A successful write has its own local success state; the same grid stays mounted.
  const settledBeforeFreshResponse = getOverviewRefreshState(snapshot, snapshot.scope, 1, false);
  assert.equal(settledBeforeFreshResponse.overview, data);
  assert.equal(settledBeforeFreshResponse.mutationsBlocked, true);
});

test('a failed read cannot unlock stale amounts; only the requested fresh revision unlocks them', () => {
  const old = { data: { finalValue: 1000 }, scope: 'same-scope', revision: 1 };
  assert.equal(getOverviewRefreshState(old, old.scope, 2, false).mutationsBlocked, true);
  const fresh = { ...old, data: { finalValue: 1200 }, revision: 2 };
  assert.equal(getOverviewRefreshState(fresh, fresh.scope, 2, true).mutationsBlocked, true);
  assert.deepEqual(getOverviewRefreshState(fresh, fresh.scope, 2, false), { overview: fresh.data, mutationsBlocked: false });
});

test('changing employee/object/period never exposes the retained previous scope', () => {
  const old = { data: { finalValue: 1000 }, scope: 'first-scope', revision: 0 };
  assert.deepEqual(getOverviewRefreshState(old, 'second-scope', 0, false), { overview: null, mutationsBlocked: true });
  assert.deepEqual(getOverviewRefreshState(null, 'first-scope', 0, true), { overview: null, mutationsBlocked: true });
});
