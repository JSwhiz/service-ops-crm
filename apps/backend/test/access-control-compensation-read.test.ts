import assert from 'node:assert/strict';
import test from 'node:test';

import { ForbiddenException } from '@nestjs/common';

import { ObjectCompensationService } from '../src/modules/object-scheduling/object-compensation.service';
import type { SchedulingUser } from '../src/modules/object-scheduling/scheduling.types';
import type { AccessRule } from '../src/modules/users-access/types/access-policy.type';

// Actual service, read-only in-memory repositories. SQL truth and HTTP belong
// to main's isolated runner; these mocks do not simulate authorization results.
function fixture(rules: AccessRule[] = []) {
  const object = { id: 'object-a', createdByUserId: 'reader', status: 'active', deletedAt: null,
    assignments: [{ userId: 'reader', assignmentRoleCode: 'manager', isActive: true }] };
  const date = new Date('2026-11-01T00:00:00Z');
  const versions = [{ id: 'version-a', objectId: object.id, scope: 'defaults', scopeId: object.id,
    version: 1, effectiveFrom: date, createdByUserId: 'reader', terms: { baseAmount: 73103, nested: { dailyRate: 73104 } } }];
  const teamFunds = [{ id: 'fund-a', objectId: object.id, version: 1, effectiveFrom: date, createdByUserId: 'reader',
    monthlyAmount: 84203, allocations: [{ employeeId: 'primary', amount: 84204 }] }];
  const adjustments = [
    { id: 'adjustment-a', objectId: object.id, kind: 'replacement', employeeId: 'primary', operationDate: date,
      createdByUserId: 'reader', appliedByUserId: null, amount: 95303,
      payload: { replacementEmployeeId: 'replacement', nested: { amount: 95304 } },
      beforeSnapshot: [{ employeeId: 'before-employee', amount: 95305 }],
      afterSnapshot: [{ employeeId: 'after-employee', dailyRateSnapshot: 95306 }] },
    { id: 'adjustment-control', objectId: object.id, kind: 'extra_work', employeeId: 'control', operationDate: date,
      createdByUserId: 'reader', appliedByUserId: null, amount: 100,
      payload: {}, beforeSnapshot: {}, afterSnapshot: null },
  ];
  const calls: string[] = [];
  const repository = <T>(name: string, rows: T[]) => ({ findMany: async () => { calls.push(name); return structuredClone(rows); } });
  const db = {
    object: { findFirst: async () => structuredClone(object) },
    objectCompensationVersion: repository('versions', versions), objectTeamFundVersion: repository('teamFunds', teamFunds),
    objectCompensationAdjustment: repository('adjustments', adjustments),
    objectPayrollCredit: repository('credits', [{ id: 'credit', employeeId: 'primary', sourceKey: 'extra:adjustment-a', amount: 95307,
      updatedAt: date, operationDate: date, policySnapshot: null }]),
    user: repository('users', [{ id: 'reader', fullName: 'Reader' }]),
    employee: repository('employees', [{ id: 'primary', fullName: 'Primary' }]),
  };
  const reader: SchedulingUser = { id: 'reader', login: 'reader', fullName: 'Reader', roleCode: 'manager',
    roleCodes: ['manager'], permissionCodes: [], isActive: true, accessRules: rules };
  return { service: new ObjectCompensationService(db as never), reader, calls, versions, teamFunds, adjustments, object };
}
const deny = (actionCode: string, selectedIds = ['object-a']): AccessRule => ({ actionCode, effect: 'deny', scope: 'selected', selectedIds });

test('compensation baseline retains real nested versions/funds/adjustments, never fake zero redaction', async () => {
  const f = fixture();
  const result = await f.service.list(f.reader, f.object.id);
  assert.deepEqual(result.versions[0].terms, f.versions[0].terms);
  assert.deepEqual(result.teamFunds[0].allocations, [{ employeeId: 'primary', amount: 84204 }]);
  assert.equal(result.adjustments.length, 2);
  assert.deepEqual(result.adjustments[0].afterSnapshot, f.adjustments[0].afterSnapshot);
  assert.deepEqual([result.capabilities.canReadRates, result.capabilities.canReadTeamFund, result.capabilities.canReadAdjustments], [true, true, true]);
});

