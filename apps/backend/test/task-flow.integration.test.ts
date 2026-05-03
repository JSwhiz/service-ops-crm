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

  assert.equal(
    founderView.capabilities.allowedStatusTransitions.includes('closed'),
    false,
  );

  const founderApprovalListResponse = await fetch(
    `${baseUrl}/api/v1/approvals?sourceEntityType=task&sourceEntityId=${createdTask.id}&status=pending`,
    {
      headers: {
        Cookie: founderCookie,
      },
    },
  );

  assert.equal(founderApprovalListResponse.status, 200);
  const founderApprovalList = (await founderApprovalListResponse.json()) as Array<{
    id: string;
    approvalType: string;
    status: string;
  }>;
  assert.equal(founderApprovalList.length, 1);
  assert.equal(founderApprovalList[0]?.approvalType, 'task_result_confirmation');
  assert.equal(founderApprovalList[0]?.status, 'pending');

  const founderDirectCloseResponse = await fetch(
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

  assert.equal(founderDirectCloseResponse.status, 403);

  const rejectResponse = await fetch(
    `${baseUrl}/api/v1/approvals/${founderApprovalList[0]?.id}/reject`,
    {
      method: 'POST',
      headers: {
        Cookie: founderCookie,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        comment: 'Нужно доработать результат.',
      }),
    },
  );

  assert.equal(rejectResponse.status, 200);

  const rejectedTaskResponse = await fetch(
    `${baseUrl}/api/v1/tasks/${createdTask.id}`,
    {
      headers: {
        Cookie: managerCookie,
      },
    },
  );

  assert.equal(rejectedTaskResponse.status, 200);
  const rejectedTask = (await rejectedTaskResponse.json()) as {
    status: string;
    capabilities: {
      allowedStatusTransitions: string[];
    };
  };
  assert.equal(rejectedTask.status, 'returned_to_work');
  assert.ok(rejectedTask.capabilities.allowedStatusTransitions.includes('in_progress'));

  const restartResponse = await fetch(
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

  assert.equal(restartResponse.status, 200);

  const resubmitResponse = await fetch(
    `${baseUrl}/api/v1/tasks/${createdTask.id}/result`,
    {
      method: 'POST',
      headers: {
        Cookie: managerCookie,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        resultText: 'Повторная сдача после доработки',
      }),
    },
  );

  assert.equal(resubmitResponse.status, 201);

  const managerApprovalListResponse = await fetch(
    `${baseUrl}/api/v1/approvals?sourceEntityType=task&sourceEntityId=${createdTask.id}&status=pending`,
    {
      headers: {
        Cookie: managerCookie,
      },
    },
  );

  assert.equal(managerApprovalListResponse.status, 200);
  const managerApprovalList = (await managerApprovalListResponse.json()) as Array<{
    id: string;
    status: string;
  }>;
  assert.equal(managerApprovalList.length, 1);

  const cancelResponse = await fetch(
    `${baseUrl}/api/v1/approvals/${managerApprovalList[0]?.id}/cancel`,
    {
      method: 'POST',
      headers: {
        Cookie: managerCookie,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    },
  );

  assert.equal(cancelResponse.status, 200);

  const cancelledTaskResponse = await fetch(
    `${baseUrl}/api/v1/tasks/${createdTask.id}`,
    {
      headers: {
        Cookie: managerCookie,
      },
    },
  );

  assert.equal(cancelledTaskResponse.status, 200);
  const cancelledTask = (await cancelledTaskResponse.json()) as {
    status: string;
  };
  assert.equal(cancelledTask.status, 'in_progress');

  const finalSubmitResponse = await fetch(
    `${baseUrl}/api/v1/tasks/${createdTask.id}/result`,
    {
      method: 'POST',
      headers: {
        Cookie: managerCookie,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        resultText: 'Финальный результат готов к подтверждению',
      }),
    },
  );

  assert.equal(finalSubmitResponse.status, 201);

  const finalApprovalListResponse = await fetch(
    `${baseUrl}/api/v1/approvals?sourceEntityType=task&sourceEntityId=${createdTask.id}&status=pending`,
    {
      headers: {
        Cookie: founderCookie,
      },
    },
  );

  assert.equal(finalApprovalListResponse.status, 200);
  const finalApprovalList = (await finalApprovalListResponse.json()) as Array<{
    id: string;
  }>;
  assert.equal(finalApprovalList.length, 1);

  const closeResponse = await fetch(
    `${baseUrl}/api/v1/approvals/${finalApprovalList[0]?.id}/approve`,
    {
      method: 'POST',
      headers: {
        Cookie: founderCookie,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    },
  );

  assert.equal(closeResponse.status, 200);

  const closedTask = (await closeResponse.json()) as {
    status: string;
  };

  assert.equal(closedTask.status, 'approved');

  const finalTaskResponse = await fetch(`${baseUrl}/api/v1/tasks/${createdTask.id}`, {
    headers: {
      Cookie: founderCookie,
    },
  });

  assert.equal(finalTaskResponse.status, 200);
  const finalTask = (await finalTaskResponse.json()) as {
    status: string;
  };
  assert.equal(finalTask.status, 'closed');
});
