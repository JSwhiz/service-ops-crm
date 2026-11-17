import assert from 'node:assert/strict';
import test from 'node:test';

import { ACCESS_ACTION_CATALOG } from '../src/modules/users-access/access-action-catalog';
import type { AccessContext, AccessRule, AccessScope, AccessSubject } from '../src/modules/users-access/types/access-policy.type';
import { buildAccessWhere, decideAccess } from '../src/modules/users-access/utils/access-policy.util';

const actor: AccessSubject = { id: 'manager-a', isActive: true, roleCodes: ['manager'], permissionCodes: [] };
const context: AccessContext = {
  resourceType: 'object', resourceId: 'selected', ownerUserId: 'other', assignedUserIds: [],
};
const rule = (
  scope: AccessScope, effect: 'allow' | 'deny' = 'allow', actionCode = 'objects.read',
  selectedIds: readonly string[] = ['selected'],
): AccessRule => ({ actionCode, effect, scope, selectedIds });
const subject = (...rules: AccessRule[]): AccessSubject => ({ ...actor, accessRules: rules });

// A tiny in-memory predicate language exercises filters without Prisma, SQL or a DB.
// Expected ids and sums below are independently stated contract examples.
interface Filter {
  AND?: readonly Filter[];
  OR?: readonly Filter[];
  NOT?: Filter;
  ids?: readonly string[];
}
const rows = [
  { id: 'own', ownerUserId: actor.id, assignedUserIds: [], amount: 10 },
  { id: 'assigned', ownerUserId: 'other', assignedUserIds: [actor.id], amount: 20 },
  { id: 'selected', ownerUserId: 'other', assignedUserIds: [], amount: 30 },
  { id: 'outside', ownerUserId: 'other', assignedUserIds: [], amount: 40 },
];
function matches(filter: Filter, id: string): boolean {
  return (filter.ids === undefined || filter.ids.includes(id)) &&
    (filter.AND === undefined || filter.AND.every((part) => matches(part, id))) &&
    (filter.OR === undefined || filter.OR.some((part) => matches(part, id))) &&
    (filter.NOT === undefined || !matches(filter.NOT, id));
}
function translateScope(value: AccessRule): Filter | null {
  switch (value.scope) {
    case 'all': return {};
    case 'own': return { ids: rows.filter((row) => row.ownerUserId === actor.id).map((row) => row.id) };
    case 'assigned': return { ids: rows.filter((row) => row.assignedUserIds.includes(actor.id)).map((row) => row.id) };
    case 'selected': return { ids: value.selectedIds };
    default: return null;
  }
}
function accessFilter(params: {
  user?: AccessSubject; code?: string; legacy?: Filter; invariant?: Filter;
  adapter?: (value: AccessRule, actionCode: string) => Filter | null;
  parents?: readonly string[];
} = {}): Filter {
  return buildAccessWhere<Filter>({
    subject: params.user ?? actor, actionCode: params.code ?? 'objects.read',
    legacyWhere: params.legacy ?? { OR: [] }, invariantWhere: params.invariant ?? {},
    scopeWhere: params.adapter ?? translateScope, parentActionCodes: params.parents,
  }) as Filter;
}
function visible(filter: Filter) {
  return rows.filter((row) => matches(filter, row.id));
}

test('zero overrides preserve both legacy decisions without mutating subject/context', () => {
  const frozenSubject = Object.freeze({ ...actor });
  const frozenContext = Object.freeze({ ...context });
  assert.equal(decideAccess(frozenSubject, 'objects.read', false, frozenContext), false);
  assert.equal(decideAccess(frozenSubject, 'objects.read', true, frozenContext), true);
  assert.deepEqual(visible(accessFilter({ legacy: { ids: ['own', 'assigned'] } })).map((row) => row.id), ['own', 'assigned']);
});

for (const [scope, expected] of [
  ['own', ['own']], ['assigned', ['assigned']], ['selected', ['selected']],
  ['all', ['own', 'assigned', 'selected', 'outside']],
] as const) {
  test(`${scope} grant matches detail and list scope exactly`, () => {
    const user = subject(rule(scope));
    assert.deepEqual(visible(accessFilter({ user })).map((row) => row.id), expected);
    for (const row of rows) {
      assert.equal(decideAccess(user, 'objects.read', false, {
        resourceType: 'object', resourceId: row.id, ownerUserId: row.ownerUserId,
        assignedUserIds: row.assignedUserIds,
      }), (expected as readonly string[]).includes(row.id), row.id);
    }
  });
}

