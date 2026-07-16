import assert from 'node:assert/strict';
import test from 'node:test';

import { PrismaClient } from '@prisma/client';

import { hashPassword } from '../src/modules/auth/utils/password-hash.util';

import { SEEDED_OBJECT_ID } from './helpers/core-fixtures';
import { loginAndGetCookieHeader } from './helpers/auth';
import { createTestApp } from './helpers/create-test-app';

async function ensureDeputyDirectorFixture(
  prisma: PrismaClient,
): Promise<void> {
  const role = await prisma.role.upsert({
    where: {
      code: 'deputy_director',
    },
    update: {
      name: 'Заместитель директора',
      description: 'Системная роль заместителя директора',
    },
    create: {
      code: 'deputy_director',
      name: 'Заместитель директора',
      description: 'Системная роль заместителя директора',
    },
  });

  const deputyPasswordHash = await hashPassword('deputy123');
  const deputyUser = await prisma.user.upsert({
    where: {
      login: 'deputy1',
    },
    update: {
      fullName: 'Заместитель директора',
      isActive: true,
      passwordHash: deputyPasswordHash,
    },
    create: {
      login: 'deputy1',
      fullName: 'Заместитель директора',
      isActive: true,
      passwordHash: deputyPasswordHash,
    },
  });

  await prisma.userRole.upsert({
    where: {
      userId_roleId: {
        userId: deputyUser.id,
        roleId: role.id,
      },
    },
    update: {},
    create: {
      userId: deputyUser.id,
      roleId: role.id,
    },
  });
}

