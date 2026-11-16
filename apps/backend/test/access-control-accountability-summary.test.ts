import assert from 'node:assert/strict';
import test from 'node:test';

import type { AccessRule, AccessSubject } from '../src/modules/users-access/types/access-policy.type';
import { summarizeAccess } from '../src/modules/users-access/utils/access-summary.util';

const subject: AccessSubject = { id: 'actor', roleCode: 'director', isActive: true };
const allow: AccessRule = { actionCode: 'accountability.issue_cash', effect: 'allow', scope: 'selected', selectedIds: ['A', 'B'] };
const baseline = { allowed: false, scopes: [] };

test('accountability summary excludes a read-denied target from a separate issue grant and keeps the control', () => {
  const result = summarizeAccess({ ...subject, accessRules: [allow, {
    actionCode: 'accountability.read', effect: 'deny', scope: 'selected', selectedIds: ['A'],
  }] }, 'accountability.issue_cash', baseline);
  assert.deepEqual(result.selectedIds, ['B']);
  assert.equal(result.allowed, true);
});

test('accountability summary blocks an all-read denial but does not require a new positive read grant', () => {
  assert.equal(summarizeAccess({ ...subject, accessRules: [allow] }, 'accountability.issue_cash', baseline).allowed, true);
  const denied = summarizeAccess({ ...subject, accessRules: [allow, {
    actionCode: 'accountability.read', effect: 'deny', scope: 'all', selectedIds: [],
  }] }, 'accountability.issue_cash', baseline);
  assert.equal(denied.allowed, false);
  assert.equal(denied.blocked, true);
});

test('accountability summary preserves the leadership restriction and the composed read-summary behavior', () => {
  assert.equal(summarizeAccess({ ...subject, roleCode: 'manager', accessRules: [allow] }, 'accountability.issue_cash', baseline).allowed, false);
  const readSummary = summarizeAccess({ ...subject, accessRules: [{
    actionCode: 'accountability.read', effect: 'deny', scope: 'all', selectedIds: [],
  }] }, 'accountability.order_summary.read', { allowed: true, scopes: ['all'] });
  assert.equal(readSummary.allowed, true, 'The order summary endpoint may still return its permitted empty projection');
});
