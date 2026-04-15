import { PrismaClient } from '@prisma/client';
import { randomBytes, scrypt as nodeScrypt } from 'node:crypto';
import { promisify } from 'node:util';

const prisma = new PrismaClient();
const scrypt = promisify(nodeScrypt);

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const derivedKey = (await scrypt(password, salt, 64)) as Buffer;

  return `scrypt$${salt}$${derivedKey.toString('hex')}`;
}

function startOfToday(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

async function main(): Promise<void> {
  const founderPasswordHash = await hashPassword('founder123');
  const directorPasswordHash = await hashPassword('director123');
  const managerPasswordHash = await hashPassword('manager123');

  const founderRole = await prisma.role.upsert({
    where: { code: 'founder' },
    update: {},
    create: {
      code: 'founder',
      name: 'Учредитель',
      description: 'Системная роль учредителя',
    },
  });

  const directorRole = await prisma.role.upsert({
    where: { code: 'director' },
    update: {},
    create: {
      code: 'director',
      name: 'Директор',
      description: 'Системная роль директора',
    },
  });

  const managerRole = await prisma.role.upsert({
    where: { code: 'manager' },
    update: {},
    create: {
      code: 'manager',
      name: 'Менеджер',
      description: 'Системная роль менеджера объекта',
    },
  });

  const permissions = [
    { code: 'auth.login', name: 'Вход в систему' },
    { code: 'objects.read', name: 'Чтение объектов' },
    { code: 'objects.create', name: 'Создание объектов' },
    { code: 'objects.update', name: 'Изменение объектов' },
    { code: 'tasks.read', name: 'Чтение задач' },
    { code: 'tasks.create', name: 'Создание задач' },
    { code: 'tasks.update', name: 'Изменение задач' },
    { code: 'timesheet.read', name: 'Чтение табеля' },
    { code: 'timesheet.attendance.edit', name: 'Изменение табеля' },
    { code: 'timesheet.amount.edit', name: 'Изменение денежных ячеек табеля' },
  ];

  for (const permission of permissions) {
    await prisma.permission.upsert({
      where: { code: permission.code },
      update: { name: permission.name },
      create: {
        code: permission.code,
        name: permission.name,
      },
    });
  }

  const founder = await prisma.user.upsert({
    where: { login: 'founder' },
    update: {
      fullName: 'Учредитель',
      isActive: true,
      passwordHash: founderPasswordHash,
      password: null,
    },
    create: {
      login: 'founder',
      passwordHash: founderPasswordHash,
      fullName: 'Учредитель',
      isActive: true,
    },
  });

  const director = await prisma.user.upsert({
    where: { login: 'director' },
    update: {
      fullName: 'Директор',
      isActive: true,
      passwordHash: directorPasswordHash,
      password: null,
    },
    create: {
      login: 'director',
      passwordHash: directorPasswordHash,
      fullName: 'Директор',
      isActive: true,
    },
  });

  const managerOne = await prisma.user.upsert({
    where: { login: 'manager1' },
    update: {
      fullName: 'Менеджер Первый',
      isActive: true,
      passwordHash: managerPasswordHash,
      password: null,
    },
    create: {
      login: 'manager1',
      passwordHash: managerPasswordHash,
      fullName: 'Менеджер Первый',
      isActive: true,
    },
  });

  const managerTwo = await prisma.user.upsert({
    where: { login: 'manager2' },
    update: {
      fullName: 'Менеджер Второй',
      isActive: true,
      passwordHash: managerPasswordHash,
      password: null,
    },
    create: {
      login: 'manager2',
      passwordHash: managerPasswordHash,
      fullName: 'Менеджер Второй',
      isActive: true,
    },
  });

  await prisma.userRole.upsert({
    where: {
      userId_roleId: {
        userId: founder.id,
        roleId: founderRole.id,
      },
    },
    update: {},
    create: {
      userId: founder.id,
      roleId: founderRole.id,
    },
  });

  await prisma.userRole.upsert({
    where: {
      userId_roleId: {
        userId: director.id,
        roleId: directorRole.id,
      },
    },
    update: {},
    create: {
      userId: director.id,
      roleId: directorRole.id,
    },
  });

  await prisma.userRole.upsert({
    where: {
      userId_roleId: {
        userId: managerOne.id,
        roleId: managerRole.id,
      },
    },
    update: {},
    create: {
      userId: managerOne.id,
      roleId: managerRole.id,
    },
  });

  await prisma.userRole.upsert({
    where: {
      userId_roleId: {
        userId: managerTwo.id,
        roleId: managerRole.id,
      },
    },
    update: {},
    create: {
      userId: managerTwo.id,
      roleId: managerRole.id,
    },
  });

  const objectOne = await prisma.object.upsert({
    where: { id: '11111111-1111-1111-1111-111111111111' },
    update: {
      name: 'Белый дом',
      internalName: 'BH-001',
      address: 'Москва, ул. Центральная, 1',
      status: 'active',
      seasonMode: 'summer',
      dailyRate: 2500,
      notes: 'Тестовый объект foundation-модуля',
      createdByUserId: founder.id,
      deletedAt: null,
    },
    create: {
      id: '11111111-1111-1111-1111-111111111111',
      name: 'Белый дом',
      internalName: 'BH-001',
      address: 'Москва, ул. Центральная, 1',
      status: 'active',
      seasonMode: 'summer',
      dailyRate: 2500,
      notes: 'Тестовый объект foundation-модуля',
      createdByUserId: founder.id,
    },
  });

  await prisma.objectAssignment.upsert({
    where: {
      objectId_userId_assignmentRoleCode: {
        objectId: objectOne.id,
        userId: founder.id,
        assignmentRoleCode: 'responsible',
      },
    },
    update: { isActive: true },
    create: {
      objectId: objectOne.id,
      userId: founder.id,
      assignmentRoleCode: 'responsible',
      isActive: true,
    },
  });

  await prisma.objectAssignment.upsert({
    where: {
      objectId_userId_assignmentRoleCode: {
        objectId: objectOne.id,
        userId: director.id,
        assignmentRoleCode: 'manager',
      },
    },
    update: { isActive: true },
    create: {
      objectId: objectOne.id,
      userId: director.id,
      assignmentRoleCode: 'manager',
      isActive: true,
    },
  });

  await prisma.objectAssignment.upsert({
    where: {
      objectId_userId_assignmentRoleCode: {
        objectId: objectOne.id,
        userId: managerOne.id,
        assignmentRoleCode: 'manager',
      },
    },
    update: { isActive: true },
    create: {
      objectId: objectOne.id,
      userId: managerOne.id,
      assignmentRoleCode: 'manager',
      isActive: true,
    },
  });

  const employeeIvan = await prisma.employee.upsert({
    where: { id: '4f1a8d0a-4c0d-4b66-8e2d-111111111111' },
    update: {
      fullName: 'Иван Петров',
      employmentStatus: 'active',
      deletedAt: null,
    },
    create: {
      id: '4f1a8d0a-4c0d-4b66-8e2d-111111111111',
      fullName: 'Иван Петров',
      employmentStatus: 'active',
      phone: '+79990000001',
    },
  });

  const employeeSergey = await prisma.employee.upsert({
    where: { id: '6b9b0e4c-2d5f-4e3f-9c1a-222222222222' },
    update: {
      fullName: 'Сергей Иванов',
      employmentStatus: 'active',
      deletedAt: null,
    },
    create: {
      id: '6b9b0e4c-2d5f-4e3f-9c1a-222222222222',
      fullName: 'Сергей Иванов',
      employmentStatus: 'active',
      phone: '+79990000002',
    },
  });

  const employeeAlexey = await prisma.employee.upsert({
    where: { id: '8c2f4d1b-7a61-4d73-a7de-333333333333' },
    update: {
      fullName: 'Алексей Смирнов',
      employmentStatus: 'active',
      deletedAt: null,
    },
    create: {
      id: '8c2f4d1b-7a61-4d73-a7de-333333333333',
      fullName: 'Алексей Смирнов',
      employmentStatus: 'active',
      phone: '+79990000003',
    },
  });

  for (const employee of [employeeIvan, employeeSergey, employeeAlexey]) {
    await prisma.objectEmployeeAssignment.upsert({
      where: {
        objectId_employeeId: {
          objectId: objectOne.id,
          employeeId: employee.id,
        },
      },
      update: {
        isActive: true,
      },
      create: {
        objectId: objectOne.id,
        employeeId: employee.id,
        isActive: true,
      },
    });
  }

  const today = startOfToday();

  await prisma.objectArrivalPhoto.upsert({
    where: {
      objectId_operationDate: {
        objectId: objectOne.id,
        operationDate: today,
      },
    },
    update: {
      photoUrl: 'https://example.com/arrival/bh-001-today.jpg',
      photoType: 'arrival',
      comment: 'Фото прибытия foundation-этапа',
      createdByUserId: founder.id,
    },
    create: {
      objectId: objectOne.id,
      operationDate: today,
      photoUrl: 'https://example.com/arrival/bh-001-today.jpg',
      photoType: 'arrival',
      comment: 'Фото прибытия foundation-этапа',
      createdByUserId: founder.id,
    },
  });

  await prisma.objectDailyReport.upsert({
    where: {
      objectId_reportDate: {
        objectId: objectOne.id,
        reportDate: today,
      },
    },
    update: {
      content:
        'На объекте выполнены базовые работы. Замечаний по текущему дню нет.',
      updatedByUserId: founder.id,
    },
    create: {
      objectId: objectOne.id,
      reportDate: today,
      content:
        'На объекте выполнены базовые работы. Замечаний по текущему дню нет.',
      updatedByUserId: founder.id,
    },
  });

  const taskOne = await prisma.task.upsert({
    where: { id: '33333333-3333-3333-3333-333333333333' },
    update: {
      title: 'Проверить состояние входной зоны',
      description: 'Осмотреть входную зону и сообщить о замечаниях.',
      priority: 'important_not_urgent',
      status: 'assigned',
      objectId: objectOne.id,
      createdByUserId: director.id,
    },
    create: {
      id: '33333333-3333-3333-3333-333333333333',
      title: 'Проверить состояние входной зоны',
      description: 'Осмотреть входную зону и сообщить о замечаниях.',
      priority: 'important_not_urgent',
      status: 'assigned',
      objectId: objectOne.id,
      createdByUserId: director.id,
    },
  });

  await prisma.taskAssignee.upsert({
    where: {
      taskId_userId: {
        taskId: taskOne.id,
        userId: founder.id,
      },
    },
    update: {},
    create: {
      taskId: taskOne.id,
      userId: founder.id,
    },
  });

  const timesheetYear = 2026;
  const timesheetMonth = 2;

  await prisma.objectAttendanceFact.deleteMany({
    where: {
      objectId: objectOne.id,
    },
  });

  const existingMonths = await prisma.timesheetMonth.findMany({
    where: {
      objectId: objectOne.id,
    },
    select: {
      id: true,
    },
  });

  const existingMonthIds = existingMonths.map((item) => item.id);

  if (existingMonthIds.length > 0) {
    await prisma.timesheetDayEntry.deleteMany({
      where: {
        row: {
          timesheetMonthId: {
            in: existingMonthIds,
          },
        },
      },
    });

    await prisma.timesheetEmployeeRow.deleteMany({
      where: {
        timesheetMonthId: {
          in: existingMonthIds,
        },
      },
    });

    await prisma.timesheetMonth.deleteMany({
      where: {
        id: {
          in: existingMonthIds,
        },
      },
    });
  }

  const monthContainer = await prisma.timesheetMonth.upsert({
    where: {
      objectId_year_month: {
        objectId: objectOne.id,
        year: timesheetYear,
        month: timesheetMonth,
      },
    },
    update: {
      status: 'open',
      createdByUserId: founder.id,
    },
    create: {
      objectId: objectOne.id,
      year: timesheetYear,
      month: timesheetMonth,
      status: 'open',
      createdByUserId: founder.id,
    },
  });

  const rows = [];
  for (const employee of [employeeIvan, employeeSergey, employeeAlexey]) {
    const row = await prisma.timesheetEmployeeRow.upsert({
      where: {
        timesheetMonthId_employeeId: {
          timesheetMonthId: monthContainer.id,
          employeeId: employee.id,
        },
      },
      update: {
        employeeNameSnapshot: employee.fullName,
      },
      create: {
        timesheetMonthId: monthContainer.id,
        employeeId: employee.id,
        employeeNameSnapshot: employee.fullName,
      },
    });
    rows.push(row);
  }

  const factDays = [1, 2, 3, 4, 7, 8, 9, 10, 11, 14, 15, 16];

  for (const day of factDays) {
    const operationDate = new Date(timesheetYear, timesheetMonth - 1, day);

    for (const employee of [employeeIvan, employeeSergey, employeeAlexey]) {
      await prisma.objectAttendanceFact.upsert({
        where: {
          objectId_employeeId_operationDate: {
            objectId: objectOne.id,
            employeeId: employee.id,
            operationDate,
          },
        },
        update: {
          createdByUserId: founder.id,
        },
        create: {
          objectId: objectOne.id,
          employeeId: employee.id,
          operationDate,
          createdByUserId: founder.id,
        },
      });
    }
  }

  for (const day of factDays) {
    for (const row of rows) {
      await prisma.timesheetDayEntry.upsert({
        where: {
          rowId_dayOfMonth: {
            rowId: row.id,
            dayOfMonth: day,
          },
        },
        update: {
          dayValue: objectOne.dailyRate,
          isChangedManually: false,
          updatedByUserId: founder.id,
        },
        create: {
          rowId: row.id,
          dayOfMonth: day,
          dayValue: objectOne.dailyRate,
          isChangedManually: false,
          createdByUserId: founder.id,
          updatedByUserId: founder.id,
        },
      });
    }
  }

  await prisma.timesheetDayEntry.update({
    where: {
      rowId_dayOfMonth: {
        rowId: rows[2].id,
        dayOfMonth: 11,
      },
    },
    data: {
      dayValue: 3100,
      isChangedManually: true,
      comment: 'Ручная корректировка тестового значения',
      updatedByUserId: founder.id,
    },
  });
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
