import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

import { ACCESS_ACTION_CATALOG } from '../src/modules/users-access/access-action-catalog';
import type { AccessContext, AccessRule, AccessSubject } from '../src/modules/users-access/types/access-policy.type';
import { buildAccessWhere, decideAccess } from '../src/modules/users-access/utils/access-policy.util';

// This is a resolver contract, NOT evidence that each domain endpoint/UI is wired.
const actor: AccessSubject = { id: 'recipient', isActive: true, roleCodes: ['manager'], permissionCodes: [] };
const expectedRegistry = JSON.parse(readFileSync(resolve(__dirname, '../../../docs/product/access-control-acceptance-matrix-2026-11-07.json'), 'utf8')) as {
  rows: Array<{ code: string; resourceType: string; scopes: string[]; managementScopes?: string[]; manageable: boolean; constraint: string | null }>;
};
const privileged: AccessSubject = { ...actor, roleCodes: ['founder', 'director'] };
const scopes = ['own', 'assigned', 'selected', 'all'] as const;
const rows = [
  { id: 'own', ownerUserId: actor.id, assignedUserIds: [] },
  { id: 'assigned', ownerUserId: 'other', assignedUserIds: [actor.id] },
  { id: 'selected', ownerUserId: 'other', assignedUserIds: [] },
  { id: 'control', ownerUserId: 'other', assignedUserIds: [] },
];
interface Predicate { ids?: readonly string[]; id?: { in: readonly string[] }; AND?: Predicate[]; OR?: Predicate[]; NOT?: Predicate }
function matches(where: Predicate, id: string): boolean {
  return (!where.ids || where.ids.includes(id)) && (!where.id || where.id.in.includes(id)) &&
    (!where.AND || where.AND.every((part) => matches(part, id))) &&
    (!where.OR || where.OR.some((part) => matches(part, id))) && (!where.NOT || !matches(where.NOT, id));
}
const forScope = (rule: AccessRule): Predicate => ({ ids: rule.scope === 'all' ? rows.map((row) => row.id) : [rule.scope] });
const ruleFor = (code: string, scope: AccessRule['scope'], effect: AccessRule['effect'] = 'allow'): AccessRule =>
  ({ actionCode: code, scope, effect, selectedIds: scope === 'selected' ? ['selected'] : [] });

test('malformed selected denies fail closed in direct decisions and list predicates; malformed allows never grant', () => {
  for (const action of ACCESS_ACTION_CATALOG.filter((entry) => entry.allowedScopes.includes('selected'))) {
    for (const selectedIds of [[], null, undefined, {}]) {
      const malformed = { actionCode: action.code, scope: 'selected', selectedIds } as AccessRule;
      const subject: AccessSubject = { ...privileged, accessRules: [{ ...malformed, effect: 'deny' }] };
      const context = { resourceType: action.resourceType, resourceId: 'control' };
      assert.equal(decideAccess(subject, action.code, true, context), false, `${action.code} malformed direct deny`);
      const filter = buildAccessWhere<Predicate>({ subject, actionCode: action.code, legacyWhere: {}, invariantWhere: {}, scopeWhere: forScope });
      assert.deepEqual(rows.filter((row) => matches(filter as Predicate, row.id)), [], `${action.code} malformed list deny`);
      assert.equal(decideAccess({ ...privileged, accessRules: [{ ...malformed, effect: 'allow' }] }, action.code, false, context), false,
        `${action.code} malformed allow cannot grant or throw`);
    }
  }
});

test('catalog has one definition per action, valid parents and declared scopes', () => {
  assert.equal(ACCESS_ACTION_CATALOG.length, 291, 'Deliberately update the acceptance registry if the catalog changes');
  const codes = new Set(ACCESS_ACTION_CATALOG.map((action) => action.code));
  assert.equal(codes.size, ACCESS_ACTION_CATALOG.length);
  assert.deepEqual([...codes].sort(), expectedRegistry.rows.map((row) => row.code).sort());
  for (const action of ACCESS_ACTION_CATALOG) {
    const expected = expectedRegistry.rows.find((row) => row.code === action.code)!;
    assert.equal(action.resourceType, expected.resourceType, `${action.code} snapshot resource type`);
    assert.deepEqual(action.allowedScopes, expected.scopes, `${action.code} snapshot scopes`);
    assert.deepEqual(action.managementScopes ?? action.allowedScopes, expected.managementScopes ?? expected.scopes, `${action.code} snapshot management scopes`);
    assert.equal(action.manageable, expected.manageable, `${action.code} snapshot manageability`);
    assert.equal(action.constraint ?? null, expected.constraint, `${action.code} snapshot constraint`);
    assert.ok(action.allowedScopes.length > 0, action.code);
    assert.equal(new Set(action.allowedScopes).size, action.allowedScopes.length, action.code);
    assert.ok(action.allowedScopes.every((scope) => scopes.includes(scope)), action.code);
    if (action.parentAction) assert.ok(codes.has(action.parentAction), action.code);
  }
});

