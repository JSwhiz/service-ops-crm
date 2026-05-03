import assert from 'node:assert/strict';
import test from 'node:test';

import { PrismaClient } from '@prisma/client';

import {
  SEEDED_EMPLOYEE_IDS,
  cleanupCoreTestObject,
  createCoreTestObject,
  getSafeBusinessDate,
} from './helpers/core-fixtures';
import { loginAndGetCookieHeader } from './helpers/auth';
import { createTestApp } from './helpers/create-test-app';

test('timesheet manual exception uses shared approvals before applying business effect', async (t) => {
  const prisma = new PrismaClient();
  const { app, baseUrl } = await createTestApp();
  const [managerCookie, founderCookie] = await Promise.all([
    loginAndGetCookieHeader({
      baseUrl,
      login: 'manager1',
      password: 'manager123',
    }),
    loginAndGetCookieHeader({
      baseUrl,
      login: 'founder',
      password: 'founder123',
    }),
  ]);
  const targetDate = getSafeBusinessDate(18);
  const { objectId } = await createCoreTestObject(prisma, {
    includeManagerAssignment: true,
  });
  const createdExceptionIds: string[] = [];

  t.after(async () => {
    await prisma.approvalRequest.deleteMany({
      where: {
        sourceEntityType: 'timesheet_exception',
        sourceEntityId: {
          in: createdExceptionIds,
        },
      },
    });
    await cleanupCoreTestObject(prisma, objectId);
    await app.close();
    await prisma.$disconnect();
  });

  const createExceptionResponse = await fetch(
    `${baseUrl}/api/v1/timesheets/exceptions`,
    {
      method: 'POST',
      headers: {
        Cookie: managerCookie,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        objectId,
        year: targetDate.year,
        month: targetDate.month,
        employeeId: SEEDED_EMPLOYEE_IDS.sergey,
        dayOfMonth: targetDate.dayOfMonth,
        dayValue: 1400,
        comment: 'Manager requests sensitive manual correction',
      }),
    },
  );

  assert.equal(createExceptionResponse.status, 201);
  const createdExceptionRequest = (await createExceptionResponse.json()) as {
    id: string;
    approvalType: string;
    sourceEntityType: string;
    sourceEntityId: string;
    status: string;
  };
  assert.equal(
    createdExceptionRequest.approvalType,
    'manual_timesheet_exception_confirmation',
  );
  assert.equal(createdExceptionRequest.sourceEntityType, 'timesheet_exception');
  assert.equal(createdExceptionRequest.status, 'pending');
  createdExceptionIds.push(createdExceptionRequest.sourceEntityId);

  const timesheetBeforeApprovalResponse = await fetch(
    `${baseUrl}/api/v1/timesheets?objectId=${objectId}&year=${targetDate.year}&month=${targetDate.month}`,
    {
      headers: {
        Cookie: founderCookie,
      },
    },
  );
  assert.equal(timesheetBeforeApprovalResponse.status, 200);
  const timesheetBeforeApproval = (await timesheetBeforeApprovalResponse.json()) as {
    rows: Array<{
      employeeId: string;
      entries: Array<{
        dayOfMonth: number;
        dayValue: number;
        isChangedManually: boolean;
      }>;
    }>;
  };
  const entryBeforeApproval = timesheetBeforeApproval.rows
    .find((row) => row.employeeId === SEEDED_EMPLOYEE_IDS.sergey)
    ?.entries.find((entry) => entry.dayOfMonth === targetDate.dayOfMonth);
  assert.ok(entryBeforeApproval);
  assert.equal(entryBeforeApproval.dayValue, 0);
  assert.equal(entryBeforeApproval.isChangedManually, false);

  const pendingApprovalsResponse = await fetch(
    `${baseUrl}/api/v1/approvals?sourceEntityType=timesheet_exception&sourceEntityId=${createdExceptionRequest.sourceEntityId}&status=pending`,
    {
      headers: {
        Cookie: founderCookie,
      },
    },
  );
  assert.equal(pendingApprovalsResponse.status, 200);
  const pendingApprovals = (await pendingApprovalsResponse.json()) as Array<{
    id: string;
    approvalType: string;
    status: string;
  }>;
  assert.equal(pendingApprovals.length, 1);
  assert.equal(
    pendingApprovals[0]?.approvalType,
    'manual_timesheet_exception_confirmation',
  );

  const approveResponse = await fetch(
    `${baseUrl}/api/v1/approvals/${pendingApprovals[0]?.id}/approve`,
    {
      method: 'POST',
      headers: {
        Cookie: founderCookie,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    },
  );
  assert.equal(approveResponse.status, 200);

  const timesheetAfterApprovalResponse = await fetch(
    `${baseUrl}/api/v1/timesheets?objectId=${objectId}&year=${targetDate.year}&month=${targetDate.month}`,
    {
      headers: {
        Cookie: founderCookie,
      },
    },
  );
  assert.equal(timesheetAfterApprovalResponse.status, 200);
  const timesheetAfterApproval = (await timesheetAfterApprovalResponse.json()) as {
    rows: Array<{
      employeeId: string;
      entries: Array<{
        dayOfMonth: number;
        dayValue: number;
        comment: string | null;
        isChangedManually: boolean;
      }>;
    }>;
  };
  const approvedEntry = timesheetAfterApproval.rows
    .find((row) => row.employeeId === SEEDED_EMPLOYEE_IDS.sergey)
    ?.entries.find((entry) => entry.dayOfMonth === targetDate.dayOfMonth);
  assert.ok(approvedEntry);
  assert.equal(approvedEntry.dayValue, 1400);
  assert.equal(approvedEntry.comment, 'Manager requests sensitive manual correction');
  assert.equal(approvedEntry.isChangedManually, true);

  const cancelableResponse = await fetch(`${baseUrl}/api/v1/timesheets/exceptions`, {
    method: 'POST',
    headers: {
      Cookie: managerCookie,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      objectId,
      year: targetDate.year,
      month: targetDate.month,
      employeeId: SEEDED_EMPLOYEE_IDS.ivan,
      dayOfMonth: targetDate.dayOfMonth,
      dayValue: 1500,
      comment: 'Second request for cancellation path',
    }),
  });
  assert.equal(cancelableResponse.status, 201);
  const cancelableRequest = (await cancelableResponse.json()) as {
    id: string;
    sourceEntityId: string;
  };
  createdExceptionIds.push(cancelableRequest.sourceEntityId);

  const cancelPendingResponse = await fetch(
    `${baseUrl}/api/v1/approvals?sourceEntityType=timesheet_exception&sourceEntityId=${cancelableRequest.sourceEntityId}&status=pending`,
    {
      headers: {
        Cookie: managerCookie,
      },
    },
  );
  assert.equal(cancelPendingResponse.status, 200);
  const cancelPendingApprovals = (await cancelPendingResponse.json()) as Array<{
    id: string;
    status: string;
  }>;
  assert.equal(cancelPendingApprovals.length, 1);

  const cancelResponse = await fetch(
    `${baseUrl}/api/v1/approvals/${cancelPendingApprovals[0]?.id}/cancel`,
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
});

