import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

function parseEnv(content) {
  const env = {};

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
    env[key] = value;
  }

  return env;
}

function resolveEnvFilePath(rawPath) {
  return path.resolve(process.cwd(), rawPath);
}

const [, , envVarName, fallbackPath, separator, command, ...args] = process.argv;

if (!envVarName || !fallbackPath || separator !== '--' || !command) {
  throw new Error(
    'Usage: node scripts/run-with-env.mjs <ENV_VAR_NAME> <fallback-path> -- <command> [args...]',
  );
}

const chosenEnvPath = process.env[envVarName] || fallbackPath;
const resolvedEnvPath = resolveEnvFilePath(chosenEnvPath);
const mergedEnv = { ...process.env };

if (existsSync(resolvedEnvPath)) {
  Object.assign(mergedEnv, parseEnv(readFileSync(resolvedEnvPath, 'utf8')));
}

mergedEnv[envVarName] = chosenEnvPath;

const child = spawn(command, args, {
  cwd: process.cwd(),
  stdio: 'inherit',
  shell: false,
  env: mergedEnv,
});

child.on('exit', (code) => {
  process.exit(code ?? 1);
});

child.on('error', (error) => {
  console.error(error);
  process.exit(1);
});
