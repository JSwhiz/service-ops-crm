import 'reflect-metadata';

import assert from 'node:assert/strict';
import test from 'node:test';

import { ForbiddenException } from '@nestjs/common';

import { ObjectCompensationService } from '../src/modules/object-scheduling/object-compensation.service';
import type { AccessRule } from '../src/modules/users-access/types/access-policy.type';

type Operation = 'version' | 'cancel' | 'teamFund';
const selected = (actionCode: string, effect: 'allow' | 'deny', ids: string[]): AccessRule => ({ actionCode, effect, scope: 'selected', selectedIds: ids });
const leaf = (operation: Operation) => operation === 'teamFund' ? 'objects.budget.edit' : 'objects.rates.manage';

// These are pre-effect authorization tests of the real service. A unique
// sentinel at the actual create/update boundary proves all preceding guards
// passed; no repository write, money calculation, audit or DB call executes.
function fixture() {
  const future = new Date(Date.now() + 3 * 60 * 60 * 1000 + 3 * 24 * 60 * 60 * 1000);
  const effectiveFrom = future.toISOString().slice(0, 10);
  const object = (id: string) => ({ id, status: 'active', deletedAt: null, createdByUserId: 'other', assignments: [],
    planningSettings: null, seasonMode: 'default' });
  const objects = [object('foreign-a'), object('control-b')];
  const boundary = new Error('AUTHORIZED_PRE_EFFECT_BOUNDARY');
  const reached: string[] = [];
  const stop = (name: string) => async () => { reached.push(name); throw boundary; };
  const tx = {
    object: { findFirst: async ({ where }: { where: { id: string } }) => structuredClone(objects.find((row) => row.id === where.id) ?? null) },
    $queryRaw: async () => [],
    objectCompensationVersion: {
      findUnique: async () => null,
      findFirst: async ({ where }: { where: { id?: string; objectId: string } }) => where.id ? {
        id: where.id, objectId: where.objectId, version: 1, effectiveFrom: new Date(`${effectiveFrom}T00:00:00Z`), cancelledAt: null,
      } : null,
      create: stop('version-create'), update: stop('version-cancel'),
    },
    objectTeamFundVersion: { findUnique: async () => null, findFirst: async () => null, create: stop('fund-create') },
  };
  const db = { ...tx, $transaction: async <T>(handler: (client: typeof tx) => Promise<T>) => handler(tx) };
  const service = new ObjectCompensationService(db as never);
  const reader = { id: 'reader', login: 'reader', fullName: 'Foreign leaf reader', isActive: true,
    roleCode: 'manager', roleCodes: ['manager'], permissionCodes: [] as string[], accessRules: [
      selected('objects.read', 'allow', objects.map((row) => row.id)),
    ] };
  const invoke = (operation: Operation, objectId: string) => {
    if (operation === 'version') return service.version(reader, objectId, {
      requestKey: 'unit-version', scope: 'defaults', expectedVersion: 0, effectiveFrom,
      terms: { ratePolicyType: 'daily_rate', baseAmount: 100, scheduleCode: '7/0', scheduleCycleStartDate: effectiveFrom },
    });
    if (operation === 'cancel') return service.cancelVersion(reader, objectId, 'future-version', {
      expectedVersion: 1, reason: 'Authorization boundary only',
    });
    return service.teamFund(reader, objectId, { requestKey: 'unit-fund', expectedVersion: 0,
      effectiveFrom, monthlyAmount: 1000, allocations: [], reason: 'Authorization boundary only' });
  };
  return { reader, objects, reached, boundary, invoke };
}

for (const operation of ['version', 'cancel', 'teamFund'] as const) {
  test(`${operation}: readable foreign A plus selected leaf reaches write boundary without generic manage grant`, async () => {
    const f = fixture();
    f.reader.accessRules.push(selected(leaf(operation), 'allow', ['foreign-a']));
    assert.equal(f.reader.accessRules.some((rule) => rule.actionCode === 'objects.compensation.manage'), false);
    await assert.rejects(f.invoke(operation, 'foreign-a'), (error) => error === f.boundary);
    assert.equal(f.reached.length, 1);
  });
  test(`${operation}: selected foreign A leaf cannot authorize readable control B`, async () => {
    const f = fixture();
    f.reader.accessRules.push(selected(leaf(operation), 'allow', ['foreign-a']));
    await assert.rejects(f.invoke(operation, 'control-b'), ForbiddenException);
    assert.deepEqual(f.reached, []);
  });
  test(`${operation}: leaf allow without positive root read cannot reach effects`, async () => {
    const f = fixture();
    f.reader.accessRules = [selected(leaf(operation), 'allow', ['foreign-a'])];
    await assert.rejects(f.invoke(operation, 'foreign-a'), ForbiddenException);
    assert.deepEqual(f.reached, []);
  });
  test(`${operation}: generic compensation manage deny remains a constraint on otherwise valid selected leaf`, async () => {
    const f = fixture();
    f.reader.accessRules.push(selected(leaf(operation), 'allow', ['foreign-a']), selected('objects.compensation.manage', 'deny', ['foreign-a']));
    await assert.rejects(f.invoke(operation, 'foreign-a'), ForbiddenException);
    assert.deepEqual(f.reached, []);
  });
}

test('legacy budget permission alone does not extend to a foreign object merely opened by root-read grant', async () => {
  const f = fixture();
  f.reader.permissionCodes.push('object.budget_edit');
  await assert.rejects(f.invoke('teamFund', 'foreign-a'), ForbiddenException);
  assert.deepEqual(f.reached, []);
});

test('legacy budget permission preserves its real own-object scope without a new personal budget grant', async () => {
  const f = fixture();
  f.reader.permissionCodes.push('object.budget_edit');
  f.objects[0].createdByUserId = f.reader.id;
  await assert.rejects(f.invoke('teamFund', 'foreign-a'), (error) => error === f.boundary);
  assert.deepEqual(f.reached, ['fund-create']);
});
