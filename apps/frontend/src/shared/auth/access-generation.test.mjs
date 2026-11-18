import assert from 'node:assert/strict';
import test from 'node:test';
import { getAccessGeneration, isAccessGenerationCurrent, updateAccessIdentity } from './access-generation.ts';

test('same identity and version retain in-flight validity; version, account and logout invalidate it', () => {
  updateAccessIdentity('user-a:1');
  const first = getAccessGeneration();
  updateAccessIdentity('user-a:1');
  assert.equal(getAccessGeneration(), first);
  assert.equal(isAccessGenerationCurrent(first), true);

  updateAccessIdentity('user-a:2');
  assert.equal(isAccessGenerationCurrent(first), false);
  const second = getAccessGeneration();
  assert.equal(second, first + 1);

  updateAccessIdentity('user-b:2');
  assert.equal(isAccessGenerationCurrent(second), false);
  const signedIn = getAccessGeneration();
  updateAccessIdentity(null);
  assert.equal(isAccessGenerationCurrent(signedIn), false);
  const signedOut = getAccessGeneration();
  updateAccessIdentity(null);
  assert.equal(getAccessGeneration(), signedOut);
});
