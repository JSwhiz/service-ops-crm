import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

// Run through run-with-env; never print connection credentials.
const database = new URL(process.env.DATABASE_URL ?? '');
if (!['127.0.0.1', 'localhost', '[::1]'].includes(database.hostname) || database.port !== '55432') {
  throw new Error('Access acceptance requires the local CRM PostgreSQL on port 55432');
}
const args = process.argv.slice(2);
const keepGoing = args[0] === '--keep-going';
const files = keepGoing ? args.slice(1) : args;
if (files.length === 0 || files.some((file) => !/^test\/access-control-[a-z-]+\.integration\.test\.ts$/.test(file) || !existsSync(resolve(file)))) {
  throw new Error('Pass explicit existing access-control integration files; no implicit broad suite');
}
async function run(args, env = process.env) {
  return new Promise((done, reject) => {
    const child = spawn(process.execPath, args, { stdio: 'inherit', env });
    child.once('error', reject);
    child.once('exit', (code, signal) => done(code ?? (signal ? 1 : 0)));
  });
}
// Type-check once, including test fixtures (the ordinary backend config excludes
// them). Only then avoid repeating that expensive compiler in each isolated app.
const checked = await run(['node_modules/typescript/bin/tsc', '-p', 'tsconfig.access-tests.json']);
if (checked !== 0) process.exitCode = checked;
else {
  console.log(`Local access acceptance: ${files.length} files, sequential isolated schemas; shared schema is not a test target. Access test typecheck passed.`);
  const env = { ...process.env, TS_NODE_TRANSPILE_ONLY: 'true' };
  if (!keepGoing) process.exitCode = await run(['scripts/run-integration-tests.mjs', ...files], env);
  else {
    // Independent modules use separate runner processes/schemas. A failure in
    // one must remain a failure, but must not hide the outcomes of the others.
    // No retries and no concurrent heavy tests are introduced.
    const outcomes = [];
    for (const file of files) {
      const code = await run(['scripts/run-integration-tests.mjs', file], env);
      outcomes.push({ file, exitCode: code });
    }
    console.log('ACCESS_ACCEPTANCE_OUTCOMES=' + JSON.stringify(outcomes));
    process.exitCode = outcomes.some(({ exitCode }) => exitCode !== 0) ? 1 : 0;
  }
}
