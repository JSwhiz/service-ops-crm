import assert from 'node:assert/strict';
import test from 'node:test';

import { ForbiddenException } from '@nestjs/common';

import { projectCommittedWrite } from '../src/common/access/project-committed-write';

const actor = { id: 'actor', roleCode: 'manager', accessVersion: 7 };
const saved = { outcome: 'saved_without_access' };
const details = { amount: 713 };

function database(readVersion: () => number | null) {
  return {
    user: {
      findFirst: async () => {
        const accessVersion = readVersion();
        return accessVersion === null ? null : { accessVersion };
      },
    },
  } as Parameters<typeof projectCommittedWrite>[0];
}

test('a committed write returns the original response while access is current', async () => {
  const result = await projectCommittedWrite(database(() => 7), actor, () => details);
  assert.equal(result, details);
});

test('a committed write skips projection if access was already revoked', async () => {
  const result = await projectCommittedWrite(database(() => 8), actor, () => assert.fail('disallowed projection'));
  assert.deepEqual(result, saved);
});

test('a committed write discards details if access changes during projection', async () => {
  let version = 7;
  const result = await projectCommittedWrite(database(() => version), actor, async () => {
    version += 1;
    return details;
  });
  assert.deepEqual(result, saved);
});

test('a committed write acknowledges a forbidden projection without returning details', async () => {
  const result = await projectCommittedWrite(database(() => 7), actor, () => {
    throw new ForbiddenException('Confidential details');
  });
  assert.deepEqual(result, saved);
});

test('a committed write does not disclose details when actor verification is unavailable', async () => {
  const db = database(() => { throw new Error('database unavailable'); });
  const result = await projectCommittedWrite(db, actor, () => assert.fail('unverified projection'));
  assert.deepEqual(result, saved);
});

test('an ordinary projection failure still acknowledges the known committed write without details', async () => {
  let projections = 0;
  const result = await projectCommittedWrite(database(() => 7), actor, () => {
    projections += 1;
    throw new Error('Attachment projection unavailable');
  });
  assert.deepEqual(result, saved);
  assert.equal(projections, 1, 'A failed response projection must not retry the committed mutation');
});
