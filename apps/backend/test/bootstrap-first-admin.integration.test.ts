import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import { PrismaClient } from '@prisma/client';

const execFileAsync = promisify(execFile);

test('bootstrap first admin creates founder user with password hash', async (t) => {
  const prisma = new PrismaClient();

  t.after(async () => {
    await prisma.$disconnect();
  });

  const login = `bootstrap_founder_${Date.now()}`;
  const backendRoot = process.cwd();
  const nodeCommand = process.execPath;

  await execFileAsync(
    nodeCommand,
    [
      '-r',
      'dotenv/config',
      '-r',
      'ts-node/register',
      'scripts/bootstrap-first-admin.ts',
    ],
    {
      cwd: backendRoot,
    env: {
      ...process.env,
      FIRST_ADMIN_LOGIN: login,
      FIRST_ADMIN_PASSWORD: 'bootstrap123',
      FIRST_ADMIN_FULL_NAME: 'Bootstrap Founder',
      DOTENV_CONFIG_PATH: path.resolve(backendRoot, '../../.env.backend.local'),
    },
    },
  );

  const user = await prisma.user.findUnique({
    where: {
      login,
    },
    include: {
      roles: {
        include: {
          role: true,
        },
      },
    },
  });

  assert.ok(user);
  assert.equal(user.fullName, 'Bootstrap Founder');
  assert.equal(user.isActive, true);
  assert.match(user.passwordHash ?? '', /^scrypt\$/);
  assert.ok(user.roles.some((item) => item.role.code === 'founder'));
});
