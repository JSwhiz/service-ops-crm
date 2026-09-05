import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { PrismaClient } from '@prisma/client';

import { hashPassword } from '../src/modules/auth/utils/password-hash.util';
import { loginAndGetCookieHeader } from './helpers/auth';
import { createTestApp } from './helpers/create-test-app';

function moscowMidnightUtc(now = new Date()): Date {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Moscow',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const year = Number(parts.find((part) => part.type === 'year')?.value ?? 0);
  const month = Number(parts.find((part) => part.type === 'month')?.value ?? 0);
  const day = Number(parts.find((part) => part.type === 'day')?.value ?? 0);
  return new Date(Date.UTC(year, month - 1, day, -3, 0, 0));
}

test('object registry signals are batched and preserve object operational scope', async (t) => {
  const prisma = new PrismaClient();
  const { app, baseUrl } = await createTestApp();
  const marker = randomUUID().slice(0, 8);
  const password = 'object-signals-123';
  const passwordHash = await hashPassword(password);

  const [managerRole, founderRole] = await Promise.all([
    prisma.role.findUniqueOrThrow({ where: { code: 'manager' } }),
    prisma.role.findUniqueOrThrow({ where: { code: 'founder' } }),
  ]);

  const [manager, founder] = await Promise.all([
    prisma.user.create({
      data: {
        login: `signals_manager_${marker}`,
        fullName: `Signals Manager ${marker}`,
        passwordHash,
        isActive: true,
        roles: { create: [{ roleId: managerRole.id }] },
      },
    }),
    prisma.user.create({
      data: {
        login: `signals_founder_${marker}`,
        fullName: `Signals Founder ${marker}`,
        passwordHash,
        isActive: true,
        roles: { create: [{ roleId: founderRole.id }] },
      },
    }),
  ]);

  const [assignedObject, foreignObject] = await Promise.all([
    prisma.object.create({
      data: {
        name: `Signals assigned ${marker}`,
        address: `Assigned ${marker}`,
        status: 'active',
        createdByUserId: founder.id,
      },
    }),
    prisma.object.create({
      data: {
        name: `Signals foreign ${marker}`,
        address: `Foreign ${marker}`,
        status: 'active',
        createdByUserId: founder.id,
      },
    }),
  ]);

  await prisma.objectAssignment.create({
    data: {
      objectId: assignedObject.id,
      userId: manager.id,
      assignmentRoleCode: 'manager',
      isActive: true,
    },
  });

  const today = moscowMidnightUtc();
  await Promise.all([
    prisma.objectDailyReport.create({
      data: {
        objectId: assignedObject.id,
        reportDate: today,
        content: 'Assigned report',
        updatedByUserId: manager.id,
      },
    }),
    prisma.objectDailyReport.create({
      data: {
        objectId: foreignObject.id,
        reportDate: today,
        content: 'Foreign report',
        updatedByUserId: founder.id,
      },
    }),
    prisma.objectAuditLog.create({
      data: {
        objectId: assignedObject.id,
        actorUserId: manager.id,
        actionCode: 'attendance.submitted',
        payload: { operationDate: today.toISOString().slice(0, 10), employeeCount: 0 },
      },
    }),
    prisma.objectAuditLog.create({
      data: {
        objectId: foreignObject.id,
        actorUserId: founder.id,
        actionCode: 'attendance.submitted',
        payload: { operationDate: today.toISOString().slice(0, 10), employeeCount: 0 },
      },
    }),
  ]);

  t.after(async () => {
    await prisma.objectAuditLog.deleteMany({ where: { objectId: { in: [assignedObject.id, foreignObject.id] } } });
    await prisma.objectDailyReport.deleteMany({ where: { objectId: { in: [assignedObject.id, foreignObject.id] } } });
    await prisma.objectAssignment.deleteMany({ where: { objectId: { in: [assignedObject.id, foreignObject.id] } } });
    await prisma.object.deleteMany({ where: { id: { in: [assignedObject.id, foreignObject.id] } } });
    await prisma.user.deleteMany({ where: { id: { in: [manager.id, founder.id] } } });
    await app.close();
    await prisma.$disconnect();
  });

  const managerCookie = await loginAndGetCookieHeader({
    baseUrl,
    login: manager.login,
    password,
  });

  const response = await fetch(
    `${baseUrl}/api/v1/objects/registry-signals?ids=${assignedObject.id},${foreignObject.id}`,
    { headers: { Cookie: managerCookie } },
  );
  assert.equal(response.status, 200);

  const body = (await response.json()) as Array<{
    objectId: string;
    attendanceSubmitted: boolean;
    dailyReportSubmitted: boolean;
  }>;

  assert.deepEqual(body, [
    {
      objectId: assignedObject.id,
      attendanceSubmitted: true,
      dailyReportSubmitted: true,
    },
  ]);
});
