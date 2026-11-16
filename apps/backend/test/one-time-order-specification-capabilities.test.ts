import assert from 'node:assert/strict';
import test from 'node:test';
import { buildOneTimeOrderCapabilities } from '../src/modules/one-time-orders/utils/one-time-order-capabilities.util';
import type { AccessRule, AccessSubject } from '../src/modules/users-access/types/access-policy.type';

// Pure projection only: no app, Prisma client, HTTP, storage or database.
const actor = 'actor';
const rule = (actionCode: string, effect: 'allow' | 'deny', selectedIds = ['A']): AccessRule => ({ actionCode, effect, scope: 'selected', selectedIds });
const project = (rules: AccessRule[] = [], id = 'A', assigned = true, status = 'in_progress', roles = ['manager'], active = true) => {
  const subject: AccessSubject = { id: actor, roleCodes: roles, permissionCodes: [], isActive: active, accessRules: rules };
  return buildOneTimeOrderCapabilities({ subject, currentUserId: actor, roleCodes: roles, order: {
    id, createdByUserId: actor, status,
    assignments: [{ userId: actor, assignmentRoleCode: 'one_time_manager', isActive: assigned }],
  } });
};
const cases = [
  ['one_time_orders.specification.execute', 'canManageSpecification'],
  ['one_time_orders.specification.comments', 'canCommentSpecification'],
  ['one_time_orders.specification.detach', 'canDetachSpecificationFiles'],
] as const;
for (const [action, flag] of cases) {
  test(`${action}: selected denial is independent, live regrant/default preserve A/B assigned baseline`, () => {
    const baseline = project();
    assert.equal(baseline[flag], true);
    const denied = project([rule(action, 'deny')]);
    for (const [, other] of cases) assert.equal(denied[other], other !== flag);
    assert.equal(project([rule(action, 'deny')], 'B')[flag], true);
    assert.equal(project([rule(action, 'allow')])[flag], true);
    assert.equal(project()[flag], true, 'Removing an explicit grant restores the assigned baseline, not a synthetic deny');
    for (const gate of ['one_time_orders.read', 'one_time_orders.access']) {
      assert.equal(project([rule(action, 'allow'), rule(gate, 'deny')])[flag], false);
      assert.equal(project([rule(action, 'allow'), rule(gate, 'deny')], 'B')[flag], true);
    }
  });
  test(`${action}: no grant manufactures assignment, open lifecycle or active identity`, () => {
    const all: AccessRule = { actionCode: action, effect: 'allow', scope: 'all', selectedIds: [] };
    for (const status of ['completed', 'cancelled']) assert.equal(project([all], 'A', true, status)[flag], false);
    assert.equal(project([all], 'A', false)[flag], false);
    assert.equal(project([all], 'A', false, 'in_progress', ['founder'])[flag], false);
    assert.equal(project([all], 'A', true, 'in_progress', ['manager'], false)[flag], false);
    assert.equal(project([all], 'A', true, 'in_progress', [])[flag], true, 'Real assignment works without inventing a role');
  });
}
test('structure management remains leadership policy; execute/comments/detach cannot grant it', () => {
  const grants = cases.map(([action]) => rule(action, 'allow'));
  assert.equal(project(grants).canEditSpecification, false);
  assert.equal(project([rule('one_time_orders.specification.manage', 'allow')]).canEditSpecification, false);
  assert.equal(project([], 'A', false, 'in_progress', ['founder']).canEditSpecification, true);
  const denied = project([rule('one_time_orders.specification.manage', 'deny')], 'A', true, 'in_progress', ['founder']);
  assert.equal(denied.canEditSpecification, false);
  assert.equal(denied.canManageSpecification, true);
  assert.equal(denied.canCommentSpecification, true);
  assert.equal(denied.canDetachSpecificationFiles, true);
});
