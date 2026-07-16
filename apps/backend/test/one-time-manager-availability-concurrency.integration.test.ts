import assert from 'node:assert/strict';
import test from 'node:test';

import { PrismaClient } from '@prisma/client';

import { loginAndGetCookieHeader } from './helpers/auth';
import { createTestApp } from './helpers/create-test-app';

interface AvailabilityResponse {
  id: string;
  status: string;
  approvalRequestId: string | null;
}

const SOURCE_ENTITY_TYPE = 'one_time_manager_availability';
const START = new Date('2060-01-01T00:00:00.000Z');
const END = new Date('2061-01-01T00:00:00.000Z');

test('one-time manager availability resolves atomically under concurrency', async (t) => {
  const prisma = new PrismaClient();
  const { app, baseUrl } = await createTestApp();
  const [managerOne, managerTwo] = await Promise.all([
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
    const approvals = await prisma.approvalRequest.findMany({
      where: {
        sourceEntityType: SOURCE_ENTITY_TYPE,
        sourceEntityId: { in: entryIds },
      },
      select: { id: true },
    });
    const approvalIds = approvals.map((request) => request.id);
    await prisma.approvalRequest.deleteMany({
      where: { id: { in: approvalIds } },
    });
    await prisma.auditEvent.deleteMany({
      where: {
        OR: [
          { entityType: SOURCE_ENTITY_TYPE, entityId: { in: entryIds } },
          { entityType: 'approval_request', entityId: { in: approvalIds } },
        ],
      },
    });
    await prisma.oneTimeManagerAvailability.deleteMany({
      where: { id: { in: entryIds } },
    });
  };

  await cleanup();
  t.after(async () => {
    await cleanup();
    await app.close();
    await prisma.$disconnect();
  });

  const [managerOneCookie, managerTwoCookie, founderCookie, hrCookie] =
    await Promise.all([
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
        login: 'founder',
        password: 'founder123',
      }),
      loginAndGetCookieHeader({
        baseUrl,
        login: 'hr1',
        password: 'hr123',
      }),
    ]);

  const requestUrl = `${baseUrl}/api/v1/one-time-orders/calendar/availability-requests`;
  const availabilityUrl = `${baseUrl}/api/v1/one-time-orders/calendar/availability`;
  const jsonPost = (url: string, cookie: string, body: unknown = {}) =>
    fetch(url, {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  const createRequest = async (
    cookie: string,
    startDate: string,
    endDate = startDate,
    entryType = 'day_off',
  ): Promise<AvailabilityResponse> => {
    const response = await jsonPost(requestUrl, cookie, {
      entryType,
      startDate,
      endDate,
    });
    assert.equal(response.status, 201);
    return (await response.json()) as AvailabilityResponse;
  };
  const assertOneWinner = (responses: Response[]) => {
    assert.equal(responses.filter((response) => response.ok).length, 1);
    assert.deepEqual(
      responses.map((response) => response.status).sort((a, b) => a - b),
      responses.some((response) => response.status === 200)
        ? [200, 409]
        : [201, 409],
    );
  };
  const assertResolvedState = async (
    request: AvailabilityResponse,
    expectedStatuses: string[],
  ) => {
    const [availability, approval] = await Promise.all([
      prisma.oneTimeManagerAvailability.findUniqueOrThrow({
        where: { id: request.id },
      }),
      prisma.approvalRequest.findUniqueOrThrow({
        where: { id: request.approvalRequestId! },
      }),
    ]);
    assert.equal(approval.status, availability.status);
    assert.ok(expectedStatuses.includes(availability.status));
    assert.equal(
      await prisma.auditEvent.count({
        where: {
          entityType: SOURCE_ENTITY_TYPE,
          entityId: request.id,
          action: `one_time_manager_availability.${availability.status}`,
        },
      }),
      1,
    );
    assert.equal(
      await prisma.auditEvent.count({
        where: {
          entityType: 'approval_request',
          entityId: request.approvalRequestId!,
          action: `approval.request.${availability.status}`,
        },
      }),
      1,
    );
  };

  const exactPayload = {
    entryType: 'vacation',
    startDate: '2060-01-02',
    endDate: '2060-01-03',
  };
  const duplicateResponses = await Promise.all([
    jsonPost(requestUrl, managerOneCookie, exactPayload),
    jsonPost(requestUrl, managerOneCookie, exactPayload),
  ]);
  assertOneWinner(duplicateResponses);
  assert.equal(
    await prisma.oneTimeManagerAvailability.count({
      where: {
        userId: managerOne.id,
        status: 'pending',
        entryType: exactPayload.entryType,
        startDate: new Date('2060-01-02T00:00:00.000Z'),
        endDate: new Date('2060-01-03T00:00:00.000Z'),
      },
    }),
    1,
  );

  await createRequest(managerOneCookie, '2060-01-10', '2060-01-12');
  await createRequest(managerOneCookie, '2060-01-11', '2060-01-13', 'vacation');
  const calendarResponse = await fetch(
    `${baseUrl}/api/v1/one-time-orders/calendar?month=2060-01&managerUserId=${managerOne.id}`,
    { headers: { Cookie: managerOneCookie } },
  );
  assert.equal(calendarResponse.status, 200);
  const calendar = (await calendarResponse.json()) as {
    managers: Array<{
      days: Array<{ date: string; pendingRequests: unknown[] }>;
    }>;
  };
  assert.equal(
    calendar.managers[0]?.days.find((day) => day.date === '2060-01-11')
      ?.pendingRequests.length,
    2,
  );

  const raceCases: Array<{
    date: string;
    run: (request: AvailabilityResponse) => Promise<Response[]>;
    expectedStatuses: string[];
  }> = [
    {
      date: '2060-02-01',
      run: (request) =>
        Promise.all([
          jsonPost(`${availabilityUrl}/${request.id}/approve`, hrCookie),
          jsonPost(`${availabilityUrl}/${request.id}/approve`, founderCookie),
        ]),
      expectedStatuses: ['approved'],
    },
    {
      date: '2060-02-03',
      run: (request) =>
        Promise.all([
          jsonPost(`${availabilityUrl}/${request.id}/approve`, hrCookie),
          jsonPost(`${availabilityUrl}/${request.id}/reject`, founderCookie, {
            comment: 'Отклонено параллельно',
          }),
        ]),
      expectedStatuses: ['approved', 'rejected'],
    },
    {
      date: '2060-02-05',
      run: (request) =>
        Promise.all([
          jsonPost(`${availabilityUrl}/${request.id}/approve`, hrCookie),
          jsonPost(`${availabilityUrl}/${request.id}/cancel`, managerOneCookie),
        ]),
      expectedStatuses: ['approved', 'cancelled'],
    },
    {
      date: '2060-02-07',
      run: (request) =>
        Promise.all([
          jsonPost(`${availabilityUrl}/${request.id}/reject`, hrCookie, {
            comment: 'Отклонено',
          }),
          jsonPost(`${availabilityUrl}/${request.id}/cancel`, managerOneCookie),
        ]),
      expectedStatuses: ['rejected', 'cancelled'],
    },
    {
      date: '2060-02-09',
      run: (request) =>
        Promise.all([
          jsonPost(`${availabilityUrl}/${request.id}/approve`, hrCookie),
          jsonPost(
            `${baseUrl}/api/v1/approvals/${request.approvalRequestId}/approve`,
            founderCookie,
          ),
        ]),
      expectedStatuses: ['approved'],
    },
  ];

  for (const raceCase of raceCases) {
    const request = await createRequest(managerOneCookie, raceCase.date);
    const responses = await raceCase.run(request);
    assertOneWinner(responses);
    await assertResolvedState(request, raceCase.expectedStatuses);
  }

  const overlapRequest = await createRequest(
    managerTwoCookie,
    '2060-03-01',
    '2060-03-02',
  );
  const directPayload = {
    userId: managerTwo.id,
    entryType: 'vacation',
    startDate: '2060-03-01',
    endDate: '2060-03-02',
  };
  const directVsApprove = await Promise.all([
    jsonPost(`${availabilityUrl}/direct`, hrCookie, directPayload),
    jsonPost(`${availabilityUrl}/${overlapRequest.id}/approve`, founderCookie),
  ]);
  assertOneWinner(directVsApprove);
  assert.equal(
    await prisma.oneTimeManagerAvailability.count({
      where: {
        userId: managerTwo.id,
        status: 'approved',
        startDate: { lte: new Date('2060-03-02T00:00:00.000Z') },
        endDate: { gte: new Date('2060-03-01T00:00:00.000Z') },
      },
    }),
    1,
  );
  const [overlapAvailability, overlapApproval] = await Promise.all([
    prisma.oneTimeManagerAvailability.findUniqueOrThrow({
      where: { id: overlapRequest.id },
    }),
    prisma.approvalRequest.findUniqueOrThrow({
      where: { id: overlapRequest.approvalRequestId! },
    }),
  ]);
  assert.equal(overlapAvailability.status, overlapApproval.status);
});
