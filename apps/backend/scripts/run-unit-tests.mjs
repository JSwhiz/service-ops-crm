import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// Opt-in native/browser acceptance wrappers require owned runtime resources.
// Keep them runnable by explicit filename through run-integration-tests.mjs;
// unit discovery is not an acceptance run or acceptance credit.
const files = readdirSync(resolve(root, 'test'), { withFileTypes: true })
  .filter(entry => entry.isFile() && entry.name.endsWith('.test.ts') && !entry.name.endsWith('.integration.test.ts') && !entry.name.endsWith('.acceptance.test.ts'))
  .map(entry => `test/${entry.name}`).sort();
assert.ok(files.length > 0, 'No backend unit tests found');
assert.ok(files.every(file => !['[', ']', '{', '}', '*', '?'].some(character => file.includes(character))), 'Unit files must be literal non-glob paths');
if (process.argv.includes('--list')) {
  // Read-only discovery for the classification regression test; never imports tests.
  console.log(JSON.stringify(files));
} else {
  console.log(`Backend unit preflight: ${files.length} explicit files, sequential; integration and opt-in acceptance fixtures excluded.`);
  // Unit tests must not inherit a connection to any application database.
  const env = { ...process.env };
  delete env.DATABASE_URL;
  delete env.REDIS_URL;
  delete env.TS_NODE_TRANSPILE_ONLY;
  const child = spawn(process.execPath, ['-r', 'ts-node/register', '--test', '--test-concurrency=1', ...files], {
    cwd: root, env, stdio: 'inherit',
  });
  child.once('error', error => { console.error(error.message); process.exitCode = 1; });
  child.once('exit', (code, signal) => { process.exitCode = code ?? (signal ? 1 : 0); });
}
