import { randomBytes, scrypt as nodeScrypt } from 'node:crypto';
import { promisify } from 'node:util';

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const scrypt = promisify(nodeScrypt);

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const derivedKey = (await scrypt(password, salt, 64)) as Buffer;

  return `scrypt$${salt}$${derivedKey.toString('hex')}`;
}

async function main(): Promise<void> {
  const login = process.env.FIRST_ADMIN_LOGIN ?? 'founder';
  const password = process.env.FIRST_ADMIN_PASSWORD ?? 'founder123';
  const fullName = process.env.FIRST_ADMIN_FULL_NAME ?? 'System Founder';

  const founderRole = await prisma.role.upsert({
    where: { code: 'founder' },
    update: {
      name: 'Учредитель',
      description: 'Bootstrap founder role',
    },
    create: {
      code: 'founder',
      name: 'Учредитель',
      description: 'Bootstrap founder role',
    },
  });

  const passwordHash = await hashPassword(password);
  const user = await prisma.user.upsert({
    where: { login },
    update: {
      fullName,
      isActive: true,
      passwordHash,
      password: null,
    },
    create: {
      login,
      fullName,
      isActive: true,
      passwordHash,
      password: null,
    },
  });

  await prisma.userRole.upsert({
    where: {
      userId_roleId: {
        userId: user.id,
        roleId: founderRole.id,
      },
    },
    update: {},
    create: {
      userId: user.id,
      roleId: founderRole.id,
    },
  });
}

void main()
  .catch(async (error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
