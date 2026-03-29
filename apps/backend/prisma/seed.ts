import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

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
    { code: 'tasks.read', name: 'Чтение задач' },
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
