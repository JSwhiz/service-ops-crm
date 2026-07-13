import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { PrismaClient } from '@prisma/client';

import { ChatsService } from '../src/modules/chats/chats.service';

import { SEEDED_OBJECT_ID } from './helpers/core-fixtures';
import { loginAndGetCookieHeader } from './helpers/auth';
import { createTestApp } from './helpers/create-test-app';

test('responsible can view object core but cannot edit it or manage managers by default', async (t) => {
  const prisma = new PrismaClient();
  const { app, baseUrl } = await createTestApp();

  const managerTwo = await prisma.user.findUniqueOrThrow({
    where: {
      login: 'manager2',
    },
    select: {
      id: true,
    },
  });

  const objectBefore = await prisma.object.findUniqueOrThrow({
    where: {
      id: SEEDED_OBJECT_ID,
    },
    select: {
      notes: true,
    },
  });

  await prisma.objectAssignment.upsert({
    where: {
      objectId_userId_assignmentRoleCode: {
        objectId: SEEDED_OBJECT_ID,
        userId: managerTwo.id,
        assignmentRoleCode: 'responsible',
      },
    },
    update: {
      isActive: true,
    },
    create: {
      objectId: SEEDED_OBJECT_ID,
      userId: managerTwo.id,
      assignmentRoleCode: 'responsible',
      isActive: true,
    },
  });

  t.after(async () => {
    await prisma.objectAssignment.updateMany({
      where: {
        objectId: SEEDED_OBJECT_ID,
        userId: managerTwo.id,
        assignmentRoleCode: 'responsible',
      },
      data: {
        isActive: false,
      },
    });

    await prisma.object.update({
      where: {
        id: SEEDED_OBJECT_ID,
      },
      data: {
        notes: objectBefore.notes,
      },
    });

    await app.close();
    await prisma.$disconnect();
  });

  const [responsibleCookie, founderCookie] = await Promise.all([
    loginAndGetCookieHeader({
      baseUrl,
      login: 'manager2',
      password: 'manager123',
    }),
    loginAndGetCookieHeader({
      baseUrl,
      login: 'founder',
      password: 'founder123',
    }),
  ]);

  const readResponse = await fetch(
    `${baseUrl}/api/v1/objects/${SEEDED_OBJECT_ID}`,
    {
      headers: {
        Cookie: responsibleCookie,
      },
    },
  );

  assert.equal(readResponse.status, 200);

  const readPayload = (await readResponse.json()) as {
    capabilities: {
      canEdit: boolean;
      canManageManagers: boolean;
    };
  };

  assert.equal(readPayload.capabilities.canEdit, false);
  assert.equal(readPayload.capabilities.canManageManagers, false);

  const deniedUpdate = await fetch(
    `${baseUrl}/api/v1/objects/${SEEDED_OBJECT_ID}`,
    {
      method: 'PATCH',
      headers: {
        Cookie: responsibleCookie,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        notes: 'Responsible should not be able to edit object core',
      }),
    },
  );

  assert.equal(deniedUpdate.status, 403);

  const allowedUpdate = await fetch(
    `${baseUrl}/api/v1/objects/${SEEDED_OBJECT_ID}`,
    {
      method: 'PATCH',
      headers: {
        Cookie: founderCookie,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        notes: 'Founder updated object note in integration test',
      }),
    },
  );

  assert.equal(allowedUpdate.status, 200);

  const updatedPayload = (await allowedUpdate.json()) as {
    notes: string | null;
  };

  assert.equal(updatedPayload.notes, 'Founder updated object note in integration test');
});

