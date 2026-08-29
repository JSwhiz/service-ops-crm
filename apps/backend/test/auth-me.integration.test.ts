import assert from 'node:assert/strict';
import test from 'node:test';

import { PrismaClient } from '@prisma/client';

import { hashPassword } from '../src/modules/auth/utils/password-hash.util';

import { createTestApp } from './helpers/create-test-app';

interface MePayload {
  id: string;
  login: string;
  fullName: string;
  roleCode: string;
  roleCodes: string[];
  isActive: boolean;
  capabilities: Record<string, boolean>;
}

interface AuthPayload {
  user: MePayload;
}

function getCookieHeader(response: Response): string {
  const cookieHeaders = (
    response.headers as Headers & {
      getSetCookie?: () => string[];
    }
  ).getSetCookie?.() ?? [];

  return cookieHeaders
    .map((cookieHeader) => cookieHeader.split(';', 1)[0])
    .join('; ');
}

async function login(params: {
  baseUrl: string;
  login: string;
  password: string;
}): Promise<{ cookieHeader: string; payload: AuthPayload }> {
  const response = await fetch(`${params.baseUrl}/api/v1/auth/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      login: params.login,
      password: params.password,
    }),
  });

  assert.equal(response.status, 201);

  return {
    cookieHeader: getCookieHeader(response),
    payload: (await response.json()) as AuthPayload,
  };
}

async function getMe(params: {
  baseUrl: string;
  cookieHeader: string;
}): Promise<Response> {
  return fetch(`${params.baseUrl}/api/v1/auth/me`, {
    headers: {
      Cookie: params.cookieHeader,
    },
  });
}

async function ensureAuthMeTestUser(prisma: PrismaClient): Promise<string> {
  const [managerRole] = await Promise.all([
    prisma.role.upsert({
      where: { code: 'manager' },
      update: {
        name: 'Менеджер',
        description: 'Системная роль менеджера',
      },
      create: {
        code: 'manager',
        name: 'Менеджер',
        description: 'Системная роль менеджера',
      },
    }),
    prisma.role.upsert({
      where: { code: 'founder' },
      update: {
        name: 'Учредитель',
        description: 'Системная роль учредителя',
      },
      create: {
        code: 'founder',
        name: 'Учредитель',
        description: 'Системная роль учредителя',
      },
    }),
  ]);

  const user = await prisma.user.upsert({
    where: {
      login: 'auth_me_runtime_user',
    },
    update: {
      fullName: 'Auth Me Runtime User',
      isActive: true,
      passwordHash: await hashPassword('authme123'),
      deletedAt: null,
    },
    create: {
      login: 'auth_me_runtime_user',
      fullName: 'Auth Me Runtime User',
      isActive: true,
      passwordHash: await hashPassword('authme123'),
    },
  });

  await prisma.userRole.deleteMany({
    where: {
      userId: user.id,
    },
  });

  await prisma.userRole.create({
    data: {
      userId: user.id,
      roleId: managerRole.id,
    },
  });

  return user.id;
}

test('/auth/me returns fresh MeResponseDto capabilities from DB', async (t) => {
  const prisma = new PrismaClient();
  const userId = await ensureAuthMeTestUser(prisma);
  const { app, baseUrl } = await createTestApp();
  const createdOrderIds: string[] = [];

  t.after(async () => {
    await app.close();
    await prisma.oneTimeOrderAssignment.deleteMany({
      where: { oneTimeOrderId: { in: createdOrderIds } },
    });
    await prisma.oneTimeOrder.deleteMany({
      where: { id: { in: createdOrderIds } },
    });
    await prisma.user.deleteMany({
      where: {
        id: userId,
      },
    });
    await prisma.$disconnect();
  });

  const { cookieHeader, payload: loginPayload } = await login({
    baseUrl,
    login: 'auth_me_runtime_user',
    password: 'authme123',
  });

  assert.equal(loginPayload.user.login, 'auth_me_runtime_user');
  assert.equal(loginPayload.user.capabilities.canCreateObject, false);
  assert.equal(loginPayload.user.capabilities.canAccessCandidates, true);
  assert.equal(loginPayload.user.capabilities.canManageCandidates, false);
  assert.equal(loginPayload.user.capabilities.canRespondToCandidates, true);
  assert.equal(typeof loginPayload.user.capabilities.canAccessChats, 'boolean');
  assert.equal(
    typeof loginPayload.user.capabilities.canAccessInventory,
    'boolean',
  );
  assert.equal(
    typeof loginPayload.user.capabilities.canAccessEquipment,
    'boolean',
  );

  const meResponse = await getMe({ baseUrl, cookieHeader });
  assert.equal(meResponse.status, 200);

  const mePayload = (await meResponse.json()) as MePayload;
  assert.equal(mePayload.id, loginPayload.user.id);
  assert.equal(mePayload.login, loginPayload.user.login);
  assert.deepEqual(
    Object.keys(mePayload.capabilities).sort(),
    Object.keys(loginPayload.user.capabilities).sort(),
  );

  await prisma.userRole.deleteMany({ where: { userId } });
  const withoutEligibleRoleResponse = await getMe({ baseUrl, cookieHeader });
  assert.equal(withoutEligibleRoleResponse.status, 200);
  assert.equal(
    ((await withoutEligibleRoleResponse.json()) as MePayload).capabilities
      .canManageOwnOneTimeOrderAvailability,
    false,
  );

  const founder = await prisma.user.findUniqueOrThrow({
    where: { login: 'founder' },
    select: { id: true },
  });
  const assignedOrder = await prisma.oneTimeOrder.create({
    data: {
      title: `Auth capability assignment ${Date.now()}`,
      executionAddress: 'Москва',
      status: 'new',
      contactName: 'Контакт',
      createdByUserId: founder.id,
      assignments: {
        create: {
          userId,
          assignmentRoleCode: 'one_time_manager',
          isActive: true,
        },
      },
    },
  });
  createdOrderIds.push(assignedOrder.id);

  const assignedMeResponse = await getMe({ baseUrl, cookieHeader });
  assert.equal(assignedMeResponse.status, 200);
  assert.equal(
    ((await assignedMeResponse.json()) as MePayload).capabilities
      .canManageOwnOneTimeOrderAvailability,
    false,
  );

  await prisma.oneTimeOrderCalendarManager.create({
    data: { userId, isVisible: true, sortOrder: 999 },
  });
  const rosterMeResponse = await getMe({ baseUrl, cookieHeader });
  assert.equal(rosterMeResponse.status, 200);
  assert.equal(
    ((await rosterMeResponse.json()) as MePayload).capabilities
      .canManageOwnOneTimeOrderAvailability,
    true,
  );

  const founderRole = await prisma.role.findUniqueOrThrow({
    where: {
      code: 'founder',
    },
    select: {
      id: true,
    },
  });

  await prisma.userRole.create({
    data: {
      userId,
      roleId: founderRole.id,
    },
  });

  const updatedMeResponse = await getMe({ baseUrl, cookieHeader });
  assert.equal(updatedMeResponse.status, 200);

  const updatedMePayload = (await updatedMeResponse.json()) as MePayload;
  assert.ok(updatedMePayload.roleCodes.includes('founder'));
  assert.equal(updatedMePayload.capabilities.canCreateObject, true);

  await prisma.user.update({
    where: {
      id: userId,
    },
    data: {
      isActive: false,
    },
  });

  const inactiveMeResponse = await getMe({ baseUrl, cookieHeader });
  assert.equal(inactiveMeResponse.status, 401);
});
