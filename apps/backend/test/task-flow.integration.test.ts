import assert from 'node:assert/strict';
import test from 'node:test';

import { PrismaClient } from '@prisma/client';

import { SEEDED_OBJECT_ID } from './helpers/core-fixtures';
import { loginAndGetCookieHeader } from './helpers/auth';
import { createTestApp } from './helpers/create-test-app';

test('task result confirmation flow is enforced between assignee and leadership', async (t) => {
  const prisma = new PrismaClient();
  const { app, baseUrl } = await createTestApp();
  const manager = await prisma.user.findUniqueOrThrow({
    where: {
      login: 'manager1',
    },
    select: {
      id: true,
    },
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

  t.after(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  const createResponse = await fetch(`${baseUrl}/api/v1/tasks`, {
    method: 'POST',
    headers: {
      Cookie: founderCookie,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      title: `Integration task ${Date.now()}`,
      description: 'Core stabilization task flow check',
      priority: 'important_not_urgent',
      objectId: SEEDED_OBJECT_ID,
      assigneeUserIds: [manager.id],
    }),
  });

  assert.equal(createResponse.status, 201);

  const createdTask = (await createResponse.json()) as {
    id: string;
    status: string;
    capabilities: {
      allowedStatusTransitions: string[];
    };
  };

  assert.equal(createdTask.status, 'assigned');
  assert.ok(createdTask.capabilities.allowedStatusTransitions.includes('in_progress'));
  assert.equal(createdTask.capabilities.allowedStatusTransitions.includes('closed'), false);

  const startResponse = await fetch(
    `${baseUrl}/api/v1/tasks/${createdTask.id}/status`,
    {
      method: 'PATCH',
      headers: {
        Cookie: managerCookie,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        status: 'in_progress',
      }),
    },
  );

  assert.equal(startResponse.status, 200);

  const submitResultResponse = await fetch(
    `${baseUrl}/api/v1/tasks/${createdTask.id}/result`,
    {
      method: 'POST',
      headers: {
        Cookie: managerCookie,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        resultText: 'Work completed and ready for confirmation',
      }),
    },
  );

  assert.equal(submitResultResponse.status, 201);

  const submittedTask = (await submitResultResponse.json()) as {
    status: string;
    capabilities: {
      canSubmitResult: boolean;
      allowedStatusTransitions: string[];
    };
  };

  assert.equal(submittedTask.status, 'awaiting_confirmation');
  assert.equal(submittedTask.capabilities.canSubmitResult, false);

  const assigneeCloseResponse = await fetch(
    `${baseUrl}/api/v1/tasks/${createdTask.id}/status`,
    {
      method: 'PATCH',
      headers: {
        Cookie: managerCookie,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        status: 'closed',
      }),
    },
  );

  assert.equal(assigneeCloseResponse.status, 403);

  const founderViewResponse = await fetch(
    `${baseUrl}/api/v1/tasks/${createdTask.id}`,
    {
      headers: {
        Cookie: founderCookie,
      },
    },
  );

  assert.equal(founderViewResponse.status, 200);

  const founderView = (await founderViewResponse.json()) as {
    capabilities: {
      allowedStatusTransitions: string[];
    };
  };

  assert.ok(founderView.capabilities.allowedStatusTransitions.includes('closed'));

  const closeResponse = await fetch(
    `${baseUrl}/api/v1/tasks/${createdTask.id}/status`,
    {
      method: 'PATCH',
      headers: {
        Cookie: founderCookie,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        status: 'closed',
      }),
    },
  );

  assert.equal(closeResponse.status, 200);

  const closedTask = (await closeResponse.json()) as {
    status: string;
  };

  assert.equal(closedTask.status, 'closed');
});
