import 'reflect-metadata';
import assert from 'node:assert/strict';
import test from 'node:test';
import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AccessAdminService } from '../src/modules/users-access/access-admin.service';

const payload = { expectedVersion: 0, reason: 'Controlled transaction boundary test',
  changes: [{ actionCode: 'timesheet.amount.edit', effect: 'allow' as const, scope: 'own' as const }] };
const actor = { id: 'actor', isActive: true, roleCodes: ['founder'] };

for (const operation of ['preview', 'save'] as const) {
  test(`${operation}: bounded serializable transaction and no automatic replay on expiration`, async () => {
    let calls = 0;
    const db = { $transaction: async (_work: unknown, options: unknown) => {
      calls++;
      assert.deepEqual(options, { isolationLevel: 'Serializable', maxWait: 5000, timeout: 15000 });
      throw new Prisma.PrismaClientKnownRequestError('Expired transaction', { code: 'P2028', clientVersion: 'test' });
    } };
    const service = new AccessAdminService(db as never);
    const request = operation === 'preview' ? service.preview(actor, 'target', payload)
      : service.save(actor, 'target', { ...payload, previewHash: 'a'.repeat(64), previewToken: 'b'.repeat(64) });
    await assert.rejects(request, (error: unknown) => error instanceof ConflictException
      && error.getStatus() === 409 && error.message.includes('проверьте историю изменений'));
    assert.equal(calls, 1, 'Never silently repeat an administrative save');
  });
  test(`${operation}: serialization conflict remains a refresh/preview conflict`, async () => {
    const service = new AccessAdminService({ $transaction: async () => {
      throw new Prisma.PrismaClientKnownRequestError('Concurrent write', { code: 'P2034', clientVersion: 'test' });
    } } as never);
    const request = operation === 'preview' ? service.preview(actor, 'target', payload)
      : service.save(actor, 'target', { ...payload, previewHash: 'a'.repeat(64), previewToken: 'b'.repeat(64) });
    await assert.rejects(request, (error: unknown) => error instanceof ConflictException && error.getStatus() === 409);
  });
}
