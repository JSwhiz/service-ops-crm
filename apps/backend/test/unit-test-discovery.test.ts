import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

test('unit discovery retains ACL units and separates opt-in native acceptance without importing it', () => {
  const backend = resolve(__dirname, '..');
  const result = spawnSync(process.execPath, ['scripts/run-unit-tests.mjs', '--list'], { cwd: backend, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const files: string[] = JSON.parse(result.stdout);
  for (const file of ['access-control-file-parent.test.ts', 'access-control-management-scopes.test.ts', 'access-control-realtime.test.ts', 'unit-test-discovery.test.ts']) {
    assert.ok(files.includes(`test/${file}`), `Real unit must remain selected: ${file}`);
  }
  for (const file of ['access-control-native-read-closeout.acceptance.test.ts', 'access-control-native-core-closeout.acceptance.test.ts', 'access-control-native-catalog-ack-closeout.acceptance.test.ts', 'chats.integration.test.ts']) {
    assert.ok(existsSync(resolve(backend, 'test', file)), `Explicit fixture must remain available: ${file}`);
    assert.ok(!files.includes(`test/${file}`), `Runtime fixture must not enter unit discovery: ${file}`);
  }
});
