import 'reflect-metadata';

import assert from 'node:assert/strict';
import test from 'node:test';

import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import { CompensationMonthDto } from '../src/modules/object-scheduling/compensation.dto';
import { ObjectCompensationController } from '../src/modules/object-scheduling/object-compensation.controller';
import { ObjectCompensationService } from '../src/modules/object-scheduling/object-compensation.service';
import type { AccessRule } from '../src/modules/users-access/types/access-policy.type';

const primary = 'a1111111-1111-4111-8111-111111111111';
const control = 'b2222222-2222-4222-8222-222222222222';
type CreditQuery = { where: { objectId: string; employeeId?: string; operationDate: { gte: Date; lte: Date } } };
function fixture(rules: AccessRule[] = []) {
  const date = new Date('2026-11-02T00:00:00Z');
  const credits = [
    { id: 'primary-credit', employeeId: primary, objectId: 'object', operationDate: date, amount: 73103, sourceKey: 'extra:primary', policySnapshot: null },
    { id: 'control-credit', employeeId: control, objectId: 'object', operationDate: date, amount: 84203, sourceKey: 'extra:control', policySnapshot: null },
  ];
  const queries: CreditQuery[] = [];
  const employeeQueries: Array<{ where: { id: { in: string[] } } }> = [];
  const db = {
    object: { findFirst: async () => ({ id: 'object', status: 'active', createdByUserId: 'reader', assignments: [] }) },
    objectPayrollCredit: { findMany: async (query: CreditQuery) => {
      queries.push(query);
      return credits.filter((row) => row.objectId === query.where.objectId &&
        (!query.where.employeeId || row.employeeId === query.where.employeeId) &&
        row.operationDate >= query.where.operationDate.gte && row.operationDate <= query.where.operationDate.lte);
    } },
    employee: { findMany: async (query: { where: { id: { in: string[] } } }) => {
      employeeQueries.push(query);
      return [{ id: primary, fullName: 'Primary employee' }, { id: control, fullName: 'Control employee' }]
        .filter((row) => query.where.id.in.includes(row.id));
    } },
  };
  const reader = { id: 'reader', login: 'reader', fullName: 'Reader', roleCode: 'founder', roleCodes: ['founder'],
    permissionCodes: [], isActive: true, accessRules: rules };
  return { service: new ObjectCompensationService(db as never), reader, queries, employeeQueries };
}

test('optional employee filter narrows the credit repository query before loading or mapping', async () => {
  const f = fixture();
  const result = await f.service.explanation(f.reader, 'object', 2026, 11, primary);
  assert.equal(f.queries.length, 1);
  assert.equal(f.queries[0].where.employeeId, primary);
  assert.equal(f.queries[0].where.objectId, 'object');
  assert.deepEqual(f.queries[0].where.operationDate, { gte: new Date('2026-11-01T00:00:00Z'), lte: new Date('2026-11-30T00:00:00Z') });
  assert.deepEqual(f.employeeQueries[0].where.id.in, [primary]);
  assert.deepEqual(result.rows.map((row) => row.employeeId), [primary]);
  assert.equal(result.rows[0].entries[0].amount, 73103);
  assert.equal(JSON.stringify(result).includes('84203'), false);
});

test('four-argument explanation remains compatible and returns both independently readable employees', async () => {
  const f = fixture();
  const result = await f.service.explanation(f.reader, 'object', 2026, 11);
  assert.equal(Object.hasOwn(f.queries[0].where, 'employeeId'), false);
  assert.deepEqual(result.rows.map((row) => row.employeeId), [primary, control]);
  assert.deepEqual(result.rows.map((row) => row.entries[0].amount), [73103, 84203]);
});

test('explicit employee selection cannot resurrect a denied Employee, with control retained for old callers', async () => {
  const f = fixture([{ actionCode: 'employees.view', effect: 'deny', scope: 'selected', selectedIds: [primary] }]);
  const selected = await f.service.explanation(f.reader, 'object', 2026, 11, primary);
  assert.deepEqual(selected.rows, []);
  assert.equal(JSON.stringify(selected).includes('73103'), false);
  const legacy = await f.service.explanation(f.reader, 'object', 2026, 11);
  assert.deepEqual(legacy.rows.map((row) => row.employeeId), [control]);
  assert.equal(JSON.stringify(legacy).includes('Primary employee'), false);
  assert.equal(legacy.rows[0].entries[0].amount, 84203);
});

test('controller forwards optional employee UUID and DTO rejects malformed identities without requiring the field', async () => {
  const calls: unknown[][] = [];
  const controller = new ObjectCompensationController({ explanation: async (...args: unknown[]) => { calls.push(args); return { rows: [] }; } } as never, {} as never);
  const reader = fixture().reader;
  await controller.explanation(reader, 'object', { year: 2026, month: 11, employeeId: primary });
  await controller.explanation(reader, 'object', { year: 2026, month: 11 });
  assert.deepEqual(calls, [[reader, 'object', 2026, 11, primary], [reader, 'object', 2026, 11, undefined]]);
  assert.deepEqual(validateSync(plainToInstance(CompensationMonthDto, { year: 2026, month: 11 })), []);
  assert.deepEqual(validateSync(plainToInstance(CompensationMonthDto, { year: 2026, month: 11, employeeId: primary })), []);
  assert.ok(validateSync(plainToInstance(CompensationMonthDto, { year: 2026, month: 11, employeeId: 'not-a-uuid' }))
    .some((error) => error.property === 'employeeId'));
});
