import assert from 'node:assert/strict';
import test from 'node:test';

import { PrismaClient } from '@prisma/client';

import { loginAndGetCookieHeader } from './helpers/auth';
import { createTestApp } from './helpers/create-test-app';

interface AvailabilityResponse {
  id: string;
  userId: string;
  entryType: string;
  startDate: string;
  endDate: string;
  status: string;
  resolutionComment: string | null;
  approvalRequestId: string | null;
}

const SOURCE_ENTITY_TYPE = 'one_time_manager_availability';
const START = new Date('2031-01-01T00:00:00.000Z');
const END = new Date('2032-01-01T00:00:00.000Z');

test('one-time manager availability supports requests, approvals and history', async (t) => {
  const prisma = new PrismaClient();
  const { app, baseUrl } = await createTestApp();
  const [founder, managerOne, managerTwo] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { login: 'founder' } }),
    prisma.user.findUniqueOrThrow({ where: { login: 'manager1' } }),
    prisma.user.findUniqueOrThrow({ where: { login: 'manager2' } }),
  ]);
  const userIds = [managerOne.id, managerTwo.id];

  const cleanup = async () => {
    const entries = await prisma.oneTimeManagerAvailability.findMany({
      where: {
        userId: { in: userIds },
        startDate: { gte: START, lt: END },
      },
      select: { id: true },
    });
    const entryIds = entries.map((entry) => entry.id);
    const approvalRequests = await prisma.approvalRequest.findMany({
      where: {
        sourceEntityType: SOURCE_ENTITY_TYPE,
        sourceEntityId: { in: entryIds },
      },
      select: { id: true },
    });
    const approvalRequestIds = approvalRequests.map((request) => request.id);
    await prisma.approvalRequest.deleteMany({
      where: {
        sourceEntityType: SOURCE_ENTITY_TYPE,
        sourceEntityId: { in: entryIds },
      },
    });
    await prisma.auditEvent.deleteMany({
      where: {
        OR: [
          { entityType: SOURCE_ENTITY_TYPE, entityId: { in: entryIds } },
          {
            entityType: 'approval_request',
            entityId: { in: approvalRequestIds },
          },
        ],
      },
    });
    await prisma.oneTimeManagerAvailability.deleteMany({
      where: {
        userId: { in: userIds },
        startDate: { gte: START, lt: END },
      },
    });
  };

  await cleanup();
  t.after(async () => {
    await cleanup();
    await app.close();
    await prisma.$disconnect();
  });

  const [founderCookie, managerOneCookie, managerTwoCookie, hrCookie] =
    await Promise.all([
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
      loginAndGetCookieHeader({
        baseUrl,
        login: 'manager2',
        password: 'manager123',
      }),
      loginAndGetCookieHeader({
        baseUrl,
        login: 'hr1',
        password: 'hr123',
      }),
    ]);
  const requestUrl = `${baseUrl}/api/v1/one-time-orders/calendar/availability-requests`;
  const availabilityUrl = `${baseUrl}/api/v1/one-time-orders/calendar/availability`;
  const createOwnRequest = async (
    cookie: string,
    payload: { entryType: string; startDate: string; endDate: string; comment?: string },
  ) => {
    const response = await fetch(requestUrl, {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    assert.equal(response.status, 201);
    return (await response.json()) as AvailabilityResponse;
  };

  const ownRequest = await createOwnRequest(managerOneCookie, {
    entryType: 'vacation',
    startDate: '2031-01-10',
    endDate: '2031-01-12',
    comment: 'Own vacation request',
  });
  assert.equal(ownRequest.userId, managerOne.id);
  assert.equal(ownRequest.status, 'pending');
  assert.ok(ownRequest.approvalRequestId);

  const managerCreatesForOther = await fetch(`${availabilityUrl}/direct`, {
    method: 'POST',
    headers: { Cookie: managerOneCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userId: managerTwo.id,
      entryType: 'day_off',
      startDate: '2031-01-15',
      endDate: '2031-01-15',
    }),
  });
  assert.equal(managerCreatesForOther.status, 403);

  const managerApprovesSelf = await fetch(
    `${availabilityUrl}/${ownRequest.id}/approve`,
    {
      method: 'POST',
      headers: { Cookie: managerOneCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    },
  );
  assert.equal(managerApprovesSelf.status, 403);

  const hrApprove = await fetch(`${availabilityUrl}/${ownRequest.id}/approve`, {
    method: 'POST',
    headers: { Cookie: hrCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ comment: 'Approved by HR' }),
  });
  assert.equal(hrApprove.status, 201);
  const approvedByHr = (await hrApprove.json()) as AvailabilityResponse;
  assert.equal(approvedByHr.status, 'approved');
  assert.equal(approvedByHr.resolutionComment, 'Approved by HR');

  const sharedApprovalRequest = await createOwnRequest(managerTwoCookie, {
    entryType: 'sick_leave',
    startDate: '2031-02-01',
    endDate: '2031-02-02',
  });
  const queueResponse = await fetch(
    `${baseUrl}/api/v1/approvals?approvalType=one_time_manager_availability&status=pending`,
    { headers: { Cookie: founderCookie } },
  );
  assert.equal(queueResponse.status, 200);
  const queue = (await queueResponse.json()) as Array<{
    id: string;
    sourceEntityId: string;
    capabilities: { canApprove: boolean };
  }>;
  const queued = queue.find(
    (request) => request.sourceEntityId === sharedApprovalRequest.id,
  );
  assert.ok(queued);
  assert.equal(queued.capabilities.canApprove, true);

  const sharedApprove = await fetch(
    `${baseUrl}/api/v1/approvals/${queued.id}/approve`,
    {
      method: 'POST',
      headers: { Cookie: founderCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ comment: 'Leadership approved' }),
    },
  );
  assert.equal(sharedApprove.status, 200);
  const sharedApprovedEntry =
    await prisma.oneTimeManagerAvailability.findUniqueOrThrow({
      where: { id: sharedApprovalRequest.id },
    });
  assert.equal(sharedApprovedEntry.status, 'approved');
  assert.equal(sharedApprovedEntry.resolutionComment, 'Leadership approved');

  const directResponse = await fetch(`${availabilityUrl}/direct`, {
    method: 'POST',
    headers: { Cookie: hrCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userId: managerOne.id,
      entryType: 'day_off',
      startDate: '2031-03-01',
      endDate: '2031-03-03',
      comment: 'Direct HR entry',
    }),
  });
  assert.equal(directResponse.status, 201);
  const direct = (await directResponse.json()) as AvailabilityResponse;
  assert.equal(direct.status, 'approved');
  assert.equal(direct.approvalRequestId, null);

  const overlapResponse = await fetch(`${availabilityUrl}/direct`, {
    method: 'POST',
    headers: { Cookie: hrCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userId: managerOne.id,
      entryType: 'sick_leave',
      startDate: '2031-03-03',
      endDate: '2031-03-04',
    }),
  });
  assert.equal(overlapResponse.status, 409);

  const updateResponse = await fetch(`${availabilityUrl}/${direct.id}`, {
    method: 'PATCH',
    headers: { Cookie: hrCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      entryType: 'vacation',
      startDate: '2031-03-04',
      endDate: '2031-03-05',
    }),
  });
  assert.equal(updateResponse.status, 200);
  const updated = (await updateResponse.json()) as AvailabilityResponse;
  assert.equal(updated.entryType, 'vacation');
  assert.equal(updated.startDate, '2031-03-04');

  const rejectRequest = await createOwnRequest(managerOneCookie, {
    entryType: 'day_off',
    startDate: '2031-04-01',
    endDate: '2031-04-01',
  });
  const rejectResponse = await fetch(
    `${availabilityUrl}/${rejectRequest.id}/reject`,
    {
      method: 'POST',
      headers: { Cookie: hrCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ comment: 'Schedule conflict' }),
    },
  );
  assert.equal(rejectResponse.status, 201);
  assert.equal(
    ((await rejectResponse.json()) as AvailabilityResponse).status,
    'rejected',
  );

  const cancelRequest = await createOwnRequest(managerOneCookie, {
    entryType: 'day_off',
    startDate: '2031-05-01',
    endDate: '2031-05-01',
  });
  const cancelOwnResponse = await fetch(
    `${availabilityUrl}/${cancelRequest.id}/cancel`,
    { method: 'POST', headers: { Cookie: managerOneCookie } },
  );
  assert.equal(cancelOwnResponse.status, 201);
  assert.equal(
    ((await cancelOwnResponse.json()) as AvailabilityResponse).status,
    'cancelled',
  );

  const cancelApprovedResponse = await fetch(
    `${availabilityUrl}/${direct.id}/cancel`,
    { method: 'POST', headers: { Cookie: hrCookie } },
  );
  assert.equal(cancelApprovedResponse.status, 201);
  assert.equal(
    ((await cancelApprovedResponse.json()) as AvailabilityResponse).status,
    'cancelled',
  );

  const historyResponse = await fetch(`${requestUrl}/me`, {
    headers: { Cookie: managerOneCookie },
  });
  assert.equal(historyResponse.status, 200);
  const history = (await historyResponse.json()) as AvailabilityResponse[];
  assert.ok(history.some((entry) => entry.status === 'approved'));
  assert.ok(history.some((entry) => entry.status === 'rejected'));
  assert.ok(history.some((entry) => entry.status === 'cancelled'));
  assert.ok(history.every((entry) => entry.userId === managerOne.id));

  const auditCount = await prisma.auditEvent.count({
    where: {
      entityType: SOURCE_ENTITY_TYPE,
      entityId: { in: history.map((entry) => entry.id) },
    },
  });
  assert.ok(auditCount >= history.length);
  assert.equal(founder.isActive, true);
});
