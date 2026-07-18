import assert from 'node:assert/strict';
import test from 'node:test';

import { PrismaClient } from '@prisma/client';

import { loginAndGetCookieHeader } from './helpers/auth';
import { createCoreTestObject } from './helpers/core-fixtures';
import { createTestApp } from './helpers/create-test-app';

test('inventory movements expose safe files and resolve approvals atomically', async (t) => {
  const prisma = new PrismaClient();
  const { app, baseUrl } = await createTestApp();
  const { objectId } = await createCoreTestObject(prisma);
  const founder = await prisma.user.findUniqueOrThrow({
    where: { login: 'founder' },
    select: { id: true },
  });
  const [founderCookie, directorCookie] = await Promise.all([
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
  ]);
  const marker = `movement-hardening-${Date.now()}`;

  t.after(async () => {
    await prisma.$executeRawUnsafe(
      'DROP TRIGGER IF EXISTS fail_inventory_resolve_audit_trigger ON "audit_events"',
    );
    await prisma.$executeRawUnsafe(
      'DROP FUNCTION IF EXISTS fail_inventory_resolve_audit()',
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
  const createMovement = async (
    inventoryItemId: string,
    payload: Record<string, unknown>,
  ): Promise<{
    id: string;
    status: string;
    approvalRequest: { id: string; status: string } | null;
  }> => {
    const response = await fetch(`${baseUrl}/api/v1/inventory/movements`, {
      method: 'POST',
      headers: {
        Cookie: founderCookie,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ inventoryItemId, ...payload }),
    });
    assert.equal(response.status, 201);
    return response.json() as Promise<{
      id: string;
      status: string;
      approvalRequest: { id: string; status: string } | null;
    }>;
  };
  const resolveApproval = (
    approvalRequestId: string,
    action: 'approve' | 'reject',
  ): Promise<Response> =>
    fetch(`${baseUrl}/api/v1/approvals/${approvalRequestId}/${action}`, {
      method: 'POST',
      headers: {
        Cookie: directorCookie,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(action === 'reject' ? { comment: 'Отклонено' } : {}),
    });

  const item = await createItem(`Safe files ${marker}`);
  const receipt = await createMovement(item.id, {
    movementType: 'receipt',
    quantity: 20,
    unitPrice: 100,
  });
  const visibleFile = await prisma.file.create({
    data: {
      bucket: 'internal-test-bucket',
      objectKey: `${marker}/visible`,
      originalName: 'receipt.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 42,
      uploadedByUserId: founder.id,
    },
  });
  const deletedFile = await prisma.file.create({
    data: {
      bucket: 'internal-test-bucket',
      objectKey: `${marker}/deleted`,
      originalName: 'deleted.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 43,
      uploadedByUserId: founder.id,
      deletedAt: new Date(),
    },
  });
  await prisma.fileAttachment.createMany({
    data: [visibleFile, deletedFile].map((file) => ({
      fileId: file.id,
      entityType: 'inventory_movement',
      entityId: receipt.id,
      uploadedByUserId: founder.id,
    })),
  });

  const movementListResponse = await fetch(
    `${baseUrl}/api/v1/inventory/movements?inventoryItemId=${item.id}&page=1&limit=1&status=applied`,
    { headers: { Cookie: founderCookie } },
  );
  assert.equal(movementListResponse.status, 200);
  const movementListBody = (await movementListResponse.json()) as {
      items: Array<{
        id: string;
        attachments: Array<Record<string, unknown>>;
      }>;
      total: number;
      page: number;
      limit: number;
      totalPages: number;
    };
  const movementList = movementListBody.items;
  assert.equal(movementListBody.total, 1);
  assert.equal(movementListBody.page, 1);
  assert.equal(movementListBody.limit, 1);
  assert.equal(movementListBody.totalPages, 1);
  const listedReceipt = movementList.find((movement) => movement.id === receipt.id);
  assert.ok(listedReceipt);
  assert.equal(listedReceipt.attachments.length, 1);
  assert.deepEqual(Object.keys(listedReceipt.attachments[0] ?? {}).sort(), [
    'createdAt',
    'downloadUrl',
    'id',
    'mimeType',
    'originalName',
    'sizeBytes',
    'viewUrl',
  ]);
  assert.equal(listedReceipt.attachments[0]?.bucket, undefined);
  assert.equal(listedReceipt.attachments[0]?.objectKey, undefined);

  const parallelWriteoff = await createMovement(item.id, {
    movementType: 'writeoff',
    quantity: 2,
    comment: 'Параллельное подтверждение',
  });
  assert.ok(parallelWriteoff.approvalRequest);
  const approveResponses = await Promise.all([
    resolveApproval(parallelWriteoff.approvalRequest.id, 'approve'),
    resolveApproval(parallelWriteoff.approvalRequest.id, 'approve'),
  ]);
  assert.deepEqual(
    approveResponses.map((response) => response.status).sort(),
    [200, 409],
  );

  const mixedWriteoff = await createMovement(item.id, {
    movementType: 'writeoff',
    quantity: 2,
    comment: 'Конкурирующие решения',
  });
  assert.ok(mixedWriteoff.approvalRequest);
  const mixedResponses = await Promise.all([
    resolveApproval(mixedWriteoff.approvalRequest.id, 'approve'),
    resolveApproval(mixedWriteoff.approvalRequest.id, 'reject'),
  ]);
  assert.deepEqual(
    mixedResponses.map((response) => response.status).sort(),
    [200, 409],
  );
  const mixedMovementState = await prisma.inventoryMovement.findUniqueOrThrow({
    where: { id: mixedWriteoff.id },
    select: { status: true },
  });
  const mixedApprovalState = await prisma.approvalRequest.findUniqueOrThrow({
    where: { id: mixedWriteoff.approvalRequest.id },
    select: { status: true },
  });
  assert.equal(
    mixedMovementState.status,
    mixedApprovalState.status === 'approved' ? 'applied' : 'rejected',
  );
  assert.equal(
    await prisma.auditEvent.count({
      where: {
        entityType: 'inventory_movement',
        entityId: mixedWriteoff.id,
        action: { in: ['inventory.writeoff.approved', 'inventory.writeoff.rejected'] },
      },
    }),
    1,
  );

  const missingPhotoIssue = await createMovement(item.id, {
    movementType: 'issue_to_object',
    quantity: 1,
    relatedObjectId: objectId,
  });
  assert.ok(missingPhotoIssue.approvalRequest);
  const missingPhotoResponses = await Promise.all([
    fetch(
      `${baseUrl}/api/v1/inventory/movements/${missingPhotoIssue.id}/resolve-missing-photo-approval`,
      { method: 'POST', headers: { Cookie: directorCookie } },
    ),
    resolveApproval(missingPhotoIssue.approvalRequest.id, 'approve'),
  ]);
  assert.deepEqual(
    missingPhotoResponses.map((response) => response.status).sort(),
    [200, 409],
  );
  assert.equal(
    await prisma.auditEvent.count({
      where: {
        entityType: 'inventory_movement',
        entityId: missingPhotoIssue.id,
        action: 'inventory.missing_photo_approval.resolved',
      },
    }),
    1,
  );
  assert.equal(
    (
      await prisma.approvalRequest.findUniqueOrThrow({
        where: { id: missingPhotoIssue.approvalRequest.id },
        select: { status: true },
      })
    ).status,
    'approved',
  );

  const stockChangeItem = await createItem(`Stock recheck ${marker}`);
  await createMovement(stockChangeItem.id, {
    movementType: 'receipt',
    quantity: 10,
    unitPrice: 50,
  });
  const blockedWriteoff = await createMovement(stockChangeItem.id, {
    movementType: 'writeoff',
    quantity: 8,
    comment: 'Запас изменится до решения',
  });
  assert.ok(blockedWriteoff.approvalRequest);
  await createMovement(stockChangeItem.id, {
    movementType: 'issue_to_object',
    quantity: 5,
    relatedObjectId: objectId,
  });
  const blockedApprovalResponse = await resolveApproval(
    blockedWriteoff.approvalRequest.id,
    'approve',
  );
  assert.equal(blockedApprovalResponse.status, 409);
  assert.equal(
    (
      await prisma.inventoryMovement.findUniqueOrThrow({
        where: { id: blockedWriteoff.id },
        select: { status: true },
      })
    ).status,
    'pending_approval',
  );
  assert.equal(
    (
      await prisma.approvalRequest.findUniqueOrThrow({
        where: { id: blockedWriteoff.approvalRequest.id },
        select: { status: true },
      })
    ).status,
    'pending',
  );

  const auditRollbackWriteoff = await createMovement(item.id, {
    movementType: 'writeoff',
    quantity: 1,
    comment: 'Проверка atomic audit',
  });
  assert.ok(auditRollbackWriteoff.approvalRequest);
  await prisma.$executeRawUnsafe(`
    CREATE FUNCTION fail_inventory_resolve_audit()
    RETURNS trigger AS $$
    BEGIN
      IF NEW."action" = 'inventory.writeoff.approved'
         AND NEW."entityId" = '${auditRollbackWriteoff.id}' THEN
        RAISE EXCEPTION 'forced inventory resolve audit failure';
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TRIGGER fail_inventory_resolve_audit_trigger
    BEFORE INSERT ON "audit_events"
    FOR EACH ROW EXECUTE FUNCTION fail_inventory_resolve_audit()
  `);
  const auditFailureResponse = await resolveApproval(
    auditRollbackWriteoff.approvalRequest.id,
    'approve',
  );
  assert.equal(auditFailureResponse.status, 500);
  assert.equal(
    (
      await prisma.inventoryMovement.findUniqueOrThrow({
        where: { id: auditRollbackWriteoff.id },
        select: { status: true },
      })
    ).status,
    'pending_approval',
  );
  assert.equal(
    (
      await prisma.approvalRequest.findUniqueOrThrow({
        where: { id: auditRollbackWriteoff.approvalRequest.id },
        select: { status: true },
      })
    ).status,
    'pending',
  );
});
