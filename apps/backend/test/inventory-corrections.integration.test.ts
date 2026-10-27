import assert from 'node:assert/strict';
import test from 'node:test';
import { PrismaClient } from '@prisma/client';
import { createTestApp } from './helpers/create-test-app';
import { createCoreTestObject } from './helpers/core-fixtures';
import { loginAndGetCookieHeader } from './helpers/auth';
import { isInventoryPhotoDay } from '../src/modules/inventory/utils/inventory-photo.util';

test('Moscow photo deadline has an exact midnight boundary', () => {
  const created = new Date('2026-10-26T20:59:00Z');
  assert.equal(isInventoryPhotoDay(created, new Date('2026-10-26T20:59:59.999Z')), true);
  assert.equal(isInventoryPhotoDay(created, new Date('2026-10-26T21:00:00Z')), false);
  assert.equal(isInventoryPhotoDay(created, new Date('2026-10-26T20:58:59Z')), false);
});

test('corrections cancel unconfirmed issues and reverse confirmed issues once, preserving source snapshots and ACL', async (t) => {
  assert.equal(process.env.TEST_ISOLATED_DATABASE, 'true');
  const prisma = new PrismaClient();
  const { app, baseUrl } = await createTestApp();
  t.after(async () => { await app.close(); await prisma.$disconnect(); });
  const { objectId } = await createCoreTestObject(prisma, { includeManagerAssignment: true });
  const founder = await prisma.user.findUniqueOrThrow({ where: { login: 'founder' } });
  const item = await prisma.inventoryItem.create({ data: { name: 'Correction fixture', category: 'Test', unit: 'шт', createdByUserId: founder.id } });
  const cookies = Object.fromEntries(await Promise.all(['founder', 'manager1', 'manager2', 'hr1'].map(async (login) => [login, await loginAndGetCookieHeader({ baseUrl, login, password: login === 'founder' ? 'founder123' : login === 'hr1' ? 'hr123' : 'manager123' })])));
  const correct = (id: string, login = 'manager1') => fetch(`${baseUrl}/api/v1/inventory/movements/${id}/correct`, { method: 'POST', headers: { Cookie: cookies[login]!, 'Content-Type': 'application/json' }, body: JSON.stringify({ reason: 'Ошибка количества' }) });
  const issue = (requiresApprovalBridge: boolean) => prisma.inventoryMovement.create({ data: { inventoryItemId: item.id, movementType: 'issue_to_object', quantity: 2, unitPriceSnapshot: 75, totalAmountSnapshot: 150, status: 'applied', createdByUserId: founder.id, relatedObjectId: objectId, requiresApprovalBridge } });
  const pending = await issue(true);
  assert.equal((await correct(pending.id, 'manager2')).status, 403);
  assert.equal((await correct(pending.id, 'hr1')).status, 403);
  assert.equal((await correct(pending.id)).status, 201);
  assert.equal((await prisma.inventoryMovement.findUniqueOrThrow({ where: { id: pending.id } })).status, 'cancelled');
  assert.equal((await correct(pending.id)).status, 201);
  assert.equal(await prisma.auditEvent.count({ where: { entityId: pending.id, action: 'inventory.movement.cancelled' } }), 1);
  const confirmed = await issue(false);
  const results = await Promise.all([correct(confirmed.id), correct(confirmed.id)]);
  assert.deepEqual(results.map((result) => result.status), [201, 201]);
  const bodies = await Promise.all(results.map((result) => result.json())) as Array<{ mode: string; compensatingMovementId: string }>;
  assert.equal(bodies[0]!.mode, 'reversed');
  assert.equal(bodies[0]!.compensatingMovementId, bodies[1]!.compensatingMovementId);
  const reverse = await prisma.inventoryMovement.findUniqueOrThrow({ where: { id: bodies[0]!.compensatingMovementId } });
  assert.equal(reverse.movementType, 'return');
  assert.equal(reverse.quantity.toNumber(), 2);
  assert.equal(reverse.unitPriceSnapshot?.toNumber(), 75);
  assert.equal(reverse.totalAmountSnapshot?.toNumber(), 150);
  const unchanged = await prisma.inventoryMovement.findUniqueOrThrow({ where: { id: confirmed.id } });
  assert.equal(unchanged.status, 'applied');
  assert.equal(unchanged.quantity.toNumber(), 2);
  assert.equal(await prisma.auditEvent.count({ where: { entityId: confirmed.id, action: 'inventory.movement.reversed' } }), 1);
});
