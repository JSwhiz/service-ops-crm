import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { PrismaClient } from '@prisma/client';
import { loginAndGetCookieHeader } from './helpers/auth';
import { createTestApp } from './helpers/create-test-app';
import { usesIsolatedIntegrationDatabase } from './helpers/isolated-database';

test('order resources preserve return permission, idempotency, equipment scope and section denies', async t => {
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
  const marker = `order-resources-${randomUUID()}`;
  const order = await prisma.oneTimeOrder.create({ data: {
    title: marker, executionAddress: 'Isolated test', contactName: 'Fixture', status: 'in_progress', createdByUserId: founder.id,
    assignments: { create: { userId: manager.id, assignmentRoleCode: 'one_time_manager', isActive: true } },
  } });
  const otherOrder = await prisma.oneTimeOrder.create({ data: {
    title: `${marker}-other`, executionAddress: 'Isolated test', contactName: 'Fixture', status: 'in_progress', createdByUserId: founder.id,
  } });
  const item = await prisma.inventoryItem.create({ data: {
    name: marker, category: 'Isolated test', unit: 'л', currentUnitPrice: 100, createdByUserId: founder.id,
  } });
  for (const [movementType, quantity, relatedOneTimeOrderId] of [
    ['receipt', 10, null], ['issue_to_one_time_order', 3, order.id],
  ] as const) await prisma.inventoryMovement.create({ data: {
    inventoryItemId: item.id, movementType, quantity, relatedOneTimeOrderId,
    unitPriceSnapshot: 100, totalAmountSnapshot: quantity * 100, createdByUserId: founder.id,
  } });
  const request = (path: string, body?: unknown) => fetch(`${baseUrl}/api/v1${path}`, {
    method: body === undefined ? 'GET' : 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(15_000),
  });
  const expectStatus = async (response: Response, expected: number) => assert.equal(response.status, expected, await response.clone().text());
  const returnPath = `/one-time-orders/${order.id}/inventory/return`;
  const payload = { inventoryItemId: item.id, quantity: 1, requestId: randomUUID(), comment: marker };
  // Assignment/issue permission alone never grants a stock return.
  await expectStatus(await request(returnPath, payload), 403);
  assert.equal(await prisma.inventoryMovement.count({ where: { inventoryItemId: item.id, movementType: 'return' } }), 0);
  const returnGrant = await prisma.userAccessRule.create({ data: {
    userId: manager.id, actionCode: 'inventory.return', effect: 'allow', scope: 'selected', selectedIds: [item.id],
  } });
  const scope = await request(`/one-time-orders/${order.id}/inventory`);
  await expectStatus(scope, 200);
  const scopeBody = await scope.json() as { availableReturnItems: Array<{ id: string }>; capabilities: { canReturnInventoryFromOrder: boolean } };
  assert.equal(scopeBody.capabilities.canReturnInventoryFromOrder, true);
  assert.ok(scopeBody.availableReturnItems.some(row => row.id === item.id));
  const returned = await Promise.all([request(returnPath, payload), request(returnPath, payload)]);
  for (const response of returned) await expectStatus(response, 201);
  const receipts = await Promise.all(returned.map(response => response.json())) as Array<{ id: string }>;
  assert.equal(receipts[0].id, receipts[1].id);
  const movements = await prisma.inventoryMovement.findMany({ where: { inventoryItemId: item.id, movementType: 'return' } });
  assert.equal(movements.length, 1);
  assert.equal(Number(movements[0].quantity), 1);
  assert.equal(movements[0].relatedOneTimeOrderId, order.id);
  assert.equal(movements[0].evidenceRequired, true);
  // One key cannot be reused for a different movement type.
  await expectStatus(await request(`/one-time-orders/${order.id}/inventory/issue`, payload), 409);
  await prisma.userAccessRule.delete({ where: { id: returnGrant.id } });
  await expectStatus(await request(returnPath, { ...payload, requestId: randomUUID() }), 403);
  await expectStatus(await request(`/one-time-orders/${otherOrder.id}/inventory/return`, { ...payload, requestId: randomUUID() }), 403);

  const catalog = await prisma.equipmentCatalogItem.create({ data: { category: 'Test', name: marker, createdByUserId: founder.id } });
  const unit = await prisma.equipmentUnit.create({ data: { catalogItemId: catalog.id, inventoryNumber: marker, createdByUserId: founder.id } });
  const optionsPath = `/equipment/scoped/one-time-orders/${order.id}/options`;
  const options = await request(optionsPath);
  await expectStatus(options, 200);
  const optionBody = await options.json() as { availableUnits: Array<{ id: string }>; returnableUnitIds: string[] };
  assert.ok(optionBody.availableUnits.some(row => row.id === unit.id));
  assert.ok(!optionBody.returnableUnitIds.includes(unit.id));
  const assignPath = `/equipment/scoped/units/${unit.id}/one-time-orders/${order.id}/assign`;
  await expectStatus(await request(assignPath, {}), 201);
  assert.equal((await prisma.equipmentUnit.findUniqueOrThrow({ where: { id: unit.id } })).currentOneTimeOrderId, order.id);
  // A stale order cannot return a unit currently on another order, even if
  // the actor is assigned to both orders.
  await prisma.oneTimeOrderAssignment.create({ data: { oneTimeOrderId: otherOrder.id, userId: manager.id, assignmentRoleCode: 'one_time_manager' } });
  await expectStatus(await request(`/equipment/scoped/units/${unit.id}/one-time-orders/${otherOrder.id}/return`, {}), 409);
  const deny = await prisma.userAccessRule.create({ data: {
    userId: manager.id, actionCode: 'one_time_orders.equipment.read', effect: 'deny', scope: 'selected', selectedIds: [order.id],
  } });
  await expectStatus(await request(optionsPath), 403);
  const equipmentReturn = `/equipment/scoped/units/${unit.id}/one-time-orders/${order.id}/return`;
  await expectStatus(await request(equipmentReturn, {}), 403);
  assert.equal(await prisma.equipmentMovement.count({ where: { equipmentUnitId: unit.id } }), 1);
  await prisma.userAccessRule.delete({ where: { id: deny.id } });
  await expectStatus(await request(equipmentReturn, {}), 201);
  await expectStatus(await request(equipmentReturn, {}), 409);
  const finalUnit = await prisma.equipmentUnit.findUniqueOrThrow({ where: { id: unit.id } });
  assert.equal(finalUnit.status, 'in_storage');
  assert.equal(finalUnit.currentOneTimeOrderId, null);
  assert.equal(await prisma.equipmentMovement.count({ where: { equipmentUnitId: unit.id } }), 2);
  assert.equal(await prisma.inventoryMovement.count({ where: { inventoryItemId: item.id, movementType: 'writeoff' } }), 0);
});