test('a scoped grant adds to legacy access without removing broader own rights', () => {
  const user = subject(rule('selected'));
  const filter = accessFilter({ user, legacy: { ids: ['own'] } });
  assert.deepEqual(visible(filter).map((row) => row.id), ['own', 'selected']);
  assert.equal(decideAccess(user, 'objects.read', true, { ...context, resourceId: 'own' }), true);
  assert.equal(decideAccess(user, 'objects.update', false, context), false);
});

test('explicit deny wins regardless of allow rule order and legacy role allowance', () => {
  for (const rules of [
    [rule('all'), rule('selected', 'deny')], [rule('selected', 'deny'), rule('all')],
  ]) {
    const user = subject(...rules);
    assert.equal(decideAccess(user, 'objects.read', true, context), false);
    assert.equal(decideAccess(user, 'objects.read', true, { ...context, resourceId: 'outside' }), true);
    assert.deepEqual(visible(accessFilter({ user, legacy: {} })).map((row) => row.id), ['own', 'assigned', 'outside']);
  }
});

test('selected parent deny blocks its child without denying unrelated resources', () => {
  const user = subject(rule('all'), rule('selected', 'deny', 'objects.access'));
  assert.equal(decideAccess(user, 'objects.read', true, context), false);
  assert.equal(decideAccess(user, 'objects.read', true, { ...context, resourceId: 'outside' }), true);
  assert.deepEqual(visible(accessFilter({ user, legacy: {} })).map((row) => row.id), ['own', 'assigned', 'outside']);
});

test('file decisions use the object ancestor identity rather than file id for scoped deny', () => {
  const user = subject(rule('all', 'allow', 'files.download'), rule('selected', 'deny', 'objects.access'));
  const file = { resourceType: 'file', resourceId: 'file-id' };
  assert.equal(decideAccess(user, 'files.download', true, {
    ...file, parents: [{ actionCode: 'objects.access', context }],
  }), false);
  assert.equal(decideAccess(user, 'files.download', true, {
    ...file, parents: [{ actionCode: 'objects.access', context: { ...context, resourceId: 'outside' } }],
  }), true);
  assert.deepEqual(visible(accessFilter({
    user, code: 'files.download', legacy: {}, parents: ['objects.access'],
  })).map((row) => row.id), ['own', 'assigned', 'outside']);
});

test('parent allow does not create a child action grant', () => {
  const user = subject(rule('all', 'allow', 'objects.access'));
  assert.equal(decideAccess(user, 'objects.read', false, context), false);
  assert.deepEqual(visible(accessFilter({ user })), []);
});

test('scope identity is domain-specific; missing metadata and empty selected ids never grant access', () => {
  for (const scope of ['own', 'assigned', 'selected'] as const) {
    const user = subject(rule(scope));
    assert.equal(decideAccess(user, 'objects.read', false, {}), false);
    assert.equal(decideAccess(user, 'objects.read', false, {
      ...context, resourceType: 'one_time_order', ownerUserId: actor.id, assignedUserIds: [actor.id],
    }), false);
  }
  assert.equal(decideAccess(subject(rule('selected', 'allow', 'objects.read', [])), 'objects.read', false, context), false);
  assert.deepEqual(visible(accessFilter({ user: subject(rule('selected', 'allow', 'objects.read', [])) })), []);
});

test('unknown code fails closed even when legacyAllowed and all-scope grant are true', () => {
  const code = 'objects.nonexistent_action';
  const user = subject(rule('all', 'allow', code));
  assert.equal(decideAccess(user, code, true, context), false);
  assert.deepEqual(visible(accessFilter({ user, code, legacy: {} })), []);
});

test('unknown scope cannot grant access in either resolver or list builder', () => {
  const invalid = { ...rule('all'), scope: 'unknown_scope' as AccessScope };
  const user = subject(invalid);
  assert.equal(decideAccess(user, 'objects.read', false, context), false);
  assert.deepEqual(visible(accessFilter({ user, adapter: () => ({}) })), [],
    'Builder must validate scopes before trusting a permissive domain adapter');
});

