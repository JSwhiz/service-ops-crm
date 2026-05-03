import { copyFileSync, existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import net from 'node:net';
import { spawn } from 'node:child_process';
import path from 'node:path';

export const rootDir = process.cwd();

const envPairs = [
  ['.env.infra.example', '.env.infra.local'],
  ['.env.backend.example', '.env.backend.local'],
  ['.env.frontend.example', '.env.frontend.local'],
  ['.env.backend.docker.example', '.env.backend.docker.local'],
  ['.env.frontend.docker.example', '.env.frontend.docker.local'],
];

export function ensureLocalEnvFiles() {
  for (const [exampleName, localName] of envPairs) {
    const examplePath = path.join(rootDir, exampleName);
    const localPath = path.join(rootDir, localName);

    if (!existsSync(localPath) && existsSync(examplePath)) {
      copyFileSync(examplePath, localPath);
      console.log(`Created ${localName} from ${exampleName}`);
    }
  }
}

export async function parseEnvFile(fileName) {
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

export async function waitForPort(
  port,
  host = '127.0.0.1',
  timeoutMs = 30_000,
) {
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

export function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? rootDir,
      stdio: 'inherit',
      shell: false,
      env: options.env ?? process.env,
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
