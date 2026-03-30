import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

function startOfToday(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
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
  ];

  for (const permission of permissions) {
    await prisma.permission.upsert({
      where: { code: permission.code },
      update: {},
      create: {
        code: permission.code,
        name: permission.name,
      },
    });
  }

  const visibilityGroups = [
    { code: 'object_basic', name: 'Базовый блок объекта', scopeType: 'object' },
    { code: 'object_financial', name: 'Финансовый блок объекта', scopeType: 'object' },
    { code: 'object_salary', name: 'Зарплатный блок объекта', scopeType: 'object' },
  ];

  for (const group of visibilityGroups) {
    await prisma.visibilityGroup.upsert({
      where: { code: group.code },
      update: {},
      create: group,
    });
  }

  const approvalCapabilities = [
    { code: 'approve_task_result', name: 'Подтверждение результата задачи' },
    { code: 'approve_consumables_without_photo', name: 'Подтверждение расходников без фото' },
  ];

  for (const capability of approvalCapabilities) {
    await prisma.approvalCapability.upsert({
      where: { code: capability.code },
      update: {},
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

  const objectTwo = await prisma.object.upsert({
    where: { id: '22222222-2222-2222-2222-222222222222' },
    update: {
      name: 'Север',
      internalName: 'SV-002',
      address: 'Москва, пр-т Северный, 15',
      status: 'frozen',
      seasonMode: 'winter',
      notes: 'Замороженный тестовый объект',
      createdByUserId: director.id,
      deletedAt: null,
    },
    create: {
      id: '22222222-2222-2222-2222-222222222222',
      name: 'Север',
      internalName: 'SV-002',
      address: 'Москва, пр-т Северный, 15',
      status: 'frozen',
      seasonMode: 'winter',
      notes: 'Замороженный тестовый объект',
      createdByUserId: director.id,
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
    update: {
      isActive: true,
    },
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
    update: {
      isActive: true,
    },
    create: {
      objectId: objectOne.id,
      userId: director.id,
      assignmentRoleCode: 'responsible',
      isActive: true,
    },
  });

  await prisma.objectAssignment.upsert({
    where: {
      objectId_userId_assignmentRoleCode: {
        objectId: objectTwo.id,
        userId: director.id,
        assignmentRoleCode: 'manager',
      },
    },
    update: {
      isActive: true,
    },
    create: {
      objectId: objectTwo.id,
      userId: director.id,
      assignmentRoleCode: 'manager',
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
