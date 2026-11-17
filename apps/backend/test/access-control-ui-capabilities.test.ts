import assert from 'node:assert/strict';
import test from 'node:test';

import { buildAccountabilityGlobalCapabilities } from '../src/modules/accountability/utils/accountability-capabilities.util';
import { buildEquipmentGlobalCapabilities } from '../src/modules/equipment/utils/equipment-capabilities.util';
import { buildInventoryGlobalCapabilities } from '../src/modules/inventory/utils/inventory-capabilities.util';
import { getAccessAction } from '../src/modules/users-access/access-action-catalog';
import type { AccessContext, AccessRule, AccessSubject } from '../src/modules/users-access/types/access-policy.type';
import { decideAccess } from '../src/modules/users-access/utils/access-policy.util';
import { applyAccessCapabilities } from '../src/modules/users-access/utils/auth-access-capabilities.util';

// Pure capability projections only: no app, HTTP, DB, UI rendering or delivery-channel claims.
const actorId = '00000000-0000-4000-8000-000000000001';
const a = '00000000-0000-4000-8000-000000000002';
const b = '00000000-0000-4000-8000-000000000003';
const rule = (actionCode: string, effect: AccessRule['effect'] = 'allow',
  scope: AccessRule['scope'] = 'all', selectedIds: string[] = []): AccessRule => {
  const action = getAccessAction(actionCode);
  assert.ok(action?.manageable, actionCode);
  assert.ok(action.allowedScopes.includes(scope), `${actionCode}: ${scope}`);
  assert.equal(selectedIds.length > 0, scope === 'selected', 'Use only valid selected/all fixtures');
  return { actionCode, effect, scope, selectedIds };
};
const subject = (roleCode: string, accessRules: AccessRule[] = [], permissionCodes: string[] = []): AccessSubject => {
  assert.equal(new Set(accessRules.map((entry) => entry.actionCode)).size, accessRules.length, 'One rule per user/action');
  return { id: actorId, isActive: true, roleCodes: [roleCode], permissionCodes, accessRules };
};
const capabilities = (roleCode: string, rules: AccessRule[] = [], permissionCodes: string[] = []) => {
  const inventory = buildInventoryGlobalCapabilities([roleCode], permissionCodes);
  return applyAccessCapabilities(subject(roleCode, rules, permissionCodes), {
    ...inventory,
    canRestoreInventoryItem: inventory.canRestoreInventoryItem ?? false,
    ...buildEquipmentGlobalCapabilities([roleCode], permissionCodes),
    ...buildAccountabilityGlobalCapabilities({ roleCodes: [roleCode], permissionCodes, isActiveUser: true }),
  });
};
const itemContext = (resourceId: string): AccessContext => ({
  resourceType: getAccessAction('inventory.movements.read')!.resourceType, resourceId,
});

test('counterparty link selector exposes selected authority without granting another source', () => {
  const project = (rules: AccessRule[]) => applyAccessCapabilities(subject('manager', rules), { canLinkCounterpartyObjects: false });
  const selected = [rule('counterparties.objects.link', 'allow', 'selected', [a])];
  assert.equal(project([]).canLinkCounterpartyObjects, false);
  assert.equal(project(selected).canLinkCounterpartyObjects, true);
  const actor = subject('manager', selected);
  assert.equal(decideAccess(actor, 'counterparties.objects.link', false, { resourceType: 'counterparty', resourceId: a }), true);
  assert.equal(decideAccess(actor, 'counterparties.objects.link', false, { resourceType: 'counterparty', resourceId: b }), false);
  assert.equal(project([...selected, rule('counterparties.access', 'deny')]).canLinkCounterpartyObjects, false);
  assert.equal(project([rule('counterparties.objects.link', 'deny', 'selected', [a])]).canLinkCounterpartyObjects, false);
  const hidden = subject('manager', [...selected, rule('counterparties.read', 'deny', 'selected', [a])]);
  assert.equal(decideAccess(hidden, 'counterparties.read', true, { resourceType: 'counterparty', resourceId: a }), false,
    'A selector flag cannot replace the concrete mutation parent-read check');
});

