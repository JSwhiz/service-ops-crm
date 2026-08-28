import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { PrismaClient } from '@prisma/client';

import { hashPassword } from '../src/modules/auth/utils/password-hash.util';
import { loginAndGetCookieHeader } from './helpers/auth';
import { createTestApp } from './helpers/create-test-app';

const EMPLOYEE_PERMISSION_CODES = [
  'employees.view',
  'employees.create',
  'employees.edit',
  'employees.archive',
  'employees.restore',
  'employees.delete_permanently',
  'employees.assignments.manage',
  'employees.assignments.delete_error',
] as const;

const FULL_EMPLOYEE_ACCESS = [...EMPLOYEE_PERMISSION_CODES];
const MANAGE_WITHOUT_HARD_DELETE = EMPLOYEE_PERMISSION_CODES.filter(
  (code) => code !== 'employees.delete_permanently',
);
const CORPORATE_DIRECTOR_ACCESS = MANAGE_WITHOUT_HARD_DELETE.filter(
  (code) => code !== 'employees.assignments.delete_error',
);

test('employee role matrix and direct permissions match the public capability contract', async (t) => {
  const prisma = new PrismaClient();
  const { app, baseUrl } = await createTestApp();
  const marker = randomUUID().slice(0, 8);
  const login = `employee_direct_${marker}`;
  let userId: string | null = null;
  let employeeId: string | null = null;

  t.after(async () => {
    if (employeeId) {
      await prisma.auditEvent.deleteMany({
        where: { entityType: 'employee', entityId: employeeId },
      });
      await prisma.employee.deleteMany({ where: { id: employeeId } });
    }
    if (userId) await prisma.user.deleteMany({ where: { id: userId } });
    await app.close();
    await prisma.$disconnect();
  });

  const roleRows = await prisma.role.findMany({
    where: {
      code: {
        in: [
          'founder',
          'deputy_founder',
          'director',
          'corporate_director',
          'deputy_director',
          'hr',
          'operation_manager',
          'manager',
        ],
      },
    },
    select: {
      code: true,
      permissions: { select: { permission: { select: { code: true } } } },
    },
  });
  const actualByRole = new Map(
    roleRows.map((role) => [
      role.code,
      role.permissions
        .map((item) => item.permission.code)
        .filter((code) =>
          [...EMPLOYEE_PERMISSION_CODES, 'objects.view_hr'].includes(
            code as (typeof EMPLOYEE_PERMISSION_CODES)[number] | 'objects.view_hr',
          ),
        )
        .sort(),
    ]),
  );
  const expectedByRole: Record<string, string[]> = {
    founder: FULL_EMPLOYEE_ACCESS,
    deputy_founder: FULL_EMPLOYEE_ACCESS,
    director: FULL_EMPLOYEE_ACCESS,
    corporate_director: CORPORATE_DIRECTOR_ACCESS,
    deputy_director: FULL_EMPLOYEE_ACCESS,
    hr: [...MANAGE_WITHOUT_HARD_DELETE, 'objects.view_hr'],
    operation_manager: ['employees.view'],
    manager: ['employees.view'],
  };

  for (const [roleCode, expected] of Object.entries(expectedByRole)) {
    assert.deepEqual(actualByRole.get(roleCode), [...expected].sort(), roleCode);
  }

  const [viewPermission, createPermission] = await Promise.all([
    prisma.permission.findUniqueOrThrow({ where: { code: 'employees.view' } }),
    prisma.permission.findUniqueOrThrow({ where: { code: 'employees.create' } }),
  ]);
  const directUser = await prisma.user.create({
    data: {
      login,
      fullName: `Пользователь с прямым доступом ${marker}`,
      passwordHash: await hashPassword('employee-direct-123'),
      isActive: true,
      permissions: {
        create: [
          { permissionId: viewPermission.id },
          { permissionId: createPermission.id },
        ],
      },
    },
  });
  userId = directUser.id;
  const cookie = await loginAndGetCookieHeader({
    baseUrl,
    login,
    password: 'employee-direct-123',
  });

  const meResponse = await fetch(`${baseUrl}/api/v1/auth/me`, {
    headers: { Cookie: cookie },
  });
  assert.equal(meResponse.status, 200);
  const me = (await meResponse.json()) as {
    capabilities: {
      canAccessEmployeesHr: boolean;
      canCreateEmployee: boolean;
      canEditEmployee: boolean;
    };
  };
  assert.deepEqual(
    {
      canAccessEmployeesHr: me.capabilities.canAccessEmployeesHr,
      canCreateEmployee: me.capabilities.canCreateEmployee,
      canEditEmployee: me.capabilities.canEditEmployee,
    },
    {
      canAccessEmployeesHr: true,
      canCreateEmployee: true,
      canEditEmployee: false,
    },
  );

  const createResponse = await fetch(`${baseUrl}/api/v1/employees`, {
    method: 'POST',
    headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fullName: `Создан прямым permission ${marker}`,
      employeeType: 'regular',
    }),
  });
  assert.equal(createResponse.status, 201);
  employeeId = ((await createResponse.json()) as { id: string }).id;
});
