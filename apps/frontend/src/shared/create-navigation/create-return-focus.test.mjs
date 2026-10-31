import assert from 'node:assert/strict';
import test from 'node:test';
import { canRestoreCreateFocus, selectCreateReturnFocus } from './create-return-focus.ts';

test('focus waits for the exact background query and for modal removal', () => {
  const target = '/user-absences?month=2030-01';
  assert.equal(canRestoreCreateFocus(target, 'http://localhost/counterparties/new?month=2030-01', false), false);
  assert.equal(canRestoreCreateFocus(target, 'http://localhost/user-absences?month=2026-10', false), false);
  assert.equal(canRestoreCreateFocus(target, 'http://localhost/user-absences?month=2030-01', true), false);
  assert.equal(canRestoreCreateFocus(target, 'http://localhost/user-absences?month=2030-01', false), true);
});
test('connected opener wins; an unmounted menu item falls back to global create', () => {
  const usable = (node) => node.connected;
  const global = { connected: true, name: 'global +' };
  const opener = { connected: true, name: 'registry create' };
  assert.equal(selectCreateReturnFocus(opener, null, global, usable), opener);
  assert.equal(selectCreateReturnFocus({ connected: false }, null, global, usable), global);
  assert.equal(selectCreateReturnFocus({ connected: false }, opener, global, usable), opener);
});
