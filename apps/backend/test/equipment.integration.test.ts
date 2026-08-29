import assert from 'node:assert/strict';
import test from 'node:test';

import { PrismaClient } from '@prisma/client';

import { SEEDED_OBJECT_ID } from './helpers/core-fixtures';
import { loginAndGetCookieHeader } from './helpers/auth';
import { createTestApp } from './helpers/create-test-app';

test('equipment unit lifecycle supports object/order scope, evidence and access gates', async (t) => {
  const prisma = new PrismaClient();
  const { app, baseUrl } = await createTestApp();

  let catalogItemId: string | null = null;
  let deputyCatalogItemId: string | null = null;
  let unitId: string | null = null;
  let oneTimeOrderId: string | null = null;
  const movementIds: string[] = [];
  const fileIds: string[] = [];

  t.after(async () => {
    if (movementIds.length > 0) {
      const attachedFileIds = (
        await prisma.fileAttachment.findMany({
          where: {
            entityType: 'equipment_movement',
            entityId: { in: movementIds },
          },
          select: { fileId: true },
        })
      ).map((attachment) => attachment.fileId);

      fileIds.push(...attachedFileIds);

      await prisma.fileAttachment.deleteMany({
        where: {
          entityType: 'equipment_movement',
          entityId: { in: movementIds },
        },
      });

      if (fileIds.length > 0) {
        await prisma.file.deleteMany({
          where: { id: { in: fileIds } },
        });
      }

      await prisma.auditEvent.deleteMany({
        where: {
          entityType: 'equipment_movement',
          entityId: { in: movementIds },
        },
      });

      await prisma.approvalRequest.deleteMany({
        where: {
          sourceEntityType: 'equipment_movement',
          sourceEntityId: {
            in: movementIds,
          },
        },
      });

      await prisma.equipmentMovement.deleteMany({
        where: { id: { in: movementIds } },
      });
    }

    if (unitId) {
      await prisma.auditEvent.deleteMany({
        where: { entityType: 'equipment_unit', entityId: unitId },
      });
      await prisma.equipmentUnit.deleteMany({ where: { id: unitId } });
    }

    if (catalogItemId) {
      await prisma.auditEvent.deleteMany({
        where: {
          entityType: 'equipment_catalog_item',
          entityId: catalogItemId,
        },
      });
      await prisma.equipmentCatalogItem.deleteMany({
        where: { id: catalogItemId },
      });
    }

    if (deputyCatalogItemId) {
      await prisma.auditEvent.deleteMany({
        where: {
          entityType: 'equipment_catalog_item',
          entityId: deputyCatalogItemId,
        },
      });
      await prisma.equipmentCatalogItem.deleteMany({
        where: { id: deputyCatalogItemId },
      });
    }

    if (oneTimeOrderId) {
      await prisma.auditEvent.deleteMany({
        where: { entityType: 'one_time_order', entityId: oneTimeOrderId },
      });
      await prisma.oneTimeOrderAssignment.deleteMany({
        where: { oneTimeOrderId },
      });
      await prisma.oneTimeOrder.deleteMany({
        where: { id: oneTimeOrderId },
      });
    }

    await app.close();
    await prisma.$disconnect();
  });

  const [founderCookie, deputyCookie, managerCookie, hrCookie] =
    await Promise.all([
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
      loginAndGetCookieHeader({
        baseUrl,
        login: 'hr1',
        password: 'hr123',
      }),
    ]);

  const managerTwo = await prisma.user.findUniqueOrThrow({
    where: { login: 'manager2' },
    select: { id: true },
  });

  const hrDenied = await fetch(`${baseUrl}/api/v1/equipment/units`, {
    headers: { Cookie: hrCookie },
  });
  assert.equal(hrDenied.status, 403);

  const managerDenied = await fetch(`${baseUrl}/api/v1/equipment/units`, {
    headers: { Cookie: managerCookie },
  });
  assert.equal(managerDenied.status, 403);

  const deputyCatalogCreated = await fetch(`${baseUrl}/api/v1/equipment/catalog`, {
    method: 'POST',
    headers: {
      Cookie: deputyCookie,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      category: 'Техника',
      name: `Тестовая мойка ${Date.now()}`,
    }),
  });
  assert.equal(deputyCatalogCreated.status, 201);
  deputyCatalogItemId = (
    (await deputyCatalogCreated.json()) as { id: string }
  ).id;

  const catalogResponse = await fetch(`${baseUrl}/api/v1/equipment/catalog`, {
    method: 'POST',
    headers: {
      Cookie: founderCookie,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      category: 'Техника',
      name: `Поломоечная машина ${Date.now()}`,
      brand: 'TestBrand',
      model: 'T-100',
    }),
  });
  assert.equal(catalogResponse.status, 201);
  const catalogItem = (await catalogResponse.json()) as { id: string };
  catalogItemId = catalogItem.id;

  const unitResponse = await fetch(`${baseUrl}/api/v1/equipment/units`, {
    method: 'POST',
    headers: {
      Cookie: founderCookie,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      catalogItemId,
      inventoryNumber: `EQ-${Date.now()}`,
      serialNumber: `SN-${Date.now()}`,
    }),
  });
  assert.equal(unitResponse.status, 201);
  const unit = (await unitResponse.json()) as {
    id: string;
    status: string;
    capabilities: { canWriteoff: boolean };
  };
  unitId = unit.id;
  assert.equal(unit.status, 'in_storage');
  assert.equal(unit.capabilities.canWriteoff, true);

  const deputyUnitListResponse = await fetch(`${baseUrl}/api/v1/equipment/units`, {
    headers: { Cookie: deputyCookie },
  });
  assert.equal(deputyUnitListResponse.status, 200);
  const deputyUnits = (await deputyUnitListResponse.json()) as Array<{
    id: string;
    capabilities: { canWriteoff: boolean; canAssignToObject: boolean };
  }>;
  const deputyUnit = deputyUnits.find((item) => item.id === unitId);
  assert.ok(deputyUnit);
  assert.equal(deputyUnit.capabilities.canAssignToObject, true);
  assert.equal(deputyUnit.capabilities.canWriteoff, true);

  const issueToObjectResponse = await fetch(
    `${baseUrl}/api/v1/equipment/units/${unitId}/movements`,
    {
      method: 'POST',
      headers: {
        Cookie: deputyCookie,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        movementType: 'issue_to_object',
        toObjectId: SEEDED_OBJECT_ID,
        comment: 'Выдали на объект для integration test',
      }),
    },
  );
  assert.equal(issueToObjectResponse.status, 201);
  const issueToObject = (await issueToObjectResponse.json()) as {
    id: string;
    toStatus: string;
    toObject: { id: string };
  };
  movementIds.push(issueToObject.id);
  assert.equal(issueToObject.toStatus, 'assigned_to_object');
  assert.equal(issueToObject.toObject.id, SEEDED_OBJECT_ID);

  const evidenceForm = new FormData();
  evidenceForm.set('entityType', 'equipment_movement');
  evidenceForm.set('entityId', issueToObject.id);
  evidenceForm.set(
    'file',
    new File(['equipment-evidence'], 'equipment-evidence.txt', {
      type: 'text/plain',
    }),
  );

  const evidenceResponse = await fetch(`${baseUrl}/api/v1/files/upload`, {
    method: 'POST',
    headers: { Cookie: deputyCookie },
    body: evidenceForm,
  });
  assert.equal(evidenceResponse.status, 201);
  const evidence = (await evidenceResponse.json()) as { id: string };
  fileIds.push(evidence.id);

  const managerObjectEquipmentResponse = await fetch(
    `${baseUrl}/api/v1/objects/${SEEDED_OBJECT_ID}/equipment`,
    {
      headers: { Cookie: managerCookie },
    },
  );
  assert.equal(managerObjectEquipmentResponse.status, 200);
  const managerObjectEquipment = (await managerObjectEquipmentResponse.json()) as {
    units: Array<{
      id: string;
      status: string;
      capabilities: { canCreateMovement: boolean };
    }>;
  };
  const scopedUnit = managerObjectEquipment.units.find((item) => item.id === unitId);
  assert.ok(scopedUnit);
  assert.equal(scopedUnit.status, 'assigned_to_object');
  assert.equal(scopedUnit.capabilities.canCreateMovement, false);

  const managerGlobalUnitResponse = await fetch(
    `${baseUrl}/api/v1/equipment/units/${unitId}`,
    {
      headers: { Cookie: managerCookie },
    },
  );
  assert.equal(managerGlobalUnitResponse.status, 403);

  const movementsResponse = await fetch(
    `${baseUrl}/api/v1/equipment/units/${unitId}/movements`,
    {
      headers: { Cookie: founderCookie },
    },
  );
  assert.equal(movementsResponse.status, 200);
  const movements = (await movementsResponse.json()) as Array<{
    id: string;
    attachments: Array<{ id: string }>;
  }>;
  const movementWithEvidence = movements.find((item) => item.id === issueToObject.id);
  assert.ok(movementWithEvidence);
  assert.equal(movementWithEvidence.attachments.length, 1);

  const createOrderResponse = await fetch(`${baseUrl}/api/v1/one-time-orders`, {
    method: 'POST',
    headers: {
      Cookie: founderCookie,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      title: `Equipment linked order ${Date.now()}`,
      executionAddress: 'Москва, equipment test, 1',
      contactName: 'Equipment contact',
      plannedPaymentMethod: 'cash',
      managerUserIds: [managerTwo.id],
    }),
  });
  assert.equal(createOrderResponse.status, 201);
  const order = (await createOrderResponse.json()) as { id: string };
  oneTimeOrderId = order.id;

  const issueToOrderResponse = await fetch(
    `${baseUrl}/api/v1/equipment/units/${unitId}/movements`,
    {
      method: 'POST',
      headers: {
        Cookie: deputyCookie,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        movementType: 'issue_to_one_time_order',
        toOneTimeOrderId: oneTimeOrderId,
      }),
    },
  );
  assert.equal(issueToOrderResponse.status, 201);
  const issueToOrder = (await issueToOrderResponse.json()) as {
    id: string;
    toStatus: string;
    toOneTimeOrder: { id: string } | null;
  };
  movementIds.push(issueToOrder.id);
  assert.equal(issueToOrder.toStatus, 'assigned_to_one_time_order');
  assert.equal(issueToOrder.toOneTimeOrder, null);

  const orderManagerCookie = await loginAndGetCookieHeader({
    baseUrl,
    login: 'manager2',
    password: 'manager123',
  });
  const orderEquipmentResponse = await fetch(
    `${baseUrl}/api/v1/one-time-orders/${oneTimeOrderId}/equipment`,
    {
      headers: { Cookie: orderManagerCookie },
    },
  );
  assert.equal(orderEquipmentResponse.status, 200);
  const orderEquipment = (await orderEquipmentResponse.json()) as {
    units: Array<{ id: string; status: string }>;
  };
  assert.ok(orderEquipment.units.some((item) => item.id === unitId));

  const returnToStorageResponse = await fetch(
    `${baseUrl}/api/v1/equipment/units/${unitId}/movements`,
    {
      method: 'POST',
      headers: {
        Cookie: deputyCookie,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        movementType: 'return_to_storage',
      }),
    },
  );
  assert.equal(returnToStorageResponse.status, 201);
  const returnToStorage = (await returnToStorageResponse.json()) as {
    id: string;
    toStatus: string;
  };
  movementIds.push(returnToStorage.id);
  assert.equal(returnToStorage.toStatus, 'in_storage');

  const brokenResponse = await fetch(
    `${baseUrl}/api/v1/equipment/units/${unitId}/movements`,
    {
      method: 'POST',
      headers: {
        Cookie: deputyCookie,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        movementType: 'mark_broken',
        comment: 'Требуется ремонт',
      }),
    },
  );
  assert.equal(brokenResponse.status, 201);
  const broken = (await brokenResponse.json()) as {
    id: string;
    toStatus: string;
  };
  movementIds.push(broken.id);
  assert.equal(broken.toStatus, 'broken');

  const repairResponse = await fetch(
    `${baseUrl}/api/v1/equipment/units/${unitId}/movements`,
    {
      method: 'POST',
      headers: {
        Cookie: deputyCookie,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        movementType: 'send_to_repair',
      }),
    },
  );
  assert.equal(repairResponse.status, 201);
  const repair = (await repairResponse.json()) as {
    id: string;
    toStatus: string;
  };
  movementIds.push(repair.id);
  assert.equal(repair.toStatus, 'under_repair');

  const fromRepairResponse = await fetch(
    `${baseUrl}/api/v1/equipment/units/${unitId}/movements`,
    {
      method: 'POST',
      headers: {
        Cookie: deputyCookie,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        movementType: 'return_from_repair',
      }),
    },
  );
  assert.equal(fromRepairResponse.status, 201);
  const fromRepair = (await fromRepairResponse.json()) as {
    id: string;
    toStatus: string;
  };
  movementIds.push(fromRepair.id);
  assert.equal(fromRepair.toStatus, 'in_storage');

  const writeoffResponse = await fetch(
    `${baseUrl}/api/v1/equipment/units/${unitId}/movements`,
    {
      method: 'POST',
      headers: {
        Cookie: deputyCookie,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        movementType: 'writeoff',
        comment: 'Финальное списание integration fixture',
      }),
    },
  );
  assert.equal(writeoffResponse.status, 201);
  const writeoff = (await writeoffResponse.json()) as {
    id: string;
    status: string;
    toStatus: string;
    approvalRequest: {
      id: string;
      approvalType: string;
      status: string;
    } | null;
  };
  movementIds.push(writeoff.id);
  assert.equal(writeoff.toStatus, 'written_off');
  assert.equal(writeoff.status, 'pending_approval');
  assert.equal(writeoff.approvalRequest?.approvalType, 'equipment_writeoff_confirmation');

  const founderWriteoffApprovalsResponse = await fetch(
    `${baseUrl}/api/v1/approvals?sourceEntityType=equipment_movement&sourceEntityId=${writeoff.id}&status=pending`,
    {
      headers: { Cookie: founderCookie },
    },
  );
  assert.equal(founderWriteoffApprovalsResponse.status, 200);
  const founderWriteoffApprovals = (await founderWriteoffApprovalsResponse.json()) as Array<{
    id: string;
    approvalType: string;
  }>;
  assert.equal(founderWriteoffApprovals.length, 1);
  assert.equal(
    founderWriteoffApprovals[0]?.approvalType,
    'equipment_writeoff_confirmation',
  );

  const founderWriteoffApproveResponse = await fetch(
    `${baseUrl}/api/v1/approvals/${founderWriteoffApprovals[0]?.id}/approve`,
    {
      method: 'POST',
      headers: {
        Cookie: founderCookie,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    },
  );
  assert.equal(founderWriteoffApproveResponse.status, 200);

  const finalUnitResponse = await fetch(`${baseUrl}/api/v1/equipment/units/${unitId}`, {
    headers: { Cookie: founderCookie },
  });
  assert.equal(finalUnitResponse.status, 200);
  const finalUnit = (await finalUnitResponse.json()) as { status: string };
  assert.equal(finalUnit.status, 'written_off');
});