for (const action of ACCESS_ACTION_CATALOG) {
  test(`catalog resolver ${action.code}: default, grants, denies, scope and invariant boundary`, () => {
    const contextFor = (row: typeof rows[number]): AccessContext => ({ ...row, resourceType: action.resourceType, resourceId: row.id });
    const context = contextFor(rows[2]);
    const evaluate = (subject: AccessSubject, legacy: boolean, ctx = context) => decideAccess(subject, action.code, legacy, ctx);
    if (action.constraint === 'logout_always_available') {
      // Logout is an escape hatch, not an ordinary protected list operation.
      const blocked = { ...actor, isActive: false, accessRules: [ruleFor(action.code, 'all', 'deny')] };
      assert.equal(evaluate(blocked, true, { invariantAllowed: false, parentAllowed: false }), true);
      assert.equal(evaluate(blocked, false), false);
      return;
    }
    assert.equal(evaluate(privileged, false), false, 'No personal rules preserves denied baseline');
    assert.equal(evaluate(privileged, true), true, 'No personal rules preserves permitted baseline');
    for (const scope of action.allowedScopes) {
      const allowed: AccessSubject = { ...privileged, accessRules: [ruleFor(action.code, scope)] };
      for (const row of rows) {
        const expected = action.manageable && (scope === 'all' || row.id === scope);
        assert.equal(evaluate(allowed, false, contextFor(row)), expected, `${scope}/${row.id}`);
      }
      const denied: AccessSubject = { ...privileged, accessRules: [ruleFor(action.code, scope, 'deny')] };
      for (const row of rows) {
        assert.equal(evaluate(denied, true, contextFor(row)), !(scope === 'all' || row.id === scope), `deny ${scope}/${row.id}`);
      }
      if (scope !== 'all') assert.equal(evaluate(allowed, false, {}), false, 'Missing resource identity cannot grant scope');
      if (scope !== 'all') assert.equal(evaluate(allowed, false, { ...contextFor(rows.find((row) => row.id === scope)!), resourceType: 'wrong_type' }), false);
      const filter = buildAccessWhere<Predicate>({ subject: allowed, actionCode: action.code, legacyWhere: { ids: [] }, invariantWhere: {}, scopeWhere: forScope });
      assert.deepEqual(rows.filter((row) => matches(filter as Predicate, row.id)).map((row) => row.id),
        action.manageable ? (scope === 'all' ? rows.map((row) => row.id) : [scope]) : [], `list ${scope}`);
      const deniedFilter = buildAccessWhere<Predicate>({ subject: denied, actionCode: action.code,
        legacyWhere: {}, invariantWhere: {}, scopeWhere: forScope });
      assert.deepEqual(rows.filter((row) => matches(deniedFilter as Predicate, row.id)).map((row) => row.id),
        scope === 'all' ? [] : rows.filter((row) => row.id !== scope).map((row) => row.id), `list deny ${scope}`);
      const intersection = buildAccessWhere<Predicate>({ subject: allowed, actionCode: action.code,
        legacyWhere: { ids: [] }, invariantWhere: { ids: ['control'] }, scopeWhere: forScope });
      assert.deepEqual(rows.filter((row) => matches(intersection as Predicate, row.id)).map((row) => row.id),
        action.manageable && scope === 'all' ? ['control'] : [], `list invariant ${scope}`);
    }
    const allGrant: AccessSubject = { ...privileged, accessRules: [ruleFor(action.code, 'all')] };
    assert.equal(evaluate({ ...allGrant, isActive: false }, true), false);
    assert.equal(evaluate(allGrant, true, { ...context, invariantAllowed: false }), false);
    assert.equal(evaluate(allGrant, true, { ...context, parentAllowed: false }), false);
    if (action.parentAction) {
      const deniedParent: AccessSubject = { ...allGrant, accessRules: [...allGrant.accessRules!, ruleFor(action.parentAction, 'all', 'deny')] };
      assert.equal(evaluate(deniedParent, true), false, 'Parent deny overrides both baseline and leaf');
      const parentFilter = buildAccessWhere<Predicate>({ subject: deniedParent, actionCode: action.code,
        legacyWhere: {}, invariantWhere: {}, scopeWhere: forScope });
      assert.deepEqual(rows.filter((row) => matches(parentFilter as Predicate, row.id)), [], 'List parent deny');
      assert.equal(evaluate({ ...privileged, accessRules: [ruleFor(action.parentAction, 'all')] }, false), false, 'Parent allow is not a child grant');
    }
    if (['founder_only', 'leadership_only', 'director_only'].includes(action.constraint ?? '')) {
      assert.equal(evaluate({ ...actor, accessRules: [ruleFor(action.code, 'all')] }, true), false, 'Restricted role cannot be bypassed');
    }
    if (action.module === 'candidates') assert.equal(evaluate({ ...allGrant, permissionCodes: ['candidates.denied'] }, true), false);
    const inactiveFilter = buildAccessWhere<Predicate>({ subject: { ...allGrant, isActive: false }, actionCode: action.code,
      legacyWhere: {}, invariantWhere: {}, scopeWhere: forScope });
    assert.deepEqual(rows.filter((row) => matches(inactiveFilter as Predicate, row.id)), [], 'Inactive list subject');
  });
}
