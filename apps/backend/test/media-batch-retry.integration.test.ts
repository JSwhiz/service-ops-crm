import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { PrismaClient } from '@prisma/client';
import { createTestApp } from './helpers/create-test-app';
import { createCoreTestObject } from './helpers/core-fixtures';
import { loginAndGetCookieHeader } from './helpers/auth';

test('more than ten report photos upload, retries deduplicate, one common issue photo closes the bridge and yesterday is read-only', async (t) => {
  assert.equal(process.env.TEST_ISOLATED_DATABASE, 'true');
  const prisma = new PrismaClient();
  const { app, baseUrl } = await createTestApp();
  t.after(async () => { await app.close(); await prisma.$disconnect(); });
  const { objectId } = await createCoreTestObject(prisma, { includeManagerAssignment: true });
  const manager = await prisma.user.findUniqueOrThrow({ where: { login: 'manager1' } });
  const cookie = await loginAndGetCookieHeader({ baseUrl, login: 'manager1', password: 'manager123' });
  const founderCookie = await loginAndGetCookieHeader({ baseUrl, login: 'founder', password: 'founder123' });
  const report = await prisma.objectDailyReport.create({ data: { objectId, reportDate: new Date(), content: 'Bulk evidence', updatedByUserId: manager.id } });
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZHkAAAAASUVORK5CYII=', 'base64');
  const upload = (entityType: string, entityId: string, uploadId = randomUUID(), auth = cookie) => {
    const form = new FormData();
    form.set('entityType', entityType); form.set('entityId', entityId); form.set('uploadId', uploadId);
    form.set('file', new Blob([png], { type: 'image/png' }), 'evidence.png');
    return fetch(`${baseUrl}/api/v1/files/upload`, { method: 'POST', headers: { Cookie: auth }, body: form });
  };
  for (let i = 0; i < 12; i += 1) {
    const response = await upload('object_daily_report', report.id);
    assert.equal(response.status, 201, await response.clone().text());
  }
  const retryId = randomUUID();
  const retries = await Promise.all([upload('object_daily_report', report.id, retryId), upload('object_daily_report', report.id, retryId)]);
  for (const response of retries) assert.equal(response.status, 201, await response.clone().text());
  assert.equal(await prisma.fileAttachment.count({ where: { entityType: 'object_daily_report', entityId: report.id } }), 13);
  assert.ok(await prisma.file.findUnique({ where: { id: retryId } }));
  const taskResponse = await fetch(`${baseUrl}/api/v1/tasks`, { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'Bulk task evidence', priority: 'important_not_urgent', assigneeUserIds: [manager.id], visibilityType: 'private', requiresConfirmation: true, completionRequirement: 'file_required', dueDate: '2030-01-01' }) });
  assert.equal(taskResponse.status, 201, await taskResponse.clone().text());
  const task = await taskResponse.json() as { id: string };
  for (let i = 0; i < 12; i += 1) assert.equal((await upload('task', task.id)).status, 201);
  assert.equal(await prisma.fileAttachment.count({ where: { entityType: 'task', entityId: task.id } }), 12);
  const another = await prisma.objectComment.create({ data: { objectId, content: 'Other target', createdByUserId: manager.id } });
  assert.equal((await upload('object_comment', another.id, retryId)).status, 409);
  const item = await prisma.inventoryItem.create({ data: { name: 'Photo evidence fixture', category: 'Test', unit: 'шт', createdByUserId: manager.id } });
  const movement = await prisma.inventoryMovement.create({ data: { inventoryItemId: item.id, movementType: 'issue_to_object', quantity: 1, unitPriceSnapshot: 10, totalAmountSnapshot: 10, status: 'applied', relatedObjectId: objectId, requiresApprovalBridge: true, createdByUserId: manager.id } });
  const attached = await upload('inventory_movement', movement.id);
  assert.equal(attached.status, 201, await attached.clone().text());
  assert.equal((await prisma.inventoryMovement.findUniqueOrThrow({ where: { id: movement.id } })).requiresApprovalBridge, false);
  await prisma.inventoryMovement.update({ where: { id: movement.id }, data: { createdAt: new Date(Date.now() - 86400000) } });
  assert.equal((await upload('inventory_movement', movement.id)).status, 403);
  assert.equal((await upload('inventory_movement', movement.id, randomUUID(), founderCookie)).status, 403);
});
