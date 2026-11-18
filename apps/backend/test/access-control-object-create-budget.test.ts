import assert from 'node:assert/strict';
import test from 'node:test';

import { ObjectSetupService } from '../src/modules/objects/object-setup.service';
import { canCreateObject } from '../src/modules/objects/utils/object-access.util';
import { getAccessAction } from '../src/modules/users-access/access-action-catalog';
import type { AccessRule, AccessSubject } from '../src/modules/users-access/types/access-policy.type';
import { applyAccessCapabilities } from '../src/modules/users-access/utils/auth-access-capabilities.util';
import { decideAccess, hasModuleDeny } from '../src/modules/users-access/utils/access-policy.util';

const actorId = '00000000-0000-4000-8000-000000000001';
const existingId = '00000000-0000-4000-8000-000000000002';
const rule = (actionCode: string, effect: AccessRule['effect'], scope: AccessRule['scope']): AccessRule => {
  const action = getAccessAction(actionCode);
  assert.ok(action?.manageable && action.allowedScopes.includes(scope), `${actionCode}:${scope}`);
  return { actionCode, effect, scope, selectedIds: scope === 'selected' ? [existingId] : [] };
};
const subject = (role: string, accessRules: AccessRule[] = [], permissionCodes: string[] = []): AccessSubject =>
  ({ id: actorId, roleCode: role, roleCodes: [role], isActive: true, accessRules, permissionCodes });
const project = (actor: AccessSubject) => applyAccessCapabilities(actor, {
  canCreateObject: canCreateObject([actor.roleCode!]),
});

test('new-object budget projection respects actual setup role, owner scopes and explicit denies', () => {
  assert.equal(project(subject('founder')).canCreateObjectBudget, true);
  assert.equal(project(subject('director')).canCreateObjectBudget, true);
  assert.equal(project(subject('deputy_founder')).canCreateObjectBudget, false);
  assert.equal(project(subject('deputy_founder', [], ['object.budget_edit'])).canCreateObjectBudget, true);
  for (const scope of ['own', 'all'] as const)
    assert.equal(project(subject('deputy_founder', [rule('objects.budget.edit', 'allow', scope)])).canCreateObjectBudget, true);
  for (const scope of ['selected', 'assigned'] as const)
    assert.equal(project(subject('deputy_founder', [rule('objects.budget.edit', 'allow', scope)])).canCreateObjectBudget, false);
  assert.equal(project(subject('manager', [rule('objects.create', 'allow', 'all'), rule('objects.budget.edit', 'allow', 'all')])).canCreateObjectBudget, false, 'Setup retains its independent role guard');
  assert.equal(project(subject('founder', [rule('objects.budget.edit', 'deny', 'own')])).canCreateObjectBudget, false);
  assert.equal(project(subject('founder', [rule('objects.budget.edit', 'deny', 'selected')])).canCreateObjectBudget, true, 'An existing object is not the new object');
  assert.equal(project(subject('founder', [rule('objects.read', 'deny', 'own')])).canCreateObjectBudget, false);
  assert.equal(project(subject('founder', [rule('objects.access', 'deny', 'all')])).canCreateObjectBudget, false);
  assert.equal(project(subject('founder', [rule('objects.access', 'deny', 'own')])).canCreateObjectBudget, false);
  assert.equal(project(subject('founder', [rule('objects.access', 'deny', 'selected')])).canCreateObjectBudget, true);
  assert.equal(project(subject('founder', [rule('objects.create', 'deny', 'all')])).canCreateObjectBudget, false);
  assert.equal(project({ ...subject('founder'), isActive: false }).canCreateObjectBudget, false);
});

