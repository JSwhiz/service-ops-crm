import assert from 'node:assert/strict';
import test from 'node:test';

import { ObjectsService } from '../src/modules/objects/objects.service';
import type { AccessRule } from '../src/modules/users-access/types/access-policy.type';

function fixture(actionCodes: string[] = [], foreignReader = false) {
  const payloads = [
    { actionCode: 'compensation.version.created', payload: { terms: { baseAmount: 73103 }, reason: 'Rate changed to 73103', label: 'Rate 73103' } },
    { actionCode: 'compensation.version.cancelled', payload: { cancelReason: 'Cancel rate 73104', notes: { before: 'Previous rate 73104' } } },
    { actionCode: 'compensation.team_fund.created', payload: { monthlyAmount: 84203, reason: 'Fund set to 84203', notes: { allocationBasis: '84203 budget basis' } } },
    { actionCode: 'object.updated', payload: { note: 'Public domain note', changes: [{ before: { instructionSteps: ['Private instruction'] }, after: { instructionSteps: ['Updated private instruction'] } }] } },
    { actionCode: 'object.contact.updated', payload: { contactId: 'contact-a', changes: [{ before: { phone: 'Private phone' }, after: { name: 'Private name' } }] } },
    { actionCode: 'object.contacts.updated', payload: { contactName: 'Plural private name', before: { notes: 'Private contact note' } } },
  ];
  const logs = payloads.map((item, index) => ({ ...item, id: `log-${index}`, objectId: 'object',
    createdAt: new Date('2026-11-01T00:00:00Z'), actor: { id: 'other', login: 'other', fullName: 'Other' } }));
  const db = { object: { findFirst: async () => ({ id: 'object', createdByUserId: foreignReader ? 'other' : 'reader', assignments: [] }) } };
  const service = new ObjectsService(db as never, { listObjectAuditLogs: async () => structuredClone(logs) } as never,
    {} as never, {} as never, {} as never, {} as never);
  const role = foreignReader ? 'manager' : 'founder';
  const reader = { id: 'reader', login: 'reader', fullName: 'Reader', isActive: true, roleCode: role,
    roleCodes: [role], permissionCodes: [], accessRules: actionCodes.map((actionCode): AccessRule => ({
      actionCode, effect: 'deny', scope: 'selected', selectedIds: ['object'],
    })) };
  if (foreignReader) Object.assign(logs[3].payload, { monthlyBudget: 84203, budgets: [{ amount: 84203 }] });
  const read = (...rules: AccessRule[]) => {
    const subject = { ...reader, accessRules: [...reader.accessRules, ...rules] };
    return service.listObjectAuditLogs(subject, 'object');
  };
  return { read, logs };
}

test('actual history baseline retains version/team-fund free text and ordinary domain records', async () => {
  const f = fixture();
  const before = structuredClone(f.logs);
  const result = await f.read();
  assert.deepEqual(result.map((row) => row.payload), f.logs.map((row) => row.payload));
  assert.deepEqual(f.logs, before);
});

test('a basic object grant does not reveal compensation history for a foreign object', async () => {
  const { read } = fixture([], true);
  const objectRead: AccessRule = { actionCode: 'objects.read', effect: 'allow', scope: 'selected', selectedIds: ['object'] };
  const budgetRead = { ...objectRead, actionCode: 'objects.budget.read' };
  const result = await read(objectRead, budgetRead);
  const update = result.find((row) => row.actionCode === 'object.updated');
  assert.equal(update?.payload?.monthlyBudget, 84203);
  assert.deepEqual(update?.payload?.budgets, [{}]);
  assert.equal(result.find((row) => row.actionCode === 'compensation.version.created')?.payload, null);
  assert.ok(JSON.stringify(result).includes('Public domain note'));

  const allowed = await read(objectRead, { ...objectRead, actionCode: 'objects.rates.read' });
  const version = allowed.find((row) => row.actionCode === 'compensation.version.created');
  assert.deepEqual(version?.payload?.terms, { baseAmount: 73103 });
});

test('rates deny hides whole version-created/cancelled payloads, including arbitrary free-text money', async () => {
  const result = await fixture(['objects.rates.read']).read();
  for (const code of ['compensation.version.created', 'compensation.version.cancelled']) {
    assert.equal(result.find((row) => row.actionCode === code)?.payload, null, code);
  }
  const fund = result.find((row) => row.actionCode === 'compensation.team_fund.created');
  assert.equal(fund?.payload?.monthlyAmount, 84203);
  assert.equal(fund?.payload?.reason, 'Fund set to 84203');
  assert.equal(JSON.stringify(result).includes('73103'), false);
  assert.equal(JSON.stringify(result).includes('73104'), false);
  assert.ok(JSON.stringify(result).includes('Public domain note'));
});

test('budget deny hides whole team-fund payload/free text while preserving readable version reasons and terms', async () => {
  const result = await fixture(['objects.budget.read']).read();
  assert.equal(result.find((row) => row.actionCode === 'compensation.team_fund.created')?.payload, null);
  assert.equal(JSON.stringify(result).includes('84203'), false);
  const version = result.find((row) => row.actionCode === 'compensation.version.created');
  assert.deepEqual(version?.payload?.terms, { baseAmount: 73103 });
  assert.equal(version?.payload?.reason, 'Rate changed to 73103');
  assert.ok(JSON.stringify(result).includes('Cancel rate 73104'));
});

test('both financial denies leave event metadata/nonfinancial notes but no financial free text', async () => {
  const result = await fixture(['objects.rates.read', 'objects.budget.read']).read();
  assert.equal(result.length, 6, 'Read redaction must not silently destroy history metadata');
  for (const row of result.filter((item) => item.actionCode.startsWith('compensation.'))) assert.equal(row.payload, null);
  assert.ok(JSON.stringify(result).includes('Public domain note'));
});

test('contact singular and plural events hide whole payloads independently of readable material history', async () => {
  const result = await fixture(['objects.contacts.read']).read();
  for (const code of ['object.contact.updated', 'object.contacts.updated']) {
    assert.equal(result.find((row) => row.actionCode === code)?.payload, null, code);
  }
  assert.equal(JSON.stringify(result).includes('Private phone'), false);
  assert.equal(JSON.stringify(result).includes('Plural private name'), false);
  assert.ok(JSON.stringify(result).includes('Private instruction'));
});

test('materials deny recursively hides instructions but preserves contacts and ordinary history notes', async () => {
  const result = await fixture(['objects.materials.read']).read();
  assert.equal(JSON.stringify(result).includes('Private instruction'), false);
  assert.equal(JSON.stringify(result).includes('Updated private instruction'), false);
  assert.ok(JSON.stringify(result).includes('Public domain note'));
  assert.ok(JSON.stringify(result).includes('Private phone'));
});