test('object status change uses shared approvals with reject, cancel and approve paths', async (t) => {
  const prisma = new PrismaClient();
  const { app, baseUrl } = await createTestApp();
  const founderCookie = await loginAndGetCookieHeader({
    baseUrl,
    login: 'founder',
    password: 'founder123',
  });
  const { objectId } = await createCoreTestObject(prisma);

  t.after(async () => {
    await prisma.approvalRequest.deleteMany({
      where: {
        sourceEntityType: 'object',
        sourceEntityId: objectId,
      },
    });
    await cleanupCoreTestObject(prisma, objectId);
    await app.close();
    await prisma.$disconnect();
  });

  const requestStatusChange = async (status: string) =>
    fetch(`${baseUrl}/api/v1/objects/${objectId}/status`, {
      method: 'PATCH',
      headers: {
        Cookie: founderCookie,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ status }),
    });

  const rejectableResponse = await requestStatusChange('frozen');
  assert.equal(rejectableResponse.status, 200);
  const rejectableRequest = (await rejectableResponse.json()) as {
    sourceEntityId: string;
    approvalType: string;
    status: string;
  };
  assert.equal(rejectableRequest.approvalType, 'object_change_confirmation');
  assert.equal(rejectableRequest.status, 'pending');

  const rejectPendingResponse = await fetch(
    `${baseUrl}/api/v1/approvals?sourceEntityType=object&sourceEntityId=${objectId}&status=pending`,
    {
      headers: {
        Cookie: founderCookie,
      },
    },
  );
  assert.equal(rejectPendingResponse.status, 200);
  const rejectPendingApprovals = (await rejectPendingResponse.json()) as Array<{
    id: string;
  }>;
  assert.equal(rejectPendingApprovals.length, 1);

  const rejectResponse = await fetch(
    `${baseUrl}/api/v1/approvals/${rejectPendingApprovals[0]?.id}/reject`,
    {
      method: 'POST',
      headers: {
        Cookie: founderCookie,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        comment: 'Rejecting first object change request',
      }),
    },
  );
  assert.equal(rejectResponse.status, 200);

  const objectAfterRejectResponse = await fetch(`${baseUrl}/api/v1/objects/${objectId}`, {
    headers: {
      Cookie: founderCookie,
    },
  });
  assert.equal(objectAfterRejectResponse.status, 200);
  const objectAfterReject = (await objectAfterRejectResponse.json()) as {
    status: string;
  };
  assert.equal(objectAfterReject.status, 'active');

  const cancelableResponse = await requestStatusChange('archived');
  assert.equal(cancelableResponse.status, 200);
  const cancelPendingResponse = await fetch(
    `${baseUrl}/api/v1/approvals?sourceEntityType=object&sourceEntityId=${objectId}&status=pending`,
    {
      headers: {
        Cookie: founderCookie,
      },
    },
  );
  assert.equal(cancelPendingResponse.status, 200);
  const cancelPendingApprovals = (await cancelPendingResponse.json()) as Array<{
    id: string;
  }>;
  assert.equal(cancelPendingApprovals.length, 1);

  const cancelResponse = await fetch(
    `${baseUrl}/api/v1/approvals/${cancelPendingApprovals[0]?.id}/cancel`,
    {
      method: 'POST',
      headers: {
        Cookie: founderCookie,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    },
  );
  assert.equal(cancelResponse.status, 200);

  const approvableResponse = await requestStatusChange('frozen');
  assert.equal(approvableResponse.status, 200);
  const approvePendingResponse = await fetch(
    `${baseUrl}/api/v1/approvals?sourceEntityType=object&sourceEntityId=${objectId}&status=pending`,
    {
      headers: {
        Cookie: founderCookie,
      },
    },
  );
  assert.equal(approvePendingResponse.status, 200);
  const approvePendingApprovals = (await approvePendingResponse.json()) as Array<{
    id: string;
  }>;
  assert.equal(approvePendingApprovals.length, 1);

  const approveResponse = await fetch(
    `${baseUrl}/api/v1/approvals/${approvePendingApprovals[0]?.id}/approve`,
    {
      method: 'POST',
      headers: {
        Cookie: founderCookie,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    },
  );
  assert.equal(approveResponse.status, 200);

  const objectAfterApproveResponse = await fetch(`${baseUrl}/api/v1/objects/${objectId}`, {
    headers: {
      Cookie: founderCookie,
    },
  });
  assert.equal(objectAfterApproveResponse.status, 200);
  const objectAfterApprove = (await objectAfterApproveResponse.json()) as {
    status: string;
  };
  assert.equal(objectAfterApprove.status, 'frozen');
});