test('object seasonality is optional and accepts only canonical values', async (t) => {
  const prisma = new PrismaClient();
  const { app, baseUrl } = await createTestApp();
  const chatsService = app.get(ChatsService);
  const createdObjectIds: string[] = [];

  t.mock.method(chatsService, 'createSystemMessage', async () => undefined);
  t.after(async () => {
    await prisma.object.deleteMany({
      where: { id: { in: createdObjectIds } },
    });
    await app.close();
    await prisma.$disconnect();
  });

  const founderCookie = await loginAndGetCookieHeader({
    baseUrl,
    login: 'founder',
    password: 'founder123',
  });
  const founder = await prisma.user.findUniqueOrThrow({
    where: { login: 'founder' },
    select: { id: true },
  });

  const create = async (seasonMode?: unknown) => {
    const marker = randomUUID().slice(0, 8);
    const body: Record<string, unknown> = {
      name: `Season object ${marker}`,
      internalName: `SEASON-${marker}`,
      address: `Москва, сезонный тест ${marker}`,
      status: 'active',
      dailyRate: 0,
      responsibleUserId: founder.id,
    };

    if (seasonMode !== undefined) {
      body.seasonMode = seasonMode;
    }

    const response = await fetch(`${baseUrl}/api/v1/objects`, {
      method: 'POST',
      headers: {
        Cookie: founderCookie,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (response.ok) {
      const payload = (await response.json()) as {
        id: string;
        seasonMode: string | null;
      };
      createdObjectIds.push(payload.id);
      return { response, payload };
    }

    return { response, payload: null };
  };

  const [withoutSeason, summer, winter, invalid] = await Promise.all([
    create(),
    create('summer'),
    create('winter'),
    create('all_year'),
  ]);

  assert.equal(withoutSeason.response.status, 201);
  assert.equal(withoutSeason.payload?.seasonMode, null);
  assert.equal(summer.payload?.seasonMode, 'summer');
  assert.equal(winter.payload?.seasonMode, 'winter');
  assert.equal(invalid.response.status, 400);

  const summerToNull = await fetch(
    `${baseUrl}/api/v1/objects/${summer.payload?.id}`,
    {
      method: 'PATCH',
      headers: {
        Cookie: founderCookie,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ seasonMode: null }),
    },
  );
  assert.equal(summerToNull.status, 200);
  assert.equal(
    ((await summerToNull.json()) as { seasonMode: string | null }).seasonMode,
    null,
  );

  const nullToWinter = await fetch(
    `${baseUrl}/api/v1/objects/${withoutSeason.payload?.id}`,
    {
      method: 'PATCH',
      headers: {
        Cookie: founderCookie,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ seasonMode: 'winter' }),
    },
  );
  assert.equal(nullToWinter.status, 200);
  assert.equal(
    ((await nullToWinter.json()) as { seasonMode: string | null }).seasonMode,
    'winter',
  );

  const emptyToNull = await fetch(
    `${baseUrl}/api/v1/objects/${winter.payload?.id}`,
    {
      method: 'PATCH',
      headers: {
        Cookie: founderCookie,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ seasonMode: '' }),
    },
  );
  assert.equal(emptyToNull.status, 200);
  assert.equal(
    ((await emptyToNull.json()) as { seasonMode: string | null }).seasonMode,
    null,
  );
});

