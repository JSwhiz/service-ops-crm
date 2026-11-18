import 'reflect-metadata';
import assert from 'node:assert/strict';
import test from 'node:test';
import { BadRequestException } from '@nestjs/common';
import { ACCESS_ACTION_CATALOG } from '../src/modules/users-access/access-action-catalog';
import { AccessAdminService } from '../src/modules/users-access/access-admin.service';
import { buildAccessWhere, decideAccess } from '../src/modules/users-access/utils/access-policy.util';
import type { AccessChange, AccessSubject } from '../src/modules/users-access/types/access-policy.type';

const actions = ACCESS_ACTION_CATALOG.filter(a => a.module === 'accountability');
const actor = { id: 'founder', isActive: true, roleCodes: ['founder'] };

test('management scopes retain 15 user-account actions and current approved metadata restrictions', () => {
  assert.equal(actions.length, 15);
  for (const action of actions) {
    assert.equal(action.resourceType, 'user');
    assert.deepEqual(action.allowedScopes, ['own','assigned','selected','all']);
    assert.deepEqual(action.managementScopes, ['own','selected','all']);
  }
  assert.deepEqual(ACCESS_ACTION_CATALOG
    .filter(a => a.module !== 'accountability' && a.managementScopes !== undefined)
    .map(a => ({ code: a.code, scopes: a.managementScopes }))
    .sort((a, b) => a.code.localeCompare(b.code)), [
    { code: 'candidates.restore', scopes: ['selected','all'] },
    { code: 'objects.substitutions.read', scopes: ['assigned','selected'] },
  ]);
  assert.deepEqual(ACCESS_ACTION_CATALOG.find(a => a.code === 'inventory.movement.photos.create')?.allowedScopes, ['own']);
  assert.deepEqual(actions.filter(a => !a.manageable).map(a => a.code).sort(), [
    'accountability.closure.approve','accountability.closure.reject',
  ].sort());
  assert(actions.filter(a => !a.manageable).every(a => a.constraint === 'policy_decision_required'));
  for (const code of ['accountability.expenses.approve','accountability.expenses.reject']) {
    const action = actions.find(a => a.code === code);
    assert.ok(action);
    assert.equal(action.manageable, true);
    assert.equal(action.constraint, undefined);
  }
});

test('preview and save reject every new/changed assigned override before opening any transaction', async () => {
  let transactions = 0;
  const service = new AccessAdminService({ $transaction: async () => { transactions++; throw new Error('Unexpected DB call'); } } as never);
  for (const action of actions) for (const effect of ['allow','deny'] as const) {
    const payload = { expectedVersion: 0, reason: 'Scope restriction', changes: [{ actionCode: action.code, effect, scope: 'assigned' as const, selectedIds: [] }] };
    for (const operation of ['preview','save'] as const) {
      const pending = operation === 'preview' ? service.preview(actor, 'recipient', payload)
        : service.save(actor, 'recipient', { ...payload, previewToken: 'a'.repeat(64), previewHash: 'b'.repeat(64) });
      await assert.rejects(pending, (error: unknown) => error instanceof BadRequestException && error.getStatus() === 400
        && (action.manageable ? error.message.includes('По умолчанию') : error.message.includes('Action is constrained')));
    }
  }
  assert.equal(transactions, 0);
});

test('normalization permits explicit default with the stored assigned scope, including constrained actions', () => {
  const service = new AccessAdminService({} as never) as unknown as {
    normalize(input: { expectedVersion: number; reason: string; changes: AccessChange[] }): { changes: AccessChange[] };
  };
  const changes: AccessChange[] = actions.map(a => ({ actionCode: a.code, effect: 'default', scope: 'assigned', selectedIds: [] }));
  const normalized = service.normalize({ expectedVersion: 4, reason: 'Explicit legacy reset', changes });
  assert(normalized.changes.every(c => c.effect === 'default' && c.scope === 'assigned'));
  assert.equal(normalized.changes.length, 15);
});

test('legacy assigned direct decisions and account-list missing-adapter behavior retain their previous results', () => {
  for (const action of actions) for (const effect of ['allow','deny'] as const) {
    const subject: AccessSubject = { ...actor, accessRules: [{ actionCode: action.code, effect, scope: 'assigned', selectedIds: [] }] };
    const context = { resourceType: 'user', resourceId: 'account-owner', ownerUserId: 'account-owner' };
    assert.equal(decideAccess(subject, action.code, true, context), true, 'No assignedUserIds: scoped rule does not match a direct account decision');
    assert.equal(decideAccess(subject, action.code, false, context), false, 'No grant may fabricate assignment');
    const where = buildAccessWhere({ subject, actionCode: action.code, legacyWhere: {}, invariantWhere: {}, scopeWhere: r => r.scope === 'all' ? {} : null });
    const baseline = buildAccessWhere({ subject: actor, actionCode: action.code, legacyWhere: {}, invariantWhere: {}, scopeWhere: () => null });
    if (effect === 'allow') assert.deepEqual(where, baseline, 'Unsupported list grant adds no rows');
    else assert.notDeepEqual(where, baseline, 'Missing list deny adapter remains fail closed, not silently reinterpreted');
  }
});