test('a known but unsupported action scope cannot grant a list or detail', () => {
  const user = subject(rule('own', 'allow', 'objects.create'));
  assert.equal(decideAccess(user, 'objects.create', false, { ...context, ownerUserId: actor.id }), false);
  assert.deepEqual(visible(accessFilter({ user, code: 'objects.create', adapter: () => ({}) })), []);
});

test('invariant=false, parentAllowed=false and inactive subjects cannot be overridden', () => {
  const user = subject(rule('all'));
  for (const limits of [{ invariantAllowed: false }, { parentAllowed: false }]) {
    assert.equal(decideAccess(user, 'objects.read', true, { ...context, ...limits }), false);
  }
  assert.equal(decideAccess({ ...user, isActive: false }, 'objects.read', true, context), false);
  assert.deepEqual(visible(accessFilter({ user, legacy: {}, invariant: { OR: [] } })), []);
  assert.deepEqual(visible(accessFilter({ user: { ...user, isActive: false }, legacy: {} })), []);
});

test('money and lifecycle invariants remain mandatory even with an explicit all grant', () => {
  for (const code of ['inventory.issue_to_one_time_order', 'objects.compensation.correct_past', 'accountability.expenses.approve']) {
    const user = { ...subject(rule('all', 'allow', code)), roleCodes: ['founder', 'director'] };
    assert.equal(decideAccess(user, code, true, { invariantAllowed: false }), false, code);
    assert.deepEqual(visible(accessFilter({ user, code, legacy: {}, invariant: { OR: [] } })), [], code);
  }
});

test('assigned dispatch is keyed by order identity and cannot grant global warehouse actions', () => {
  const code = 'inventory.issue_to_one_time_order';
  const user = subject(rule('assigned', 'allow', code));
  const assignedOrder: AccessContext = {
    resourceType: 'one_time_order', resourceId: 'order-a', assignedUserIds: [actor.id],
    invariantAllowed: true, parentAllowed: true,
  };
  assert.equal(decideAccess(user, code, false, assignedOrder), true);
  assert.equal(decideAccess(user, code, false, { ...assignedOrder, resourceId: 'order-b', assignedUserIds: [] }), false);
  assert.equal(decideAccess(user, code, false, { ...assignedOrder, resourceType: 'inventory_item' }), false);
  assert.equal(decideAccess(user, code, false, { ...assignedOrder, invariantAllowed: false }), false);
  assert.equal(decideAccess(user, code, false, { ...assignedOrder, parentAllowed: false }), false);
  for (const otherCode of ['inventory.access', 'inventory.catalog.update', 'inventory.receipt', 'inventory.writeoff', 'inventory.adjustment', 'objects.read']) {
    assert.equal(decideAccess(user, otherCode, false, assignedOrder), false, otherCode);
  }
});

test('selected shipment ids refer to orders, with separate SKU and order parent contexts', () => {
  const code = 'inventory.issue_to_one_time_order';
  const orderContext: AccessContext = { resourceType: 'one_time_order', resourceId: 'order-a' };
  const user = subject(
    rule('selected', 'allow', code, ['order-a']),
    rule('selected', 'deny', 'inventory.access', ['item-a']),
  );
  assert.equal(decideAccess(user, code, false, orderContext), true,
    'SKU-scoped deny must not interpret an order id as a SKU id');
  assert.equal(decideAccess(user, code, false, {
    ...orderContext,
    parents: [{ actionCode: 'inventory.access', context: { resourceType: 'inventory_item', resourceId: 'item-a' } }],
  }), false);
  assert.equal(decideAccess(user, code, false, { ...orderContext, resourceId: 'item-a' }), false);
  assert.equal(decideAccess(subject(rule('all', 'allow', code), rule('all', 'deny', 'inventory.access')), code, false, orderContext), false);
});

