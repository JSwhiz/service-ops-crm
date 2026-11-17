import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { PrismaClient } from '@prisma/client';
import { loginAndGetCookieHeader } from './helpers/auth';
import { createTestApp } from './helpers/create-test-app';
import { usesIsolatedIntegrationDatabase } from './helpers/isolated-database';

test('return delta: unissued/cross-order items cannot credit stock and competing returns cannot exceed outstanding issue', async t => {
  assert.equal(usesIsolatedIntegrationDatabase(), true);
  const url = new URL(process.env.DATABASE_URL!);
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname));
  assert.equal(url.port, '55432');
  assert.match(url.searchParams.get('schema') ?? '', /^integration_\d+_\d+$/);
  const prisma = new PrismaClient();
  t.after(() => prisma.$disconnect());
  const { app, baseUrl } = await createTestApp();
  t.after(() => app.close());
  const founder = await prisma.user.findUniqueOrThrow({ where: { login: 'founder' } });
  const manager = await prisma.user.findUniqueOrThrow({ where: { login: 'manager1' } });
  const cookie = await loginAndGetCookieHeader({ baseUrl, login: 'manager1', password: 'manager123' });
  const marker = `return-delta-${randomUUID()}`;
  const order = async (suffix: string) => prisma.oneTimeOrder.create({ data: {
    title: `${marker}-${suffix}`, executionAddress: 'Isolated delta', contactName: 'Fixture', status: 'in_progress', createdByUserId: founder.id,
    assignments: { create: { userId: manager.id, assignmentRoleCode: 'one_time_manager', isActive: true } },
  } });
  const [a, b] = await Promise.all([order('a'), order('b')]);
  const item = async (suffix: string) => prisma.inventoryItem.create({ data: {
    name: `${marker}-${suffix}`, category: 'Isolated delta', unit: 'л', currentUnitPrice: 100, createdByUserId: founder.id,
  } });
  const [unissued, otherOrderOnly, bounded] = await Promise.all([item('unissued'), item('other-order-only'), item('bounded')]);
  await prisma.userAccessRule.create({ data: {
    userId: manager.id, actionCode: 'inventory.return', effect: 'allow', scope: 'selected', selectedIds: [unissued.id, otherOrderOnly.id, bounded.id],
  } });
  const movement = (inventoryItemId: string, movementType: string, quantity: number, relatedOneTimeOrderId: string | null) => prisma.inventoryMovement.create({ data: {
    inventoryItemId, movementType, quantity, relatedOneTimeOrderId, status: 'applied', unitPriceSnapshot: 100, totalAmountSnapshot: quantity * 100,
    createdByUserId: founder.id,
  } });
  for (const row of [unissued, otherOrderOnly, bounded]) await movement(row.id, 'receipt', 10, null);
  await movement(otherOrderOnly.id, 'issue_to_one_time_order', 5, b.id);
  await movement(bounded.id, 'issue_to_one_time_order', 3, a.id);
  await movement(bounded.id, 'return', 1, a.id); // Existing generic return reduces the same outstanding balance.
  const post = (inventoryItemId: string, quantity: number, requestId = randomUUID()) => fetch(`${baseUrl}/api/v1/one-time-orders/${a.id}/inventory/return`, {
    method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ inventoryItemId, quantity, requestId }), signal: AbortSignal.timeout(15_000),
  });
  const effects = () => Promise.all([
    prisma.inventoryMovement.findMany({ where: { inventoryItemId: { in: [unissued.id, otherOrderOnly.id, bounded.id] } }, orderBy: { id: 'asc' } }),
    prisma.auditEvent.findMany({ where: { actorUserId: manager.id }, orderBy: { id: 'asc' } }),
    prisma.approvalRequest.findMany({ where: { createdByUserId: manager.id }, orderBy: { id: 'asc' } }),
  ]);
  const before = await effects();
  for (const id of [unissued.id, otherOrderOnly.id]) {
    const denied = await post(id, 1);
    assert.equal(denied.status, 409, await denied.clone().text());
    assert.match(await denied.text(), /INVENTORY_ORDER_RETURN_NOT_ISSUED/);
  }
  const over = await post(bounded.id, 2.001);
  assert.equal(over.status, 409, await over.clone().text());
  assert.match(await over.text(), /INVENTORY_ORDER_RETURN_EXCEEDS_OUTSTANDING/);
  assert.deepEqual(await effects(), before, 'Rejected returns create no stock, audit or approval effects');
  const keys = [randomUUID(), randomUUID()];
  const competing = await Promise.all(keys.map(key => post(bounded.id, 2, key)));
  assert.deepEqual(competing.map(response => response.status).sort(), [201, 409]);
  const winner = competing.findIndex(response => response.status === 201);
  const receipt = await competing[winner].json() as { id: string };
  const after = await effects();
  const retry = await post(bounded.id, 2, keys[winner]);
  assert.equal(retry.status, 201, await retry.clone().text());
  assert.equal((await retry.json() as { id: string }).id, receipt.id);
  assert.deepEqual(await effects(), after, 'An exhausted balance does not invalidate or duplicate the saved request receipt');
  const totals = await prisma.inventoryMovement.aggregate({ where: { inventoryItemId: bounded.id, relatedOneTimeOrderId: a.id, movementType: 'return', status: 'applied' }, _sum: { quantity: true } });
  assert.equal(Number(totals._sum.quantity), 3);
});
