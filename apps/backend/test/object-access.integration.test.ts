import assert from 'node:assert/strict';
import test from 'node:test';

import { PrismaClient } from '@prisma/client';

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