test('projection agrees with actual active setup field capability for eligible creators', () => {
  const setupCapabilities = (ObjectSetupService as unknown as { capabilities: (user: AccessSubject, object: { id: string; createdByUserId: string; status: string; assignments: never[] }) => { canEditBudgets: boolean } }).capabilities;
  for (const actor of [subject('founder'), subject('deputy_founder'),
    subject('deputy_founder', [rule('objects.budget.edit', 'allow', 'own')]),
    subject('founder', [rule('objects.budget.edit', 'deny', 'all')]),
    subject('director', [rule('objects.read', 'deny', 'own')])]) {
    const actual = setupCapabilities(actor, { id: 'new-object-id', createdByUserId: actor.id, status: 'active', assignments: [] });
    assert.equal(project(actor).canCreateObjectBudget, actual.canEditBudgets);
  }
  const founder = subject('founder');
  const deputy = subject('deputy_founder', [rule('objects.budget.edit', 'allow', 'all')]);
  const object = { id: 'new-object-id', createdByUserId: actorId, status: 'frozen', assignments: [] as never[] };
  assert.equal(setupCapabilities(founder, object).canEditBudgets, true);
  assert.equal(setupCapabilities(deputy, object).canEditBudgets, false);
  assert.equal(setupCapabilities(founder, { ...object, status: 'archived' }).canEditBudgets, false);
});

test('file upload owner context remains independent of object budget capability', () => {
  assert.equal(project(subject('founder', [rule('files.access', 'deny', 'own')])).canUploadFile, false);
  assert.equal(project(subject('founder', [rule('files.access', 'deny', 'selected')])).canUploadFile, true);
});

test('new object admission accounts for inevitable owner read and root denies', () => {
  const createGrant = rule('objects.create', 'allow', 'all');
  assert.equal(project(subject('manager', [createGrant])).canCreateObject, true);
  assert.equal(project(subject('manager', [createGrant, rule('objects.read', 'deny', 'own')])).canCreateObject, false);
  assert.equal(project(subject('manager', [createGrant, rule('objects.access', 'deny', 'own')])).canCreateObject, false);
  assert.equal(project(subject('manager', [createGrant, rule('objects.read', 'deny', 'selected')])).canCreateObject, true);
});

test('new inventory and equipment discovery subtracts inevitable read denies, not selected existing IDs', () => {
  for (const [create, read, root, flag] of [
    ['inventory.catalog.create', 'inventory.read', 'inventory.access', 'canCreateInventoryItem'],
    ['equipment.unit.create', 'equipment.read', 'equipment.access', 'canCreateEquipmentUnit'],
  ] as const) {
    const grant = rule(create, 'allow', 'all');
    assert.equal(project(subject('manager', [grant]))[flag], true);
    assert.equal(project(subject('manager', [grant, rule(read, 'deny', 'all')]))[flag], false);
    assert.equal(project(subject('manager', [grant, rule(root, 'deny', 'all')]))[flag], false);
    assert.equal(project(subject('manager', [grant, rule(read, 'deny', 'selected')]))[flag], true);
    assert.equal(project(subject('manager', [grant, rule(root, 'deny', 'selected')]))[flag], true);
    // own is not a supported catalog scope: malformed persisted denies fail
    // closed globally and malformed allows never grant, irrespective of owner.
    assert.equal(getAccessAction(read)?.allowedScopes.includes('own'), false);
    const invalidDeny: AccessRule = { actionCode: read, effect: 'deny', scope: 'own', selectedIds: [] };
    const invalidAllow: AccessRule = { actionCode: read, effect: 'allow', scope: 'own', selectedIds: [] };
    assert.equal(project(subject('manager', [grant, invalidDeny]))[flag], false);
    const context = { resourceType: getAccessAction(read)!.resourceType, ownerUserId: existingId };
    assert.equal(hasModuleDeny(subject('manager', [invalidDeny]), read, context), true);
    assert.equal(decideAccess(subject('manager', [invalidAllow]), read, false, context), false);
  }
});

test('new task discovery subtracts owner and global read/root denies only', () => {
  assert.equal(project(subject('manager')).canCreateTask, true);
  for (const code of ['tasks.read', 'tasks.access']) {
    assert.equal(project(subject('manager', [rule(code, 'deny', 'own')])).canCreateTask, false);
    assert.equal(project(subject('manager', [rule(code, 'deny', 'all')])).canCreateTask, false);
    assert.equal(project(subject('manager', [rule(code, 'deny', 'selected')])).canCreateTask, true);
    assert.equal(project(subject('manager', [rule(code, 'deny', 'assigned')])).canCreateTask, true);
  }
});

