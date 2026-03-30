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

  const taskTwo = await prisma.task.upsert({
    where: { id: '44444444-4444-4444-4444-444444444444' },
    update: {
      title: 'Проверить расходники по объекту',
      description: 'Сверить наличие базовых расходников на объекте.',
      priority: 'urgent_important',
      status: 'in_progress',
      objectId: objectOne.id,
      createdByUserId: founder.id,
    },
    create: {
      id: '44444444-4444-4444-4444-444444444444',
      title: 'Проверить расходники по объекту',
      description: 'Сверить наличие базовых расходников на объекте.',
      priority: 'urgent_important',
      status: 'in_progress',
      objectId: objectOne.id,
      createdByUserId: founder.id,
    },
  });

  await prisma.taskAssignee.upsert({
    where: {
      taskId_userId: {
        taskId: taskTwo.id,
        userId: director.id,
      },
    },
    update: {},
    create: {
      taskId: taskTwo.id,
      userId: director.id,
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
