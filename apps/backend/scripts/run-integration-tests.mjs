import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';

import { PrismaClient } from '@prisma/client';

const backendDirectory = process.cwd();
const testDirectory = resolve(backendDirectory, 'test');
const requestedFiles = process.argv.slice(2).filter((value) => value !== '--');
const testFiles = (
  requestedFiles.length > 0
    ? requestedFiles
    : readdirSync(testDirectory)
        .filter((name) => name.endsWith('.integration.test.ts'))
        .map((name) => `test/${name}`)
).sort();

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is required for integration tests');
}

const adminDatabaseUrl = process.env.DATABASE_URL;
const admin = new PrismaClient({ datasourceUrl: adminDatabaseUrl });
let totalTests = 0;

function run(command, args, env, printOutput = true) {
  const result = spawnSync(command, args, {
    cwd: backendDirectory,
    env,
    encoding: 'utf8',
    maxBuffer: 50 * 1024 * 1024,
  });

  if (printOutput || result.status !== 0) {
    process.stdout.write(result.stdout ?? '');
    process.stderr.write(result.stderr ?? '');
  }

  if (result.error) {
    throw result.error;
  }

  return result;
}

try {
  for (const [index, testFile] of testFiles.entries()) {
    const schema = `integration_${process.pid}_${index}`;
    const testUrl = new URL(adminDatabaseUrl);
    testUrl.searchParams.set('schema', schema);
    const env = {
      ...process.env,
      DATABASE_URL: testUrl.toString(),
      TEST_ISOLATED_DATABASE: 'true',
    };

    await admin.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
    try {
      const migrate = run(
        'pnpm',
        ['exec', 'prisma', 'migrate', 'deploy'],
        env,
        false,
      );
      if (migrate.status !== 0) process.exitCode = migrate.status ?? 1;

      const seed = run('pnpm', ['exec', 'tsx', 'prisma/seed.ts'], env, false);
      if (seed.status !== 0) process.exitCode = seed.status ?? 1;

      if (process.exitCode) break;

      process.stdout.write(`\n[integration ${index + 1}/${testFiles.length}] ${testFile}\n`);
      const testResult = run(
        'node',
        ['-r', 'ts-node/register', '--test', testFile],
        env,
      );
      const match = testResult.stdout?.match(/ℹ tests (\d+)/u);
      totalTests += match ? Number(match[1]) : 0;
      if (testResult.status !== 0) {
        process.exitCode = testResult.status ?? 1;
        break;
      }
    } finally {
      await admin.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    }
  }
} finally {
  await admin.$disconnect();
}

if (!process.exitCode) {
  process.stdout.write(
    `\nIntegration suite passed: ${totalTests} tests in ${testFiles.length} isolated schemas.\n`,
  );
}
