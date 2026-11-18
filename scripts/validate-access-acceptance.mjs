import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { closeSync, existsSync, fstatSync, lstatSync, openSync, readFileSync, readSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const registry = JSON.parse(readFileSync(resolve(root, 'docs/product/access-control-acceptance-matrix-2026-11-07.json'), 'utf8'));
const markdown = readFileSync(resolve(root, 'docs/product/access-control-acceptance-matrix-2026-11-07.md'), 'utf8');

// Raw artifacts stay outside Git. CI explicitly validates their committed
// identity receipts; it does not claim to have read or re-run those artifacts.
// Local/default mode still requires every original, now with hash and size.
const evidenceMode = process.env.ACCESS_EVIDENCE_MODE ?? 'raw';
assert.ok(['raw', 'receipts'].includes(evidenceMode), 'ACCESS_EVIDENCE_MODE must be raw or receipts');
const receiptManifest = JSON.parse(readFileSync(resolve(root, 'docs/product/access-control-external-evidence-receipts-2026-11-18.json'), 'utf8'));
assert.equal(receiptManifest.schemaVersion, 1);
assert.equal(receiptManifest.kind, 'external-acceptance-evidence-receipts');
assert.equal(receiptManifest.rawContentIncluded, false);
assert.equal(receiptManifest.registrySha256, createHash('sha256').update(readFileSync(resolve(root, 'docs/product/access-control-acceptance-matrix-2026-11-07.json'))).digest('hex'), 'Evidence receipts refer to a different registry');
assert.equal(receiptManifest.provenance?.kind, 'local-snapshot-export');
assert.ok(Number.isFinite(Date.parse(receiptManifest.provenance?.exportedAtUTC)), 'Receipt export time required');
assert.ok(receiptManifest.provenance?.statement?.trim(), 'Receipt provenance and limits required');
assert.equal(receiptManifest.provenance.externalFilesParsed, false);
assert.equal(receiptManifest.provenance.externalFilesCopied, false);
const externalReceipts = new Map();
const repositoryAliases = new Map();
const receiptPaths = new Set();
for (const [records, target] of [[receiptManifest.entries, externalReceipts], [receiptManifest.repositoryAliases, repositoryAliases]]) {
  assert.ok(Array.isArray(records), 'Receipt and alias arrays required');
  for (const record of records) {
    assert.ok(typeof record.id === 'string' && typeof record.sourceFile === 'string' && isAbsolute(record.sourceFile), 'Receipt identity/path required');
    assert.ok(!externalReceipts.has(record.id) && !repositoryAliases.has(record.id) && !receiptPaths.has(record.sourceFile), `Duplicate receipt ${record.id}`);
    assert.match(record.sha256, /^[a-f0-9]{64}$/);
    assert.ok(Number.isSafeInteger(record.sizeBytes) && record.sizeBytes > 0, `Invalid receipt size ${record.id}`);
    target.set(record.id, record); receiptPaths.add(record.sourceFile);
  }
}
const absoluteEvidence = registry.evidence.filter((entry) => isAbsolute(entry.file));
assert.equal(absoluteEvidence.length, externalReceipts.size + repositoryAliases.size, 'Receipt coverage must be exact');
for (const [id, record] of [...externalReceipts, ...repositoryAliases]) {
  assert.ok(absoluteEvidence.some((entry) => entry.id === id && entry.file === record.sourceFile), `Unexpected or mismatched receipt ${id}`);
}
function verifyOriginal(path, receipt) {
  const before = lstatSync(path);
  assert.ok(before.isFile(), `Evidence must be a regular file: ${receipt.id}`);
  const fd = openSync(path, 'r');
  try {
    const opened = fstatSync(fd);
    assert.equal(opened.dev, before.dev); assert.equal(opened.ino, before.ino);
    const hash = createHash('sha256'); const buffer = Buffer.alloc(1024 * 1024); let size = 0; let bytes;
    while ((bytes = readSync(fd, buffer, 0, buffer.length, null)) > 0) { hash.update(buffer.subarray(0, bytes)); size += bytes; }
    const after = fstatSync(fd);
    for (const field of ['dev', 'ino', 'size', 'mtimeMs', 'ctimeMs']) assert.equal(after[field], opened[field], `Evidence changed during hashing: ${receipt.id}`);
    assert.equal(size, receipt.sizeBytes, `Evidence size mismatch: ${receipt.id}`);
    assert.equal(hash.digest('hex'), receipt.sha256, `Evidence SHA-256 mismatch: ${receipt.id}`);
  } finally { closeSync(fd); }
}
let externalRawFilesVerified = 0;
let repositoryAliasFilesVerified = 0;
function verifyEvidenceLocation(entry) {
  const receipt = externalReceipts.get(entry.id);
  const alias = repositoryAliases.get(entry.id);
  if (isAbsolute(entry.file)) {
    assert.ok(Boolean(receipt) !== Boolean(alias), `Missing or ambiguous receipt: ${entry.id}`);
    if (alias) {
      assert.ok(typeof alias.repositoryFile === 'string' && !isAbsolute(alias.repositoryFile), 'Repository alias must be relative');
      const path = resolve(root, alias.repositoryFile);
      const rel = relative(root, path);
      assert.ok(rel && rel !== '..' && !rel.startsWith('..' + sep), 'Repository alias escapes root');
      assert.ok(alias.sourceFile.endsWith('/' + alias.repositoryFile), 'Repository alias source suffix mismatch');
      const real = relative(realpathSync(root), realpathSync(path));
      assert.ok(real && real !== '..' && !real.startsWith('..' + sep) && !isAbsolute(real), 'Repository alias resolves outside root');
      verifyOriginal(path, alias); repositoryAliasFilesVerified += 1;
      if (evidenceMode === 'raw') verifyOriginal(entry.file, alias);
    } else if (evidenceMode === 'raw') {
      verifyOriginal(entry.file, receipt); externalRawFilesVerified += 1;
    }
  } else {
    assert.ok(!receipt && !alias, `Receipt cannot replace repository evidence ${entry.id}`);
    assert.ok(existsSync(resolve(root, entry.file)), `Missing evidence file ${entry.file}`);
  }
}

const markdownRows = markdown.split('\n').filter((line) => line.startsWith('|') && line.includes('<br>`'));
const summaryStart = '<!-- access-criterion-summary:start -->';
const summaryEnd = '<!-- access-criterion-summary:end -->';
assert.equal(markdown.split(summaryStart).length, 2, 'Missing or duplicate criterion summary start');
assert.equal(markdown.split(summaryEnd).length, 2, 'Missing or duplicate criterion summary end');
assert.ok(markdown.indexOf(summaryStart) < markdown.indexOf(summaryEnd), 'Reversed criterion summary');
const criterionRows = markdown.slice(markdown.indexOf(summaryStart), markdown.indexOf(summaryEnd))
  .split('\n').filter((line) => line.startsWith('| `'));
assert.equal(criterionRows.length, registry.rows.length, 'Named criterion summary must cover the whole registry');
const criterionLabels = { verified: 'Подтв.', partial: 'Частично', not_verified: 'Не проверено', not_applicable: 'Н/П' };
const statuses = Object.keys(registry.statusDefinitions);
const counts = Object.fromEntries(statuses.map((status) => [status, 0]));
for (const status of statuses) {
  const renderedCounts = markdown.split('\n').filter((line) => line.startsWith(`| ${status} | `));
  assert.equal(renderedCounts.length, 1, `Missing or duplicate Markdown total for ${status}`);
  assert.equal(renderedCounts[0], `| ${status} | ${registry.counts[status]} |`, `Markdown total disagrees for ${status}`);
}
const renderedCatalog = markdown.split('\n').find((line) => line.startsWith('- Каталог: [access-action-catalog.ts]'));
assert.ok(renderedCatalog?.includes(`SHA-256: \`${registry.snapshot.catalogSha256}\``), 'Markdown catalog snapshot disagrees');
const moduleNames = [...new Set(registry.rows.map((row) => row.moduleName))];
for (const name of moduleNames) {
  const group = registry.rows.filter((row) => row.moduleName === name);
  const rendered = markdown.split('\n').filter((line) => line.startsWith(`| ${name} | `));
  assert.equal(rendered.length, 1, `Missing or duplicate section total for ${name}`);
  const expected = `| ${name} | ${group.length} | ${statuses.map((status) => group.filter((row) => row.status === status).length).join(' | ')} |`;
  assert.equal(rendered[0], expected, `Markdown section total disagrees for ${name}`);
}
const codes = new Set();
const evidence = new Map();
const criterionCounts = { verified: 0, partial: 0, not_verified: 0, not_applicable: 0 };
let rowsWithCriterionReview = 0;
for (const entry of registry.evidence) {
  assert.ok(!evidence.has(entry.id), `Duplicate evidence ${entry.id}`);
  verifyEvidenceLocation(entry);
  assert.ok(entry.observed && entry.limit && entry.run, `Evidence must record result, run and limits: ${entry.id}`);
  evidence.set(entry.id, entry);
}
for (const row of registry.rows) {
  assert.ok(!codes.has(row.code), `Duplicate action ${row.code}`);
  codes.add(row.code);
  assert.ok(statuses.includes(row.status), `Invalid status ${row.code}`);
  counts[row.status] += 1;
  const rendered = markdownRows.filter((line) => line.includes(`<br>\`${row.code}\``));
  assert.equal(rendered.length, 1, `Missing or duplicate named Markdown row ${row.code}`);
  const columns = rendered[0].split(' | ');
  assert.equal(columns[1], row.status, `Markdown status disagrees for ${row.code}`);
  const renderedEvidence = [...columns[4].matchAll(/\[(E\d+)\]/g)].map((match) => match[1]);
  assert.deepEqual(renderedEvidence, row.evidenceIds, `Markdown evidence disagrees for ${row.code}`);
  for (const id of [...row.evidenceIds, ...(row.mechanismEvidenceIds ?? [])]) {
    assert.ok(evidence.has(id), `Missing evidence ${row.code}/${id}`);
    assert.ok(evidence.get(id).codes.includes(row.code), `Unrelated evidence ${row.code}/${id}`);
  }
  // Partial acceptance must be traceable too. A green criterion cannot be
  // inferred from a helper, a test filename, or another action's successful run.
  if (row.acceptanceCriteria) {
    assert.deepEqual(Object.keys(row.acceptanceCriteria).sort(), ['K1', 'K2', 'K3', 'K4', 'K5', 'K6', 'K7'], `Incomplete criterion review ${row.code}`);
    rowsWithCriterionReview += 1;
  }
  const criterionRendered = criterionRows.filter((line) => line.startsWith(`| \`${row.code}\` — `));
  assert.equal(criterionRendered.length, 1, `Missing or duplicate criterion summary ${row.code}`);
  assert.ok(row.acceptanceCriteria, `No criterion review for summary ${row.code}`);
  assert.deepEqual(criterionRendered[0].slice(2, -2).split(' | ').slice(1),
    ['K1', 'K2', 'K3', 'K4', 'K5', 'K6', 'K7'].map((key) => criterionLabels[row.acceptanceCriteria[key].status]),
    `Markdown criterion statuses disagree for ${row.code}`);
  for (const [criterion, result] of Object.entries(row.acceptanceCriteria ?? {})) {
    assert.ok(['K1', 'K2', 'K3', 'K4', 'K5', 'K6', 'K7'].includes(criterion), `Unknown criterion ${row.code}/${criterion}`);
    assert.ok(['verified', 'partial', 'not_verified', 'not_applicable'].includes(result.status), `Invalid criterion status ${row.code}/${criterion}`);
    criterionCounts[result.status] += 1;
    for (const id of result.evidenceIds ?? []) {
      assert.ok(evidence.has(id) && evidence.get(id).codes.includes(row.code), `Unrelated criterion evidence ${row.code}/${criterion}/${id}`);
    }
    if (result.status === 'verified') assert.ok(result.evidenceIds?.length, `No criterion proof ${row.code}/${criterion}`);
    if (result.status === 'not_applicable') assert.ok(result.reason?.trim(), `No criterion N/A reason ${row.code}/${criterion}`);
  }
  if (row.status === 'подтверждено') {
    assert.ok(row.acceptanceCriteria, `No criterion-by-criterion acceptance for ${row.code}`);
    for (const criterion of ['K1', 'K2', 'K3', 'K4', 'K5', 'K6', 'K7']) {
      const result = row.acceptanceCriteria[criterion];
      assert.ok(result && ['verified', 'not_applicable'].includes(result.status), `Open ${row.code}/${criterion}`);
      if (result.status === 'not_applicable') assert.ok(result.reason?.trim(), `No N/A reason ${row.code}/${criterion}`);
      else {
        assert.ok(result.evidenceIds?.length, `No evidence ${row.code}/${criterion}`);
        for (const id of result.evidenceIds) assert.ok(evidence.has(id) && evidence.get(id).codes.includes(row.code), `Invalid criterion evidence ${row.code}/${criterion}/${id}`);
      }
    }
    assert.ok(row.independentReviewEvidenceId && evidence.has(row.independentReviewEvidenceId), `No independent review ${row.code}`);
  }
}
assert.deepEqual(counts, registry.counts, 'Status totals disagree with rows');
assert.equal(registry.rows.length, registry.snapshot.total);
const digest = createHash('sha256').update(readFileSync(resolve(root, registry.snapshot.catalogFile))).digest('hex');
assert.equal(digest, registry.snapshot.catalogSha256, 'Catalog changed: reconcile named acceptance before claiming coverage');
console.log(JSON.stringify({ actions: codes.size, evidence: evidence.size, counts, fullyAccepted: counts['подтверждено'], rowsWithCriterionReview, criterionCounts, catalogSnapshotMatches: true, evidenceValidation: { mode: evidenceMode, externalReceipts: externalReceipts.size, repositoryAliases: repositoryAliases.size, externalRawFilesVerified, repositoryAliasFilesVerified, historicalAcceptanceRerun: false } }));
