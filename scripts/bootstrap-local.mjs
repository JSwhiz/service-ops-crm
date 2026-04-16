import { copyFileSync, existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import net from 'node:net';
import { spawn } from 'node:child_process';
import path from 'node:path';

const rootDir = process.cwd();

const envPairs = [
  ['.env.infra.example', '.env.infra.local'],
  ['.env.backend.example', '.env.backend.local'],
  ['.env.frontend.example', '.env.frontend.local'],
];

function ensureLocalEnvFiles() {
  for (const [exampleName, localName] of envPairs) {
    const examplePath = path.join(rootDir, exampleName);
    const localPath = path.join(rootDir, localName);

    if (!existsSync(localPath) && existsSync(examplePath)) {
      copyFileSync(examplePath, localPath);
      console.log(`Created ${localName} from ${exampleName}`);
    }
  }
}

async function parseEnvFile(fileName) {
  const filePath = path.join(rootDir, fileName);
  const content = await readFile(filePath, 'utf8');
  const result = {};

  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }

    const separatorIndex = line.indexOf('=');
    if (separatorIndex <= 0) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();
    result[key] = value;
  }

  return result;
}

async function waitForPort(port, host = '127.0.0.1', timeoutMs = 30_000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const isOpen = await new Promise((resolve) => {
      const socket = net.createConnection({ host, port });

      socket.once('connect', () => {
        socket.end();
        resolve(true);
      });
      socket.once('error', () => resolve(false));
      socket.setTimeout(1_000, () => {
        socket.destroy();
        resolve(false);
      });
    });

    if (isOpen) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }

  throw new Error(`Timed out waiting for ${host}:${port}`);
}

function runCommand(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: rootDir,
      stdio: 'inherit',
      shell: false,
    });

    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`${command} ${args.join(' ')} failed with code ${code}`));
    });
    child.on('error', reject);
  });
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
  ]);

  const postgresPort = Number(infraEnv.POSTGRES_HOST_PORT ?? '55432');
  const redisPort = Number(infraEnv.REDIS_PORT ?? '6379');
  const minioPort = Number(infraEnv.MINIO_PORT ?? '9000');

  await waitForPort(postgresPort);
  await waitForPort(redisPort);
  await waitForPort(minioPort);

  await runCommand('pnpm', ['db:generate']);
  await runCommand('pnpm', ['--filter', 'backend', 'prisma:deploy']);
  await runCommand('pnpm', ['db:seed']);
  await runCommand('pnpm', ['backend:first-admin']);

  console.log('');
  console.log('Local platform bootstrap completed.');
  console.log('Next steps:');
  console.log('1. pnpm --filter backend start:dev');
  console.log('2. pnpm --filter frontend dev');
}

void main();