test('inventory ledger supports receipts, scoped issues, returns, evidence and capability gates', async (t) => {
  const prisma = new PrismaClient();
  await ensureDeputyDirectorFixture(prisma);
  const { app, baseUrl } = await createTestApp();

  let inventoryItemId: string | null = null;
  let deputyInventoryItemId: string | null = null;
  let oneTimeOrderId: string | null = null;
  const createdMovementIds: string[] = [];
  const createdFileIds: string[] = [];

  t.after(async () => {
    if (createdMovementIds.length > 0) {
      const attachmentFileIds = (
        await prisma.fileAttachment.findMany({
          where: {
            entityType: 'inventory_movement',
            entityId: {
              in: createdMovementIds,
            },
          },
          select: {
            fileId: true,
          },
        })
      ).map((item) => item.fileId);

      createdFileIds.push(...attachmentFileIds);

      await prisma.fileAttachment.deleteMany({
        where: {
          entityType: 'inventory_movement',
          entityId: {
            in: createdMovementIds,
          },
        },
      });

      if (createdFileIds.length > 0) {
        await prisma.file.deleteMany({
          where: {
            id: {
              in: createdFileIds,
            },
          },
        });
      }

      await prisma.auditEvent.deleteMany({
        where: {
          entityType: 'inventory_movement',
          entityId: {
            in: createdMovementIds,
          },
        },
      });

      await prisma.approvalRequest.deleteMany({
        where: {
          sourceEntityType: 'inventory_movement',
          sourceEntityId: {
            in: createdMovementIds,
          },
        },
      });

      await prisma.inventoryMovement.deleteMany({
        where: {
          id: {
            in: createdMovementIds,
          },
        },
      });
    }

    if (oneTimeOrderId) {
      await prisma.auditEvent.deleteMany({
        where: {
          entityType: 'one_time_order',
          entityId: oneTimeOrderId,
        },
      });

      await prisma.oneTimeOrderAssignment.deleteMany({
        where: {
          oneTimeOrderId,
        },
      });

      await prisma.oneTimeOrder.deleteMany({
        where: {
          id: oneTimeOrderId,
        },
      });
    }

    if (inventoryItemId) {
      await prisma.auditEvent.deleteMany({
        where: {
          entityType: 'inventory_item',
          entityId: inventoryItemId,
        },
      });

      await prisma.inventoryItem.deleteMany({
        where: {
          id: inventoryItemId,
        },
      });
    }

    if (deputyInventoryItemId) {
      await prisma.auditEvent.deleteMany({
        where: {
          entityType: 'inventory_item',
          entityId: deputyInventoryItemId,
        },
      });
      await prisma.inventoryItem.deleteMany({
        where: { id: deputyInventoryItemId },
      });
    }

    await app.close();
    await prisma.$disconnect();
  });

  const [founderCookie, directorCookie, deputyCookie, managerCookie] =
    await Promise.all([
      loginAndGetCookieHeader({
        baseUrl,
        login: 'founder',
        password: 'founder123',
      }),
      loginAndGetCookieHeader({
        baseUrl,
        login: 'director',
        password: 'director123',
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

  const managerDeniedResponse = await fetch(`${baseUrl}/api/v1/inventory/items`, {
    headers: {
      Cookie: managerCookie,
    },
  });

  assert.equal(managerDeniedResponse.status, 403);

  const createItemForDeputy = await fetch(
    `${baseUrl}/api/v1/inventory/items`,
    {
      method: 'POST',
      headers: {
        Cookie: deputyCookie,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: `Запасная химия ${Date.now()}`,
        category: 'Химия',
        unit: 'шт',
      }),
    },
  );

  assert.equal(createItemForDeputy.status, 201);
  deputyInventoryItemId = (
    (await createItemForDeputy.json()) as { id: string }
  ).id;

  const createItemResponse = await fetch(`${baseUrl}/api/v1/inventory/items`, {
    method: 'POST',
    headers: {
      Cookie: founderCookie,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: `Моющее средство ${Date.now()}`,
      category: 'Химия',
      unit: 'л',
      notes: 'Интеграционный inventory fixture',
    }),
  });

  assert.equal(createItemResponse.status, 201);

  const createdItem = (await createItemResponse.json()) as {
    id: string;
    currentStock: number;
    currentUnitPrice: number | null;
  };
  inventoryItemId = createdItem.id;
  assert.equal(createdItem.currentStock, 0);
  assert.equal(createdItem.currentUnitPrice, null);

  const createOrderResponse = await fetch(`${baseUrl}/api/v1/one-time-orders`, {
    method: 'POST',
    headers: {
      Cookie: founderCookie,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      title: `Inventory linked order ${Date.now()}`,
      executionAddress: 'Москва, тестовый адрес заказа, 99',
      linkedObjectId: SEEDED_OBJECT_ID,
      contactName: 'Складской контакт',
      agreedSum: 10000,
    }),
  });

  assert.equal(createOrderResponse.status, 201);
  const createdOrder = (await createOrderResponse.json()) as { id: string };
  oneTimeOrderId = createdOrder.id;

  const receiptResponse = await fetch(`${baseUrl}/api/v1/inventory/movements`, {
    method: 'POST',
    headers: {
      Cookie: deputyCookie,
      'Content-Type': 'application/json',
    },
      body: JSON.stringify({
        inventoryItemId,
        movementType: 'receipt',
        quantity: 10,
        unitPrice: 120.5,
        comment: 'Приход для inventory integration test',
      }),
  });

  assert.equal(receiptResponse.status, 201);
  const receiptMovement = (await receiptResponse.json()) as {
    id: string;
    unitPriceSnapshot: number;
    totalAmountSnapshot: number;
  };
  createdMovementIds.push(receiptMovement.id);
  assert.equal(receiptMovement.unitPriceSnapshot, 120.5);
  assert.equal(receiptMovement.totalAmountSnapshot, 1205);

  const issueToObjectResponse = await fetch(
    `${baseUrl}/api/v1/inventory/movements`,
    {
      method: 'POST',
      headers: {
        Cookie: founderCookie,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        inventoryItemId,
        movementType: 'issue_to_object',
        quantity: 2,
        relatedObjectId: SEEDED_OBJECT_ID,
      }),
    },
  );

  assert.equal(issueToObjectResponse.status, 201);
  const issueToObjectMovement = (await issueToObjectResponse.json()) as {
    id: string;
    projection: {
      requiresApprovalBridge: boolean;
    };
  };
  createdMovementIds.push(issueToObjectMovement.id);
  assert.equal(issueToObjectMovement.projection.requiresApprovalBridge, true);

  const uploadFormData = new FormData();
  uploadFormData.set('entityType', 'inventory_movement');
  uploadFormData.set('entityId', issueToObjectMovement.id);
  uploadFormData.set(
    'file',
    new File(['inventory-evidence'], 'evidence.txt', {
      type: 'text/plain',
    }),
  );

  const uploadEvidenceResponse = await fetch(`${baseUrl}/api/v1/files/upload`, {
    method: 'POST',
    headers: {
      Cookie: founderCookie,
    },
    body: uploadFormData,
  });

  assert.equal(uploadEvidenceResponse.status, 201);
  const uploadedEvidence = (await uploadEvidenceResponse.json()) as { id: string };
  createdFileIds.push(uploadedEvidence.id);

  const managerObjectIssueResponse = await fetch(
    `${baseUrl}/api/v1/objects/${SEEDED_OBJECT_ID}/inventory/issue`,
    {
      method: 'POST',
      headers: {
        Cookie: managerCookie,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        inventoryItemId,
        quantity: 1,
        comment: 'Объектный менеджер списал расходник без фото',
      }),
    },
  );

  assert.equal(managerObjectIssueResponse.status, 201);
  const managerObjectIssue = (await managerObjectIssueResponse.json()) as {
    id: string;
    projection: {
      requiresApprovalBridge: boolean;
      canResolveMissingPhotoApproval: boolean;
    };
  };
  createdMovementIds.push(managerObjectIssue.id);
  assert.equal(managerObjectIssue.projection.requiresApprovalBridge, true);
  assert.equal(
    managerObjectIssue.projection.canResolveMissingPhotoApproval,
    false,
  );

  const issueToOrderResponse = await fetch(
    `${baseUrl}/api/v1/inventory/movements`,
    {
      method: 'POST',
      headers: {
        Cookie: founderCookie,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        inventoryItemId,
        movementType: 'issue_to_one_time_order',
        quantity: 3,
        relatedOneTimeOrderId: oneTimeOrderId,
      }),
    },
  );

  assert.equal(issueToOrderResponse.status, 201);
  const issueToOrderMovement = (await issueToOrderResponse.json()) as {
    id: string;
    projection: {
      requiresApprovalBridge: boolean;
      approvalBridgeType: string | null;
      canResolveMissingPhotoApproval: boolean;
    };
  };
  createdMovementIds.push(issueToOrderMovement.id);
  assert.equal(issueToOrderMovement.projection.requiresApprovalBridge, true);
  assert.equal(
    issueToOrderMovement.projection.approvalBridgeType,
    'inventory_missing_photo_evidence_required',
  );
  assert.equal(
    issueToOrderMovement.projection.canResolveMissingPhotoApproval,
    false,
  );

  const returnResponse = await fetch(`${baseUrl}/api/v1/inventory/movements`, {
    method: 'POST',
    headers: {
      Cookie: founderCookie,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      inventoryItemId,
      movementType: 'return',
      quantity: 1,
      relatedObjectId: SEEDED_OBJECT_ID,
    }),
  });

  assert.equal(returnResponse.status, 201);
  const returnMovement = (await returnResponse.json()) as { id: string };
  createdMovementIds.push(returnMovement.id);

  const writeoffResponse = await fetch(
    `${baseUrl}/api/v1/inventory/movements`,
    {
      method: 'POST',
      headers: {
        Cookie: deputyCookie,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        inventoryItemId,
        movementType: 'writeoff',
        quantity: 1,
        comment: 'Списание заместителем директора',
      }),
    },
  );

  assert.equal(writeoffResponse.status, 201);
  const writeoffMovement = (await writeoffResponse.json()) as {
    id: string;
    status: string;
    approvalRequest: {
      id: string;
      approvalType: string;
      status: string;
    } | null;
    projection: {
      requiresApprovalBridge: boolean;
      approvalBridgeType: string | null;
      canResolveMissingPhotoApproval: boolean;
    };
  };
  createdMovementIds.push(writeoffMovement.id);
  assert.equal(writeoffMovement.status, 'pending_approval');
  assert.equal(writeoffMovement.approvalRequest?.approvalType, 'inventory_writeoff_confirmation');
  assert.equal(writeoffMovement.approvalRequest?.status, 'pending');
  assert.equal(writeoffMovement.projection.requiresApprovalBridge, false);
  assert.equal(writeoffMovement.projection.approvalBridgeType, null);
  assert.equal(
    writeoffMovement.projection.canResolveMissingPhotoApproval,
    false,
  );

  const directorWriteoffApprovalsResponse = await fetch(
    `${baseUrl}/api/v1/approvals?sourceEntityType=inventory_movement&sourceEntityId=${writeoffMovement.id}&status=pending`,
    {
      headers: {
        Cookie: directorCookie,
      },
    },
  );

  assert.equal(directorWriteoffApprovalsResponse.status, 200);
  const directorWriteoffApprovals = (await directorWriteoffApprovalsResponse.json()) as Array<{
    id: string;
    approvalType: string;
    status: string;
  }>;
  assert.equal(directorWriteoffApprovals.length, 1);
  assert.equal(
    directorWriteoffApprovals[0]?.approvalType,
    'inventory_writeoff_confirmation',
  );

  const directorWriteoffApproveResponse = await fetch(
    `${baseUrl}/api/v1/approvals/${directorWriteoffApprovals[0]?.id}/approve`,
    {
      method: 'POST',
      headers: {
        Cookie: directorCookie,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    },
  );

  assert.equal(directorWriteoffApproveResponse.status, 200);

  const adjustmentResponse = await fetch(
    `${baseUrl}/api/v1/inventory/movements`,
    {
      method: 'POST',
      headers: {
        Cookie: founderCookie,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        inventoryItemId,
        movementType: 'adjustment',
        quantity: 0.5,
        adjustmentDirection: 'decrease',
        comment: 'Корректировка инвентаризации',
      }),
    },
  );

  assert.equal(adjustmentResponse.status, 201);
  const adjustmentMovement = (await adjustmentResponse.json()) as {
    id: string;
    projection: {
      requiresApprovalBridge: boolean;
      approvalBridgeType: string | null;
      canResolveMissingPhotoApproval: boolean;
    };
  };
  createdMovementIds.push(adjustmentMovement.id);
  assert.equal(adjustmentMovement.projection.requiresApprovalBridge, true);
  assert.equal(
    adjustmentMovement.projection.approvalBridgeType,
    'inventory_missing_photo_evidence_required',
  );
  assert.equal(
    adjustmentMovement.projection.canResolveMissingPhotoApproval,
    false,
  );

  const itemDetailsResponse = await fetch(
    `${baseUrl}/api/v1/inventory/items/${inventoryItemId}`,
    {
      headers: {
        Cookie: founderCookie,
      },
    },
  );

  assert.equal(itemDetailsResponse.status, 200);

  const itemDetails = (await itemDetailsResponse.json()) as {
    currentStock: number;
    currentUnitPrice: number;
    currentEstimatedTotalValue: number;
    summary: {
      movementsCount: number;
    };
  };

  assert.equal(itemDetails.currentStock, 3.5);
  assert.equal(itemDetails.currentUnitPrice, 120.5);
  assert.equal(itemDetails.currentEstimatedTotalValue, 421.75);
  assert.equal(itemDetails.summary.movementsCount, 7);

  const founderMovementsResponse = await fetch(
    `${baseUrl}/api/v1/inventory/movements?inventoryItemId=${inventoryItemId}`,
    {
      headers: {
        Cookie: founderCookie,
      },
    },
  );

  assert.equal(founderMovementsResponse.status, 200);
  const founderMovements = (await founderMovementsResponse.json()) as Array<{
    id: string;
    projection: {
      hasEvidence: boolean;
      requiresApprovalBridge: boolean;
      canResolveMissingPhotoApproval: boolean;
    };
    relatedObject: { canOpenObjectCard: boolean } | null;
    relatedOneTimeOrder: { canOpenOrderCard: boolean } | null;
  }>;

  const uploadedMovement = founderMovements.find(
    (movement) => movement.id === issueToObjectMovement.id,
  );
  assert.ok(uploadedMovement);
  assert.equal(uploadedMovement.projection.hasEvidence, true);
  assert.equal(uploadedMovement.projection.requiresApprovalBridge, false);
  assert.equal(uploadedMovement.relatedObject?.canOpenObjectCard, true);

  const managerMissingPhotoMovement = founderMovements.find(
    (movement) => movement.id === managerObjectIssue.id,
  );
  assert.ok(managerMissingPhotoMovement);
  assert.equal(
    managerMissingPhotoMovement.projection.requiresApprovalBridge,
    true,
  );
  assert.equal(
    managerMissingPhotoMovement.projection.canResolveMissingPhotoApproval,
    false,
  );

  const orderLinkedMovement = founderMovements.find(
    (movement) => movement.id === issueToOrderMovement.id,
  );
  assert.ok(orderLinkedMovement);
  assert.equal(orderLinkedMovement.relatedOneTimeOrder?.canOpenOrderCard, true);

  const deputyMovementsResponse = await fetch(
    `${baseUrl}/api/v1/inventory/movements?inventoryItemId=${inventoryItemId}`,
    {
      headers: {
        Cookie: deputyCookie,
      },
    },
  );

  assert.equal(deputyMovementsResponse.status, 200);
  const deputyMovements = (await deputyMovementsResponse.json()) as Array<{
    relatedObject: { canOpenObjectCard: boolean } | null;
    relatedOneTimeOrder: { canOpenOrderCard: boolean } | null;
  }>;

  assert.ok(deputyMovements.some((movement) => movement.relatedObject !== null));
  assert.ok(
    deputyMovements.some(
      (movement) => movement.relatedObject?.canOpenObjectCard === true,
    ),
  );
  assert.ok(
    deputyMovements.every((movement) => movement.relatedOneTimeOrder === null),
  );

  const directorMovementsResponse = await fetch(
    `${baseUrl}/api/v1/inventory/movements?inventoryItemId=${inventoryItemId}`,
    {
      headers: {
        Cookie: directorCookie,
      },
    },
  );

  assert.equal(directorMovementsResponse.status, 200);
  const directorMovements = (await directorMovementsResponse.json()) as Array<{
    id: string;
    projection: {
      requiresApprovalBridge: boolean;
      approvalBridgeResolvedAt: string | null;
      canResolveMissingPhotoApproval: boolean;
    };
  }>;
  const directorBridgeMovement = directorMovements.find(
    (movement) => movement.id === managerObjectIssue.id,
  );
  assert.ok(directorBridgeMovement);
  assert.equal(
    directorBridgeMovement.projection.canResolveMissingPhotoApproval,
    true,
  );

  const directorApprovalsResponse = await fetch(
    `${baseUrl}/api/v1/approvals?sourceEntityType=inventory_movement&sourceEntityId=${managerObjectIssue.id}&status=pending`,
    {
      headers: {
        Cookie: directorCookie,
      },
    },
  );

  assert.equal(directorApprovalsResponse.status, 200);
  const directorApprovals = (await directorApprovalsResponse.json()) as Array<{
    id: string;
    approvalType: string;
    status: string;
  }>;
  assert.equal(directorApprovals.length, 1);
  assert.equal(
    directorApprovals[0]?.approvalType,
    'inventory_exception_confirmation',
  );
  assert.equal(directorApprovals[0]?.status, 'pending');

  const founderResolveResponse = await fetch(
    `${baseUrl}/api/v1/approvals/${directorApprovals[0]?.id}/approve`,
    {
      method: 'POST',
      headers: {
        Cookie: founderCookie,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    },
  );

  assert.equal(founderResolveResponse.status, 403);

  const directorResolveResponse = await fetch(
    `${baseUrl}/api/v1/approvals/${directorApprovals[0]?.id}/approve`,
    {
      method: 'POST',
      headers: {
        Cookie: directorCookie,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    },
  );

  assert.equal(directorResolveResponse.status, 200);
  const resolvedMovement = (await directorResolveResponse.json()) as {
    status: string;
  };
  assert.equal(resolvedMovement.status, 'approved');

  const resolvedMovementViewResponse = await fetch(
    `${baseUrl}/api/v1/inventory/movements?inventoryItemId=${inventoryItemId}`,
    {
      headers: {
        Cookie: directorCookie,
      },
    },
  );

  assert.equal(resolvedMovementViewResponse.status, 200);
  const resolvedMovementView = (await resolvedMovementViewResponse.json()) as Array<{
    id: string;
    projection: {
      hasEvidence: boolean;
      requiresApprovalBridge: boolean;
      approvalBridgeResolvedAt: string | null;
      approvalBridgeResolvedBy: { fullName: string } | null;
      canResolveMissingPhotoApproval: boolean;
    };
  }>;
  const approvedMovement = resolvedMovementView.find(
    (movement) => movement.id === managerObjectIssue.id,
  );
  assert.ok(approvedMovement);
  assert.equal(approvedMovement.projection.hasEvidence, false);
  assert.equal(approvedMovement.projection.requiresApprovalBridge, false);
  assert.ok(approvedMovement.projection.approvalBridgeResolvedAt);
  assert.equal(
    approvedMovement.projection.approvalBridgeResolvedBy?.fullName,
    'Директор',
  );
  assert.equal(
    approvedMovement.projection.canResolveMissingPhotoApproval,
    false,
  );

  const objectInventoryResponse = await fetch(
    `${baseUrl}/api/v1/objects/${SEEDED_OBJECT_ID}/inventory`,
    {
      headers: {
        Cookie: directorCookie,
      },
    },
  );

  assert.equal(objectInventoryResponse.status, 200);
  const objectInventory = (await objectInventoryResponse.json()) as {
    movements: Array<{
      id: string;
      inventoryItem: { unit: string };
      quantity: number;
      unitPriceSnapshot: number;
      totalAmountSnapshot: number;
      createdBy: { fullName: string };
      projection: {
        hasEvidence: boolean;
        requiresApprovalBridge: boolean;
        approvalBridgeResolvedAt: string | null;
      };
    }>;
  };
  const objectInventoryMovement = objectInventory.movements.find(
    (movement) => movement.id === managerObjectIssue.id,
  );
  assert.ok(objectInventoryMovement);
  assert.equal(objectInventoryMovement.inventoryItem.unit, 'л');
  assert.equal(objectInventoryMovement.quantity, 1);
  assert.equal(objectInventoryMovement.unitPriceSnapshot, 120.5);
  assert.equal(objectInventoryMovement.totalAmountSnapshot, 120.5);
  assert.equal(objectInventoryMovement.createdBy.fullName, 'Менеджер Первый');
  assert.equal(objectInventoryMovement.projection.hasEvidence, false);
  assert.equal(
    objectInventoryMovement.projection.requiresApprovalBridge,
    false,
  );
  assert.ok(objectInventoryMovement.projection.approvalBridgeResolvedAt);
});
