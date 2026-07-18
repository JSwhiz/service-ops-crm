import assert from 'node:assert/strict';
import test from 'node:test';

import { PrismaClient } from '@prisma/client';

import { loginAndGetCookieHeader } from './helpers/auth';
import { createCoreTestObject } from './helpers/core-fixtures';
import { createTestApp } from './helpers/create-test-app';

test('inventory supply price is the atomic maximum of applied receipts', async (t) => {
  const prisma = new PrismaClient();
  const { app, baseUrl } = await createTestApp();
  const { objectId } = await createCoreTestObject(prisma);
  const founder = await prisma.user.findUniqueOrThrow({
    where: { login: 'founder' },
    select: { id: true },
  });
  const founderCookie = await loginAndGetCookieHeader({
    baseUrl,
    login: 'founder',
    password: 'founder123',
  });
  const marker = `supply-price-${Date.now()}`;

  t.after(async () => {
    await prisma.$executeRawUnsafe(
      'DROP TRIGGER IF EXISTS fail_inventory_movement_audit_trigger ON "audit_events"',
    );
    await prisma.$executeRawUnsafe(
      'DROP FUNCTION IF EXISTS fail_inventory_movement_audit()',
    );
    await app.close();
    await prisma.$disconnect();
  });

  const createItem = async (name: string): Promise<{ id: string }> => {
    const response = await fetch(`${baseUrl}/api/v1/inventory/items`, {
      method: 'POST',
      headers: {
        Cookie: founderCookie,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name, category: 'Тест', unit: 'шт' }),
    });
    assert.equal(response.status, 201);
    return response.json() as Promise<{ id: string }>;
  };
  const createMovement = (
    inventoryItemId: string,
    body: Record<string, unknown>,
  ): Promise<Response> =>
    fetch(`${baseUrl}/api/v1/inventory/movements`, {
      method: 'POST',
      headers: {
        Cookie: founderCookie,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ inventoryItemId, ...body }),
    });
  const loadPrice = async (inventoryItemId: string): Promise<number | null> => {
    const response = await fetch(
      `${baseUrl}/api/v1/inventory/items/${inventoryItemId}`,
      { headers: { Cookie: founderCookie } },
    );
    assert.equal(response.status, 200);
    return (
      (await response.json()) as {
        currentUnitPrice: number | null;
      }
    ).currentUnitPrice;
  };

  const item = await createItem(`Цена поставки ${marker}`);
  const firstReceipt = await createMovement(item.id, {
    movementType: 'receipt',
    quantity: 10,
    unitPrice: 100,
  });
  assert.equal(firstReceipt.status, 201);
  assert.equal(await loadPrice(item.id), 100);

  const cheaperReceipt = await createMovement(item.id, {
    movementType: 'receipt',
    quantity: 5,
    unitPrice: 80,
  });
  assert.equal(cheaperReceipt.status, 201);
  assert.equal(await loadPrice(item.id), 100);

  const issue = await createMovement(item.id, {
    movementType: 'issue_to_object',
    quantity: 2,
    relatedObjectId: objectId,
  });
  assert.equal(issue.status, 201);
  assert.equal(await loadPrice(item.id), 100);

  const returned = await createMovement(item.id, {
    movementType: 'return',
    quantity: 1,
    relatedObjectId: objectId,
  });
  assert.equal(returned.status, 201);
  assert.equal(await loadPrice(item.id), 100);

  const pendingWriteoff = await createMovement(item.id, {
    movementType: 'writeoff',
    quantity: 1,
    comment: 'Ожидает подтверждения',
  });
  assert.equal(pendingWriteoff.status, 201);
  const pendingWriteoffBody = (await pendingWriteoff.json()) as { id: string };
  assert.equal(await loadPrice(item.id), 100);

  const expensiveReceipt = await createMovement(item.id, {
    movementType: 'receipt',
    quantity: 1,
    unitPrice: 150,
  });
  assert.equal(expensiveReceipt.status, 201);
  assert.equal(await loadPrice(item.id), 150);

  const parallelReceipts = await Promise.all([
    createMovement(item.id, {
      movementType: 'receipt',
      quantity: 1,
      unitPrice: 140,
    }),
    createMovement(item.id, {
      movementType: 'receipt',
      quantity: 1,
      unitPrice: 175,
    }),
  ]);
  assert.deepEqual(
    parallelReceipts.map((response) => response.status),
    [201, 201],
  );
  assert.equal(await loadPrice(item.id), 175);

  const reportSummaryResponse = await fetch(
    `${baseUrl}/api/v1/inventory/reports/summary`,
    { headers: { Cookie: founderCookie } },
  );
  assert.equal(reportSummaryResponse.status, 200);
  assert.deepEqual(await reportSummaryResponse.json(), {
    totalItems: 1,
    totalActiveItems: 1,
    movementCount: 8,
    totalStockValueEstimate: 2975,
    missingPhotoBridgeCount: 1,
  });

  const movementCount = await prisma.inventoryMovement.count({
    where: { inventoryItemId: item.id },
  });
  assert.equal(
    await prisma.auditEvent.count({
      where: {
        entityType: 'inventory_movement',
        action: 'inventory.movement.created',
        newValues: { path: ['inventoryItemId'], equals: item.id },
      },
    }),
    movementCount,
  );
  const writeoffApproval = await prisma.approvalRequest.findFirstOrThrow({
    where: {
      sourceEntityType: 'inventory_movement',
      sourceEntityId: pendingWriteoffBody.id,
      status: 'pending',
    },
  });
  assert.equal(
    await prisma.auditEvent.count({
      where: {
        entityType: 'approval_request',
        entityId: writeoffApproval.id,
        action: 'approval.request.created',
      },
    }),
    1,
  );

  const rollbackItem = await createItem(`Audit rollback ${marker}`);
  await prisma.$executeRawUnsafe(`
    CREATE FUNCTION fail_inventory_movement_audit()
    RETURNS trigger AS $$
    BEGIN
      IF NEW."action" = 'inventory.movement.created'
         AND NEW."newValues"->>'inventoryItemId' = '${rollbackItem.id}' THEN
        RAISE EXCEPTION 'forced inventory movement audit failure';
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TRIGGER fail_inventory_movement_audit_trigger
    BEFORE INSERT ON "audit_events"
    FOR EACH ROW EXECUTE FUNCTION fail_inventory_movement_audit()
  `);

  try {
    const failedReceipt = await createMovement(rollbackItem.id, {
      movementType: 'receipt',
      quantity: 1,
      unitPrice: 999,
    });
    assert.equal(failedReceipt.status, 500);
    assert.equal(
      await prisma.inventoryMovement.count({
        where: { inventoryItemId: rollbackItem.id },
      }),
      0,
    );
    assert.equal(await loadPrice(rollbackItem.id), null);
  } finally {
    await prisma.$executeRawUnsafe(
      'DROP TRIGGER fail_inventory_movement_audit_trigger ON "audit_events"',
    );
    await prisma.$executeRawUnsafe(
      'DROP FUNCTION fail_inventory_movement_audit()',
    );
  }

  const backfillItem = await prisma.inventoryItem.create({
    data: {
      name: `Backfill ${marker}`,
      category: 'Тест',
      unit: 'шт',
      currentUnitPrice: 999,
      createdByUserId: founder.id,
    },
  });
  await prisma.inventoryMovement.createMany({
    data: [
      {
        inventoryItemId: backfillItem.id,
        movementType: 'receipt',
        status: 'applied',
        quantity: 1,
        unitPriceSnapshot: 10,
        totalAmountSnapshot: 10,
        createdByUserId: founder.id,
      },
      {
        inventoryItemId: backfillItem.id,
        movementType: 'receipt',
        status: 'applied',
        quantity: 1,
        unitPriceSnapshot: 20,
        totalAmountSnapshot: 20,
        createdByUserId: founder.id,
      },
      {
        inventoryItemId: backfillItem.id,
        movementType: 'issue_to_object',
        status: 'applied',
        quantity: 1,
        unitPriceSnapshot: 500,
        totalAmountSnapshot: 500,
        createdByUserId: founder.id,
      },
      {
        inventoryItemId: backfillItem.id,
        movementType: 'receipt',
        status: 'pending_approval',
        quantity: 1,
        unitPriceSnapshot: 30,
        totalAmountSnapshot: 30,
        createdByUserId: founder.id,
      },
      {
        inventoryItemId: backfillItem.id,
        movementType: 'receipt',
        status: 'rejected',
        quantity: 1,
        unitPriceSnapshot: 40,
        totalAmountSnapshot: 40,
        createdByUserId: founder.id,
      },
    ],
  });
  const noReceiptItem = await prisma.inventoryItem.create({
    data: {
      name: `No receipt ${marker}`,
      category: 'Тест',
      unit: 'шт',
      currentUnitPrice: 5,
      createdByUserId: founder.id,
    },
  });

  await prisma.$queryRaw`SELECT reconcile_inventory_current_unit_prices()::text`;
  await prisma.$queryRaw`SELECT reconcile_inventory_current_unit_prices()::text`;

  const [backfilled, cleared] = await Promise.all([
    prisma.inventoryItem.findUniqueOrThrow({ where: { id: backfillItem.id } }),
    prisma.inventoryItem.findUniqueOrThrow({ where: { id: noReceiptItem.id } }),
  ]);
  assert.equal(Number(backfilled.currentUnitPrice), 20);
  assert.equal(cleared.currentUnitPrice, null);
});
