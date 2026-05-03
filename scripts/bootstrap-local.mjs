import {
  ensureLocalEnvFiles,
  parseEnvFile,
  runCommand,
  waitForPort,
} from './bootstrap-utils.mjs';

async function main() {
  ensureLocalEnvFiles();

  const infraEnv = await parseEnvFile('.env.infra.local');

  await runCommand('docker', [
    'compose',
    '--env-file',
    '.env.infra.local',
    '-f',
    'docker-compose.dev.yml',
    'up',
    '-d',
  ]);

  const postgresPort = Number(infraEnv.POSTGRES_HOST_PORT ?? '55432');
  const redisPort = Number(infraEnv.REDIS_HOST_PORT ?? '6379');
  const minioPort = Number(infraEnv.MINIO_HOST_PORT ?? '9000');

  await waitForPort(postgresPort);
  await waitForPort(redisPort);
  await waitForPort(minioPort);

  await runCommand('pnpm', ['db:generate']);
  await runCommand('pnpm', ['--filter', 'backend', 'prisma:deploy']);
  await runCommand('pnpm', ['db:seed']);
  await runCommand('pnpm', ['backend:first-admin']);

  console.log('');
  console.log('Local host bootstrap completed.');
  console.log('Next steps:');
  console.log('1. pnpm --filter backend start:dev');
  console.log('2. pnpm --filter frontend dev');
}

void main();