test('inventory catalog create is independent of update and respects root deny', () => {
  assert.equal(capabilities('manager').canCreateInventoryItem, false);
  const rules = [rule('inventory.catalog.create'), rule('inventory.catalog.update', 'deny')];
  const result = capabilities('manager', rules);
  assert.equal(result.canCreateInventoryItem, true);
  assert.equal(result.canManageInventoryCatalog, false);
  assert.equal(result.canDeleteInventoryItem, false);
  assert.equal(capabilities('manager', [...rules, rule('inventory.access', 'deny')]).canCreateInventoryItem, false);
  assert.equal(capabilities('manager').canCreateInventoryItem, false, 'Removing the grant restores the real baseline');
});

test('file upload discovery matches its real global action and default', () => {
  assert.equal(capabilities('manager').canUploadFile, true);
  assert.equal(capabilities('hr').canUploadFile, true);
  const denied = capabilities('manager', [rule('files.upload', 'deny')]);
  assert.equal(denied.canUploadFile, false);
  assert.equal(capabilities('manager', [rule('files.upload')]).canUploadFile, true);
  assert.equal(capabilities('manager', [rule('files.access', 'deny')]).canUploadFile, false);
  assert.equal(capabilities('manager', [{ actionCode: 'files.access', effect: 'deny', scope: 'own', selectedIds: [] }]).canUploadFile, false,
    'Every new upload is owned by its uploader; an own-files root deny applies before creation');
  assert.equal(capabilities('manager', [rule('files.access', 'deny', 'selected', [a])]).canUploadFile, true,
    'A denial for an existing file does not turn into a global upload denial');
  assert.equal(capabilities('manager').canUploadFile, true, 'Default returns without retaining a previous deny');
});

test('inventory catalog update does not grant create', () => {
  const result = capabilities('manager', [rule('inventory.catalog.update')]);
  assert.equal(result.canManageInventoryCatalog, true);
  assert.equal(result.canCreateInventoryItem, false);
  assert.equal(result.canDeleteInventoryItem, false);
  assert.equal(capabilities('manager', [rule('inventory.catalog.update'), rule('inventory.access', 'deny')]).canManageInventoryCatalog, false);
});

const equipmentFlags = ['canReadEquipmentCatalog', 'canManageEquipmentCatalog', 'canDeleteEquipmentCatalog',
  'canCreateEquipmentUnit', 'canDeleteEquipmentUnit'] as const;
const equipmentCases = [
  ['equipment.catalog.read', 'canReadEquipmentCatalog'],
  ['equipment.catalog.create', 'canManageEquipmentCatalog'],
  ['equipment.catalog.delete', 'canDeleteEquipmentCatalog'],
  ['equipment.unit.create', 'canCreateEquipmentUnit'],
  ['equipment.unit.delete', 'canDeleteEquipmentUnit'],
] as const;
for (const [actionCode, grantedFlag] of equipmentCases) {
  test(`${actionCode} exposes only its independent capability, with live deny/default/root boundaries`, () => {
    const baseline = capabilities('hr');
    for (const flag of equipmentFlags) assert.equal(baseline[flag], false, flag);
    const result = capabilities('hr', [rule(actionCode)]);
    for (const flag of equipmentFlags) assert.equal(result[flag], flag === grantedFlag, flag);
    assert.equal(capabilities('hr', [rule(actionCode, 'deny')])[grantedFlag], false);
    assert.equal(capabilities('hr')[grantedFlag], false, 'Removing the grant restores default');
    const blocked = capabilities('hr', [rule(actionCode), rule('equipment.access', 'deny')]);
    for (const flag of equipmentFlags) assert.equal(blocked[flag], false, flag);
  });
}

test('manager movement-read baseline survives report deny but not inventory root deny', () => {
  const baseline = capabilities('manager');
  assert.equal(baseline.canViewInventoryMovements, true);
  assert.equal(baseline.canViewInventoryReports, false);
  const rules = [rule('inventory.reports', 'deny')];
  assert.equal(capabilities('manager', rules).canViewInventoryMovements, true);
  const domain = buildInventoryGlobalCapabilities(['manager'], [], subject('manager', rules), itemContext(a));
  assert.equal(domain.canViewInventoryMovements, true);
  assert.equal(domain.canViewInventoryReports, false);
  const blockedRules = [...rules, rule('inventory.access', 'deny')];
  assert.equal(capabilities('manager', blockedRules).canViewInventoryMovements, false);
  assert.equal(buildInventoryGlobalCapabilities(['manager'], [], subject('manager', blockedRules), itemContext(a)).canViewInventoryMovements, false);
});

