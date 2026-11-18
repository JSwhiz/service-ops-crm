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
const targets = ['candidates.access', 'candidates.view'];

test('candidate postfix only: exact native held reply after fresh deny profile', { timeout: 720000 }, async t => {
  assert.equal(process.env.TEST_ISOLATED_DATABASE, 'true');
  const dbUrl = new URL(process.env.DATABASE_URL);
  assert(['localhost', '127.0.0.1'].includes(dbUrl.hostname));
  assert.match(dbUrl.searchParams.get('schema'), /^integration_\d+_\d+$/);
  const dir = path.dirname(process.env.CLOSEOUT_NATIVE_READ_OUTPUT);
  fs.mkdirSync(dir, { recursive: true });
  const proof = { status: 'running', reservedEvidenceId: 'E481', authorIsNotReviewer: true, schema: dbUrl.searchParams.get('schema'), cases: [], sourceManifest: [], cleanup: {}, productionTouched: false, postfixBeforeProof: { path: process.env.NATIVE_READ_BEFORE_PROOF, sha256: sha(fs.readFileSync(process.env.NATIVE_READ_BEFORE_PROOF)) }, preparedFixedSourceSha256: process.env.NATIVE_READ_FIXED_SOURCE_SHA256 };
  const save = () => fs.writeFileSync(process.env.CLOSEOUT_NATIVE_READ_OUTPUT, serial(proof) + '\n');
  const db = new PrismaClient();
  const { app, baseUrl } = await createTestApp();
  const api = baseUrl + '/api/v1', ui = 'http://127.0.0.1:3214';
  let front, browser;
  const frontendRoot = process.env.NATIVE_READ_FRONTEND_DIR;
  assert(frontendRoot && path.resolve(frontendRoot) === path.resolve(process.env.NATIVE_READ_ROOT, 'frontend'), 'owned frontend mirror required');
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
  freeze(frontendRoot + '/next.config.ts'); freeze(backend + '/test/access-control-native-read-closeout.acceptance.test.ts');
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
  const founder = await db.user.findUniqueOrThrow({ where: { login: 'founder' } });
  const role = await db.role.findUniqueOrThrow({ where: { code: 'founder' } });
  async function actor(label) { return db.user.create({ data: { login: 'nr_' + label + '_' + randomUUID(), fullName: 'Native reader ' + label, passwordHash: founder.passwordHash, roles: { create: { roleId: role.id } } } }); }
  async function object(name) { return db.object.create({ data: { name, address: 'Native read isolated source', status: 'active', createdByUserId: founder.id } }); }
  const year = 2026, month = 11;
  async function fixture(code, a) {
    const prefix = 'NR_' + code.replaceAll('.', '_') + '_' + randomUUID(), markerA = prefix + '_PRIVATE_A', markerB = prefix + '_CONTROL_B';
    let A, B, revokeId, open, control, match, selector = 'body', expectedFresh = true;
    if (code.startsWith('timesheet.')) {
      A = await object(prefix + '_OBJECT_A'); B = await object(prefix + '_OBJECT_B'); revokeId = A.id;
      for (const [o, m] of [[A, markerA], [B, markerB]]) {
        const e = await db.employee.create({ data: { fullName: m, employmentStatus: 'active' } });
        await db.timesheetMonth.create({ data: { objectId: o.id, year, month, createdByUserId: founder.id, rows: { create: { employeeId: e.id, employeeNameSnapshot: m, entries: { create: { dayOfMonth: 10, dayValue: 37219, autoValue: 37000, manualValue: 37219, difference: 219, comment: m + '_CORRECTION', isChangedManually: true, createdByUserId: founder.id, updatedByUserId: founder.id } } } } } });
      }
      open = '/timesheet?year=2026&month=11&objectId=' + A.id;
      control = '/timesheet?year=2026&month=11&objectId=' + B.id;
      if (code === 'timesheet.read') { match = u => u.pathname === '/api/v1/timesheets' && u.searchParams.get('objectId') === A.id; selector = '.timesheet-object-detail'; }
      if (code === 'timesheet.overview') { match = u => u.pathname === '/api/v1/timesheets/overview' && u.searchParams.get('objectId') === A.id; selector = 'table'; }
      if (code === 'timesheet.corrections.read') { match = u => u.pathname === '/api/v1/timesheets/corrections' && u.searchParams.get('objectId') === A.id; selector = '[aria-label="Ручные корректировки табеля"]'; }
      // read marker must be unique to the restricted consumer, not an independently permitted overview row.
      if (code === 'timesheet.read') { selector = '[aria-label="Сводка выбранного объекта"]'; return { A, B, revokeId, open, control, match, selector, markerA: A.name, markerB: B.name, expectedFresh }; }
    } else if (code.startsWith('approvals.')) {
      const oa = await object(prefix + '_SOURCE_A'), ob = await object(prefix + '_SOURCE_B');
      for (const [o, m, side] of [[oa, markerA, 'A'], [ob, markerB, 'B']]) {
        const item = await db.approvalRequest.create({ data: { approvalType: 'object_change_confirmation', sourceEntityType: 'object', sourceEntityId: o.id, createdByUserId: founder.id, payloadSnapshot: { objectId: o.id, objectName: o.name, currentStatus: 'active', requestedStatus: 'frozen', summaryTitle: m, summarySubtitle: m + '_SNAPSHOT' } } });
        if (side === 'A') A = item; else B = item;
      }
      revokeId = A.id; open = '/approvals?sourceEntityId=' + oa.id + '&sourceEntityType=object'; control = '/approvals?sourceEntityId=' + ob.id + '&sourceEntityType=object';
      match = u => u.pathname === '/api/v1/approvals' && u.searchParams.get('sourceEntityId') === oa.id;
    } else if (code.startsWith('candidates.')) {
      A = await db.candidate.create({ data: { fullName: markerA, phone: '+79991230001', candidateType: 'regular', createdByUserId: founder.id, comment: markerA + '_COMMENT' } });
      B = await db.candidate.create({ data: { fullName: markerB, phone: '+79991230002', candidateType: 'regular', createdByUserId: founder.id } });
      revokeId = A.id; open = '/candidates?q=' + encodeURIComponent(prefix); control = open;
      match = u => u.pathname === '/api/v1/candidates' && u.searchParams.get('q') === prefix;
      expectedFresh = false; // Registry may use the shared fetcher generation boundary without issuing a second list.
    } else if (code === 'employees.view') {
      A = await db.employee.create({ data: { fullName: markerA, employmentStatus: 'active', notes: markerA + '_NOTES' } });
      B = await db.employee.create({ data: { fullName: markerB, employmentStatus: 'active' } });
      revokeId = A.id; open = '/employees/' + A.id; control = '/employees/' + B.id;
      match = u => u.pathname === '/api/v1/employees/' + A.id;
    } else if (code.startsWith('user_substitutions.')) {
      const oa = await object(prefix + '_OBJECT_A'), ob = await object(prefix + '_OBJECT_B'), replacement = await actor('replacement');
      A = await db.userSubstitution.create({ data: { principalUserId: a.id, replacementUserId: replacement.id, createdByUserId: a.id, startsAt: new Date(Date.now() - 1000), endsAt: new Date(Date.now() + 86400000), reason: markerA, objects: { create: { objectId: oa.id } } } });
      B = await db.userSubstitution.create({ data: { principalUserId: a.id, replacementUserId: replacement.id, createdByUserId: a.id, startsAt: new Date(Date.now() - 1000), endsAt: new Date(Date.now() + 86400000), reason: markerB, objects: { create: { objectId: ob.id } } } });
      revokeId = oa.id; open = '/user-substitutions'; control = open;
      match = u => u.pathname === '/api/v1/user-substitutions';
    } else if (code === 'user_absences.view_private_reasons') {
      A = await actor('absenceA'); B = a; revokeId = A.id;
      for (const [u, m] of [[A, markerA], [B, markerB]]) {
        await db.$executeRaw`INSERT INTO "user_absences" ("id","userId","absenceType","startDate","endDate","comment","createdByUserId","createdAt","updatedAt") VALUES (${randomUUID()},${u.id},'vacation','2026-11-18'::date,'2026-11-19'::date,${m},${founder.id},NOW(),NOW())`;
      }
      open = '/user-absences?month=2026-11'; control = open; match = u => u.pathname === '/api/v1/user-absences';
    }
    return { A, B, revokeId, open, control, match, selector, markerA, markerB, expectedFresh };
  }
  try {
    front = spawn('pnpm', ['exec', 'next', 'dev', '--hostname', '127.0.0.1', '--port', '3214'], { cwd: frontendRoot, detached: true, env: { ...process.env, CRM_PREVIEW_DIST_DIR: cacheName, NEXT_PUBLIC_API_URL: api, NEXT_TELEMETRY_DISABLED: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
    const frontData = b => { frontendLog.push(String(b)); fs.writeFileSync(dir + '/frontend.log', frontendLog.join('')); }; front.stdout.on('data', frontData); front.stderr.on('data', frontData);
    proof.owner = { frontendPid: front.pid, cacheName, frontendPort: 3214, api: baseUrl, redis: process.env.REDIS_URL, bucket: process.env.MINIO_BUCKET }; save();
    let ready = false;
    for (let i = 0; i < 120; i++) { if (front.exitCode !== null) throw Error('owned frontend exited: ' + frontendLog.join('')); try { if ((await fetch(ui + '/login')).ok) { ready = true; break; } } catch {} await delay(500); }
    assert(ready, 'owned frontend3214 ready');
    browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
    const admin = await browser.newContext();
    assert.equal((await admin.request.post(api + '/auth/login', { data: { login: founder.login, password: 'founder123' } })).status(), 201);
    const controlOnlyCodes = (process.env.NATIVE_READ_CONTROL_ONLY || '').split(',');
    const requested = process.env.NATIVE_READ_CODES ? process.env.NATIVE_READ_CODES.split(',') : targets;
    for (const code of requested) {
      assert(targets.includes(code));
      const a = await actor(code.replaceAll('.', '_')), f = await fixture(code, a), key = code.replaceAll('.', '-');
      const controlOnly = controlOnlyCodes.includes(code);
      const row = { id: code + '/K5', code, key, mode: controlOnly ? 'missing-B-native-control-only' : 'missing-full-native-phase', status: 'running', actorId: a.id, A: f.A.id, B: f.B.id, revokeResourceId: f.revokeId, markers: { A: f.markerA, B: f.markerB }, consumer: { page: f.open, endpoint: null, selector: f.selector }, assertions: [], network: [], console: [], screenshots: [], graphs: {}, events: [] };
      proof.cases.push(row); save();
      const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
      await ctx.route('**/*', route => ['localhost', '127.0.0.1'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
      let release = () => {}, page;
      try {
        assert.equal((await ctx.request.post(api + '/auth/login', { data: { login: a.login, password: 'founder123' } })).status(), 201);
        page = await ctx.newPage(); page.setDefaultTimeout(20000);
        page.on('pageerror', e => row.console.push({ type: 'pageerror', message: String(e) }));
        page.on('console', m => { if (['error', 'warning'].includes(m.type())) row.console.push({ type: m.type(), message: m.text() }); });
        page.on('response', r => { if (r.url().startsWith(api)) row.network.push({ at: new Date().toISOString(), method: r.request().method(), path: new URL(r.url()).pathname + new URL(r.url()).search, status: r.status() }); });
        // Establish the real shell's default membership before this source read's no-effect baseline.
        row.shellBootstrap = { route: 'GET /chats/rooms', status: (await ctx.request.get(api + '/chats/rooms')).status() };
        if (code === 'user_absences.view_private_reasons') {
          const v = (await db.user.findUniqueOrThrow({ where: { id: a.id } })).accessVersion;
          const data = { expectedVersion: v, reason: 'Initial legitimate private-reasons read fixture', changes: [{ actionCode: code, effect: 'allow', scope: 'selected', selectedIds: [f.A.id, f.B.id] }] };
          const endpoint = api + '/users-access/admin/users/' + a.id;
          const pr = await admin.request.post(endpoint + '/preview', { data }), pv = await pr.json(); assert.equal(pr.status(), 201);
          const sr = await admin.request.post(endpoint + '/save', { data: { ...data, previewToken: pv.previewToken, previewHash: pv.previewHash } });
          row.initialAllow = { status: sr.status(), body: await sr.json() }; save(); assert.equal(sr.status(), 201);
        }
        const before = await snapshot(row, 'before-initial-read');
        if (controlOnly) {
          const original = JSON.parse(fs.readFileSync(process.env.NATIVE_READ_ORIGINAL_PROOF, 'utf8'));
          const originalIndex = original.cases.findIndex(c => c.code === code);
          assert(originalIndex >= 0, 'exact reused code binding');
          row.reusesOriginalLatePhase = { path: process.env.NATIVE_READ_ORIGINAL_PROOF, sha256: sha(fs.readFileSync(process.env.NATIVE_READ_ORIGINAL_PROOF)), pointer: '/cases/' + originalIndex, binding: 'New independent B fixture, same exact leaf, same founder capability rendering class and selected-deny A. Original held phase is reused without replay; source identity differs and is explicit.' };
          const v = (await db.user.findUniqueOrThrow({ where: { id: a.id } })).accessVersion;
          const data = { expectedVersion: v, reason: 'Only missing independent B native control', changes: [{ actionCode: code, effect: 'deny', scope: 'selected', selectedIds: [f.revokeId] }] };
          const endpoint = api + '/users-access/admin/users/' + a.id;
          const pr = await admin.request.post(endpoint + '/preview', { data }), pv = await pr.json(); assert.equal(pr.status(), 201);
          const sr = await admin.request.post(endpoint + '/save', { data: { ...data, previewToken: pv.previewToken, previewHash: pv.previewHash } });
          row.deny = { status: sr.status(), body: await sr.json() }; save(); assert.equal(sr.status(), 201);
          await page.goto(ui + f.control, { waitUntil: 'networkidle' });
          await page.locator(f.selector).filter({ hasText: f.markerB }).first().waitFor();
          row.bodyAfter = await page.locator('body').innerText();
          row.controlVisibleText = (await page.locator(f.selector).allInnerTexts()).join('\n');
          row.profile = await (await ctx.request.get(api + '/auth/me')).json();
          check(row, 'independent B native consumer visible under selected A deny', row.controlVisibleText.includes(f.markerB), true);
          await shot(row, page, 'control-B');
          const final = await snapshot(row, 'after-control');
          row.changedModels = Object.keys(before).filter(k => serial(before[k]) !== serial(final[k]));
          check(row, 'B native read leaves complete domain/role/membership graph unchanged', serial(before) === serial(final), true);
          row.status = 'passed'; save(); continue;
        }
        await page.goto(ui + f.open, { waitUntil: 'networkidle' });
        await page.locator(f.selector).filter({ hasText: f.markerA }).first().waitFor();
        check(row, 'private A marker rendered in actual consumer', (await page.locator(f.selector).allInnerTexts()).join('\n').includes(f.markerA), true);
        await shot(row, page, 'before'); save();
        let reached, delivered, used = false;
        const heldReady = new Promise(r => reached = r), gate = new Promise(r => release = r), delivery = new Promise(r => delivered = r);
        await page.route('**/api/v1/**', async route => {
          const u = new URL(route.request().url());
          if (used || route.request().method() !== 'GET' || !f.match(u)) return route.continue();
          used = true;
          const response = await route.fetch();
          row.consumer.endpoint = u.pathname + u.search;
          row.held = { status: response.status(), body: await response.json() };
          row.events.push({ phase: 'authorized-response-held', at: new Date().toISOString() }); save(); reached();
          await gate;
          try { await route.fulfill({ response }); delivered('fulfilled'); } catch (e) { row.deliveryError = String(e); delivered('cancelled'); }
        });
        await page.reload({ waitUntil: 'domcontentloaded' });
        await bounded(heldReady, 25000, code + ': native held response absent');
        check(row, 'held response authorized', row.held.status, 200);
        check(row, 'held DTO contains private marker', serial(row.held.body).includes(f.markerA), true);
        const version = (await db.user.findUniqueOrThrow({ where: { id: a.id } })).accessVersion;
        const request = { expectedVersion: version, reason: 'Native read exact held response closeout', changes: [{ actionCode: code, effect: 'deny', scope: 'selected', selectedIds: [f.revokeId] }] };
        const route = api + '/users-access/admin/users/' + a.id;
        const previewResponse = await admin.request.post(route + '/preview', { data: request });
        const preview = await previewResponse.json(); row.preview = { status: previewResponse.status(), body: preview }; save();
        assert.equal(previewResponse.status(), 201, 'personal deny preview');
        const saved = await admin.request.post(route + '/save', { data: { ...request, previewToken: preview.previewToken, previewHash: preview.previewHash } });
        row.deny = { status: saved.status(), body: await saved.json(), oldVersion: version }; save(); assert.equal(saved.status(), 201, 'personal deny committed');
        let fresh = null;
        const freshAuthorizedList = page.waitForResponse(async response => {
          if (!f.match(new URL(response.url())) || response.request().method() !== 'GET' || response.status() !== 200) return false;
          try { const body = serial(await response.json()); return !body.includes(f.markerA) && body.includes(f.markerB); } catch { return false; }
        }, { timeout: 20000 });
        page.on('response', async response => {
          if (f.match(new URL(response.url())) && response.request().method() === 'GET' && row.freshProfileVersion !== undefined) {
            try { fresh = { status: response.status(), body: await response.json(), at: new Date().toISOString() }; } catch {}
          }
        });
        const profile = page.waitForResponse(async r => r.url().startsWith(api + '/auth/me') && r.status() === 200 && (await r.json()).accessVersion > version, { timeout: 20000 });
        await page.evaluate(() => window.dispatchEvent(new Event('focus')));
        const updated = await profile; row.profile = await updated.json(); row.freshProfileVersion = row.profile.accessVersion;
        row.events.push({ phase: 'fresh-profile-after-committed-deny', accessVersion: row.freshProfileVersion, at: new Date().toISOString() }); save();
        const freshListResponse = await freshAuthorizedList;
        row.freshNativeListBeforeDelivery = { status: freshListResponse.status(), body: await freshListResponse.json() };
        check(row, 'fresh native list excludes A before old reply delivery', serial(row.freshNativeListBeforeDelivery.body).includes(f.markerA), false);
        check(row, 'fresh native list includes B before old reply delivery', serial(row.freshNativeListBeforeDelivery.body).includes(f.markerB), true);
        await page.waitForFunction(({a,b}) => !document.body.innerText.includes(a) && document.body.innerText.includes(b), {a:f.markerA,b:f.markerB});
        row.events.push({ phase: 'new-revision-list-DOM-A-absent-B-visible-before-release', at: new Date().toISOString() });
        release(); row.delivery = await bounded(delivery, 10000, 'old reply delivery');
        row.events.push({ phase: 'old-reply-delivered', delivery: row.delivery, at: new Date().toISOString() });
        await delay(800);
        row.afterVisibleText = (await page.locator(f.selector).allInnerTexts()).join('\n');
        row.bodyAfter = await page.locator('body').innerText();
        row.freshConsumer = fresh;
        row.afterFullHTML = await page.content();
        await shot(row, page, 'after-held-delivery');
        // Capture terminal evidence before any navigation or control request can mask a defect.
        const after = await snapshot(row, 'after-held-delivery');
        const same = serial(before) === serial(after); row.changedModels = Object.keys(before).filter(k => serial(before[k]) !== serial(after[k]));
        check(row, 'read + grant administration preserves domain/role graph', same, true);
        const markerAbsent = !row.afterVisibleText.includes(f.markerA);
        row.markerAbsent = markerAbsent; save();
        check(row, 'old private marker absent after fresh profile and late reply', markerAbsent, true);
        check(row, 'private A absent from entire DOM including attributes after late reply', row.afterFullHTML.includes(f.markerA), false);
        check(row, 'B stays visible in same native list after late reply', row.bodyAfter.includes(f.markerB), true);
        const ar = await ctx.request.get(api + '/candidates/' + f.A.id), br = await ctx.request.get(api + '/candidates/' + f.B.id);
        row.freshAPI = { A: { path: '/candidates/' + f.A.id, status: ar.status(), body: await ar.json() }, B: { path: '/candidates/' + f.B.id, status: br.status(), body: await br.json() } };
        check(row, 'fresh exact A detail API after deny', row.freshAPI.A.status, 404);
        check(row, 'fresh exact B detail API under same selected deny', row.freshAPI.B.status, 200);
        check(row, 'fresh exact B detail identity', row.freshAPI.B.body.id, f.B.id);
        row.browserDomainWrites = row.network.filter(x => !['GET','HEAD','OPTIONS'].includes(x.method) && !x.path.startsWith('/api/v1/auth/'));
        check(row, 'native list and access refresh do not submit a domain mutation', row.browserDomainWrites, []);
        await page.goto(ui + f.control, { waitUntil: 'networkidle' });
        await page.locator(f.selector).filter({ hasText: f.markerB }).first().waitFor();
        check(row, 'independent B native consumer remains visible', (await page.locator(f.selector).allInnerTexts()).join('\n').includes(f.markerB), true);
        await shot(row, page, 'control-B');
        const final = await snapshot(row, 'after-control');
        check(row, 'control read produces no domain/role writes', serial(before) === serial(final), true);
        row.status = 'passed';
      } catch (error) {
        row.status = row.held?.status === 200 && row.freshProfileVersion !== undefined && row.markerAbsent === false ? 'product_defect' : 'failed';
        row.error = String(error.stack || error);
        if (page && !page.isClosed()) { try { await shot(row, page, 'failure'); row.failureBody = await page.locator('body').innerText(); } catch {} }
        try { await snapshot(row, 'failure'); } catch {}
      } finally { release(); save(); await ctx.close(); }
      if (process.env.NATIVE_READ_STOP_ON_FAILURE === '1' && row.status !== 'passed') break;
    }
    await admin.close();
    proof.status = proof.cases.every(c => c.status === 'passed') ? 'passed' : 'completed_with_open_cases';
    proof.counts = Object.fromEntries(['passed', 'product_defect', 'failed'].map(s => [s, proof.cases.filter(c => c.status === s).length]));
    save();
    // Each case persists even when another fails. No whole acceptance assertion is made here.
    assert.equal(proof.cases.length, requested.length);
    assert.equal(proof.status, 'passed', 'both explicit candidate postfix cases must pass');
  } catch (error) { proof.status = 'failed'; proof.error = String(error.stack || error); save(); throw error; }
});
