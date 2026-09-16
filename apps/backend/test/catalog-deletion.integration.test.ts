import assert from 'node:assert/strict';
import test from 'node:test';

import { PrismaClient } from '@prisma/client';

import { loginAndGetCookieHeader } from './helpers/auth';
import { createTestApp } from './helpers/create-test-app';

test('safe delete preserves ledgers, permissions and concurrent operations', async (t) => {
  const prisma = new PrismaClient();
  const { app, baseUrl } = await createTestApp();
  const founder = await prisma.user.findUniqueOrThrow({
    where: { login: 'founder' },
    select: { id: true },
  });
  const deputy = await prisma.user.findUniqueOrThrow({
    where: { login: 'deputy1' },
    select: { id: true },
  });

  const [founderCookie, deputyCookie, managerCookie] = await Promise.all([
    loginAndGetCookieHeader({
      baseUrl,
      login: 'founder',
      password: 'founder123',
    }),
    loginAndGetCookieHeader({
      baseUrl,
      login: 'deputy1',
      password: 'deputy123',
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
  const temporaryPermissionIds: string[] = [];
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
    if (temporaryPermissionIds.length > 0) {
      await prisma.userPermission.deleteMany({
        where: { id: { in: temporaryPermissionIds } },
      });
    }
    await app.close();
    await prisma.$disconnect();
  });

  const inventoryDeletePermission = await prisma.permission.findUniqueOrThrow({
    where: { code: 'inventory.catalog.delete' },
    select: { id: true },
  });
  const equipmentDeletePermission = await prisma.permission.findUniqueOrThrow({
    where: { code: 'equipment.unit.delete' },
    select: { id: true },
  });

  const createInventoryItem = async (
    name: string,
    cookie = founderCookie,
  ): Promise<string> => {
    const response = await fetch(`${baseUrl}/api/v1/inventory/items`, {
      method: 'POST',
      headers: {
        Cookie: cookie,
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

  const deputyInventoryId = await createInventoryItem(
    `Расходник deputy ${marker}`,
  );
  assert.equal(
    (
      await fetch(`${baseUrl}/api/v1/inventory/items/${deputyInventoryId}`, {
        method: 'DELETE',
        headers: { Cookie: deputyCookie },
      })
    ).status,
    403,
  );

  const deputyInventoryPermission = await prisma.userPermission.create({
    data: {
      userId: deputy.id,
      permissionId: inventoryDeletePermission.id,
    },
  });
  temporaryPermissionIds.push(deputyInventoryPermission.id);

  const deputyInventoryDelete = await fetch(
    `${baseUrl}/api/v1/inventory/items/${deputyInventoryId}`,
    {
      method: 'DELETE',
      headers: { Cookie: deputyCookie },
    },
  );
  assert.equal(deputyInventoryDelete.status, 200);

  const managerInventoryId = await createInventoryItem(
    `Расходник manager ${marker}`,
  );
  assert.equal(
    (
      await fetch(`${baseUrl}/api/v1/inventory/items/${managerInventoryId}`, {
        method: 'DELETE',
        headers: { Cookie: managerCookie },
      })
    ).status,
    403,
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
  assert.equal(
    await prisma.inventoryMovement.count({
      where: { inventoryItemId: softInventoryId },
    }),
    2,
  );

  await assert.rejects(
    prisma.inventoryItem.delete({ where: { id: softInventoryId } }),
  );

  const raceInventoryId = await createInventoryItem(
    `Гонка расходника ${marker}`,
  );
  const [raceDeleteResult, raceMovementResult] = await Promise.allSettled([
    fetch(`${baseUrl}/api/v1/inventory/items/${raceInventoryId}`, {
      method: 'DELETE',
      headers: { Cookie: founderCookie },
    }),
    fetch(`${baseUrl}/api/v1/inventory/movements`, {
      method: 'POST',
      headers: {
        Cookie: founderCookie,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        inventoryItemId: raceInventoryId,
        movementType: 'receipt',
        quantity: 1,
        unitPrice: 1,
      }),
    }),
  ]);
  assert.equal(raceDeleteResult.status, 'fulfilled');
  assert.equal(raceMovementResult.status, 'fulfilled');
  if (
    raceDeleteResult.status === 'fulfilled' &&
    raceMovementResult.status === 'fulfilled'
  ) {
    const deleteStatus = raceDeleteResult.value.status;
    const movementStatus = raceMovementResult.value.status;
    assert.ok(
      (deleteStatus === 200 && movementStatus >= 400) ||
        (movementStatus === 201 && deleteStatus === 409),
    );
  }

  const emptyCatalogResponse = await fetch(
    `${baseUrl}/api/v1/equipment/catalog`,
    {
      method: 'POST',
      headers: {
        Cookie: founderCookie,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        category: 'Техника',
        name: `Пустой тип ${marker}`,
      }),
    },
  );
  assert.equal(emptyCatalogResponse.status, 201);
  const emptyCatalog = (await emptyCatalogResponse.json()) as {
    id: string;
    unitsCount: number;
  };
  equipmentCatalogItemIds.push(emptyCatalog.id);
  assert.equal(emptyCatalog.unitsCount, 0);

  const emptyCatalogDelete = await fetch(
    `${baseUrl}/api/v1/equipment/catalog/${emptyCatalog.id}`,
    {
      method: 'DELETE',
      headers: { Cookie: founderCookie },
    },
  );
  assert.equal(emptyCatalogDelete.status, 200);

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

  const catalogBlockedDelete = await createEquipmentUnit('catalog-used');
  assert.ok(catalogBlockedDelete);
  const usedCatalogDelete = await fetch(
    `${baseUrl}/api/v1/equipment/catalog/${catalog.id}`,
    {
      method: 'DELETE',
      headers: { Cookie: founderCookie },
    },
  );
  assert.equal(usedCatalogDelete.status, 409);

  const unusedUnitId = await createEquipmentUnit('unused');
  const deputyEquipmentDenied = await fetch(
    `${baseUrl}/api/v1/equipment/units/${unusedUnitId}`,
    {
      method: 'DELETE',
      headers: { Cookie: deputyCookie },
    },
  );
  assert.equal(deputyEquipmentDenied.status, 403);

  const deputyEquipmentPermission = await prisma.userPermission.create({
    data: {
      userId: deputy.id,
      permissionId: equipmentDeletePermission.id,
    },
  });
  temporaryPermissionIds.push(deputyEquipmentPermission.id);

  const deputyEquipmentDelete = await fetch(
    `${baseUrl}/api/v1/equipment/units/${unusedUnitId}`,
    {
      method: 'DELETE',
      headers: { Cookie: deputyCookie },
    },
  );
  assert.equal(deputyEquipmentDelete.status, 200);

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
  assert.equal(
    await prisma.equipmentMovement.count({
      where: { equipmentUnitId: usedUnitId },
    }),
    1,
  );
  await assert.rejects(
    prisma.equipmentUnit.delete({ where: { id: usedUnitId } }),
  );

  const raceUnitId = await createEquipmentUnit('race');
  const [equipmentDeleteRace, equipmentMovementRace] = await Promise.allSettled([
    fetch(`${baseUrl}/api/v1/equipment/units/${raceUnitId}`, {
      method: 'DELETE',
      headers: { Cookie: founderCookie },
    }),
    fetch(`${baseUrl}/api/v1/equipment/units/${raceUnitId}/movements`, {
      method: 'POST',
      headers: {
        Cookie: founderCookie,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ movementType: 'mark_lost' }),
    }),
  ]);
  assert.equal(equipmentDeleteRace.status, 'fulfilled');
  assert.equal(equipmentMovementRace.status, 'fulfilled');
  if (
    equipmentDeleteRace.status === 'fulfilled' &&
    equipmentMovementRace.status === 'fulfilled'
  ) {
    const deleteStatus = equipmentDeleteRace.value.status;
    const movementStatus = equipmentMovementRace.value.status;
    assert.ok(
      (deleteStatus === 200 && movementStatus >= 400) ||
        (movementStatus === 201 && deleteStatus === 409),
    );
  }
});
