import assert from 'node:assert/strict';
import test from 'node:test';

import {
  canEditObject,
  canEditObjectDailyRate,
  canOverrideObjectAttendanceRate,
} from '../src/modules/objects/utils/object-access.util';

test('deputy director can manage rates without joining leadership or gaining core edit', () => {
  const roles = ['deputy_director'];

  assert.equal(canEditObjectDailyRate(roles), true);
  assert.equal(canEditObject(roles), false);
  assert.equal(canOverrideObjectAttendanceRate(roles), false);
});

test('managers cannot manage compensation profiles or attendance rate overrides', () => {
  const roles = ['manager'];

  assert.equal(canEditObjectDailyRate(roles), false);
  assert.equal(canEditObject(roles), false);
  assert.equal(canOverrideObjectAttendanceRate(roles), false);
});

test('canonical leadership roles retain compensation management', () => {
  for (const role of ['founder', 'deputy_founder', 'director', 'corporate_director']) {
    assert.equal(canEditObjectDailyRate([role]), true, role);
  }
});
