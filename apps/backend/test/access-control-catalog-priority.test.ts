import assert from 'node:assert/strict';
import test from 'node:test';

import { ACCESS_ACTION_CATALOG } from '../src/modules/users-access/access-action-catalog';
import type { AccessRule, AccessScope, AccessSubject } from '../src/modules/users-access/types/access-policy.type';
import { buildAccessWhere, decideAccess } from '../src/modules/users-access/utils/access-policy.util';

// Run alongside access-control-catalog-contract.test.ts. Both exercise the
// resolver with synthetic inputs. Admin and domain HTTP/DB coverage is separate.
const unsupportedStandalone = [
  'equipment.move',
  'files.detach',
  'objects.planning.manage',
  'one_time_order_calendar.manage',
  'settings.access',
  'tasks.status',
  'timesheet.attendance.edit',
  'timesheet.manual_correction',
];
const scopes: readonly AccessScope[] = ['own', 'assigned', 'selected', 'all'];
const roleByConstraint: Readonly<Record<string, string>> = {
  founder_only: 'founder',
  leadership_only: 'director',
  director_only: 'director',
};
const actorId = 'recipient';
const resources = [
  { id: 'own', ownerUserId: actorId },
  { id: 'assigned', assignedUserIds: [actorId] },
  { id: 'selected' },
  { id: 'control' },
];
const resourceIds = resources.map(({ id }) => id);
const idsInScope = (scope: AccessScope) => scope === 'all' ? resourceIds : [scope];

interface Filter {
  id?: { in: readonly string[] };
  AND?: Filter[];
  OR?: Filter[];
  NOT?: Filter;
}

function matches(filter: Filter, id: string): boolean {
  return (!filter.id || filter.id.in.includes(id)) &&
    (!filter.AND || filter.AND.every((child) => matches(child, id))) &&
    (!filter.OR || filter.OR.some((child) => matches(child, id))) &&
    (!filter.NOT || !matches(filter.NOT, id));
}

test('catalog fast classification covers adjustable, restricted implemented and unsupported standalone actions', () => {
  const unsupported = ACCESS_ACTION_CATALOG.filter(({ constraint }) => constraint === 'unsupported_standalone_operation');
  assert.deepEqual(unsupported.map(({ code }) => code).sort(), unsupportedStandalone);
  const adjustable = ACCESS_ACTION_CATALOG.filter(({ manageable }) => manageable);
  assert.equal(adjustable.length, 265);
  const restricted = ACCESS_ACTION_CATALOG.filter(({ manageable, code }) => !manageable && !unsupportedStandalone.includes(code));
  assert.equal(restricted.filter(({ constraint }) => constraint === 'policy_decision_required').length, 16);
  assert.deepEqual(
    restricted.filter(({ constraint }) => constraint !== 'policy_decision_required')
      .map(({ code, constraint }) => [code, constraint]).sort(),
    [['auth.logout', 'logout_always_available'], ['candidates.denied', 'legacy_negative']],
  );
  assert.equal(ACCESS_ACTION_CATALOG.length, 291);
});

for (const action of ACCESS_ACTION_CATALOG) {
  const unsupported = unsupportedStandalone.includes(action.code);
  const classification = unsupported ? 'unsupported standalone'
    : action.manageable ? 'adjustable' : 'restricted implemented';
  test(`catalog fast [${classification}] ${action.code}`, () => {
    const subject: AccessSubject = {
      id: actorId,
      isActive: true,
      roleCodes: [roleByConstraint[action.constraint ?? ''] ?? 'manager'],
    };
    const rule = (scope: AccessScope, effect: AccessRule['effect']): AccessRule => ({
      actionCode: action.code,
      effect,
      scope,
      selectedIds: scope === 'selected' ? ['selected'] : [],
    });
    const check = (
      rules: AccessRule[],
      legacyIds: readonly string[],
      expectedIds: readonly string[],
      label: string,
    ) => {
      const recipient = { ...subject, accessRules: rules };
      const detailIds = resources.filter(({ id, ...resource }) => decideAccess(recipient, action.code, legacyIds.includes(id), {
        ...resource,
        resourceType: action.resourceType,
        resourceId: id,
      })).map(({ id }) => id);
      assert.deepEqual(detailIds, expectedIds, `${label}: detail`);

      const where = buildAccessWhere<Filter>({
        subject: recipient,
        actionCode: action.code,
        legacyWhere: { id: { in: legacyIds } },
        invariantWhere: {},
        scopeWhere: (accessRule) => ({ id: { in: idsInScope(accessRule.scope) } }),
      });
      assert.deepEqual(resourceIds.filter((id) => matches(where as Filter, id)), expectedIds, `${label}: synthetic list`);
    };

    if (unsupported) {
      assert.equal(action.constraint, 'unsupported_standalone_operation');
      assert.equal(action.manageable, false);
      for (const scope of action.allowedScopes) {
        check([rule(scope, 'allow')], [], [], `unsupported ${scope} allow cannot create authority`);
      }
      return;
    }

    if (action.constraint === 'logout_always_available') {
      const blocked = { ...subject, isActive: false, accessRules: [rule('all', 'deny')] };
      assert.equal(decideAccess(blocked, action.code, true, { parentAllowed: false, invariantAllowed: false }), true);
      assert.equal(decideAccess(blocked, action.code, false), false);
      return;
    }

    // An empty rule set represents the resolver state after a return to default.
    check([], ['control'], ['control'], 'default preserves allowed and denied legacy resources');

    // Conflicting rules are synthetic. The admin request rejects duplicate codes.
    for (const scope of scopes) {
      if (!action.allowedScopes.includes(scope)) {
        check([rule(scope, 'allow')], [], [], `undeclared ${scope} allow cannot grant`);
        check([rule(scope, 'deny')], resourceIds, [], `undeclared ${scope} deny fails closed`);
        continue;
      }

      if (scope !== 'all') {
        check([rule(scope, 'allow'), rule('all', 'deny')], resourceIds, [], `all deny over ${scope} allow and legacy allowance`);
      }
      const remaining = resourceIds.filter((id) => !idsInScope(scope).includes(id));
      const allow = rule('all', 'allow');
      const deny = rule(scope, 'deny');
      for (const [order, rules] of [
        ['allow first', [allow, deny]],
        ['deny first', [deny, allow]],
      ] as const) {
        check([...rules], resourceIds, remaining, `${scope} deny over legacy allowance, ${order}`);
        check([...rules], [], action.manageable ? remaining : [], `${scope} deny over personal allow, ${order}`);
      }
    }
  });
}