test('candidates.denied survives role/direct allowances, new grants and returning to default', () => {
  for (const action of ACCESS_ACTION_CATALOG.filter((item) => item.module === 'candidates')) {
    for (const rules of [[], [rule('all', 'allow', action.code)]]) {
      const user = {
        ...actor, roleCodes: ['founder'], permissionCodes: ['candidates.view', 'candidates.manage', 'candidates.denied'],
        accessRules: rules,
      };
      assert.equal(decideAccess(user, action.code, true, { resourceType: 'candidate' }), false, action.code);
      assert.deepEqual(visible(accessFilter({ user, code: action.code, legacy: {} })), [], action.code);
    }
  }
});

test('approved personal expense decisions grant only the selected scope and retain explicit deny and read parents', () => {
  for (const code of ['accountability.expenses.approve', 'accountability.expenses.reject']) {
    const target: AccessContext = { resourceType: 'user', resourceId: 'selected', ownerUserId: 'other' };
    const control: AccessContext = { ...target, resourceId: 'outside' };
    const allow = rule('selected', 'allow', code);
    const user = subject(allow);
    assert.equal(decideAccess(user, code, false, target), true, code);
    assert.equal(decideAccess(user, code, false, control), false, `${code}: unselected control`);
    assert.deepEqual(visible(accessFilter({ user, code })).map(row => row.id), ['selected']);
    const denied = subject(rule('selected', 'deny', code));
    assert.equal(decideAccess(denied, code, true, target), false, `${code}: explicit deny`);
    assert.equal(decideAccess(denied, code, true, control), true, `${code}: control baseline retained`);
    for (const parent of ['accountability.access', 'accountability.read']) {
      const blocked = subject(allow, rule('all', 'deny', parent));
      assert.equal(decideAccess(blocked, code, true, { ...target, parents: [{ actionCode: parent, context: target }] }), false, `${code}: ${parent}`);
      assert.deepEqual(visible(accessFilter({ user: blocked, code, legacy: {}, parents: [parent] })), [], `${code}: parent list deny`);
    }
    assert.equal(decideAccess(user, code, true, { ...target, invariantAllowed: false }), false, `${code}: business invariants remain mandatory`);
  }
});

test('sensitive approver actions preserve legacy authority rather than accepting a new allow', () => {
  for (const code of ['accountability.closure.approve', 'accountability.closure.reject', 'approvals.resolve_inventory_exception', 'one_time_orders.specification.manage']) {
    const user = subject(rule('all', 'allow', code));
    assert.equal(decideAccess(user, code, false), false, code);
    assert.deepEqual(visible(accessFilter({ user, code })), [], code);
    assert.equal(decideAccess(user, code, true), true, code);
  }
});

test('founder/leadership/director constraints apply to grants and list filters', () => {
  for (const [code, allowedRoles, deniedRoles] of [
    ['users_access.manage', ['manager', 'founder'], ['sys_admin', 'director']],
    ['objects.contract_amount.read', ['corporate_director'], ['deputy_director']],
    ['inventory.resolve_missing_photo', ['director'], ['founder']],
  ] as const) {
    for (const [roles, expected] of [[allowedRoles, true], [deniedRoles, false]] as const) {
      const user = { ...subject(rule('all', 'allow', code)), roleCodes: roles };
      assert.equal(decideAccess(user, code, true), expected, code);
      assert.equal(visible(accessFilter({ user, code, legacy: {} })).length, expected ? 4 : 0, code);
    }
  }
});

test('list/count/aggregate share an intersected predicate before pagination', () => {
  const filter = accessFilter({
    user: subject(rule('all'), rule('selected', 'deny', 'objects.access')),
    legacy: { ids: ['outside'] }, invariant: { ids: ['own', 'assigned', 'selected'] },
  });
  const allowed = visible(filter);
  assert.deepEqual(allowed.map((row) => row.id), ['own', 'assigned']);
  assert.equal(allowed.length, 2, 'Count uses the same predicate as list');
  assert.equal(allowed.reduce((total, row) => total + row.amount, 0), 30, 'Aggregate excludes denied/out-of-invariant rows');
  assert.deepEqual(allowed.slice(1, 2).map((row) => row.id), ['assigned']);
});

test('missing adapters discard an unrepresentable allow but fail closed for deny', () => {
  assert.deepEqual(visible(accessFilter({
    user: subject(rule('selected')), adapter: () => null,
  })), []);
  assert.deepEqual(visible(accessFilter({
    user: subject(rule('selected', 'deny')), legacy: {}, adapter: () => null,
  })), []);
});
