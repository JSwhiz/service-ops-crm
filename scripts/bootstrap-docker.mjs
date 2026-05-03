import {
  ensureLocalEnvFiles,
  parseEnvFile,
  runCommand,
  waitForPort,
} from './bootstrap-utils.mjs';

const composeArgs = [
  'compose',
  '--env-file',
  '.env.infra.local',
  '-f',
  'docker-compose.dev.yml',
  '--profile',
  'app',
];

async function runCompose(args) {
  await runCommand('docker', [...composeArgs, ...args]);
}

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
    'postgres',
    'redis',
    'minio',
    'minio-init',
  ]);

  const postgresPort = Number(infraEnv.POSTGRES_HOST_PORT ?? '55432');
  const redisPort = Number(infraEnv.REDIS_HOST_PORT ?? '6379');
  const minioPort = Number(infraEnv.MINIO_HOST_PORT ?? '9000');

  await waitForPort(postgresPort);
  await waitForPort(redisPort);
  await waitForPort(minioPort);

  await runCompose(['build', 'backend', 'frontend']);

  await runCompose(['run', '--rm', 'backend', 'pnpm', 'db:generate']);
  await runCompose([
    'run',
    '--rm',
    'backend',
    'pnpm',
    '--filter',
    'backend',
    'prisma:deploy',
  ]);
  await runCompose(['run', '--rm', 'backend', 'pnpm', 'db:seed']);
  await runCompose([
    'run',
    '--rm',
    'backend',
    'pnpm',
    'backend:first-admin',
  ]);

  await runCompose(['up', '-d', 'backend', 'frontend']);

  console.log('');
  console.log('Local docker bootstrap completed.');
  console.log('Stack URLs:');
  console.log('1. Frontend: http://localhost:3000');
  console.log('2. Backend health: http://localhost:4000/api/v1/health');
}

void main();
