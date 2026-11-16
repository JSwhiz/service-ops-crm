import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../ui/timesheet-cell-editor.tsx', import.meta.url), 'utf8');
test('fresh successful read clears a stale rejection but never resets the entered amount or reason', () => {
  const effect = source.match(/useEffect\(\(\) => \{\n {4}if \(blockedAtRevision[\s\S]+?\}, \[blockedAtRevision, dataRevision, mutationsBlocked\]\);/)?.[0];
  assert.ok(effect);
  assert.match(effect, /dataRevision <= blockedAtRevision \|\| mutationsBlocked/);
  assert.match(effect, /setMessage\(null\)/);
  assert.match(effect, /setBlockedAtRevision\(null\)/);
  assert.doesNotMatch(effect, /setValue|setReason|setPendingRequest/);
});
