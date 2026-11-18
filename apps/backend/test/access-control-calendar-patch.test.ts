import 'reflect-metadata';
import assert from 'node:assert/strict';
import test from 'node:test';
import { plainToInstance } from 'class-transformer';
import { ForbiddenException } from '@nestjs/common';

import { UserAbsencesService } from '../src/modules/user-absences/user-absences.service';
import { UpdateUserAbsenceDto } from '../src/modules/user-absences/dto/user-absence.dto';

// Controlled service boundary, not a substitute for the calendar HTTP/DB suite.
for (const [label, fields, expected] of [
  ['omitted reason preserves stored text', { absenceType: 'sick_leave' }, 'Stored private reason'],
  ['explicit null clears reason', { comment: null }, null],
  ['empty reason clears reason', { comment: '  ' }, null],
  ['explicit reason is trimmed', { comment: ' New reason ' }, 'New reason'],
] as const) {
  test(`transformed calendar PATCH: ${label}`, async () => {
    const payload = plainToInstance(UpdateUserAbsenceDto, fields);
    const current = { id: 'absence', userId: 'recipient', absenceType: 'vacation', startDate: '2040-01-01', endDate: '2040-01-01', comment: 'Stored private reason' };
    const audits: Array<{ newValues?: unknown }> = [];
    let writes = 0;
    const db = {
      $queryRaw: async (query: { sql: string }) => query.sql.includes('FOR UPDATE') ? [{ id: current.userId }] : [],
      $executeRaw: async () => { writes++; return 1; },
    };
    const service = new UserAbsencesService({ $transaction: async (work: (tx: typeof db) => Promise<unknown>) => work(db) } as never,
      { writeAuditEvent: async (value: typeof audits[number]) => { audits.push(value); } } as never);
    Reflect.set(service, 'getById', async () => current);
    await service.update({ id: 'recipient', login: 'recipient', fullName: 'Test', roleCode: 'manager', isActive: true }, current.id, payload);
    assert.equal(writes, 1);
    assert.equal(audits.length, 1);
    assert.equal((audits[0].newValues as { comment: string | null }).comment, expected);
  });
}
test('foreign PATCH metadata works without private-reason permission, but explicit null is forbidden before effects', async () => {
  const current = { id: 'absence', userId: 'foreign', absenceType: 'vacation', startDate: '2040-01-01', endDate: '2040-01-01', comment: 'Private' };
  let writes = 0;
  const db = {
    $queryRaw: async (query: { sql: string }) => query.sql.includes('FOR UPDATE') ? [{ id: current.userId }] : [],
    $executeRaw: async () => { writes++; return 1; },
  };
  const audits: Array<{ newValues?: unknown }> = [];
  const service = new UserAbsencesService({ $transaction: async (work: (tx: typeof db) => Promise<unknown>) => work(db) } as never,
    { writeAuditEvent: async (value: typeof audits[number]) => { audits.push(value); } } as never);
  Reflect.set(service, 'getById', async () => current);
  const actor = { id: 'recipient', login: 'recipient', fullName: 'Test', roleCode: 'manager', isActive: true,
    accessRules: ['user_absences.update', 'user_absences.manage'].map((actionCode) => ({ actionCode, effect: 'allow' as const, scope: 'selected' as const, selectedIds: ['foreign'] })) };
  await service.update(actor, current.id, plainToInstance(UpdateUserAbsenceDto, { absenceType: 'sick_leave' }));
  assert.equal(writes, 1);
  assert.equal((audits[0].newValues as { comment: string }).comment, 'Private');
  await assert.rejects(service.update(actor, current.id, plainToInstance(UpdateUserAbsenceDto, { comment: null })), ForbiddenException);
  assert.equal(writes, 1);
  assert.equal(audits.length, 1);
});
