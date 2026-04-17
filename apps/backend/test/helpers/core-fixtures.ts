import { randomUUID } from 'node:crypto';

import type { PrismaClient } from '@prisma/client';

export const SEEDED_OBJECT_ID = '11111111-1111-1111-1111-111111111111';

export const SEEDED_EMPLOYEE_IDS = {
  ivan: '4f1a8d0a-4c0d-4b66-8e2d-111111111111',
  sergey: '6b9b0e4c-2d5f-4e3f-9c1a-222222222222',
  alexey: '8c2f4d1b-7a61-4d73-a7de-333333333333',
} as const;

export function getSafeBusinessDate(dayOfMonth: number): {
  year: number;
  month: number;
  dayOfMonth: number;
  operationDate: string;
} {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const daysInMonth = new Date(year, month, 0).getDate();
  const safeDay = Math.min(dayOfMonth, daysInMonth);

  return {
    year,
    month,
    dayOfMonth: safeDay,
    operationDate: `${year}-${String(month).padStart(2, '0')}-${String(safeDay).padStart(2, '0')}`,
  };
}

export async function createCoreTestObject(
  prisma: PrismaClient,
  params?: {
    includeManagerAssignment?: boolean;
  },
): Promise<{
  objectId: string;
}> {
  const [founder, manager] = await Promise.all([
    prisma.user.findUniqueOrThrow({
      where: {
        login: 'founder',
      },
      select: {
        id: true,
      },
    }),
    prisma.user.findUniqueOrThrow({
      where: {
        login: 'manager1',
      },
      select: {
        id: true,
      },
    }),
  ]);

  const objectId = randomUUID();
  const object = await prisma.object.create({
    data: {
      id: objectId,
      name: `Integration Core Object ${objectId.slice(0, 8)}`,
      internalName: `IT-${objectId.slice(0, 6)}`,
      address: 'Москва, тестовый адрес, 1',
      status: 'active',
      seasonMode: 'summer',
      dailyRate: 2500,
      notes: 'Core integration fixture',
      createdByUserId: founder.id,
    },
    select: {
      id: true,
    },
  });

  await prisma.objectAssignment.create({
    data: {
      objectId: object.id,
      userId: founder.id,
      assignmentRoleCode: 'responsible',
      isActive: true,
    },
  });

  if (params?.includeManagerAssignment) {
    await prisma.objectAssignment.create({
      data: {
        objectId: object.id,
        userId: manager.id,
        assignmentRoleCode: 'manager',
        isActive: true,
      },
    });
  }

  await prisma.objectEmployeeAssignment.createMany({
    data: Object.values(SEEDED_EMPLOYEE_IDS).map((employeeId) => ({
      objectId: object.id,
      employeeId,
      isActive: true,
    })),
  });

  return {
    objectId: object.id,
  };
}

export async function cleanupCoreTestObject(
  prisma: PrismaClient,
  objectId: string,
): Promise<void> {
  const monthIds = (
    await prisma.timesheetMonth.findMany({
      where: {
        objectId,
      },
      select: {
        id: true,
      },
    })
  ).map((item) => item.id);

  if (monthIds.length > 0) {
    await prisma.timesheetDayEntry.deleteMany({
      where: {
        row: {
          timesheetMonthId: {
            in: monthIds,
          },
        },
      },
    });

    await prisma.timesheetEmployeeRow.deleteMany({
      where: {
        timesheetMonthId: {
          in: monthIds,
        },
      },
    });

    await prisma.timesheetMonth.deleteMany({
      where: {
        id: {
          in: monthIds,
        },
      },
    });
  }

  await prisma.objectAttendanceFact.deleteMany({
    where: {
      objectId,
    },
  });

  await prisma.objectEmployeeAssignment.deleteMany({
    where: {
      objectId,
    },
  });

  await prisma.objectAssignment.deleteMany({
    where: {
      objectId,
    },
  });

  await prisma.object.deleteMany({
    where: {
      id: objectId,
    },
  });
}
