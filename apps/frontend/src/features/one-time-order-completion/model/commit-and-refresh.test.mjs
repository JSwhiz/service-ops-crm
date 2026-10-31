import assert from 'node:assert/strict';
import test from 'node:test';

import { commitAndStartRefresh } from './commit-and-refresh.ts';

test('confirmed commit resets draft before independent refresh completes', async () => {
  const events = [];
  let finishRefresh;
  const refreshWait = new Promise((resolve) => { finishRefresh = resolve; });

  const flow = await commitAndStartRefresh(
    async () => { events.push('commit'); return 'saved'; },
    (result) => events.push(`reset:${result}`),
    async () => { events.push('refresh'); await refreshWait; },
  );

  assert.deepEqual(events, ['commit', 'reset:saved', 'refresh']);
  finishRefresh();
  assert.equal(await flow.refreshResult, true);
});

test('refresh failure is reported separately and does not reject committed mutation', async () => {
  let draftReset = false;
  const flow = await commitAndStartRefresh(
    async () => 'committed',
    () => { draftReset = true; },
    async () => { throw new Error('read failed'); },
  );

  assert.equal(draftReset, true);
  assert.equal(await flow.refreshResult, false);
});

test('an explicit unsuccessful refresh result remains a refresh failure', async () => {
  const flow = await commitAndStartRefresh(
    async () => 'committed',
    () => {},
    async () => false,
  );

  assert.equal(await flow.refreshResult, false);
});

test('failed mutation does not reset draft or start a refresh', async () => {
  let draftReset = false;
  let refreshStarted = false;
  await assert.rejects(
    commitAndStartRefresh(
      async () => { throw new Error('write outcome unknown'); },
      () => { draftReset = true; },
      async () => { refreshStarted = true; },
    ),
    /write outcome unknown/,
  );

  assert.equal(draftReset, false);
  assert.equal(refreshStarted, false);
});