for (const [action, hidden, retained] of [
  ['objects.rates.read', 'versions', 'teamFunds'], ['objects.budget.read', 'teamFunds', 'versions'],
] as const) {
  test(`${action} deny omits exact denied arrays/adjustments while preserving the independent financial branch`, async () => {
    const f = fixture([deny(action)]);
    const result = await f.service.list(f.reader, f.object.id);
    assert.deepEqual(result[hidden], []);
    assert.deepEqual(result.adjustments, [], 'No partial before/after/payload/credit snapshots may survive');
    assert.equal(result[retained].length, 1);
    assert.equal(f.calls.includes(hidden), false, 'Denied financial repository must not be read');
    assert.equal(f.calls.includes('adjustments'), false);
    assert.equal(f.calls.includes('credits'), false);
    assert.equal(result.capabilities.canReadRates, action !== 'objects.rates.read');
    assert.equal(result.capabilities.canReadTeamFund, action !== 'objects.budget.read');
    assert.equal(result.capabilities.canReadAdjustments, false);
    assert.equal(result.capabilities.requestAdjustment, false);
    assert.equal(result.capabilities.requestExtraWork, false);
    assert.equal(result.capabilities.approveRetroactive, false);
    const body = JSON.stringify(result);
    for (const secret of action === 'objects.rates.read' ? ['73103', '73104'] : ['84203', '84204']) assert.equal(body.includes(secret), false);
    for (const secret of ['95303', '95304', '95305', '95306', '95307']) assert.equal(body.includes(secret), false);
  });
}

for (const employeeId of ['primary', 'replacement', 'before-employee', 'after-employee']) {
  test(`actual adjustment Employee ${employeeId} deny removes only that adjustment's complete nested payload`, async () => {
    const f = fixture([deny('employees.view', [employeeId])]);
    const result = await f.service.list(f.reader, f.object.id);
    assert.deepEqual(result.adjustments.map((row) => row.id), ['adjustment-control']);
    assert.equal(result.versions.length, 1);
    assert.equal(result.teamFunds.length, 1);
    assert.equal(JSON.stringify(result.adjustments).includes('9530'), false);
  });
}

test('root read denial wins over compensation/rate/budget all grants before reading financial repositories', async () => {
  const f = fixture([deny('objects.read'), ...['objects.compensation.read', 'objects.rates.read', 'objects.budget.read'].map((actionCode): AccessRule => ({
    actionCode, effect: 'allow', scope: 'all', selectedIds: [],
  }))]);
  await assert.rejects(f.service.list(f.reader, f.object.id), ForbiddenException);
  assert.deepEqual(f.calls, []);
});

test('explanation rejects rate denial before credits are loaded; unrelated selected deny keeps positive output', async () => {
  const denied = fixture([deny('objects.rates.read')]);
  await assert.rejects(denied.service.explanation(denied.reader, denied.object.id, 2026, 11), ForbiddenException);
  assert.equal(denied.calls.includes('credits'), false);
  const allowed = fixture([deny('objects.rates.read', ['different-object'])]);
  const result = await allowed.service.explanation(allowed.reader, allowed.object.id, 2026, 11);
  assert.equal(result.rows[0].entries[0].amount, 95307);
});

test('explanation hides a denied Employee row rather than returning its amounts under a redacted name', async () => {
  const f = fixture([deny('employees.view', ['primary'])]);
  const result = await f.service.explanation(f.reader, f.object.id, 2026, 11);
  assert.deepEqual(result.rows, []);
  assert.equal(JSON.stringify(result).includes('95307'), false);
});

test('explanation rejects budget denial as well, before reading saved monetary credits', async () => {
  const f = fixture([deny('objects.budget.read')]);
  await assert.rejects(f.service.explanation(f.reader, f.object.id, 2026, 11), ForbiddenException);
  assert.equal(f.calls.includes('credits'), false);
});
