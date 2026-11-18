import assert from 'node:assert/strict';
import test from 'node:test';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { RubberMatsService } from '../src/modules/rubber-mats/rubber-mats.service';
import type { AccessRule } from '../src/modules/users-access/types/access-policy.type';

function fixture(linked = true, accessRules: AccessRule[] = []) {
  let historyReads = 0;
  const actor = { id: 'actor', fullName: 'Visible event actor' };
  const source = [
    { id: 'private-registration', action: 'registered', fromObjectId: null, toObjectId: 'private',
      fromCondition: null, toCondition: 'good', fromZone: null, toZone: 'Private registration zone',
      note: 'Private registration note', actor: { id: 'hidden-author', fullName: 'Private author' } },
    { id: 'local-registration', action: 'registered', fromObjectId: null, toObjectId: 'target',
      fromCondition: null, toCondition: 'good', fromZone: null, toZone: 'Entrance', note: 'Local registration', actor },
    { id: 'incoming', action: 'moved', fromObjectId: 'private', toObjectId: 'target',
      fromCondition: 'worn', toCondition: 'good', fromZone: 'Private source zone', toZone: 'Entrance', note: 'Incoming move', actor },
    { id: 'outgoing', action: 'moved', fromObjectId: 'target', toObjectId: 'private',
      fromCondition: 'good', toCondition: 'worn', fromZone: 'Entrance', toZone: 'Private destination zone', note: 'Outgoing move', actor },
    { id: 'local-service', action: 'serviced', fromObjectId: 'target', toObjectId: 'target',
      fromCondition: 'worn', toCondition: 'good', fromZone: 'Entrance', toZone: 'Hall', note: 'Local service', actor },
  ].map(row => ({ ...row, occurredAt: new Date('2026-11-01T00:00:00Z') }));
  let query: unknown;
  const db = {
    object: { findFirst: async () => ({ id: 'target', createdByUserId: 'reader', assignments: [] }) },
    rubberMatEvent: {
      findFirst: async () => linked ? { id: 'link' } : null,
      findMany: async ({ where }: { where: { OR: Record<string, string>[] } }) => {
        historyReads += 1; query = where;
        return source.filter(row => where.OR.some(condition =>
          Object.entries(condition).every(([key, value]) => (row as Record<string, unknown>)[key] === value)));
      },
    },
  };
  const service = new RubberMatsService(db as never);
  const reader = { id: 'reader', roleCode: 'manager', roleCodes: ['manager'], isActive: true, accessRules };
  return { source, read: () => service.getHistory(reader, 'target', 'mat'), reads: () => historyReads, query: () => query };
}

test('mat history excludes registration on an unrelated object and preserves local registration', async () => {
  const f = fixture(); const before = structuredClone(f.source);
  const rows = await f.read();
  assert.deepEqual(rows.map(row => row.id), ['local-registration', 'incoming', 'outgoing', 'local-service']);
  assert.deepEqual(f.query(), { rubberMatId: 'mat', OR: [{ fromObjectId: 'target' }, { toObjectId: 'target' }] });
  assert.ok(!JSON.stringify(rows).includes('Private'));
  assert.ok(!JSON.stringify(rows).includes('hidden-author'));
  assert.deepEqual(f.source, before);
});

test('mat history hides opposite movement fields and preserves both local sides', async () => {
  const rows = await fixture().read();
  const incoming = rows.find(row => row.id === 'incoming')!;
  assert.equal(incoming.fromObjectId, null); assert.equal(incoming.fromZone, null); assert.equal(incoming.fromCondition, null);
  assert.equal(incoming.toObjectId, 'target'); assert.equal(incoming.toZone, 'Entrance'); assert.equal(incoming.toCondition, 'good');
  const outgoing = rows.find(row => row.id === 'outgoing')!;
  assert.equal(outgoing.toObjectId, null); assert.equal(outgoing.toZone, null); assert.equal(outgoing.toCondition, null);
  assert.equal(outgoing.fromObjectId, 'target'); assert.equal(outgoing.fromZone, 'Entrance'); assert.equal(outgoing.fromCondition, 'good');
  const local = rows.find(row => row.id === 'local-service')!;
  assert.equal(local.fromZone, 'Entrance'); assert.equal(local.toZone, 'Hall'); assert.equal(local.note, 'Local service');
});

test('a mat unrelated to an allowed object returns 404 before loading history', async () => {
  const f = fixture(false);
  await assert.rejects(f.read(), NotFoundException);
  assert.equal(f.reads(), 0);
});

test('parent read denial blocks mat history despite an explicit history grant', async () => {
  const f = fixture(true, [
    { actionCode: 'mats.history', effect: 'allow', scope: 'all', selectedIds: [] },
    { actionCode: 'objects.read', effect: 'deny', scope: 'selected', selectedIds: ['target'] },
  ]);
  await assert.rejects(f.read(), ForbiddenException);
  assert.equal(f.reads(), 0);
});