test('report-only grant does not grant inventory movements', () => {
  const rules = [rule('inventory.reports')];
  const result = capabilities('hr', rules);
  assert.equal(result.canViewInventoryReports, true);
  assert.equal(result.canViewInventoryMovements, false);
  const domain = buildInventoryGlobalCapabilities(['hr'], [], subject('hr', rules), itemContext(a));
  assert.equal(domain.canViewInventoryReports, true);
  assert.equal(domain.canViewInventoryMovements, false);
});

test('selected movement grant enables discovery but concrete item flags require the actual selected id', () => {
  assert.equal(capabilities('hr').canViewInventoryMovements, false);
  const rules = [rule('inventory.movements.read', 'allow', 'selected', [a])];
  const result = capabilities('hr', rules);
  assert.equal(result.canViewInventoryMovements, true, 'Existential discovery, not all-item authorization');
  assert.equal(result.canViewInventoryReports, false);
  const viewer = subject('hr', rules);
  assert.equal(buildInventoryGlobalCapabilities(['hr'], [], viewer).canViewInventoryMovements, false, 'No concrete id cannot match selected scope');
  assert.equal(buildInventoryGlobalCapabilities(['hr'], [], viewer, itemContext(a)).canViewInventoryMovements, true);
  assert.equal(buildInventoryGlobalCapabilities(['hr'], [], viewer, itemContext(b)).canViewInventoryMovements, false);
  const blocked = [...rules, rule('inventory.access', 'deny')];
  assert.equal(capabilities('hr', blocked).canViewInventoryMovements, false);
  assert.equal(buildInventoryGlobalCapabilities(['hr'], [], subject('hr', blocked), itemContext(a)).canViewInventoryMovements, false);
  assert.equal(capabilities('hr').canViewInventoryMovements, false);
});

test('per-item movement deny A subtracts only A from a real manager read baseline', () => {
  const rules = [rule('inventory.movements.read', 'deny', 'selected', [a])];
  const viewer = subject('manager', rules);
  assert.equal(buildInventoryGlobalCapabilities(['manager'], [], viewer, itemContext(a)).canViewInventoryMovements, false);
  assert.equal(buildInventoryGlobalCapabilities(['manager'], [], viewer, itemContext(b)).canViewInventoryMovements, true);
  assert.equal(capabilities('manager', rules).canViewInventoryMovements, true, 'Other permitted items remain discoverable');
  const reportsOnlyDenied = subject('manager', [rule('inventory.reports', 'deny', 'selected', [a])]);
  assert.equal(buildInventoryGlobalCapabilities(['manager'], [], reportsOnlyDenied, itemContext(a)).canViewInventoryMovements, true);
  assert.equal(buildInventoryGlobalCapabilities(['manager'], [], subject('manager'), itemContext(a)).canViewInventoryMovements, true);
});

test('foreign selected accountability review permits discovery without claiming global or actor-account review', () => {
  const baseline = capabilities('manager');
  assert.equal(baseline.canReviewAccountability, false);
  assert.equal(baseline.canDiscoverAccountabilityReview, false);
  const rules = [rule('accountability.review', 'allow', 'selected', [a])];
  const result = capabilities('manager', rules);
  assert.equal(result.canDiscoverAccountabilityReview, true);
  assert.equal(result.canReviewAccountability, false, 'Auth projection uses the actor account, not foreign selected A');
  const viewer = subject('manager', rules);
  const context = (id: string): AccessContext => ({ resourceType: getAccessAction('accountability.review')!.resourceType,
    resourceId: id, ownerUserId: id });
  assert.equal(decideAccess(viewer, 'accountability.review', false, context(a)), true);
  assert.equal(decideAccess(viewer, 'accountability.review', false, context(b)), false);
  assert.equal(decideAccess(viewer, 'accountability.review', false, context(actorId)), false);
  assert.equal(result.canIssueAccountabilityFunds, false);
  assert.equal(result.canApproveAccountabilityClosure, false);
  assert.equal(capabilities('manager').canDiscoverAccountabilityReview, false);
});

