import assert from 'node:assert/strict';
import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { runCampaign } from './run-access-acceptance-campaign.mjs';

test('checkpoints cells, resumes failed work and invalidates only changed dependencies', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'crm-access-campaign-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = name => join(dir, name);
  const journalPath = file('journal.jsonl');
  for (const dependency of ['one', 'two']) writeFileSync(file(dependency), 'original');
  const matrix = {
    rows: [
      { code: 'one', acceptanceCriteria: { K1: { status: 'partial' }, K2: { status: 'partial' }, K3: { status: 'verified' } } },
      { code: 'two', acceptanceCriteria: { K1: { status: 'partial' } } },
    ],
  };
  let fail = true;
  let preparations = 0;
  const execution = [];
  const cases = ['one', 'two'].map((id, index) => ({
    id,
    mode: 'read',
    dependencies: [file(id)],
    cells: index ? ['two/K1'] : ['one/K1', 'one/K2', 'one/K3'],
    run: async (_shared, cells, record) => {
      execution.push(...cells);
      for (const cell of cells) {
        if (fail && cell === 'one/K2') throw Error('Controlled failure');
        record(cell, { status: 200 });
      }
    },
  }));
  const run = () => runCampaign({ matrix, cases, journalPath, prepare: async () => { preparations++; } });
  const first = await run();
  assert.deepEqual(first.failed, ['one/K2']);
  assert.deepEqual(first.alreadyAccepted, ['one/K3']);
  assert.deepEqual(first.passed.sort(), ['one/K1', 'two/K1']);

  appendFileSync(journalPath, '{"interrupted":');
  fail = false;
  execution.length = 0;
  const second = await run();
  assert.deepEqual(execution, ['one/K2']);
  assert.deepEqual(second.resumed, ['one/K1', 'two/K1']);
  assert.deepEqual(second.passed, ['one/K2']);
  assert(!readFileSync(journalPath, 'utf8').includes('interrupted'));

  writeFileSync(file('two'), 'changed');
  execution.length = 0;
  const third = await run();
  assert.deepEqual(execution, ['two/K1']);
  assert.deepEqual(third.resumed, ['one/K1', 'one/K2']);
  const fourth = await run();
  assert.equal(fourth.passed.length, 0);
  assert.equal(preparations, 3);
});

test('runs independent reads together and sequences writes after all reads', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'crm-access-scheduling-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const codes = ['first', 'second', 'stock', 'finance'];
  const dependencies = [new URL(import.meta.url)];
  const matrix = { rows: codes.map(code => ({ code, acceptanceCriteria: { K1: { status: 'partial' } } })) };
  const { promise, resolve } = Promise.withResolvers();
  const order = [];
  const cases = codes.map((id, index) => ({
    id, mode: index < 2 ? 'read' : 'write', dependencies, cells: [id + '/K1'],
    async run(shared, [cell], record) {
      assert.equal(shared, 'one shared fixture');
      order.push(id + ' start');
      if (index === 1) resolve();
      if (index === 0) await promise;
      order.push(id + ' done');
      record(cell, { id });
    },
  }));
  await runCampaign({
    matrix, cases, journalPath: join(dir, 'journal.jsonl'), parallelReads: 2,
    prepare: () => 'one shared fixture',
  });
  assert.deepEqual(order, [
    'first start', 'second start', 'second done', 'first done',
    'stock start', 'stock done', 'finance start', 'finance done',
  ]);
});
