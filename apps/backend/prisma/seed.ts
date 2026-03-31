import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

function startOfToday(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function currentYearMonth(): { year: number; month: number } {
  const now = new Date();
  return {
    year: now.getFullYear(),
    month: now.getMonth() + 1,
  };
}

async function main(): Promise<void> {
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

  const permissions = [
    { code: 'auth.login', name: 'Вход в систему' },
    { code: 'objects.read', name: 'Чтение объектов' },
    { code: 'objects.create', name: 'Создание объектов' },
    { code: 'objects.update', name: 'Изменение объектов' },
    { code: 'tasks.read', name: 'Чтение задач' },
    { code: 'tasks.create', name: 'Создание задач' },
    { code: 'tasks.update', name: 'Изменение задач' },
    { code: 'timesheet.read', name: 'Чтение табеля' },
    { code: 'timesheet.attendance.edit', name: 'Изменение attendance части табеля' },
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

  const visibilityGroups = [
    { code: 'object_basic', name: 'Базовый блок объекта', scopeType: 'object' },
    { code: 'object_contact', name: 'Контактный блок объекта', scopeType: 'object' },
    { code: 'object_financial', name: 'Финансовый блок объекта', scopeType: 'object' },
    { code: 'object_salary', name: 'Зарплатный блок объекта', scopeType: 'object' },
    { code: 'object_consumables', name: 'Расходники и плановые работы', scopeType: 'object' },
    { code: 'object_equipment', name: 'Оборудование объекта', scopeType: 'object' },
  ];

  for (const group of visibilityGroups) {
    await prisma.visibilityGroup.upsert({
      where: { code: group.code },
      update: {
        name: group.name,
        scopeType: group.scopeType,
      },
      create: group,
    });
  }

  const approvalCapabilities = [
    { code: 'approve_task_result', name: 'Подтверждение результата задачи' },
    { code: 'approve_consumables_without_photo', name: 'Подтверждение расходников без фото' },
    { code: 'approve_return', name: 'Подтверждение возврата' },
    { code: 'approve_expense', name: 'Подтверждение расхода' },
    { code: 'approve_key_status_change', name: 'Подтверждение ключевого изменения статуса' },
  ];

  for (const capability of approvalCapabilities) {
    await prisma.approvalCapability.upsert({
      where: { code: capability.code },
      update: { name: capability.name },
      create: capability,
    });
  }

  const founder = await prisma.user.upsert({
    where: { login: 'founder' },
    update: {
      fullName: 'Учредитель',
      isActive: true,
    },
    create: {
      login: 'founder',
      password: 'founder123',
      fullName: 'Учредитель',
      isActive: true,
    },
  });

  const director = await prisma.user.upsert({
    where: { login: 'director' },
    update: {
      fullName: 'Директор',
      isActive: true,
    },
    create: {
      login: 'director',
      password: 'director123',
      fullName: 'Директор',
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

  const timesheetReadPermission = await prisma.permission.findUniqueOrThrow({
    where: { code: 'timesheet.read' },
  });

  await prisma.userPermission.upsert({
    where: {
      userId_permissionId: {
        userId: founder.id,
        permissionId: timesheetReadPermission.id,
      },
    },
    update: {},
    create: {
      userId: founder.id,
      permissionId: timesheetReadPermission.id,
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
      notes: 'Тестовый объект foundation-модуля',
      createdByUserId: founder.id,
    },
  });

  await prisma.objectAssignment.upsert({
    where: {
      objectId_userId_assignmentRoleCode: {
        objectId: objectOne.id,
        userId: founder.id,
        assignmentRoleCode: 'manager',
      },
    },
    update: { isActive: true },
    create: {
      objectId: objectOne.id,
      userId: founder.id,
      assignmentRoleCode: 'manager',
      isActive: true,
    },
  });

  await prisma.objectAssignment.upsert({
    where: {
      objectId_userId_assignmentRoleCode: {
        objectId: objectOne.id,
        userId: director.id,
        assignmentRoleCode: 'responsible',
      },
    },
    update: { isActive: true },
    create: {
      objectId: objectOne.id,
      userId: director.id,
      assignmentRoleCode: 'responsible',
      isActive: true,
    },
  });

  const employeeIvan = await prisma.employee.upsert({
    where: { id: '55555555-5555-5555-5555-555555555555' },
    update: {
      fullName: 'Иван Петров',
      employmentStatus: 'active',
      deletedAt: null,
    },
    create: {
      id: '55555555-5555-5555-5555-555555555555',
      fullName: 'Иван Петров',
      employmentStatus: 'active',
      phone: '+79990000001',
    },
  });

  const employeeSergey = await prisma.employee.upsert({
    where: { id: '66666666-6666-6666-6666-666666666666' },
    update: {
      fullName: 'Сергей Иванов',
      employmentStatus: 'active',
      deletedAt: null,
    },
    create: {
      id: '66666666-6666-6666-6666-666666666666',
      fullName: 'Сергей Иванов',
      employmentStatus: 'active',
      phone: '+79990000002',
    },
  });

  const employeeAlexey = await prisma.employee.upsert({
    where: { id: '77777777-7777-7777-7777-777777777777' },
    update: {
      fullName: 'Алексей Смирнов',
      employmentStatus: 'active',
      deletedAt: null,
    },
    create: {
      id: '77777777-7777-7777-7777-777777777777',
      fullName: 'Алексей Смирнов',
      employmentStatus: 'active',
      phone: '+79990000003',
    },
  });

  await prisma.objectEmployeeAssignment.upsert({
    where: {
      objectId_employeeId: {
        objectId: objectOne.id,
        employeeId: employeeIvan.id,
      },
    },
    update: {
      isActive: true,
    },
    create: {
      objectId: objectOne.id,
      employeeId: employeeIvan.id,
      isActive: true,
    },
  });

  await prisma.objectEmployeeAssignment.upsert({
    where: {
      objectId_employeeId: {
        objectId: objectOne.id,
        employeeId: employeeSergey.id,
      },
    },
    update: {
      isActive: true,
    },
    create: {
      objectId: objectOne.id,
      employeeId: employeeSergey.id,
      isActive: true,
    },
  });

  await prisma.objectEmployeeAssignment.upsert({
    where: {
      objectId_employeeId: {
        objectId: objectOne.id,
        employeeId: employeeAlexey.id,
      },
    },
    update: {
      isActive: true,
    },
    create: {
      objectId: objectOne.id,
      employeeId: employeeAlexey.id,
      isActive: true,
    },
  });

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
      content: 'На объекте выполнены базовые работы. Замечаний по текущему дню нет.',
      updatedByUserId: founder.id,
    },
    create: {
      objectId: objectOne.id,
      reportDate: today,
      content: 'На объекте выполнены базовые работы. Замечаний по текущему дню нет.',
      updatedByUserId: founder.id,
    },
  });

  const existingComment = await prisma.objectComment.findFirst({
    where: {
      objectId: objectOne.id,
      content: 'Стартовый комментарий по объекту для проверки feed и ленты.',
      createdByUserId: director.id,
    },
  });

  if (!existingComment) {
    await prisma.objectComment.create({
      data: {
        objectId: objectOne.id,
        content: 'Стартовый комментарий по объекту для проверки feed и ленты.',
        commentType: 'manual',
        createdByUserId: director.id,
      },
    });
  }

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

  const { year, month } = currentYearMonth();

  const monthContainer = await prisma.timesheetMonth.upsert({
    where: {
      objectId_year_month: {
        objectId: objectOne.id,
        year,
        month,
      },
    },
    update: {
      status: 'open',
      createdByUserId: founder.id,
    },
    create: {
      objectId: objectOne.id,
      year,
      month,
      status: 'open',
      createdByUserId: founder.id,
    },
  });

  const rowIvan = await prisma.timesheetEmployeeRow.upsert({
    where: {
      timesheetMonthId_employeeId: {
        timesheetMonthId: monthContainer.id,
        employeeId: employeeIvan.id,
      },
    },
    update: {
      employeeNameSnapshot: employeeIvan.fullName,
    },
    create: {
      timesheetMonthId: monthContainer.id,
      employeeId: employeeIvan.id,
      employeeNameSnapshot: employeeIvan.fullName,
    },
  });

  const rowSergey = await prisma.timesheetEmployeeRow.upsert({
    where: {
      timesheetMonthId_employeeId: {
        timesheetMonthId: monthContainer.id,
        employeeId: employeeSergey.id,
      },
    },
    update: {
      employeeNameSnapshot: employeeSergey.fullName,
    },
    create: {
      timesheetMonthId: monthContainer.id,
      employeeId: employeeSergey.id,
      employeeNameSnapshot: employeeSergey.fullName,
    },
  });

  const rowAlexey = await prisma.timesheetEmployeeRow.upsert({
    where: {
      timesheetMonthId_employeeId: {
        timesheetMonthId: monthContainer.id,
        employeeId: employeeAlexey.id,
      },
    },
    update: {
      employeeNameSnapshot: employeeAlexey.fullName,
    },
    create: {
      timesheetMonthId: monthContainer.id,
      employeeId: employeeAlexey.id,
      employeeNameSnapshot: employeeAlexey.fullName,
    },
  });

  const entriesToUpsert = [
    { rowId: rowIvan.id, dayOfMonth: 1, attendanceStatus: 'present' },
    { rowId: rowIvan.id, dayOfMonth: 2, attendanceStatus: 'present' },
    { rowId: rowSergey.id, dayOfMonth: 1, attendanceStatus: 'present' },
    { rowId: rowSergey.id, dayOfMonth: 2, attendanceStatus: 'sick' },
    { rowId: rowAlexey.id, dayOfMonth: 1, attendanceStatus: 'day_off' },
    { rowId: rowAlexey.id, dayOfMonth: 2, attendanceStatus: 'present' },
  ];

  for (const entry of entriesToUpsert) {
    await prisma.timesheetDayEntry.upsert({
      where: {
        rowId_dayOfMonth: {
          rowId: entry.rowId,
          dayOfMonth: entry.dayOfMonth,
        },
      },
      update: {
        attendanceStatus: entry.attendanceStatus,
        updatedByUserId: founder.id,
      },
      create: {
        rowId: entry.rowId,
        dayOfMonth: entry.dayOfMonth,
        attendanceStatus: entry.attendanceStatus,
        createdByUserId: founder.id,
        updatedByUserId: founder.id,
      },
    });
  }
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