test('accountability root deny blocks discovery and concrete review including legacy reviewer baseline', () => {
  const rules = [rule('accountability.review', 'allow', 'selected', [a]), rule('accountability.access', 'deny')];
  for (const permissionCodes of [[], ['accountability.review']]) {
    const baseline = capabilities('manager', [], permissionCodes);
    assert.equal(baseline.canReviewAccountability, permissionCodes.length > 0);
    assert.equal(baseline.canDiscoverAccountabilityReview, permissionCodes.length > 0);
    const result = capabilities('manager', rules, permissionCodes);
    assert.equal(result.canDiscoverAccountabilityReview, false);
    assert.equal(result.canReviewAccountability, false);
    assert.equal(result.canAccessAccountability, false);
    assert.equal(decideAccess(subject('manager', rules, permissionCodes), 'accountability.review',
      permissionCodes.length > 0, { resourceType: 'user', resourceId: a, ownerUserId: a }), false);
  }
});

// Baselines from the four dashboard services, not a single generic leadership gate:
// deputy_director has leadership dashboard access but is outside the catalog's four-role circle.
const catalogLeaders = ['founder', 'deputy_founder', 'director', 'corporate_director'];
const canonicalRoles = [...catalogLeaders, 'deputy_director', 'manager', 'senior_manager', 'operation_manager', 'hr'];
const dashboards = [
  { variant: 'leadership', flag: 'canViewLeadershipDashboard', roles: [...catalogLeaders, 'deputy_director'], alternative: 'hr' },
  { variant: 'manager', flag: 'canViewManagerDashboard', roles: ['manager', 'senior_manager', 'operation_manager'], alternative: 'hr' },
  { variant: 'hr', flag: 'canViewHrDashboard', roles: ['hr'], alternative: 'manager' },
  { variant: 'operations', flag: 'canViewOperationsDashboard', roles: ['operation_manager'], alternative: 'hr' },
] as const;

for (const { variant, flag, roles, alternative } of dashboards) {
  test(`${flag}: exact service role baseline, independent variant grant and view/access deny`, () => {
    const actionCode = `dashboard.${variant}.view`;
    assert.deepEqual(getAccessAction(actionCode)!.allowedScopes, ['all']);
    for (const roleCode of canonicalRoles) {
      const expected = roles.some((role) => role === roleCode);
      assert.equal(capabilities(roleCode)[flag], expected, roleCode);
      const fallback: AccessSubject = { id: actorId, isActive: true, roleCode, permissionCodes: [] };
      assert.equal(applyAccessCapabilities(fallback, {})[flag], expected, `${roleCode}: primary-role fallback`);
      assert.equal(capabilities(roleCode, [rule(actionCode, 'deny')])[flag], false, `${roleCode}: leaf deny`);
      for (const parent of ['dashboard.view', 'dashboard.access']) {
        const blocked = capabilities(roleCode, [rule(actionCode), rule(parent, 'deny')]);
        for (const dashboard of dashboards) assert.equal(blocked[dashboard.flag], false, `${roleCode}: ${parent}/${dashboard.flag}`);
        assert.equal(blocked.canAccessDashboard, false);
      }
    }
    assert.equal(capabilities(alternative)[flag], false);
    const viewer = subject(alternative, [rule(actionCode)]);
    const original = structuredClone(viewer);
    const granted = applyAccessCapabilities(viewer, {});
    assert.equal(granted[flag], true, 'An alternative dashboard needs a grant, not a role rewrite');
    for (const other of dashboards) if (other.flag !== flag) {
      assert.equal(granted[other.flag], other.roles.some((role) => role === alternative), 'A variant grant does not grant other variants');
    }
    assert.deepEqual(viewer, original, 'Capability projection never mutates roles, permissions or rules');
    assert.equal(capabilities(alternative)[flag], false, 'Removing the grant restores the actual role baseline');
  });
}

