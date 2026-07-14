import assert from 'node:assert/strict';
import test from 'node:test';

import { PrismaClient } from '@prisma/client';

import { UsersService } from '../src/modules/users-access/users.service';

import { createTestApp } from './helpers/create-test-app';

test('effective permissions combine direct and current role permissions', async (t) => {
  const prisma = new PrismaClient();
  const roleWithPermission = await prisma.role.create({
    data: {
      code: `permission_role_${Date.now()}`,
      name: 'Permission role A',
    },
  });
  const replacementRole = await prisma.role.create({
    data: {
      code: `permission_role_replacement_${Date.now()}`,
      name: 'Permission role B',
    },
  });
  const inheritedPermission = await prisma.permission.create({
    data: {
      code: `permission.inherited.${Date.now()}`,
      name: 'Inherited permission',
    },
  });
  const replacementPermission = await prisma.permission.create({
    data: {
      code: `permission.replacement.${Date.now()}`,
      name: 'Replacement permission',
    },
  });
  const directPermission = await prisma.permission.create({
    data: {
      code: `permission.direct.${Date.now()}`,
      name: 'Direct permission',
    },
  });
  const user = await prisma.user.create({
    data: {
      login: `permission_runtime_${Date.now()}`,
      fullName: 'Permission Runtime User',
      isActive: true,
      roles: {
        create: {
          roleId: roleWithPermission.id,
        },
      },
      permissions: {
        create: [
          { permissionId: directPermission.id },
          { permissionId: inheritedPermission.id },
        ],
      },
    },
  });

  await prisma.rolePermission.createMany({
    data: [
      {
        roleId: roleWithPermission.id,
        permissionId: inheritedPermission.id,
      },
      {
        roleId: replacementRole.id,
        permissionId: replacementPermission.id,
      },
    ],
  });

  const { app } = await createTestApp();
  const usersService = app.get(UsersService);

  t.after(async () => {
    await app.close();
    await prisma.user.delete({ where: { id: user.id } });
    await prisma.role.deleteMany({
      where: { id: { in: [roleWithPermission.id, replacementRole.id] } },
    });
    await prisma.permission.deleteMany({
      where: {
        id: {
          in: [
            inheritedPermission.id,
            replacementPermission.id,
            directPermission.id,
          ],
        },
      },
    });
    await prisma.$disconnect();
  });

  const initial = await usersService.findById(user.id);
  assert.ok(initial);
  assert.deepEqual(usersService.sanitizeUser(initial).permissionCodes, [
    directPermission.code,
    inheritedPermission.code,
  ].sort());

  await prisma.userRole.deleteMany({ where: { userId: user.id } });
  await prisma.userRole.create({
    data: {
      userId: user.id,
      roleId: replacementRole.id,
    },
  });

  const afterRoleChange = await usersService.findById(user.id);
  assert.ok(afterRoleChange);
  assert.deepEqual(usersService.sanitizeUser(afterRoleChange).permissionCodes, [
    directPermission.code,
    inheritedPermission.code,
    replacementPermission.code,
  ].sort());

  await prisma.user.update({
    where: { id: user.id },
    data: {
      login: `renamed_permission_runtime_${Date.now()}`,
      fullName: 'Completely Different Name',
    },
  });

  const afterIdentityChange = await usersService.findById(user.id);
  assert.ok(afterIdentityChange);
  assert.deepEqual(
    usersService.sanitizeUser(afterIdentityChange).permissionCodes,
    usersService.sanitizeUser(afterRoleChange).permissionCodes,
  );
});
