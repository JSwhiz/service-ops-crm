import assert from 'node:assert/strict';
import test from 'node:test';

import { PrismaClient } from '@prisma/client';

import { loginAndGetCookieHeader } from './helpers/auth';
import { createTestApp } from './helpers/create-test-app';

async function api(
  baseUrl: string,
  cookie: string,
  path: string,
  init?: RequestInit,
): Promise<Response> {
  return fetch(`${baseUrl}/api/v1${path}`, {
    ...init,
    headers: {
      Cookie: cookie,
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    },
  });
}

test('counterparty registry, object links, ACL isolation and archive semantics', async (t) => {
  const prisma = new PrismaClient();
  const { app, baseUrl } = await createTestApp();
  const marker = `counterparty-${Date.now()}`;

  t.after(async () => {
    await prisma.object.deleteMany({
      where: { name: { contains: marker } },
    });
    await prisma.counterparty.deleteMany({
      where: { name: { contains: marker } },
    });
    await app.close();
    await prisma.$disconnect();
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

  const [founder, manager] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { login: 'founder' } }),
    prisma.user.findUniqueOrThrow({ where: { login: 'manager1' } }),
  ]);

  const founderMe = await api(baseUrl, founderCookie, '/auth/me');
  assert.equal(founderMe.status, 200);
  const founderCapabilities = (
    (await founderMe.json()) as {
      capabilities: Record<string, boolean>;
    }
  ).capabilities;
  assert.equal(founderCapabilities.canAccessCounterparties, true);
  assert.equal(founderCapabilities.canManageCounterparties, true);
  assert.equal(founderCapabilities.canLinkCounterpartyObjects, true);

  const managerMe = await api(baseUrl, managerCookie, '/auth/me');
  assert.equal(managerMe.status, 200);
  const managerCapabilities = (
    (await managerMe.json()) as {
      capabilities: Record<string, boolean>;
    }
  ).capabilities;
  assert.equal(managerCapabilities.canAccessCounterparties, true);
  assert.equal(managerCapabilities.canManageCounterparties, false);
  assert.equal(managerCapabilities.canLinkCounterpartyObjects, false);

  const forbiddenCreate = await api(baseUrl, managerCookie, '/counterparties', {
    method: 'POST',
    body: JSON.stringify({ name: `${marker}-forbidden` }),
  });
  assert.equal(forbiddenCreate.status, 403);

  const createFirst = await api(baseUrl, founderCookie, '/counterparties', {
    method: 'POST',
    body: JSON.stringify({
      name: `УК Альфа ${marker}`,
      legalName: `ООО Альфа Управление ${marker}`,
      contactName: 'Иван Петров',
      contactPhone: '+79990000001',
      notes: 'Тестовый контрагент',
    }),
  });
  assert.equal(createFirst.status, 201);
  let first = (await createFirst.json()) as any;
  assert.equal(first.objectCount, 0);
  assert.equal(first.status, 'active');

  const createSecond = await api(baseUrl, founderCookie, '/counterparties', {
    method: 'POST',
    body: JSON.stringify({
      name: `УК Бета ${marker}`,
      legalName: `ООО Бета Управление ${marker}`,
    }),
  });
  assert.equal(createSecond.status, 201);
  const second = (await createSecond.json()) as any;

  const update = await api(
    baseUrl,
    founderCookie,
    `/counterparties/${first.id}`,
    {
      method: 'PATCH',
      body: JSON.stringify({
        contactName: 'Пётр Иванов',
        contactPhone: '+79990000002',
      }),
    },
  );
  assert.equal(update.status, 200);
  first = await update.json();
  assert.equal(first.contactName, 'Пётр Иванов');

  const [visibleObject, hiddenObject, secondVisibleObject] = await Promise.all([
    prisma.object.create({
      data: {
        name: `Дом видимый ${marker}`,
        internalName: `VISIBLE-${marker}`,
        address: `Ленина 10 ${marker}`,
        status: 'active',
        dailyRate: 0,
        createdByUserId: founder.id,
        assignments: {
          create: {
            userId: manager.id,
            assignmentRoleCode: 'manager',
            isActive: true,
          },
        },
      },
    }),
    prisma.object.create({
      data: {
        name: `Дом скрытый ${marker}`,
        internalName: `HIDDEN-${marker}`,
        address: `Ленина 12 ${marker}`,
        status: 'active',
        dailyRate: 0,
        createdByUserId: founder.id,
      },
    }),
    prisma.object.create({
      data: {
        name: `Дом второй ${marker}`,
        internalName: `SECOND-${marker}`,
        address: `Кирова 5 ${marker}`,
        status: 'active',
        dailyRate: 0,
        createdByUserId: founder.id,
      },
    }),
  ]);

  for (const objectId of [visibleObject.id, hiddenObject.id]) {
    const linked = await api(
      baseUrl,
      founderCookie,
      `/counterparties/${first.id}/objects/${objectId}`,
      { method: 'POST' },
    );
    assert.equal(linked.status, 201);
  }

  let firstCard = (await (
    await api(baseUrl, founderCookie, `/counterparties/${first.id}`)
  ).json()) as any;
  assert.equal(firstCard.objectCount, 2);
  assert.equal(firstCard.visibleObjectCount, 2);

  const linkThird = await api(
    baseUrl,
    founderCookie,
    `/counterparties/${first.id}/objects/${secondVisibleObject.id}`,
    { method: 'POST' },
  );
  assert.equal(linkThird.status, 201);
  firstCard = await linkThird.json();
  assert.equal(firstCard.objectCount, 3);

  const managerCardResponse = await api(
    baseUrl,
    managerCookie,
    `/counterparties/${first.id}`,
  );
  assert.equal(managerCardResponse.status, 200);
  const managerCard = (await managerCardResponse.json()) as any;
  assert.equal(managerCard.objectCount, 3);
  assert.equal(managerCard.visibleObjectCount, 1);
  assert.deepEqual(
    managerCard.objects.map((object: { id: string }) => object.id),
    [visibleObject.id],
  );

  const hiddenObjectResponse = await api(
    baseUrl,
    managerCookie,
    `/objects/${hiddenObject.id}`,
  );
  assert.equal(hiddenObjectResponse.status, 404);

  const managerCannotLink = await api(
    baseUrl,
    managerCookie,
    `/counterparties/${first.id}/objects/${secondVisibleObject.id}`,
    { method: 'POST' },
  );
  assert.equal(managerCannotLink.status, 403);

  const relink = await api(
    baseUrl,
    founderCookie,
    `/counterparties/${second.id}/objects/${secondVisibleObject.id}`,
    { method: 'POST' },
  );
  assert.equal(relink.status, 201);

  const movedObject = await prisma.object.findUniqueOrThrow({
    where: { id: secondVisibleObject.id },
    select: { counterpartyId: true },
  });
  assert.equal(movedObject.counterpartyId, second.id);

  const oldCounterpartyHistory = (await (
    await api(baseUrl, founderCookie, `/counterparties/${first.id}/history`)
  ).json()) as Array<{ action: string }>;
  assert.ok(
    oldCounterpartyHistory.some(
      (event) => event.action === 'counterparty.object_unlinked_by_relink',
    ),
  );

  const unlink = await api(
    baseUrl,
    founderCookie,
    `/counterparties/${first.id}/objects/${visibleObject.id}`,
    { method: 'DELETE' },
  );
  assert.equal(unlink.status, 200);
  assert.equal(
    (
      await prisma.object.findUniqueOrThrow({
        where: { id: visibleObject.id },
        select: { counterpartyId: true },
      })
    ).counterpartyId,
    null,
  );
  assert.ok(
    await prisma.auditEvent.findFirst({
      where: {
        entityType: 'counterparty',
        entityId: first.id,
        action: 'counterparty.object_unlinked',
      },
    }),
  );

  const archive = await api(
    baseUrl,
    founderCookie,
    `/counterparties/${first.id}/archive`,
    { method: 'POST' },
  );
  assert.equal(archive.status, 201);
  const archived = (await archive.json()) as any;
  assert.equal(archived.status, 'archived');

  const hiddenAfterArchive = await prisma.object.findUniqueOrThrow({
    where: { id: hiddenObject.id },
    select: { counterpartyId: true, status: true, deletedAt: true },
  });
  assert.equal(hiddenAfterArchive.counterpartyId, first.id);
  assert.equal(hiddenAfterArchive.status, 'active');
  assert.equal(hiddenAfterArchive.deletedAt, null);

  const search = await api(
    baseUrl,
    founderCookie,
    `/counterparties?q=${encodeURIComponent(`ООО Альфа Управление ${marker}`)}&status=all`,
  );
  assert.equal(search.status, 200);
  assert.equal(((await search.json()) as { total: number }).total, 1);

  const normalReferences = await api(
    baseUrl,
    founderCookie,
    `/counterparties/references?q=${encodeURIComponent(`УК Альфа ${marker}`)}`,
  );
  assert.equal(normalReferences.status, 200);
  assert.equal(((await normalReferences.json()) as unknown[]).length, 0);

  const selectedReference = await api(
    baseUrl,
    founderCookie,
    `/counterparties/references?selectedId=${first.id}`,
  );
  assert.equal(selectedReference.status, 200);
  const selected = (await selectedReference.json()) as Array<{
    id: string;
    status: string;
  }>;
  assert.equal(selected[0]?.id, first.id);
  assert.equal(selected[0]?.status, 'archived');

  const objectAudit = await prisma.objectAuditLog.findFirst({
    where: {
      objectId: visibleObject.id,
      actionCode: 'object.counterparty_changed',
    },
  });
  assert.ok(objectAudit);
});
