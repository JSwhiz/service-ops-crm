import assert from 'node:assert/strict';
import test from 'node:test';

import { PrismaClient } from '@prisma/client';

import { InventoryService } from '../src/modules/inventory/inventory.service';
import { loginAndGetCookieHeader } from './helpers/auth';
import { createTestApp } from './helpers/create-test-app';
import { usesIsolatedIntegrationDatabase } from './helpers/isolated-database';

test('receipt committed before a selected read deny returns only acknowledgement', { timeout: 25_000 }, async (t) => {
  assert.equal(usesIsolatedIntegrationDatabase(), true);
  const prisma = new PrismaClient();
  t.after(() => prisma.$disconnect());
  const { app, baseUrl } = await createTestApp();
  t.after(() => app.close());
  const [manager, founder] = await Promise.all(['manager1', 'founder'].map((login) =>
    prisma.user.findUniqueOrThrow({ where: { login } })));
  const item = await prisma.inventoryItem.create({ data: {
    name: 'Receipt response fixture', category: 'ACL', unit: 'шт', createdByUserId: founder.id,
  } });
  await prisma.userAccessRule.create({ data: {
    userId: manager.id, actionCode: 'inventory.receipt', effect: 'allow', scope: 'all',
  } });
  const [actorCookie, founderCookie] = await Promise.all([
    loginAndGetCookieHeader({ baseUrl, login: 'manager1', password: 'manager123' }),
    loginAndGetCookieHeader({ baseUrl, login: 'founder', password: 'founder123' }),
  ]);
  const send = (path: string, cookie: string, body?: object) => fetch(`${baseUrl}/api/v1${path}`, {
    method: body ? 'POST' : 'GET', headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(15_000),
  });
  let reachProjection!: () => void;
  let releaseProjection!: () => void;
  const projecting = new Promise<void>((resolve) => { reachProjection = resolve; });
  const released = new Promise<void>((resolve) => { releaseProjection = resolve; });
  const service = app.get(InventoryService) as unknown as {
    loadPendingApprovalRequestsByMovementIds: (ids: string[]) => Promise<unknown>;
  };
  const original = service.loadPendingApprovalRequestsByMovementIds.bind(service);
  t.mock.method(service, 'loadPendingApprovalRequestsByMovementIds', async (ids: string[]) => {
    reachProjection();
    await released;
    return original(ids);
  });
  const receipt = send('/inventory/movements', actorCookie, {
    inventoryItemId: item.id, movementType: 'receipt', quantity: 3, unitPrice: 41,
  });
  try {
    await Promise.race([projecting, receipt.then(() => assert.fail('Receipt completed before the response barrier'))]);
    assert.equal(await prisma.inventoryMovement.count({ where: { inventoryItemId: item.id } }), 1);
    const target = `/users-access/admin/users/${manager.id}`;
    const rule = {
      expectedVersion: manager.accessVersion, reason: 'Revoke item read before receipt response',
      changes: [{ actionCode: 'inventory.read', effect: 'deny', scope: 'selected', selectedIds: [item.id] }],
    };
    const preview = await send(target+'/preview', founderCookie, rule);
    assert.equal(preview.status, 201, await preview.clone().text());
    const { previewToken, previewHash } = await preview.json() as { previewToken: string; previewHash: string };
    const saved = await send(target+'/save', founderCookie, { ...rule, previewToken, previewHash });
    assert.equal(saved.status, 201, await saved.clone().text());
    const hidden = await send('/inventory/items/'+item.id, actorCookie);
    assert.ok([403, 404].includes(hidden.status));
  } finally {
    releaseProjection();
    await receipt.catch(() => undefined);
  }
  const response = await receipt;
  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), { outcome: 'saved_without_access' });
  const movements = await prisma.inventoryMovement.findMany({ where: { inventoryItemId: item.id } });
  assert.equal(movements.length, 1);
  assert.equal(movements[0].quantity.toNumber(), 3);
  assert.equal((await prisma.inventoryItem.findUniqueOrThrow({ where: { id: item.id } })).currentUnitPrice?.toNumber(), 41);
  assert.equal(await prisma.auditEvent.count({ where: { entityId: movements[0].id, action: 'inventory.movement.created' } }), 1);
});
