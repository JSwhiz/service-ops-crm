import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { closeSync, fsyncSync, openSync, readFileSync, truncateSync, writeFileSync } from 'node:fs';

function fingerprint({ id, mode, dependencies }) {
  const hash = createHash('sha256');
  hash.update(JSON.stringify([id, mode]));
  for (const file of [new URL(import.meta.url), ...dependencies]) {
    hash.update(createHash('sha256').update(readFileSync(file)).digest());
  }
  return hash.digest('hex');
}

function readJournal(path) {
  const bytes = readFileSync(path);
  const end = bytes.lastIndexOf(10) + 1;
  const entries = bytes.subarray(0, end).toString('utf8').split('\n').filter(Boolean).map(JSON.parse);
  // An interrupted append can leave an incomplete final line. Keep complete entries.
  if (end !== bytes.length) truncateSync(path, end);
  return entries;
}

export async function runCampaign({ matrix, cases, journalPath, prepare, parallelReads = 4 }) {
  assert(Number.isInteger(parallelReads) && parallelReads > 0);
  const cells = new Map(matrix.rows.flatMap(({ code, acceptanceCriteria }) =>
    Object.entries(acceptanceCriteria).map(([key, cell]) => [code + '/' + key, cell.status])));
  const owners = new Set();
  const ids = new Set();
  for (const scenario of cases) {
    assert(!ids.has(scenario.id) && scenario.cells.length > 0);
    ids.add(scenario.id);
    assert(['read', 'write'].includes(scenario.mode));
    assert(scenario.dependencies.length > 0);
    for (const cell of scenario.cells) {
      assert(cells.has(cell) && !owners.has(cell), 'Unknown or duplicated cell: ' + cell);
      owners.add(cell);
    }
  }

  const journal = openSync(journalPath, 'a');
  try {
    const previous = new Map();
    for (const entry of readJournal(journalPath)) previous.set(entry.cell, entry);
    const summary = { alreadyAccepted: [], resumed: [], passed: [], failed: [] };
    const pending = cases.flatMap(scenario => {
      const revision = fingerprint(scenario);
      const remaining = scenario.cells.filter(cell => {
        if (['verified', 'not_applicable'].includes(cells.get(cell))) {
          summary.alreadyAccepted.push(cell);
          return false;
        }
        const entry = previous.get(cell);
        if (entry?.status === 'passed' && entry.scenario === scenario.id && entry.revision === revision) {
          summary.resumed.push(cell);
          return false;
        }
        return true;
      });
      return remaining.length ? [{ scenario, revision, remaining }] : [];
    });
    if (!pending.length) return summary;

    const shared = await prepare();
    const execute = async ({ scenario, revision, remaining }) => {
      const open = new Set(remaining);
      function record(cell, status, evidence) {
        const line = JSON.stringify({ cell, status, scenario: scenario.id, revision, evidence });
        writeFileSync(journal, line + '\n');
        fsyncSync(journal);
        open.delete(cell);
        summary[status].push(cell);
      }
      try {
        await scenario.run(shared, remaining, (cell, evidence) => {
          assert(open.has(cell), 'Unexpected or repeated cell result: ' + cell);
          assert(evidence && Object.keys(evidence).length, 'Missing evidence: ' + cell);
          record(cell, 'passed', evidence);
        });
        assert.equal(open.size, 0, 'Scenario omitted results');
      } catch (error) {
        if (!open.size) throw error;
        for (const cell of open) record(cell, 'failed', { error: String(error.stack ?? error) });
      }
    };
    // Reads have separate recipients. Writes form a barrier so shared resources
    // are never mutated by two scenarios at once.
    const reads = pending.filter(({ scenario }) => scenario.mode === 'read');
    for (let offset = 0; offset < reads.length; offset += parallelReads) {
      await Promise.all(reads.slice(offset, offset + parallelReads).map(execute));
    }
    for (const item of pending.filter(({ scenario }) => scenario.mode === 'write')) await execute(item);
    return summary;
  } finally {
    closeSync(journal);
  }
}
