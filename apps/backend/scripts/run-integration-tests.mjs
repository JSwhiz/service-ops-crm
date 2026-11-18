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
const failedFiles = [];

function run(command, args, env, printOutput = true, testTimeoutMs) {
  const result = spawnSync(command, args, {
    cwd: backendDirectory,
    env,
    encoding: 'utf8',
    maxBuffer: 50 * 1024 * 1024,
    ...(testTimeoutMs === undefined ? {} : { timeout: testTimeoutMs, killSignal: 'SIGKILL' }),
  });

  if (printOutput || result.status !== 0) {
    process.stdout.write(result.stdout ?? '');
    process.stderr.write(result.stderr ?? '');
  }

  if (result.error?.code === 'ETIMEDOUT') {
    throw new Error(`Integration test watchdog expired after ${testTimeoutMs}ms: ${args.at(-1)}; killSignal=SIGKILL, signal=${result.signal ?? 'none'}; aborting suite`, { cause: result.error });
  }
  if (result.error) {
    throw result.error;
  }
  if (result.signal) {
    throw new Error(`${command} ${args.join(' ')} stopped by ${result.signal}; aborting suite`);
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
      FILE_PREVIEW_QUEUE_NAME: `service-ops:file-preview:jobs:integration:${process.pid}:${index}`,
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
      if (migrate.status !== 0) {
        throw new Error(`Migration failed for ${testFile} (${schema}): exit ${migrate.status}`);
      }

      const seed = run('pnpm', ['exec', 'tsx', 'prisma/seed.ts'], env, false);
      if (seed.status !== 0) {
        throw new Error(`Seed failed for ${testFile} (${schema}): exit ${seed.status}`);
      }

      process.stdout.write(`\n[integration ${index + 1}/${testFiles.length}] ${testFile}\n`);
      const testResult = run(
        'node',
        ['-r', 'ts-node/register', '--test', testFile],
        env,
        true,
        600_000,
      );
      const match = testResult.stdout?.match(/^(?:ℹ|#) tests (\d+)\r?$/mu);
      totalTests += match ? Number(match[1]) : 0;
      if (testResult.status !== 0) {
        // Only a completed test-file failure continues. Infrastructure errors
        // above and schema cleanup below still abort the campaign immediately.
        failedFiles.push({ file: testFile, exitCode: testResult.status ?? 1 });
      }
    } finally {
      await admin.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    }
  }
} finally {
  await admin.$disconnect();
}

if (failedFiles.length) {
  process.exitCode = 1;
  process.stderr.write(`\nIntegration suite failed: ${failedFiles.length}/${testFiles.length} files; ${totalTests} tests.\n`);
  for (const failure of failedFiles) {
    process.stderr.write(`  ${failure.file}: exit ${failure.exitCode}\n`);
  }
} else {
  process.stdout.write(
    `\nIntegration suite passed: ${totalTests} tests in ${testFiles.length} isolated schemas.\n`,
  );
}