const specificationFlags = [
  ['read', 'canReadSpecificationCatalog'],
  ['create', 'canCreateSpecificationCatalog'],
  ['update', 'canUpdateSpecificationCatalog'],
  ['archive', 'canArchiveSpecificationCatalog'],
] as const;
test('canReadSpecificationCatalog: approved read grant retains parent deny, independent locked writes and default', () => {
  for (const roleCode of canonicalRoles) {
    const isLeader = catalogLeaders.includes(roleCode);
    const allow = rule('specification_catalog.read');
    assert.equal(capabilities(roleCode).canReadSpecificationCatalog, isLeader, roleCode);
    const viewer = subject(roleCode, [allow]);
    const original = structuredClone(viewer);
    const granted = applyAccessCapabilities(viewer, {});
    assert.equal(granted.canReadSpecificationCatalog, true, `${roleCode}: approved read grant`);
    for (const [suffix, flag] of specificationFlags) if (suffix !== 'read') {
      assert.equal(granted[flag], isLeader, `${roleCode}: read grant cannot promote catalog writes`);
    }
    assert.deepEqual(viewer, original, 'No role, permission or rule mutation');
    assert.equal(capabilities(roleCode, [rule('specification_catalog.read', 'deny')]).canReadSpecificationCatalog, false);
    const blocked = capabilities(roleCode, [allow, rule('specification_catalog.access', 'deny')]);
    for (const [, flag] of specificationFlags) assert.equal(blocked[flag], false, `${roleCode}: root deny`);
    assert.equal(capabilities(roleCode, [rule('specification_catalog.access')]).canReadSpecificationCatalog, isLeader, 'Root grant alone is not a child read grant');
    assert.equal(capabilities(roleCode).canReadSpecificationCatalog, isLeader, 'Default restores actual role baseline');
  }
});

// The three catalog writes remain locked. Read/access rules use the validated
// manageable-action helper; synthetic write allows cannot promote ordinary roles.
const lockedCatalogRule = (actionCode: string, effect: AccessRule['effect']): AccessRule => {
  const action = getAccessAction(actionCode);
  assert.ok(action);
  assert.equal(action.manageable, false);
  assert.equal(action.constraint, 'policy_decision_required');
  assert.deepEqual(action.allowedScopes, ['all']);
  return { actionCode, effect, scope: 'all', selectedIds: [] };
};
for (const [suffix, flag] of specificationFlags.filter(([suffix]) => suffix !== 'read')) {
  test(`${flag}: locked catalog action preserves only four leader roles and personal deny precedence`, () => {
    const actionCode = `specification_catalog.${suffix}`;
    const allow = lockedCatalogRule(actionCode, 'allow');
    const deny = lockedCatalogRule(actionCode, 'deny');
    const rootDeny = rule('specification_catalog.access', 'deny');
    for (const roleCode of canonicalRoles) {
      const isLeader = catalogLeaders.includes(roleCode);
      assert.equal(capabilities(roleCode)[flag], isLeader, roleCode);
      assert.equal(capabilities(roleCode, [allow])[flag], isLeader, `${roleCode}: locked leaf allow is not promotion`);
      assert.equal(capabilities(roleCode, [deny])[flag], false, `${roleCode}: deny overrides baseline`);
      const blocked = capabilities(roleCode, [allow, rootDeny]);
      for (const [, catalogFlag] of specificationFlags) assert.equal(blocked[catalogFlag], false, `${roleCode}: root deny`);
      if (isLeader) {
        const independent = capabilities(roleCode, [deny]);
        for (const [, otherFlag] of specificationFlags) if (otherFlag !== flag) {
          assert.equal(independent[otherFlag], true, 'Leaf deny does not silently deny independent catalog actions');
        }
      } else {
        const viewer = subject(roleCode, [allow, rule('specification_catalog.access', 'allow')]);
        const original = structuredClone(viewer);
        assert.equal(applyAccessCapabilities(viewer, {})[flag], false, 'Even root plus leaf allow cannot promote an ordinary role');
        assert.deepEqual(viewer, original);
      }
      assert.equal(capabilities(roleCode)[flag], isLeader, 'Removing a rule restores the role baseline');
    }
  });
}
