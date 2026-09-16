import assert from 'node:assert/strict';
import test from 'node:test';

import { PrismaClient } from '@prisma/client';

import { loginAndGetCookieHeader } from './helpers/auth';
import { createTestApp } from './helpers/create-test-app';

test('catalog delete keeps operational history and only hard-deletes unused cards', async (t) => {
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

  const inventoryItemIds: string[] = [];
  const equipmentUnitIds: string[] = [];
  const equipmentCatalogItemIds: string[] = [];
  const marker = `safe-delete-${Date.now()}`;

  t.after(async () => {
    await prisma.approvalRequest.deleteMany({
      where: {
        OR: [
          {
            sourceEntityType: 'inventory_movement',
            sourceEntityId: {
              in: (
                await prisma.inventoryMovement.findMany({
                  where: { inventoryItemId: { in: inventoryItemIds } },
                  select: { id: true },
                })
              ).map((item) => item.id),
            },
          },
          {
            sourceEntityType: 'equipment_movement',
            sourceEntityId: {
              in: (
                await prisma.equipmentMovement.findMany({
                  where: { equipmentUnitId: { in: equipmentUnitIds } },
                  select: { id: true },
                })
              ).map((item) => item.id),
            },
          },
        ],
      },
    });
    await prisma.inventoryMovement.deleteMany({
      where: { inventoryItemId: { in: inventoryItemIds } },
    });
    await prisma.equipmentMovement.deleteMany({
      where: { equipmentUnitId: { in: equipmentUnitIds } },
    });
    await prisma.auditEvent.deleteMany({
      where: {
        OR: [
          { entityType: 'inventory_item', entityId: { in: inventoryItemIds } },
          { entityType: 'equipment_unit', entityId: { in: equipmentUnitIds } },
          {
            entityType: 'equipment_catalog_item',
            entityId: { in: equipmentCatalogItemIds },
          },
        ],
      },
    });
    await prisma.inventoryItem.deleteMany({
      where: { id: { in: inventoryItemIds } },
    });
    await prisma.equipmentUnit.deleteMany({
      where: { id: { in: equipmentUnitIds } },
    });
    await prisma.equipmentCatalogItem.deleteMany({
      where: { id: { in: equipmentCatalogItemIds } },
    });
    await app.close();
    await prisma.$disconnect();
  });

  const createInventoryItem = async (name: string): Promise<string> => {
    const response = await fetch(`${baseUrl}/api/v1/inventory/items`, {
      method: 'POST',
      headers: {
        Cookie: founderCookie,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name,
        category: 'Тест удаления',
        unit: 'шт',
      }),
    });
    assert.equal(response.status, 201);
    const item = (await response.json()) as { id: string };
    inventoryItemIds.push(item.id);
    return item.id;
  };

  const hardInventoryId = await createInventoryItem(
    `Ошибочно созданный расходник ${marker}`,
  );
  const managerInventoryDelete = await fetch(
    `${baseUrl}/api/v1/inventory/items/${hardInventoryId}`,
    {
      method: 'DELETE',
      headers: { Cookie: managerCookie },
    },
  );
  assert.equal(managerInventoryDelete.status, 403);

  const hardInventoryView = await fetch(
    `${baseUrl}/api/v1/inventory/items/${hardInventoryId}`,
    { headers: { Cookie: founderCookie } },
  );
  const hardInventoryState = (await hardInventoryView.json()) as {
    deletionState: { canDelete: boolean; mode: string };
  };
  assert.equal(hardInventoryState.deletionState.canDelete, true);
  assert.equal(hardInventoryState.deletionState.mode, 'hard');

  const hardInventoryDelete = await fetch(
    `${baseUrl}/api/v1/inventory/items/${hardInventoryId}`,
    {
      method: 'DELETE',
      headers: { Cookie: founderCookie },
    },
  );
  assert.equal(hardInventoryDelete.status, 200);
  assert.deepEqual(await hardInventoryDelete.json(), {
    id: hardInventoryId,
    mode: 'hard',
  });
  assert.equal(
    await prisma.inventoryItem.count({ where: { id: hardInventoryId } }),
    0,
  );

  const softInventoryId = await createInventoryItem(
    `Исторический расходник ${marker}`,
  );
  await prisma.inventoryMovement.createMany({
    data: [
      {
        inventoryItemId: softInventoryId,
        movementType: 'receipt',
        status: 'applied',
        quantity: 1,
        unitPriceSnapshot: 10,
        totalAmountSnapshot: 10,
        createdByUserId: founder.id,
      },
      {
        inventoryItemId: softInventoryId,
        movementType: 'writeoff',
        status: 'applied',
        quantity: 1,
        unitPriceSnapshot: 10,
        totalAmountSnapshot: 10,
        createdByUserId: founder.id,
      },
    ],
  });

  const softInventoryDelete = await fetch(
    `${baseUrl}/api/v1/inventory/items/${softInventoryId}`,
    {
      method: 'DELETE',
      headers: { Cookie: founderCookie },
    },
  );
  assert.equal(softInventoryDelete.status, 200);
  assert.deepEqual(await softInventoryDelete.json(), {
    id: softInventoryId,
    mode: 'soft',
  });
  const softDeletedInventory = await prisma.inventoryItem.findUniqueOrThrow({
    where: { id: softInventoryId },
    select: { isActive: true },
  });
  assert.equal(softDeletedInventory.isActive, false);
  assert.equal(
    await prisma.inventoryMovement.count({
      where: { inventoryItemId: softInventoryId },
    }),
    2,
  );

  const blockedInventoryId = await createInventoryItem(
    `Расходник с остатком ${marker}`,
  );
  await prisma.inventoryMovement.create({
    data: {
      inventoryItemId: blockedInventoryId,
      movementType: 'receipt',
      status: 'applied',
      quantity: 2,
      unitPriceSnapshot: 10,
      totalAmountSnapshot: 20,
      createdByUserId: founder.id,
    },
  });
  const blockedInventoryDelete = await fetch(
    `${baseUrl}/api/v1/inventory/items/${blockedInventoryId}`,
    {
      method: 'DELETE',
      headers: { Cookie: founderCookie },
    },
  );
  assert.equal(blockedInventoryDelete.status, 409);
  const blockedInventoryBody = (await blockedInventoryDelete.json()) as {
    code: string;
    reasons: string[];
  };
  assert.equal(blockedInventoryBody.code, 'INVENTORY_ITEM_DELETE_BLOCKED');
  assert.ok(blockedInventoryBody.reasons.includes('non_zero_stock'));

  const catalogResponse = await fetch(`${baseUrl}/api/v1/equipment/catalog`, {
    method: 'POST',
    headers: {
      Cookie: founderCookie,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      category: 'Техника',
      name: `Удаление оборудования ${marker}`,
    }),
  });
  assert.equal(catalogResponse.status, 201);
  const catalog = (await catalogResponse.json()) as { id: string };
  equipmentCatalogItemIds.push(catalog.id);

  const createEquipmentUnit = async (suffix: string): Promise<string> => {
    const response = await fetch(`${baseUrl}/api/v1/equipment/units`, {
      method: 'POST',
      headers: {
        Cookie: founderCookie,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        catalogItemId: catalog.id,
        inventoryNumber: `DEL-${marker}-${suffix}`,
      }),
    });
    assert.equal(response.status, 201);
    const unit = (await response.json()) as { id: string };
    equipmentUnitIds.push(unit.id);
    return unit.id;
  };

  const unusedUnitId = await createEquipmentUnit('unused');
  const managerEquipmentDelete = await fetch(
    `${baseUrl}/api/v1/equipment/units/${unusedUnitId}`,
    {
      method: 'DELETE',
      headers: { Cookie: managerCookie },
    },
  );
  assert.equal(managerEquipmentDelete.status, 403);

  const unusedUnitView = await fetch(
    `${baseUrl}/api/v1/equipment/units/${unusedUnitId}`,
    { headers: { Cookie: founderCookie } },
  );
  const unusedUnitState = (await unusedUnitView.json()) as {
    deletionState: { canDelete: boolean; movementsCount: number };
  };
  assert.equal(unusedUnitState.deletionState.canDelete, true);
  assert.equal(unusedUnitState.deletionState.movementsCount, 0);

  const unusedEquipmentDelete = await fetch(
    `${baseUrl}/api/v1/equipment/units/${unusedUnitId}`,
    {
      method: 'DELETE',
      headers: { Cookie: founderCookie },
    },
  );
  assert.equal(unusedEquipmentDelete.status, 200);
  assert.deepEqual(await unusedEquipmentDelete.json(), {
    id: unusedUnitId,
    mode: 'hard',
  });

  const usedUnitId = await createEquipmentUnit('used');
  await prisma.equipmentMovement.create({
    data: {
      equipmentUnitId: usedUnitId,
      movementType: 'return_to_storage',
      status: 'applied',
      fromStatus: 'in_storage',
      toStatus: 'in_storage',
      createdByUserId: founder.id,
    },
  });
  const usedEquipmentDelete = await fetch(
    `${baseUrl}/api/v1/equipment/units/${usedUnitId}`,
    {
      method: 'DELETE',
      headers: { Cookie: founderCookie },
    },
  );
  assert.equal(usedEquipmentDelete.status, 409);
  const usedEquipmentBody = (await usedEquipmentDelete.json()) as {
    code: string;
    reasons: string[];
  };
  assert.equal(usedEquipmentBody.code, 'EQUIPMENT_UNIT_DELETE_BLOCKED');
  assert.ok(usedEquipmentBody.reasons.includes('movement_history'));
  assert.equal(
    await prisma.equipmentMovement.count({
      where: { equipmentUnitId: usedUnitId },
    }),
    1,
  );
});
