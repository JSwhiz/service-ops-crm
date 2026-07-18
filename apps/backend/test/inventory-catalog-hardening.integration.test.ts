import assert from 'node:assert/strict';
import test from 'node:test';

import { PrismaClient } from '@prisma/client';

import { loginAndGetCookieHeader } from './helpers/auth';
import { createTestApp } from './helpers/create-test-app';

type ItemResponse = {
  id: string;
  name: string;
  category: string;
  unit: string;
  notes: string | null;
  isActive: boolean;
  version: number;
};

test('inventory catalog enforces normalized identity, versioning and archive invariants', async (t) => {
  const prisma = new PrismaClient();
  const { app, baseUrl } = await createTestApp();
  const founder = await prisma.user.findUniqueOrThrow({
    where: { login: 'founder' },
    select: { id: true },
  });
  const [founderCookie, managerCookie] = await Promise.all([
    loginAndGetCookieHeader({
      baseUrl,
      login: 'founder',
      password: 'founder123',
    }),
    loginAndGetCookieHeader({
      baseUrl,
      login: 'manager1',
      password: 'manager123',
    }),
  ]);
  const marker = `catalog-${Date.now()}`;

  t.after(async () => {
    await prisma.$executeRawUnsafe(
      'DROP TRIGGER IF EXISTS fail_inventory_item_audit_trigger ON "audit_events"',
    );
    await prisma.$executeRawUnsafe(
      'DROP FUNCTION IF EXISTS fail_inventory_item_audit()',
    );
    await app.close();
    await prisma.$disconnect();
  });

  const createItem = async (
    body: Record<string, unknown>,
    cookie = founderCookie,
  ): Promise<Response> =>
    fetch(`${baseUrl}/api/v1/inventory/items`, {
      method: 'POST',
      headers: {
        Cookie: cookie,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
  const updateItem = async (
    itemId: string,
    body: Record<string, unknown>,
    cookie = founderCookie,
  ): Promise<Response> =>
    fetch(`${baseUrl}/api/v1/inventory/items/${itemId}`, {
      method: 'PATCH',
      headers: {
        Cookie: cookie,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

  for (const invalidBody of [
    { name: '   ', category: 'Химия', unit: 'л' },
    { name: 'Средство', category: '   ', unit: 'л' },
    { name: 'Средство', category: 'Химия', unit: '   ' },
    { name: 'x'.repeat(201), category: 'Химия', unit: 'л' },
    { name: 'Средство', category: 'x'.repeat(101), unit: 'л' },
    { name: 'Средство', category: 'Химия', unit: 'x'.repeat(51) },
    {
      name: 'Средство',
      category: 'Химия',
      unit: 'л',
      notes: 'x'.repeat(4001),
    },
  ]) {
    assert.equal((await createItem(invalidBody)).status, 400);
  }

  const createResponse = await createItem({
    name: `  Основное средство ${marker}  `,
    category: '  Химия  ',
    unit: '  л  ',
    notes: '   ',
  });
  assert.equal(createResponse.status, 201);
  const item = (await createResponse.json()) as ItemResponse;
  assert.equal(item.name, `Основное средство ${marker}`);
  assert.equal(item.category, 'Химия');
  assert.equal(item.unit, 'л');
  assert.equal(item.notes, null);
  assert.equal(item.version, 1);

  const duplicateResponse = await createItem({
    name: `основное средство ${marker.toUpperCase()}`,
    category: 'химия',
    unit: 'Л',
  });
  assert.equal(duplicateResponse.status, 409);
  assert.equal(
    ((await duplicateResponse.json()) as { code: string }).code,
    'INVENTORY_ITEM_DUPLICATE',
  );

  const staleResponse = await updateItem(item.id, {
    expectedVersion: 99,
    notes: 'Не должно сохраниться',
  });
  assert.equal(staleResponse.status, 409);
  assert.equal(
    ((await staleResponse.json()) as { code: string }).code,
    'INVENTORY_ITEM_VERSION_CONFLICT',
  );

  const parallelUpdateResponses = await Promise.all([
    updateItem(item.id, {
      expectedVersion: 1,
      notes: 'Изменение A',
    }),
    updateItem(item.id, {
      expectedVersion: 1,
      notes: 'Изменение B',
    }),
  ]);
  assert.deepEqual(
    parallelUpdateResponses.map((response) => response.status).sort(),
    [200, 409],
  );
  const currentItem = await prisma.inventoryItem.findUniqueOrThrow({
    where: { id: item.id },
  });
  assert.equal(currentItem.version, 2);

  const managerDeniedResponse = await updateItem(
    item.id,
    { expectedVersion: 2, notes: 'Denied' },
    managerCookie,
  );
  assert.equal(managerDeniedResponse.status, 403);

  const managerHistoryResponse = await fetch(
    `${baseUrl}/api/v1/inventory/movements?inventoryItemId=${item.id}`,
    { headers: { Cookie: managerCookie } },
  );
  assert.equal(managerHistoryResponse.status, 403);

  const archiveResponse = await updateItem(item.id, {
    expectedVersion: 2,
    isActive: false,
  });
  assert.equal(archiveResponse.status, 200);
  const archivedItem = (await archiveResponse.json()) as ItemResponse;
  assert.equal(archivedItem.isActive, false);
  assert.equal(archivedItem.version, 3);

  const replacementResponse = await createItem({
    name: item.name,
    category: item.category,
    unit: item.unit,
  });
  assert.equal(replacementResponse.status, 201);
  const replacement = (await replacementResponse.json()) as ItemResponse;

  const blockedReactivationResponse = await updateItem(item.id, {
    expectedVersion: 3,
    isActive: true,
  });
  assert.equal(blockedReactivationResponse.status, 409);
  assert.equal(
    ((await blockedReactivationResponse.json()) as { code: string }).code,
    'INVENTORY_ITEM_DUPLICATE',
  );

  const archiveReplacementResponse = await updateItem(replacement.id, {
    expectedVersion: 1,
    isActive: false,
  });
  assert.equal(archiveReplacementResponse.status, 200);
  const reactivateResponse = await updateItem(item.id, {
    expectedVersion: 3,
    isActive: true,
  });
  assert.equal(reactivateResponse.status, 200);
  const reactivatedItem = (await reactivateResponse.json()) as ItemResponse;
  assert.equal(reactivatedItem.version, 4);
  assert.equal(reactivatedItem.isActive, true);
  const reactivatedReceiptResponse = await fetch(
    `${baseUrl}/api/v1/inventory/movements`,
    {
      method: 'POST',
      headers: {
        Cookie: founderCookie,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        inventoryItemId: reactivatedItem.id,
        movementType: 'receipt',
        quantity: 1,
        unitPrice: 5,
      }),
    },
  );
  assert.equal(reactivatedReceiptResponse.status, 201);

  const parallelName = `Параллельный товар ${marker}`;
  const parallelCreateResponses = await Promise.all([
    createItem({ name: parallelName, category: 'Тест', unit: 'шт' }),
    createItem({ name: parallelName, category: 'Тест', unit: 'шт' }),
  ]);
  assert.deepEqual(
    parallelCreateResponses.map((response) => response.status).sort(),
    [201, 409],
  );
  assert.equal(
    await prisma.inventoryItem.count({
      where: { name: parallelName, isActive: true },
    }),
    1,
  );

  const stockItemResponse = await createItem({
    name: `Товар с остатком ${marker}`,
    category: 'Тест',
    unit: 'шт',
  });
  const stockItem = (await stockItemResponse.json()) as ItemResponse;
  const receiptResponse = await fetch(`${baseUrl}/api/v1/inventory/movements`, {
    method: 'POST',
    headers: {
      Cookie: founderCookie,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      inventoryItemId: stockItem.id,
      movementType: 'receipt',
      quantity: 2,
      unitPrice: 10,
    }),
  });
  assert.equal(receiptResponse.status, 201);
  const stockArchiveResponse = await updateItem(stockItem.id, {
    expectedVersion: 1,
    isActive: false,
  });
  assert.equal(stockArchiveResponse.status, 409);
  assert.deepEqual(
    ((await stockArchiveResponse.json()) as { reasons: string[] }).reasons,
    ['non_zero_stock'],
  );

  const pendingItemResponse = await createItem({
    name: `Товар с согласованием ${marker}`,
    category: 'Тест',
    unit: 'шт',
  });
  const pendingItem = (await pendingItemResponse.json()) as ItemResponse;
  const pendingMovement = await prisma.inventoryMovement.create({
    data: {
      inventoryItemId: pendingItem.id,
      movementType: 'writeoff',
      status: 'pending_approval',
      quantity: 1,
      unitPriceSnapshot: 1,
      totalAmountSnapshot: 1,
      createdByUserId: founder.id,
    },
  });
  await prisma.approvalRequest.create({
    data: {
      approvalType: 'inventory_writeoff_confirmation',
      sourceEntityType: 'inventory_movement',
      sourceEntityId: pendingMovement.id,
      createdByUserId: founder.id,
      payloadSnapshot: {},
    },
  });
  const pendingArchiveResponse = await updateItem(pendingItem.id, {
    expectedVersion: 1,
    isActive: false,
  });
  assert.equal(pendingArchiveResponse.status, 409);
  assert.deepEqual(
    (
      (await pendingArchiveResponse.json()) as {
        reasons: string[];
      }
    ).reasons.sort(),
    ['pending_approval', 'pending_movement'],
  );

  const pendingItemViewResponse = await fetch(
    `${baseUrl}/api/v1/inventory/items/${pendingItem.id}`,
    { headers: { Cookie: founderCookie } },
  );
  assert.equal(pendingItemViewResponse.status, 200);
  const pendingItemView = (await pendingItemViewResponse.json()) as {
    archiveState: {
      canArchive: boolean;
      pendingMovementsCount: number;
      pendingApprovalsCount: number;
      blockerCodes: string[];
    };
  };
  assert.equal(pendingItemView.archiveState.canArchive, false);
  assert.equal(pendingItemView.archiveState.pendingMovementsCount, 1);
  assert.equal(pendingItemView.archiveState.pendingApprovalsCount, 1);
  assert.deepEqual(pendingItemView.archiveState.blockerCodes.sort(), [
    'pending_approval',
    'pending_movement',
  ]);

  const paginatedListResponse = await fetch(
    `${baseUrl}/api/v1/inventory/items?search=${encodeURIComponent(marker)}&page=1&limit=2&sortBy=name&sortDirection=desc`,
    { headers: { Cookie: founderCookie } },
  );
  assert.equal(paginatedListResponse.status, 200);
  const paginatedList = (await paginatedListResponse.json()) as {
    items: Array<{ name: string }>;
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
  assert.equal(paginatedList.items.length, 2);
  assert.ok(paginatedList.total > 2);
  assert.equal(paginatedList.page, 1);
  assert.equal(paginatedList.limit, 2);
  assert.equal(paginatedList.totalPages, Math.ceil(paginatedList.total / 2));
  const expectedPage = await prisma.inventoryItem.findMany({
    where: { name: { contains: marker, mode: 'insensitive' } },
    orderBy: [{ name: 'desc' }, { id: 'asc' }],
    take: 2,
    select: { name: true },
  });
  assert.deepEqual(
    paginatedList.items.map((listedItem) => ({ name: listedItem.name })),
    expectedPage,
  );

  const archivedMovementResponse = await fetch(
    `${baseUrl}/api/v1/inventory/movements`,
    {
      method: 'POST',
      headers: {
        Cookie: founderCookie,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        inventoryItemId: replacement.id,
        movementType: 'receipt',
        quantity: 1,
        unitPrice: 1,
      }),
    },
  );
  assert.equal(archivedMovementResponse.status, 400);

  const itemAuditEvents = await prisma.auditEvent.findMany({
    where: { entityType: 'inventory_item', entityId: item.id },
    orderBy: { createdAt: 'asc' },
    select: { action: true, oldValues: true, newValues: true },
  });
  assert.deepEqual(itemAuditEvents.map((event) => event.action), [
    'inventory.item.created',
    'inventory.item.updated',
    'inventory.item.archived',
    'inventory.item.reactivated',
  ]);
  assert.deepEqual(itemAuditEvents[0]?.newValues, {
    name: item.name,
    category: item.category,
    unit: item.unit,
    notes: null,
    isActive: true,
    version: 1,
  });
  assert.equal(
    (itemAuditEvents[3]?.oldValues as { version?: number } | null)?.version,
    3,
  );
  assert.equal(
    (itemAuditEvents[3]?.newValues as { version?: number } | null)?.version,
    4,
  );

  await prisma.$executeRawUnsafe(`
    CREATE FUNCTION fail_inventory_item_audit()
    RETURNS trigger AS $$
    BEGIN
      IF NEW."action" = 'inventory.item.created'
         AND NEW."newValues"->>'name' = 'Atomic Rollback Item' THEN
        RAISE EXCEPTION 'forced inventory audit failure';
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TRIGGER fail_inventory_item_audit_trigger
    BEFORE INSERT ON "audit_events"
    FOR EACH ROW EXECUTE FUNCTION fail_inventory_item_audit()
  `);

  try {
    const failedAuditResponse = await createItem({
      name: 'Atomic Rollback Item',
      category: marker,
      unit: 'шт',
    });
    assert.equal(failedAuditResponse.status, 500);
    assert.equal(
      await prisma.inventoryItem.count({
        where: { name: 'Atomic Rollback Item', category: marker },
      }),
      0,
    );
  } finally {
    await prisma.$executeRawUnsafe(
      'DROP TRIGGER fail_inventory_item_audit_trigger ON "audit_events"',
    );
    await prisma.$executeRawUnsafe(
      'DROP FUNCTION fail_inventory_item_audit()',
    );
  }
});