test('object creation and editing enforce one active responsible assignment', async (t) => {
  const prisma = new PrismaClient();
  const { app, baseUrl } = await createTestApp();
  const chatsService = app.get(ChatsService);
  const createdObjectIds: string[] = [];
  const temporaryUserIds: string[] = [];

  t.mock.method(chatsService, 'createSystemMessage', async () => undefined);
  t.after(async () => {
    await prisma.object.deleteMany({
      where: { id: { in: createdObjectIds } },
    });
    await prisma.user.deleteMany({
      where: { id: { in: temporaryUserIds } },
    });
    await app.close();
    await prisma.$disconnect();
  });

  const [founder, manager] = await Promise.all([
    prisma.user.findUniqueOrThrow({
      where: { login: 'founder' },
      select: { id: true },
    }),
    prisma.user.findUniqueOrThrow({
      where: { login: 'manager2' },
      select: { id: true },
    }),
  ]);
  const inactiveUserId = randomUUID();
  const deletedUserId = randomUUID();
  temporaryUserIds.push(inactiveUserId, deletedUserId);
  await prisma.user.createMany({
    data: [
      {
        id: inactiveUserId,
        login: `inactive_${inactiveUserId.slice(0, 8)}`,
        fullName: 'Неактивный ответственный',
        isActive: false,
      },
      {
        id: deletedUserId,
        login: `deleted_${deletedUserId.slice(0, 8)}`,
        fullName: 'Удаленный ответственный',
        isActive: true,
        deletedAt: new Date(),
      },
    ],
  });

  const founderCookie = await loginAndGetCookieHeader({
    baseUrl,
    login: 'founder',
    password: 'founder123',
  });
  const marker = randomUUID().slice(0, 8);
  const createBody = {
    name: `Responsible object ${marker}`,
    internalName: `RESP-${marker}`,
    address: `Москва, ответственный тест ${marker}`,
    status: 'active',
    seasonMode: null,
    dailyRate: 0,
  };

  const createWith = (responsibleUserId?: string) =>
    fetch(`${baseUrl}/api/v1/objects`, {
      method: 'POST',
      headers: {
        Cookie: founderCookie,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        ...createBody,
        name: `${createBody.name} ${responsibleUserId ?? 'missing'}`,
        ...(responsibleUserId ? { responsibleUserId } : {}),
      }),
    });

  assert.equal((await createWith()).status, 400);
  assert.equal((await createWith(randomUUID())).status, 400);
  assert.equal((await createWith(inactiveUserId)).status, 400);
  assert.equal((await createWith(deletedUserId)).status, 400);

  const createdResponse = await createWith(manager.id);
  assert.equal(createdResponse.status, 201);
  const created = (await createdResponse.json()) as {
    id: string;
    responsible: { id: string; login: string; fullName: string } | null;
    responsibles: Array<{ userId: string }>;
  };
  createdObjectIds.push(created.id);
  assert.equal(created.responsible?.id, manager.id);
  assert.equal(created.responsibles.length, 1);

  const changedResponse = await fetch(
    `${baseUrl}/api/v1/objects/${created.id}`,
    {
      method: 'PATCH',
      headers: {
        Cookie: founderCookie,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ responsibleUserId: founder.id }),
    },
  );
  assert.equal(changedResponse.status, 200);
  const changed = (await changedResponse.json()) as {
    responsible: { id: string } | null;
    responsibles: Array<{ userId: string }>;
  };
  assert.equal(changed.responsible?.id, founder.id);
  assert.deepEqual(changed.responsibles.map((item) => item.userId), [founder.id]);

  const legacyObject = await prisma.object.create({
    data: {
      name: `Legacy object ${marker}`,
      internalName: `LEGACY-${marker}`,
      address: 'Москва, старый объект',
      status: 'active',
      seasonMode: null,
      dailyRate: 0,
      createdByUserId: founder.id,
    },
    select: { id: true },
  });
  createdObjectIds.push(legacyObject.id);

  const legacyRead = await fetch(
    `${baseUrl}/api/v1/objects/${legacyObject.id}`,
    { headers: { Cookie: founderCookie } },
  );
  assert.equal(legacyRead.status, 200);
  assert.equal(
    ((await legacyRead.json()) as { responsible: unknown }).responsible,
    null,
  );

  const repairedResponse = await fetch(
    `${baseUrl}/api/v1/objects/${legacyObject.id}`,
    {
      method: 'PATCH',
      headers: {
        Cookie: founderCookie,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        responsibleUserId: manager.id,
        notes: 'Ответственный назначен при первом редактировании',
      }),
    },
  );
  assert.equal(repairedResponse.status, 200);
  assert.equal(
    ((await repairedResponse.json()) as { responsible: { id: string } | null })
      .responsible?.id,
    manager.id,
  );
});
