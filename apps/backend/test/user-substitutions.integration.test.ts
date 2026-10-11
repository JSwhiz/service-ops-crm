import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { PrismaClient } from '@prisma/client';

import { createCoreTestObject } from './helpers/core-fixtures';
import { loginAndGetCookieHeader } from './helpers/auth';
import { createTestApp } from './helpers/create-test-app';

test('object substitutions preserve identity, constrain scope, expire and revoke without global privilege inheritance', async (t) => {
  const prisma = new PrismaClient();
  const { app, baseUrl } = await createTestApp();
  t.after(async () => {
    await app.close();
    await prisma.$disconnect();
  });
  const source = await prisma.user.findUniqueOrThrow({
    where: { login: 'manager1' },
  });
  const founder = await prisma.user.findUniqueOrThrow({
    where: { login: 'founder' },
  });
  const passwordSource = await prisma.user.findUniqueOrThrow({
    where: { login: 'manager2' },
  });
  const replacement = await prisma.user.create({
    data: {
      id: randomUUID(),
      login: `replacement-${randomUUID()}`,
      fullName: 'Замещающий тестовый пользователь',
      passwordHash: passwordSource.passwordHash,
    },
  });
  const object = await createCoreTestObject(prisma, {
    includeManagerAssignment: true,
  });
  const outside = await createCoreTestObject(prisma);
  const sourceCookie = await loginAndGetCookieHeader({
    baseUrl,
    login: source.login,
    password: 'manager123',
  });
  const founderCookie = await loginAndGetCookieHeader({
    baseUrl,
    login: 'founder',
    password: 'founder123',
  });
  const replacementCookie = await loginAndGetCookieHeader({
    baseUrl,
    login: replacement.login,
    password: 'manager123',
  });
  const request = (
    cookie: string,
    path: string,
    method = 'GET',
    payload?: unknown,
  ) =>
    fetch(`${baseUrl}/api/v1/${path}`, {
      method,
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
    });
  const createPayload = (objectIds = [object.objectId]) => ({
    replacementUserId: replacement.id,
    objectIds,
    startsAt: new Date(Date.now() - 1000).toISOString(),
    endsAt: new Date(Date.now() + 3600000).toISOString(),
    reason: 'Отпуск',
  });
  assert.equal(
    (await request(replacementCookie, `objects/${object.objectId}`)).status,
    404,
  );
  assert.equal(
    (
      await request(
        sourceCookie,
        'user-substitutions',
        'POST',
        createPayload([outside.objectId]),
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await request(sourceCookie, 'user-substitutions', 'POST', {
        ...createPayload(),
        principalUserId: founder.id,
      })
    ).status,
    403,
  );
  const created = await request(
    sourceCookie,
    'user-substitutions',
    'POST',
    createPayload(),
  );
  assert.equal(created.status, 201, await created.clone().text());
  const records = (await created.json()) as { items: Array<{ id: string }> };
  const substitutionId = records.items[0].id;
  assert.equal(
    (await request(sourceCookie, 'user-substitutions', 'POST', createPayload()))
      .status,
    409,
  );
  const card = await request(replacementCookie, `objects/${object.objectId}`);
  assert.equal(card.status, 200);
  const profile = (await card.json()) as {
    capabilities: {
      canEdit: boolean;
      canCreateTask: boolean;
      canEditDailyRate: boolean;
    };
  };
  assert.equal(profile.capabilities.canCreateTask, true);
  assert.equal(profile.capabilities.canEdit, false);
  assert.equal(profile.capabilities.canEditDailyRate, false);
  assert.equal(
    (await request(replacementCookie, `objects/${outside.objectId}`)).status,
    404,
  );
  const list = await request(replacementCookie, 'objects');
  assert.equal(list.status, 200);
  assert.ok(
    ((await list.json()) as Array<{ id: string }>).some(
      (item) => item.id === object.objectId,
    ),
  );
  const comment = await request(
    replacementCookie,
    `objects/${object.objectId}/comments`,
    'POST',
    { content: 'Комментарий замещающего' },
  );
  assert.equal(comment.status, 201, await comment.clone().text());
  assert.equal(
    (
      await request(
        replacementCookie,
        `objects/${object.objectId}/attendance/today`,
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await request(replacementCookie, `objects/${object.objectId}`, 'PATCH', {
        notes: 'Не допускается менеджеру',
      })
    ).status,
    403,
  );
  assert.equal(
    (await request(replacementCookie, 'inventory/items')).status,
    403,
  );
  assert.equal(
    (await request(replacementCookie, 'equipment/catalog')).status,
    403,
  );
  const borrowedOptions = await request(
    replacementCookie,
    'user-substitutions/options',
  );
  assert.equal(borrowedOptions.status, 200);
  assert.deepEqual(
    ((await borrowedOptions.json()) as { objects: unknown[] }).objects,
    [],
  );
  assert.equal(
    (
      await request(replacementCookie, 'user-substitutions', 'POST', {
        ...createPayload(),
        replacementUserId: passwordSource.id,
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await request(
        founderCookie,
        `user-substitutions/${substitutionId}/revoke`,
        'POST',
        { reason: 'Не участник и нет отдельного permission' },
      )
    ).status,
    403,
  );
  const unrelatedList = await request(founderCookie, 'user-substitutions');
  assert.equal(((await unrelatedList.json()) as { total: number }).total, 0);
  assert.equal(
    (await request(sourceCookie, 'user-substitutions?page=0')).status,
    400,
  );

  // Grants are resolved on each request from current principal state, not cached
  // in the replacement's JWT; revoking the source's assignment is immediate.
  await prisma.objectAssignment.updateMany({
    where: { objectId: object.objectId, userId: source.id },
    data: { isActive: false },
  });
  assert.equal(
    (await request(replacementCookie, `objects/${object.objectId}`)).status,
    404,
  );
  await prisma.objectAssignment.updateMany({
    where: { objectId: object.objectId, userId: source.id },
    data: { isActive: true },
  });
  await prisma.user.update({
    where: { id: source.id },
    data: { isActive: false },
  });
  assert.equal(
    (await request(replacementCookie, `objects/${object.objectId}`)).status,
    404,
  );
  await prisma.user.update({
    where: { id: source.id },
    data: { isActive: true },
  });
  const concurrency = await Promise.all(
    Array.from({ length: 8 }, (_, index) =>
      request(
        index % 2 ? replacementCookie : sourceCookie,
        `objects/${index % 2 ? outside.objectId : object.objectId}`,
      ),
    ),
  );
  assert.deepEqual(
    concurrency.map((response) => response.status),
    [200, 404, 200, 404, 200, 404, 200, 404],
  );

  const taskResponse = await request(sourceCookie, 'tasks', 'POST', {
    title: 'Задача исходного менеджера',
    priority: 'important_not_urgent',
    objectId: object.objectId,
    assigneeUserIds: [source.id],
    dueDate: '2030-01-15',
  });
  assert.equal(taskResponse.status, 201, await taskResponse.clone().text());
  const task = (await taskResponse.json()) as { id: string };
  assert.equal(
    (await request(replacementCookie, `tasks/${task.id}`)).status,
    200,
  );
  assert.equal(
    (
      await request(replacementCookie, `tasks/${task.id}`, 'PATCH', {
        description: 'Работа заместителя',
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await request(replacementCookie, `tasks/${task.id}`, 'PATCH', {
        objectId: outside.objectId,
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await request(
        replacementCookie,
        `tasks/${task.id}/assignees/me/complete`,
        'POST',
        { completionText: 'Нельзя выдать себя за исполнителя' },
      )
    ).status,
    403,
  );
  const hiddenTask = await request(founderCookie, 'tasks', 'POST', {
    title: 'Чужая приватная задача',
    priority: 'important_not_urgent',
    objectId: object.objectId,
    assigneeUserIds: [founder.id],
    visibilityMode: 'selected',
    visibleUserIds: [founder.id],
    dueDate: '2030-01-15',
  });
  assert.equal(hiddenTask.status, 201, await hiddenTask.clone().text());
  assert.equal(
    (
      await request(
        replacementCookie,
        `tasks/${((await hiddenTask.json()) as { id: string }).id}`,
      )
    ).status,
    404,
  );
  const newTask = await request(replacementCookie, 'tasks', 'POST', {
    title: 'Создана заместителем',
    priority: 'important_not_urgent',
    objectId: object.objectId,
    assigneeUserIds: [source.id],
    dueDate: '2030-01-15',
  });
  assert.equal(newTask.status, 201, await newTask.clone().text());
  const authored = (await newTask.json()) as {
    id: string;
    createdBy: { id: string };
  };
  assert.equal(authored.createdBy.id, replacement.id);
  const taskHistory = await prisma.taskHistoryEvent.findFirstOrThrow({
    where: { taskId: authored.id },
  });
  assert.match(JSON.stringify(taskHistory.payload), new RegExp(source.id));
  const order = await prisma.oneTimeOrder.create({
    data: {
      title: 'Связанный заказ без наследования прав',
      executionAddress: 'Москва',
      linkedObjectId: object.objectId,
      status: 'new',
      contactName: 'Клиент',
      createdByUserId: founder.id,
    },
  });
  const orderAccess = await request(
    replacementCookie,
    `one-time-orders/${order.id}`,
  );
  assert.ok([403, 404].includes(orderAccess.status));
  const orderTask = await prisma.task.create({
    data: {
      title: 'Задача заказа',
      priority: 'important_not_urgent',
      status: 'in_progress',
      objectId: object.objectId,
      oneTimeOrderId: order.id,
      createdByUserId: source.id,
    },
  });
  assert.equal(
    (await request(replacementCookie, `tasks/${orderTask.id}`)).status,
    404,
  );

  const createdComment = (await comment.json()) as { id: string };
  const attachment = new FormData();
  attachment.set('entityType', 'object_comment');
  attachment.set('entityId', createdComment.id);
  attachment.set(
    'file',
    new Blob(['delegation-evidence'], { type: 'image/jpeg' }),
    'evidence.jpg',
  );
  const upload = await fetch(`${baseUrl}/api/v1/files/upload`, {
    method: 'POST',
    headers: { Cookie: replacementCookie },
    body: attachment,
  });
  assert.equal(upload.status, 201, await upload.clone().text());
  const file = (await upload.json()) as { id: string };
  assert.equal(
    (await request(replacementCookie, `files/${file.id}/content`)).status,
    200,
  );

  const item = await prisma.inventoryItem.create({
    data: {
      name: 'Средство для замещения',
      category: 'химия',
      unit: 'л',
      createdByUserId: founder.id,
    },
  });
  const receipt = await request(founderCookie, 'inventory/movements', 'POST', {
    inventoryItemId: item.id,
    movementType: 'receipt',
    quantity: 20,
    unitPrice: 100,
  });
  assert.equal(receipt.status, 201, await receipt.clone().text());
  const issue = await request(
    replacementCookie,
    `objects/${object.objectId}/inventory/issue`,
    'POST',
    { inventoryItemId: item.id, quantity: 3.5, comment: 'Выдача заместителем' },
  );
  assert.equal(issue.status, 201, await issue.clone().text());
  assert.equal(
    (
      await request(
        replacementCookie,
        `objects/${outside.objectId}/inventory/issue`,
        'POST',
        { inventoryItemId: item.id, quantity: 1 },
      )
    ).status,
    403,
  );
  const audit = await prisma.auditEvent.findFirst({
    where: { actorUserId: replacement.id, action: 'user_substitution.action' },
    orderBy: { createdAt: 'desc' },
  });
  assert.ok(audit);
  assert.match(JSON.stringify(audit.metadata), new RegExp(source.id));
  assert.equal(
    (
      await request(
        sourceCookie,
        `user-substitutions/${substitutionId}/revoke`,
        'POST',
        { reason: 'Возвращение к работе' },
      )
    ).status,
    201,
  );
  assert.equal(
    (await request(replacementCookie, `objects/${object.objectId}`)).status,
    404,
  );
  assert.equal(
    (await request(replacementCookie, `files/${file.id}/content`)).status,
    403,
  );

  const leadership = await request(
    founderCookie,
    'user-substitutions',
    'POST',
    createPayload(),
  );
  assert.equal(leadership.status, 201, await leadership.clone().text());
  assert.equal(
    (
      await request(replacementCookie, `objects/${object.objectId}`, 'PATCH', {
        notes: 'Редактирование по замещению',
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await request(replacementCookie, `objects/${object.objectId}`, 'PATCH', {
        dailyRate: 99999,
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await request(replacementCookie, 'equipment/catalog', 'POST', {
        category: 'Уборка',
        name: 'Недопустимый каталог',
      })
    ).status,
    403,
  );
  const catalog = await prisma.equipmentCatalogItem.create({
    data: { name: 'Машина', category: 'Уборка', createdByUserId: founder.id },
  });
  const equipment = await prisma.equipmentUnit.create({
    data: {
      catalogItemId: catalog.id,
      inventoryNumber: `SUB-${randomUUID()}`,
      createdByUserId: founder.id,
      currentObjectId: object.objectId,
      status: 'assigned_to_object',
    },
  });
  const equipmentCard = await request(
    replacementCookie,
    `equipment/units/${equipment.id}`,
  );
  assert.equal(equipmentCard.status, 200, await equipmentCard.clone().text());
  const equipmentCapabilities = (
    (await equipmentCard.json()) as {
      capabilities: {
        canCreateMovement: boolean;
        canWriteoff: boolean;
        canAssignToOneTimeOrder: boolean;
      };
    }
  ).capabilities;
  assert.equal(equipmentCapabilities.canCreateMovement, true);
  assert.equal(equipmentCapabilities.canWriteoff, false);
  assert.equal(equipmentCapabilities.canAssignToOneTimeOrder, false);
  assert.equal(
    (
      await request(
        replacementCookie,
        `equipment/units/${equipment.id}/movements`,
        'POST',
        { movementType: 'issue_to_object', toObjectId: outside.objectId },
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await request(
        replacementCookie,
        `equipment/units/${equipment.id}/movements`,
        'POST',
        { movementType: 'issue_to_one_time_order', toOneTimeOrderId: order.id },
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await request(
        replacementCookie,
        `equipment/units/${equipment.id}/movements`,
        'POST',
        { movementType: 'writeoff', comment: 'Нельзя делегировать списание' },
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await request(
        replacementCookie,
        `equipment/units/${equipment.id}/movements`,
        'POST',
        { movementType: 'return_to_storage', comment: 'Возврат заместителем' },
      )
    ).status,
    201,
  );
  assert.equal(
    (await request(replacementCookie, `equipment/units/${equipment.id}`))
      .status,
    403,
  );
  const leadershipRecords = (await leadership.json()) as {
    items: Array<{ id: string }>;
  };
  await prisma.userSubstitution.update({
    where: { id: leadershipRecords.items[0].id },
    data: {
      startsAt: new Date(Date.now() - 60000),
      endsAt: new Date(Date.now() - 1000),
    },
  });
  assert.equal(
    (await request(replacementCookie, `objects/${object.objectId}`)).status,
    404,
  );
  const ownGrant = await request(sourceCookie, 'user-substitutions', 'POST', {
    ...createPayload(),
    replacementUserId: founder.id,
  });
  assert.equal(ownGrant.status, 201);
  const ownCard = await request(founderCookie, `objects/${outside.objectId}`);
  assert.equal(ownCard.status, 200);
  assert.equal(
    ((await ownCard.json()) as { capabilities: { canEditDailyRate: boolean } })
      .capabilities.canEditDailyRate,
    true,
  );
});
