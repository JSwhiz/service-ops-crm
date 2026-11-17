const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { randomUUID, createHash } = require('node:crypto');
const { createRequire } = require('node:module');
const backend = process.cwd(), repo = path.resolve(backend, '../..');
const req = createRequire(backend + '/package.json');
const { PrismaClient, Prisma } = req('@prisma/client');
const { createTestApp } = req('./test/helpers/create-test-app.ts');
const { chromium } = req('/tmp/crm-acl-browser/node_modules/playwright-core');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const serial = value => JSON.stringify(value, (_k, v) => typeof v === 'bigint' ? v.toString() : v);
const delay = ms => new Promise(r => setTimeout(r, ms));
const bounded = (promise, ms, label) => { let timer; return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(Error(label)), ms); })]).finally(() => clearTimeout(timer)); };
const targets = ['employees.assignments.delete_as_error'];

test('E491 only native erroneous-assignment postcommit ACK', { timeout: 480000 }, async t => {
  assert.equal(process.env.NATIVE_EMPLOYEE_POSTCOMMIT_EXCLUSIVE_SLOT, 'main-explicit');
  assert.equal(process.env.TEST_ISOLATED_DATABASE, 'true');
  const dbUrl = new URL(process.env.DATABASE_URL);
  assert(['localhost', '127.0.0.1'].includes(dbUrl.hostname));
  assert.match(dbUrl.searchParams.get('schema'), /^integration_\d+_\d+$/);
  const dir = path.dirname(process.env.CLOSEOUT_NATIVE_EMPLOYEE_POSTCOMMIT_OUTPUT);
  fs.mkdirSync(dir, { recursive: true });
  const proof = { status: 'running', reservedEvidenceId: 'E491', authorIsNotReviewer: true, schema: dbUrl.searchParams.get('schema'), cases: [], sourceManifest: [], cleanup: {}, productionTouched: false };
  const save = () => fs.writeFileSync(process.env.CLOSEOUT_NATIVE_EMPLOYEE_POSTCOMMIT_OUTPUT, serial(proof) + '\n');
  const db = new PrismaClient();
  const { app, baseUrl } = await createTestApp();
  const api = baseUrl + '/api/v1', ui = 'http://127.0.0.1:3214';
  let front, browser;
  const frontendRoot = process.env.NATIVE_EMPLOYEE_POSTCOMMIT_FRONTEND_DIR;
  assert(frontendRoot && path.resolve(frontendRoot) === path.resolve(process.env.NATIVE_EMPLOYEE_POSTCOMMIT_ROOT, 'frontend'), 'owned frontend mirror required');
  const frontendLog = [], cacheName = '.next-acl-preview-' + process.pid;
  const configs = ['next-env.d.ts', 'tsconfig.json'].map(n => ({ path: frontendRoot + '/' + n, before: fs.readFileSync(frontendRoot + '/' + n, 'utf8') }));
  fs.writeFileSync(dir + '/config-before.json', serial(configs));
  function freeze(source) {
    if (!fs.existsSync(source) || proof.sourceManifest.some(x => x.source === source)) return;
    const bytes = fs.readFileSync(source), hash = sha(bytes), dest = dir + '/source-freeze/' + hash + '/' + path.basename(source);
    fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.writeFileSync(dest, bytes);
    proof.sourceManifest.push({ source, path: dest, sha256: hash });
  }
  // Freeze every backend module actually loaded by createTestApp, and the full frontend source tree used by this dev server.
  for (const p of Object.keys(require.cache)) if (p.startsWith(backend + '/src/') || p === __filename || p.endsWith('/test/helpers/create-test-app.ts')) freeze(p);
  function walk(p) { for (const e of fs.readdirSync(p, { withFileTypes: true })) { const f = path.join(p, e.name); if (e.isDirectory()) walk(f); else if (/\.(?:tsx?|css)$/.test(f)) freeze(f); } }
  walk(frontendRoot + '/src');
  for (const x of proof.sourceManifest.filter(x => x.source.startsWith(frontendRoot + '/src/'))) { x.originalSource = repo + '/apps/frontend/src/' + path.relative(frontendRoot + '/src', x.source); assert.equal(sha(fs.readFileSync(x.originalSource)), x.sha256, 'mirror equals current source'); }
  freeze(frontendRoot + '/next.config.ts'); freeze(backend + '/test/access-control-native-employee-postcommit-closeout.acceptance.test.ts');
  save();
  t.after(async () => {
    const errors = [];
    try { await browser?.close(); proof.cleanup.browserClosed = true; } catch (e) { errors.push(String(e)); }
    try {
      if (front && front.exitCode === null) {
        // Detached group owns pnpm, Next and its child server, never another runtime.
        process.kill(-front.pid, 'SIGTERM');
        await bounded(new Promise(r => front.once('exit', r)), 10000, 'owned frontend stop timeout');
      }
      proof.cleanup.frontendProcessGroupStopped = true;
    } catch (e) { errors.push(String(e)); }
    fs.writeFileSync(dir + '/frontend.log', frontendLog.join(''));
    proof.cleanup.configRestoration = [];
    for (const c of configs) {
      try {
        const current = fs.readFileSync(c.path, 'utf8');
        if (current === c.before) { proof.cleanup.configRestoration.push({ path: c.path, status: 'unchanged', sha256: sha(current) }); continue; }
        let expectedOwn;
        if (c.path.endsWith('next-env.d.ts')) expectedOwn = current.replaceAll(cacheName, '.next');
        else {
          const parsed = JSON.parse(current), prior = JSON.parse(c.before);
          parsed.include = parsed.include.filter(p => p !== cacheName + '/types/**/*.ts');
          assert.deepEqual(parsed, prior, 'concurrent tsconfig edit: leave file untouched'); expectedOwn = c.before;
        }
        assert.equal(expectedOwn, c.before, 'concurrent next-env edit: leave file untouched');
        assert.equal(fs.readFileSync(c.path, 'utf8'), current, 'config changed during restoration');
        fs.writeFileSync(c.path, c.before);
        proof.cleanup.configRestoration.push({ path: c.path, status: 'own-generated-change-restored', sha256: sha(c.before) });
      } catch (e) { errors.push(String(e)); proof.cleanup.configRestoration.push({ path: c.path, status: 'concurrent-change-preserved', error: String(e) }); }
    }
    try { await app.close(); proof.cleanup.appClosed = true; } catch (e) { errors.push(String(e)); }
    try { await db.$disconnect(); proof.cleanup.dbDisconnected = true; } catch (e) { errors.push(String(e)); }
    proof.cleanup.errors = errors; save();
    fs.writeFileSync(dir + '/helper-cleanup.json', serial(proof.cleanup) + '\n');
    assert.deepEqual(errors, [], 'cleanup errors');
  });
  // Full domain graph, roles and assignments. Auth/session and documented access-admin mutations are recorded separately.
  const excluded = new Set(['User', 'AuthSession', 'UserAccessRule', 'UserAccessAudit', 'UserAccessPreview']);
  async function graph() {
    const result = {};
    for (const model of Prisma.dmmf.datamodel.models) {
      if (excluded.has(model.name)) continue;
      const key = model.name[0].toLowerCase() + model.name.slice(1);
      let rows = await db[key].findMany();
      if (model.name === 'AuditEvent') rows = rows.filter(x => !['user_access', 'user_access_rule'].includes(x.entityType) && !String(x.action).startsWith('user_access'));
      result[model.name] = rows.sort((a, b) => serial(a).localeCompare(serial(b)));
    }
    result.userAbsences = await db.$queryRawUnsafe('SELECT * FROM "user_absences" ORDER BY "id"');
    result.userIdentity = await db.user.findMany({ select: { id: true, login: true, fullName: true, isActive: true, deletedAt: true }, orderBy: { id: 'asc' } });
    return JSON.parse(serial(result));
  }
  async function snapshot(row, phase) {
    const data = await graph(), dest = dir + '/' + row.key + '-' + phase + '-graph.json';
    fs.writeFileSync(dest, serial(data) + '\n'); const r = { path: dest, sha256: sha(fs.readFileSync(dest)) }; row.graphs[phase] = r; save(); return data;
  }
  async function shot(row, page, phase) { const p = dir + '/' + row.key + '-' + phase + '.png'; await page.screenshot({ path: p, fullPage: true }); row.screenshots.push({ phase, path: p }); fs.writeFileSync(dir + '/' + row.key + '-' + phase + '.html', await page.content()); }
  function check(row, label, actual, expected) { row.assertions.push({ label, actual, expected, passed: serial(actual) === serial(expected) }); save(); assert.deepEqual(actual, expected, label); }
  const { PrismaService } = req('./src/modules/prisma/prisma.service.ts');
  const prisma = app.get(PrismaService), originalTransaction = prisma.$transaction.bind(prisma);
  const founder = await db.user.findUniqueOrThrow({ where: { login: 'founder' } }), role = await db.role.findUniqueOrThrow({ where: { code: 'founder' } });
  const a = await db.user.create({ data: { login: 'nepc_' + randomUUID(), fullName: 'E491 native actor', passwordHash: founder.passwordHash, roles: { create: { roleId: role.id } } } });
  const row = { key: 'employee-assignment-postcommit-ack', id: 'employees.assignments.delete_as_error/K7', status: 'running', actorId: a.id, assertions: [], graphs: {}, screenshots: [], events: [], network: [], console: [], fixtures: [], mutationRequests: [], limits: 'Only native postcommit ACK delta, not accepted lifecycle/delete/revoke-first repeats. Historical closed-assignment rows are explicit state fixtures, no lifecycle execution claim.' };
  proof.cases.push(row); save();
  let admin, ctx, page, serverRelease = () => {}, deliveryRelease = () => {}, routePromise;
  async function until(fn, label) { for (let i = 0; i < 120; i++) { if (await fn()) return; await delay(100); } throw Error(label); }
  async function post(endpoint, data) { const r = await ctx.request.post(api + endpoint, { data }), body = await r.json(); row.fixtures.push({ endpoint, request: data, status: r.status(), body }); save(); assert.equal(r.status(), 201); return body; }
  async function dom(phase) {
    row[phase] = await page.locator('body').evaluate(el => ({ text: el.innerText, textContent: el.textContent, fields: [...el.querySelectorAll('input,textarea,select')].map(x => x.value), attributes: [...el.querySelectorAll('*')].flatMap(x => [...x.attributes].filter(a => /^(?:title|aria-label|alt|value)$/.test(a.name)).map(a => a.value)) }));
    await shot(row, page, phase); save(); return row[phase];
  }
  try {
    front = spawn('pnpm', ['exec', 'next', 'dev', '--hostname', '127.0.0.1', '--port', '3214'], { cwd: frontendRoot, detached: true, env: { ...process.env, CRM_PREVIEW_DIST_DIR: cacheName, NEXT_PUBLIC_API_URL: api, NEXT_TELEMETRY_DISABLED: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
    const frontData = b => { frontendLog.push(String(b)); fs.writeFileSync(dir + '/frontend.log', frontendLog.join('')); }; front.stdout.on('data', frontData); front.stderr.on('data', frontData);
    proof.owner = { frontendPid: front.pid, frontendPort: 3214, cacheName, api: baseUrl, redis: process.env.REDIS_URL, bucket: process.env.MINIO_BUCKET }; save();
    await until(async () => { if (front.exitCode !== null) throw Error('owned frontend exited'); try { return (await fetch(ui + '/login')).ok; } catch { return false; } }, 'frontend3214 ready');
    browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
    admin = await browser.newContext(); ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
    await ctx.route('**/*', route => ['localhost', '127.0.0.1'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
    for (const [context, login] of [[admin, founder.login], [ctx, a.login]]) {
      assert.equal((await context.request.post(api + '/auth/login', { data: { login, password: 'founder123' } })).status(), 201);
      assert.equal((await context.request.get(api + '/chats/rooms')).status(), 200);
    }
    const prefix = 'E491_' + randomUUID();
    const A = await post('/employees', { fullName: prefix + '_PRIVATE_A', phone: '+79998764321', employmentStatus: 'active', notes: prefix + '_PRIVATE_NOTES' });
    const B = await post('/employees', { fullName: prefix + '_CONTROL_B', employmentStatus: 'active' });
    const object = await post('/objects', { name: prefix + '_SOURCE_A', address: 'Isolated E491', status: 'active' });
    const start = new Date('2025-01-01T00:00:00Z'), end = new Date('2025-01-31T23:59:59Z');
    const assignment = await db.objectEmployeeAssignment.create({ data: { employeeId: A.id, objectId: object.id, startDate: start, endDate: end, isActive: false } });
    const history = await db.employeeObjectAssignmentHistory.create({ data: { employeeId: A.id, objectId: object.id, startedAt: start, endedAt: end, createdByUserId: a.id, closedByUserId: a.id } });
    row.fixture = { A, B, object, assignment, history, kind: 'Employee/object via real APIs; precise historical closed-assignment DB state fixture reused from Main server proof, no operational records' }; row.reason = prefix + '_ERRONEOUS_REASON'; save();
    page = await ctx.newPage(); page.setDefaultTimeout(20000);
    page.on('pageerror', e => { row.console.push({ type: 'pageerror', message: String(e) }); save(); });
    page.on('console', m => { if (['error', 'warning'].includes(m.type())) { row.console.push({ type: m.type(), message: m.text() }); save(); } });
    page.on('response', r => { if (r.url().startsWith(api)) { row.network.push({ at: new Date().toISOString(), method: r.request().method(), path: new URL(r.url()).pathname, status: r.status() }); save(); } });
    page.on('request', r => { if (r.url().startsWith(api) && r.method() !== 'GET') { row.mutationRequests.push({ method: r.method(), path: new URL(r.url()).pathname, payload: r.postData() }); save(); } });
    await page.goto(ui + '/employees/' + A.id + '?section=assignments', { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: 'Действия: ' + object.name, exact: true }).click();
    await page.getByRole('menuitem', { name: 'Удалить ошибочную запись', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Удалить ошибочное назначение?', exact: true });
    await dialog.getByRole('textbox', { name: 'Причина удаления' }).fill(row.reason);
    await dom('before-native-submit');
    const before = await snapshot(row, 'before-native-submit');
    const postPath = '/api/v1/employees/' + A.id + '/object-assignment-history/' + history.id + '/delete-as-error';
    let commitResolve, responseResolve, deliveredResolve, captured = false;
    const committed = new Promise(r => commitResolve = r), serverGate = new Promise(r => serverRelease = r), responseReady = new Promise(r => responseResolve = r), deliveryGate = new Promise(r => deliveryRelease = r), delivered = new Promise(r => deliveredResolve = r);
    // Exact same real post-transaction barrier as Main: commit first, canonical read revoke before projection.
    prisma.$transaction = async (...args) => {
      const result = await originalTransaction(...args);
      if (!captured && await db.employeeObjectAssignmentHistory.count({ where: { id: history.id } }) === 0 && await db.auditEvent.count({ where: { entityId: A.id, action: 'employee.object_assignment.deleted_as_error' } }) === 1) {
        captured = true; row.commitAt = new Date().toISOString(); row.committedGraph = await snapshot(row, 'real-postcommit-before-read-deny'); save(); commitResolve(); await serverGate;
      }
      return result;
    };
    await page.route('**/api/v1/**', route => {
      if (route.request().method() !== 'POST' || new URL(route.request().url()).pathname !== postPath) return route.continue();
      routePromise = (async () => {
        const response = await route.fetch(); row.held = { status: response.status(), body: await response.json(), at: new Date().toISOString() }; save(); responseResolve(); await deliveryGate;
        try { await route.fulfill({ response }); row.delivery = 'fulfilled'; } catch (e) { row.delivery = 'cancelled'; row.deliveryError = String(e); }
        save(); deliveredResolve();
      })(); return routePromise;
    });
    await dialog.getByRole('button', { name: 'Удалить запись', exact: true }).click();
    await bounded(committed, 20000, 'real native postcommit barrier absent');
    check(row, 'exact history deleted by committed native command', row.committedGraph.EmployeeObjectAssignmentHistory.some(x => x.id === history.id), false);
    check(row, 'exact closed assignment deleted by committed native command', row.committedGraph.ObjectEmployeeAssignment.some(x => x.id === assignment.id), false);
    const newAudits = row.committedGraph.AuditEvent.filter(x => !before.AuditEvent.some(y => y.id === x.id));
    check(row, 'exactly one committed A deletion audit', newAudits.map(x => [x.entityType, x.entityId, x.actorUserId, x.action]), [['employee', A.id, a.id, 'employee.object_assignment.deleted_as_error']]);
    for (const model of Object.keys(before)) {
      const removed = model === 'EmployeeObjectAssignmentHistory' ? [history.id] : model === 'ObjectEmployeeAssignment' ? [assignment.id] : [];
      const additions = model === 'AuditEvent' ? newAudits.map(x => x.id) : [];
      check(row, 'native commit changes only intended rows ' + model, row.committedGraph[model].filter(x => !additions.includes(x.id)), before[model].filter(x => !removed.includes(x.id)));
    }
    const version = (await db.user.findUniqueOrThrow({ where: { id: a.id } })).accessVersion;
    const request = { expectedVersion: version, reason: 'E491 only postcommit native read revoke', changes: [{ actionCode: 'employees.view', effect: 'deny', scope: 'selected', selectedIds: [A.id] }] };
    const endpoint = api + '/users-access/admin/users/' + a.id;
    const pr = await admin.request.post(endpoint + '/preview', { data: request }), pv = await pr.json(); assert.equal(pr.status(), 201);
    const sr = await admin.request.post(endpoint + '/save', { data: { ...request, previewToken: pv.previewToken, previewHash: pv.previewHash } }); row.deny = { status: sr.status(), body: await sr.json() }; save(); assert.equal(sr.status(), 201);
    const freshProfile = page.waitForResponse(async r => r.url() === api + '/auth/me' && r.status() === 200 && (await r.json()).accessVersion > version);
    const nativeDenied = page.waitForResponse(r => new URL(r.url()).pathname === '/api/v1/employees/' + A.id && r.request().method() === 'GET' && r.status() === 403);
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    row.freshProfile = await (await freshProfile).json(); await nativeDenied;
    await page.getByText('Карточка сотрудника недоступна.', { exact: true }).waitFor();
    await dom('fresh-profile-denied-before-ack');
    check(row, 'fresh profile advanced while actual command held postcommit', row.freshProfile.accessVersion > version, true);
    serverRelease(); await bounded(responseReady, 15000, 'actual native ACK response absent');
    check(row, 'actual postcommit response201', row.held.status, 201);
    check(row, 'actual response is minimal saved acknowledgement, no Employee DTO', row.held.body, { outcome: 'saved_without_access' });
    deliveryRelease(); await bounded(delivered, 10000, 'ACK delivery absent'); check(row, 'actual ACK delivered', row.delivery, 'fulfilled');
    const success = 'Назначение удалено. Доступ к карточке изменился, поэтому она закрыта. Повторять действие не нужно.';
    await page.getByRole('status').filter({ hasText: success }).waitFor();
    const terminal = await dom('postcommit-ack-terminal-before-control');
    check(row, 'native generic saved-and-closed success visible', terminal.text.includes(success), true);
    for (const marker of [A.fullName, '+79998764321', prefix + '_PRIVATE_NOTES', object.name, row.reason]) check(row, 'no private A source/draft data in terminal DOM ' + marker, serial(terminal).includes(marker), false);
    check(row, 'no active deletion dialog after ACK', await page.getByRole('dialog').count(), 0);
    const after = await snapshot(row, 'after-ack'); check(row, 'ACK+read revoke caused no further domain writes', after, row.committedGraph);
    const bp = await ctx.newPage(); await bp.goto(ui + '/employees/' + B.id, { waitUntil: 'networkidle' });
    check(row, 'unaffected native B readable', await bp.getByRole('heading', { name: B.fullName, exact: true }).isVisible(), true); await shot(row, bp, 'B-native-control');
    const br = await ctx.request.get(api + '/employees/' + B.id); row.B = { status: br.status(), body: await br.json() }; check(row, 'actual B read200', br.status(), 200);
    check(row, 'B control leaves exact committed graph unchanged', await snapshot(row, 'after-B-control'), row.committedGraph);
    check(row, 'one native command only, no automatic replay', row.mutationRequests.filter(x => !x.path.startsWith('/api/v1/auth/')).map(x => [x.method, x.path, JSON.parse(x.payload)]), [['POST', postPath, { reason: row.reason }]]);
    await bp.close(); row.status = 'passed'; proof.status = 'passed'; save();
  } catch (error) {
    row.status = 'failed'; row.error = String(error.stack || error); proof.status = 'failed'; save();
    if (page && !page.isClosed()) try { await dom('failure-before-new-query'); } catch {}
    try { await snapshot(row, 'failure'); } catch {}
    throw error;
  } finally {
    serverRelease(); deliveryRelease(); if (routePromise) await Promise.allSettled([routePromise]);
    prisma.$transaction = originalTransaction; proof.cleanup.transactionBarrierRestored = true;
    await ctx?.close(); await admin?.close(); save();
  }
});
