import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const command = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')).scripts['test:access'];
const args = (command.match(/"[^"]*"|[^\s]+/g) ?? []).map(arg => arg.replace(/^"|"$/g, ''));
const files = args.filter(arg => arg.endsWith('.test.mjs'));
assert.ok(args.includes('--test') && files.length > 0, 'Explicit access test files required');
assert.equal(new Set(files).size, files.length, 'Duplicate access test file');
for (const file of files) {
  // Node's --test interprets brackets as a glob even when the shell argument is
  // quoted. An unmatched pattern can silently exit successfully with zero tests.
  assert.ok(!['[', ']', '{', '}', '*', '?'].some(character => file.includes(character)), `Use a literal non-glob suite path for ${file}; bracketed app routes belong in the test source URL, not the CLI`);
  assert.ok(file.startsWith('src/') && !file.split('/').includes('..') && existsSync(resolve(root, file)), `Missing explicit access suite: ${file}`);
}
console.log(`Access preflight: ${files.length} existing explicit test files, no silent unmatched CLI globs.`);
