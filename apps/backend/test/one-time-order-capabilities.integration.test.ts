import assert from 'node:assert/strict';
import test from 'node:test';

import { PrismaClient } from '@prisma/client';

import { loginAndGetCookieHeader } from './helpers/auth';
import { createTestApp } from './helpers/create-test-app';

interface OrderCapabilities {
  canEditOperationalFields: boolean;
  canEditFinancialFields: boolean;
  canChangeLinkedObject: boolean;
  canManageManagers: boolean;
  canChangeStatus: boolean;
  canManageSpecification: boolean;
  canUploadPhotos: boolean;
  canDeletePhotos: boolean;
  canRestorePhotos: boolean;
  canCreateTask: boolean;
  canEditReview: boolean;
  canViewCalendar: boolean;
  canManageOwnAvailability: boolean;
  canManageAnyAvailability: boolean;
  canApproveAvailability: boolean;
}

test('one-time order capabilities separate operational, financial and calendar access', async (t) => {
  const prisma = new PrismaClient();
  const { app, baseUrl } = await createTestApp();
  const marker = `capabilities-${Date.now()}`;
  const [founder, managerOne, managerTwo] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { login: 'founder' } }),
    prisma.user.findUniqueOrThrow({ where: { login: 'manager1' } }),
    prisma.user.findUniqueOrThrow({ where: { login: 'manager2' } }),
  ]);
  const creatorOrder = await prisma.oneTimeOrder.create({
    data: {
      title: `${marker}-creator`,
      executionAddress: 'Москва',
      status: 'new',
      contactName: 'Контакт',
      createdByUserId: managerTwo.id,
      assignments: {
        create: {
          userId: managerOne.id,
          assignmentRoleCode: 'one_time_manager',
          isActive: true,
        },
      },
    },
  });
  const inactiveOrder = await prisma.oneTimeOrder.create({
    data: {
      title: `${marker}-inactive`,
      executionAddress: 'Москва',
      status: 'new',
      contactName: 'Контакт',
      createdByUserId: founder.id,
      assignments: {
        create: {
          userId: managerOne.id,
          assignmentRoleCode: 'one_time_manager',
          isActive: false,
        },
      },
    },
  });
  const orderIds = [creatorOrder.id, inactiveOrder.id];

  t.after(async () => {
    await prisma.auditEvent.deleteMany({
      where: { entityType: 'one_time_order', entityId: { in: orderIds } },
    });
    await prisma.oneTimeOrderAssignment.deleteMany({
      where: { oneTimeOrderId: { in: orderIds } },
    });
    await prisma.oneTimeOrder.deleteMany({ where: { id: { in: orderIds } } });
    await app.close();
    await prisma.$disconnect();
  });

  const [founderCookie, managerOneCookie, managerTwoCookie, deputyCookie, hrCookie] =
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
        login: 'deputy1',
        password: 'deputy123',
      }),
      loginAndGetCookieHeader({
        baseUrl,
        login: 'hr1',
        password: 'hr123',
      }),
    ]);
  const cookies = {
    founder: founderCookie,
    manager1: managerOneCookie,
    manager2: managerTwoCookie,
    deputy1: deputyCookie,
    hr1: hrCookie,
  };

  const getOrder = async (cookie: string, orderId = creatorOrder.id) => {
    const response = await fetch(
      `${baseUrl}/api/v1/one-time-orders/${orderId}`,
      { headers: { Cookie: cookie } },
    );
    const payload = response.status === 200
      ? ((await response.json()) as { capabilities: OrderCapabilities })
      : null;

    return { response, payload };
  };

  const leadership = await getOrder(cookies.founder);
  assert.equal(leadership.response.status, 200);
  assert.equal(leadership.payload?.capabilities.canEditOperationalFields, true);
  assert.equal(leadership.payload?.capabilities.canEditFinancialFields, true);
  assert.equal(leadership.payload?.capabilities.canManageManagers, true);
  assert.equal(leadership.payload?.capabilities.canEditReview, true);
  assert.equal(leadership.payload?.capabilities.canManageAnyAvailability, true);
  assert.equal(leadership.payload?.capabilities.canApproveAvailability, true);

  const creator = await getOrder(cookies.manager2);
  assert.equal(creator.response.status, 200);
  assert.equal(creator.payload?.capabilities.canEditOperationalFields, true);
  assert.equal(creator.payload?.capabilities.canEditFinancialFields, true);
  assert.equal(creator.payload?.capabilities.canChangeLinkedObject, true);
  assert.equal(creator.payload?.capabilities.canManageManagers, true);
  assert.equal(creator.payload?.capabilities.canEditReview, false);

  const creatorFinancialEdit = await fetch(
    `${baseUrl}/api/v1/one-time-orders/${creatorOrder.id}`,
    {
      method: 'PATCH',
      headers: {
        Cookie: cookies.manager2,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ agreedSum: 25000 }),
    },
  );
  assert.equal(creatorFinancialEdit.status, 200);

  const activeManager = await getOrder(cookies.manager1);
  assert.equal(activeManager.response.status, 200);
  assert.equal(activeManager.payload?.capabilities.canEditOperationalFields, true);
  assert.equal(activeManager.payload?.capabilities.canEditFinancialFields, false);
  assert.equal(activeManager.payload?.capabilities.canChangeLinkedObject, false);
  assert.equal(activeManager.payload?.capabilities.canManageManagers, false);
  assert.equal(activeManager.payload?.capabilities.canChangeStatus, true);
  assert.equal(activeManager.payload?.capabilities.canManageSpecification, true);
  assert.equal(activeManager.payload?.capabilities.canUploadPhotos, true);
  assert.equal(activeManager.payload?.capabilities.canCreateTask, true);
  assert.equal(activeManager.payload?.capabilities.canManageOwnAvailability, true);

  const managerFinancialEdit = await fetch(
    `${baseUrl}/api/v1/one-time-orders/${creatorOrder.id}`,
    {
      method: 'PATCH',
      headers: {
        Cookie: cookies.manager1,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ agreedSum: 1 }),
    },
  );
  assert.equal(managerFinancialEdit.status, 403);

  const managerCandidates = await fetch(
    `${baseUrl}/api/v1/users-access/users?purpose=one_time_order_manager&oneTimeOrderId=${creatorOrder.id}`,
    { headers: { Cookie: cookies.manager1 } },
  );
  assert.equal(managerCandidates.status, 403);

  const creatorCandidates = await fetch(
    `${baseUrl}/api/v1/users-access/users?purpose=one_time_order_manager&oneTimeOrderId=${creatorOrder.id}`,
    { headers: { Cookie: cookies.manager2 } },
  );
  assert.equal(creatorCandidates.status, 200);

  const inactiveManager = await getOrder(cookies.manager1, inactiveOrder.id);
  assert.equal(inactiveManager.response.status, 404);

  const ordinaryReader = await getOrder(cookies.deputy1);
  assert.equal(ordinaryReader.response.status, 200);
  assert.equal(
    ordinaryReader.payload?.capabilities.canEditOperationalFields,
    false,
  );
  assert.equal(
    ordinaryReader.payload?.capabilities.canEditFinancialFields,
    false,
  );
  assert.equal(ordinaryReader.payload?.capabilities.canViewCalendar, true);

  const hrMeResponse = await fetch(`${baseUrl}/api/v1/auth/me`, {
    headers: { Cookie: cookies.hr1 },
  });
  assert.equal(hrMeResponse.status, 200);
  const hrMe = (await hrMeResponse.json()) as {
    capabilities: {
      canAccessOneTimeOrders: boolean;
      canCreateOneTimeOrder: boolean;
      canViewOneTimeOrderCalendar: boolean;
      canManageAnyOneTimeOrderAvailability: boolean;
      canApproveOneTimeOrderAvailability: boolean;
    };
  };
  assert.equal(hrMe.capabilities.canAccessOneTimeOrders, false);
  assert.equal(hrMe.capabilities.canCreateOneTimeOrder, false);
  assert.equal(hrMe.capabilities.canViewOneTimeOrderCalendar, true);
  assert.equal(hrMe.capabilities.canManageAnyOneTimeOrderAvailability, true);
  assert.equal(hrMe.capabilities.canApproveOneTimeOrderAvailability, true);
  assert.equal((await getOrder(cookies.hr1)).response.status, 404);
});
