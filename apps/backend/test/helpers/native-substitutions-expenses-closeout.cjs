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
const targets = ['user_substitutions.manage'];

test('E498 only failed manage create-for-other selected-scope postfix', { timeout: 600000 }, async t => {
  assert.equal(process.env.NATIVE_SUBSTITUTIONS_EXPENSES_EXCLUSIVE_SLOT, 'main-explicit');
  assert.equal(process.env.TEST_ISOLATED_DATABASE, 'true');
  const dbUrl = new URL(process.env.DATABASE_URL);
  assert(['localhost', '127.0.0.1'].includes(dbUrl.hostname));
  assert.match(dbUrl.searchParams.get('schema'), /^integration_\d+_\d+$/);
  const dir = path.dirname(process.env.CLOSEOUT_NATIVE_SUBSTITUTIONS_EXPENSES_OUTPUT);
  fs.mkdirSync(dir, { recursive: true });
  const proof = { status: 'running', reservedEvidenceId: 'E498', packet: 'manage-only-postfix' , authorIsNotReviewer: true, schema: dbUrl.searchParams.get('schema'), cases: [], sourceManifest: [], cleanup: {}, productionTouched: false };
  const save = () => fs.writeFileSync(process.env.CLOSEOUT_NATIVE_SUBSTITUTIONS_EXPENSES_OUTPUT, serial(proof) + '\n');
  const db = new PrismaClient();
  const { app, baseUrl } = await createTestApp();
  const api = baseUrl + '/api/v1', ui = 'http://127.0.0.1:3214';
  let front, browser;
  const frontendRoot = process.env.NATIVE_SUBSTITUTIONS_EXPENSES_FRONTEND_DIR;
  assert(frontendRoot && path.resolve(frontendRoot) === path.resolve(process.env.NATIVE_SUBSTITUTIONS_EXPENSES_ROOT, 'frontend'), 'owned frontend mirror required');
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
  freeze(frontendRoot + '/next.config.ts'); freeze(backend + '/test/access-control-native-substitutions-expenses-closeout.acceptance.test.ts');
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
  async function actor(label, roleCode = 'founder') { const role = await db.role.findUniqueOrThrow({ where: { code: roleCode } }); return db.user.create({ data: { login: 'nse_' + randomUUID(), fullName: label + '_' + randomUUID(), passwordHash: founder.passwordHash, roles: { create: { roleId: role.id } } } }); }
  async function until(fn, label) { for (let i = 0; i < 150; i++) { if (await fn()) return; await delay(100); } throw Error(label); }
  let admin;
  async function context(a) { const c = await browser.newContext({ viewport: { width: 1366, height: 900 } }); await c.route('**/*', r => ['localhost', '127.0.0.1'].includes(new URL(r.request().url()).hostname) ? r.continue() : r.abort()); assert.equal((await c.request.post(api + '/auth/login', { data: { login: a.login, password: 'founder123' } })).status(), 201); assert.equal((await c.request.get(api + '/chats/rooms')).status(), 200); return c; }
  async function post(row, c, endpoint, data) { const r = await c.request.post(api + endpoint, { data }), body = await r.json(); row.fixtures.push({ endpoint, request: data, status: r.status(), body }); save(); assert.equal(r.status(), 201, 'actual fixture ' + endpoint); return body; }
  async function rule(row, code, effect, ids, all = false) {
    const prior = (await db.user.findUniqueOrThrow({ where: { id: row.actorId } })).accessVersion;
    const request = { expectedVersion: prior, reason: 'Only exact native substitution/expense criterion ' + effect, changes: [{ actionCode: code, effect, scope: effect === 'default' || all ? 'all' : 'selected', selectedIds: effect === 'default' || all ? [] : ids }] };
    const endpoint = api + '/users-access/admin/users/' + row.actorId;
    const p = await admin.request.post(endpoint + '/preview', { data: request }), preview = await p.json(); row.events.push({ phase: 'preview', request, status: p.status(), body: preview }); save(); assert.equal(p.status(), 201);
    const r = await admin.request.post(endpoint + '/save', { data: { ...request, previewToken: preview.previewToken, previewHash: preview.previewHash } }); row.events.push({ phase: 'save', status: r.status(), body: await r.json() }); save(); assert.equal(r.status(), 201); return prior;
  }
  async function refresh(row, page, prior, phase) { const promise = page.waitForResponse(async r => r.url() === api + '/auth/me' && r.status() === 200 && (await r.json()).accessVersion > prior); await page.evaluate(() => window.dispatchEvent(new Event('focus'))); row.events.push({ phase, profile: await (await promise).json(), at: new Date().toISOString() }); save(); await delay(200); }
  async function dom(row, page, phase) { const d = { text: await page.locator('body').innerText(), fields: await page.locator('input,textarea').evaluateAll(xs => xs.map(x => ({ tag: x.tagName, value: x.value, disabled: x.disabled, visible: !!x.getClientRects().length, checked: x.checked ?? null }))) }; row.dom[phase] = d; await shot(row, page, phase); save(); return d; }
  function mutationRequests(row) { return row.mutationRequests.filter(x => !x.path.startsWith('/api/v1/auth/')); }
  async function selectAccount(page, user) { await page.getByRole('button', { name: 'Пользователь', exact: true }).click(); const op = page.getByRole('option').filter({ hasText: user.fullName }); assert.equal(await op.count(), 1, 'exact own account option'); await op.click(); }
  function expenseCard(page, f, side = 'A') { return page.locator('#review-account-panel-expenses .record-list > div').filter({ hasText: f[side].description }); }
  function subCard(page, f, side = 'A') { return page.locator('article').filter({ hasText: f[side].reason }); }
  try {
    front = spawn('pnpm', ['exec', 'next', 'dev', '--hostname', '127.0.0.1', '--port', '3214'], { cwd: frontendRoot, detached: true, env: { ...process.env, CRM_PREVIEW_DIST_DIR: cacheName, NEXT_PUBLIC_API_URL: api, NEXT_TELEMETRY_DISABLED: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
    const frontData = b => { frontendLog.push(String(b)); fs.writeFileSync(dir + '/frontend.log', frontendLog.join('')); }; front.stdout.on('data', frontData); front.stderr.on('data', frontData);
    proof.owner = { frontendPid: front.pid, frontendPort: 3214, cacheName, api: baseUrl, redis: process.env.REDIS_URL, bucket: process.env.MINIO_BUCKET }; save();
    await until(async () => { if (front.exitCode !== null) throw Error('owned frontend exited'); try { return (await fetch(ui + '/login')).ok; } catch { return false; } }, 'frontend ready');
    browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true }); admin = await context(founder);
    const requested = process.env.NATIVE_SUBSTITUTIONS_EXPENSES_CASES ? process.env.NATIVE_SUBSTITUTIONS_EXPENSES_CASES.split(',') : targets;
    assert(requested.every(c => targets.includes(c)));
    for (const code of requested) {
      const a = await actor(code), ctx = await context(a), row = { code, id: code + '/K5', key: code.replaceAll('.', '-'), status: 'running', actorId: a.id, fixtures: [], assertions: [], graphs: {}, screenshots: [], console: [], network: [], events: [], dom: {}, mutationRequests: [], reads: [], phase: 'fixtures' }; proof.cases.push(row); save();
      let page, controlContext, release = () => {}, f;
      try {
        const prefix = 'NSE_' + randomUUID(), isSub = code.startsWith('user_substitutions.'), isCreate = code === 'user_substitutions.create', isReject = code === 'accountability.expenses.reject';
        if (isSub) {
          const OA = await post(row, ctx, '/objects', { name: prefix + '_OBJECT_A', address: 'Isolated native scope A', status: 'active' });
          const OB = await post(row, ctx, '/objects', { name: prefix + '_OBJECT_B', address: 'Isolated native scope B', status: 'active' });
          const replacement = await actor(prefix + '_REPLACEMENT');
          if (isCreate) {
            const controlActor = await actor(prefix + '_CONTROL'); controlContext = await context(controlActor);
            f = { isSub, isCreate, OA, OB, replacement, controlActor, open: '/user-substitutions', endpoint: '/user-substitutions', resourceA: OA.id, resourceB: OB.id, ownDraft: prefix + '_OWN_CREATE_REASON' };
          } else {
            const principal = await actor(prefix + '_PRINCIPAL');
            f = { isSub, isCreate, principal, OA, OB, replacement, scopeSearchOnlyB: OB.name, open: '/user-substitutions', endpoint: '/user-substitutions/options', resourceA: OA.id, resourceB: OB.id, objectSearch: prefix + '_OBJECT', ownDraft: prefix + '_OWN_MANAGE_CREATE_REASON', manageConsumer: 'Real create-for-another principal selected object authority, NOT separate revoke right' };
          }
        } else {
          const owners = [], expenses = [];
          for (const side of ['A', 'B']) { const owner = await actor(prefix + '_OWNER_' + side, 'manager'), ownerContext = await context(owner); try { await post(row, ctx, '/accountability/accounts/' + owner.id + '/fundings', { amount: 1000, comment: 'Isolated source fixture initial account funding' }); const expense = await post(row, ownerContext, '/accountability/me/expenses', { amount: 137, description: prefix + '_EXPENSE_' + side }); await post(row, ownerContext, '/accountability/me/expenses/' + expense.id + '/submit', {}); owners.push(owner); expenses.push(expense); } finally { await ownerContext.close(); } }
          f = { isSub, isCreate, isReject, A: expenses[0], B: expenses[1], ownerA: owners[0], ownerB: owners[1], open: '/accountability?section=accounts&accountSection=expenses', endpoint: '/accountability/accounts/' + owners[0].id, resourceA: owners[0].id, resourceB: owners[1].id, ownDraft: prefix + '_OWN_REJECTION', capability: isReject ? 'canReject' : 'canApprove', actionLabel: isReject ? 'Отклонить' : 'Подтвердить' };
        }
        row.fixture = f; save(); page = await ctx.newPage(); page.setDefaultTimeout(25000);
        page.on('pageerror', e => { row.console.push({ type: 'pageerror', message: String(e) }); save(); });
        page.on('console', m => { if (['error', 'warning'].includes(m.type())) { row.console.push({ type: m.type(), message: m.text() }); save(); } });
        page.on('response', r => { if (r.url().startsWith(api)) { row.network.push({ method: r.request().method(), path: new URL(r.url()).pathname, status: r.status(), at: new Date().toISOString() }); save(); } });
        page.on('request', r => { if (r.url().startsWith(api) && r.method() !== 'GET') { row.mutationRequests.push({ phase: row.phase, method: r.method(), path: new URL(r.url()).pathname, payload: r.postData() }); save(); } });
        if (isSub && !isCreate) { row.scopeMode = 'Supported selected manage grant withdrawal A+B to B only; no baseline admin permission invented'; await rule(row, code, 'allow', [f.resourceA, f.resourceB]); }
        await page.goto(ui + f.open, { waitUntil: 'networkidle' });
        if (isSub) {
          await page.getByRole('button', { name: 'Создать замещение', exact: true }).click();
          const d = page.getByRole('dialog', { name: 'Создать замещение', exact: true });
          if (!isCreate) { await d.getByRole('button', { name: 'Чей доступ передаётся', exact: true }).click(); await d.getByRole('option').filter({ hasText: f.principal.fullName }).click(); }
          await d.getByRole('button', { name: 'Кто замещает', exact: true }).click();
          await d.getByRole('option').filter({ hasText: f.replacement.fullName }).click();
          await d.getByRole('checkbox', { name: f.OA.name, exact: true }).check();
          await d.getByRole('textbox', { name: 'Основание' }).fill(f.ownDraft);
        } else {
          await selectAccount(page, f.ownerA); await expenseCard(page, f).waitFor();
          check(row, 'actual native expense leaf available before deny', await expenseCard(page, f).getByRole('button', { name: f.actionLabel, exact: true }).isVisible(), true);
          if (isReject) { await expenseCard(page, f).getByRole('button', { name: 'Отклонить', exact: true }).click(); await expenseCard(page, f).getByPlaceholder('Укажите причину отклонения').fill(f.ownDraft); }
        }
        if (isSub && !isCreate) {
          const d = page.getByRole('dialog', { name: 'Создать замещение', exact: true });
          await until(() => d.getByRole('button', { name: 'Создать замещение', exact: true }).isEnabled(), 'initial selected A exact eligibility not ready');
          const projection = page.waitForResponse(async r => new URL(r.url()).pathname === '/api/v1/user-substitutions/options' && new URL(r.url()).searchParams.get('objectSearch') === f.scopeSearchOnlyB && r.status() === 200);
          await d.getByRole('searchbox', { name: 'Найти объект', exact: true }).fill(f.scopeSearchOnlyB);
          row.selectedEligibilityIndependentSearch = await (await projection).json(); save();
          check(row, 'selected A eligibility independent of visible B-only search results', row.selectedEligibilityIndependentSearch.eligibleSelectedObjectIds.includes(f.OA.id), true);
          check(row, 'B-only search results do not include A', row.selectedEligibilityIndependentSearch.objects.some(x => x.id === f.OA.id), false);
          await until(() => d.getByRole('button', { name: 'Создать замещение', exact: true }).isEnabled(), 'hidden authorized selected A must remain submittable despite B-only search');
        }
        row.nativeBaselineReady = true; row.phase = 'baseline'; await dom(row, page, 'mounted-before'); const before = await snapshot(row, 'baseline');
        let heldResolve, deliveredResolve, used = false;
        const heldReady = new Promise(r => heldResolve = r), gate = new Promise(r => release = r), delivered = new Promise(r => deliveredResolve = r);
        await page.route('**/api/v1/**', async route => {
          if (route.request().method() !== 'GET' || new URL(route.request().url()).pathname !== '/api/v1' + f.endpoint || (isSub && !isCreate && new URL(route.request().url()).searchParams.get('principalUserId') !== f.principal.id)) return route.continue();
          const phase = row.phase, query = Object.fromEntries(new URL(route.request().url()).searchParams), response = await route.fetch(), body = await response.json();
          if (!used) { used = true; row.held = { phase, query, status: response.status(), body }; save(); heldResolve(); await gate; try { await route.fulfill({ response }); row.delivery = 'fulfilled'; } catch (e) { row.delivery = 'cancelled'; row.deliveryError = String(e); } save(); deliveredResolve(); }
          else { row.reads.push({ phase, query, status: response.status(), body }); save(); await route.fulfill({ response }); }
        });
        row.phase = 'authorized-refresh';
        // Policy-restricted financial rights are never newly allowed: deny unrelated B only for the refresh trigger.
        if (isSub && !isCreate) {
          // Existing native object search triggers an authorized options request without changing/remounting the draft.
          await page.getByRole('dialog', { name: 'Создать замещение', exact: true }).getByRole('searchbox', { name: 'Найти объект', exact: true }).fill(f.objectSearch);
          await bounded(heldReady, 20000, 'native authorized other-principal options absent');
        } else {
          const setup = await rule(row, code, isSub ? 'allow' : 'deny', isSub ? [f.resourceA, f.resourceB] : [f.resourceB], isCreate);
          await refresh(row, page, setup, 'authorized-refresh-profile'); await bounded(heldReady, 20000, 'native authorized source absent');
        }
        function allowed(body) { return isCreate ? body.capabilities.canCreate || body.capabilities.canCreateForOthers : isSub ? body.eligibleSelectedObjectIds.includes(f.OA.id) : body.expenses.find(x => x.id === f.A.id)?.capabilities[f.capability]; }
        check(row, 'actual held source200', row.held.status, 200); check(row, 'actual held A exact capability true', allowed(row.held.body), true);
        row.phase = 'deny'; const prior = await rule(row, code, isSub && !isCreate ? 'allow' : 'deny', isSub && !isCreate ? [f.resourceB] : [f.resourceA], isCreate); await refresh(row, page, prior, 'fresh-denied-profile');
        await until(() => row.reads.some(x => x.phase === 'deny' && x.status === 200), 'native read retained200 after exact write deny');
        const deniedRead = row.reads.filter(x => x.phase === 'deny' && x.status === 200).at(-1); row.freshDeniedRead = deniedRead; save();
        check(row, 'fresh exact A write capability false while read200 retained', allowed(deniedRead.body), false);
        await dom(row, page, 'fresh-deny-before-old-source'); row.phase = 'late-delivery'; release(); await bounded(delivered, 10000, 'real old source delivery'); check(row, 'held actual response delivered', row.delivery, 'fulfilled'); await delay(400);
        const afterDOM = await dom(row, page, 'late-terminal-before-control');
        if (isSub) {
          const d = page.getByRole('dialog', { name: 'Создать замещение', exact: true });
          check(row, 'exact create/manage deny keeps own real draft reason', await d.getByRole('textbox', { name: 'Основание' }).inputValue(), f.ownDraft);
          if (!isCreate) { check(row, 'exact independent selected projection excludes withdrawn A', deniedRead.body.eligibleSelectedObjectIds.includes(f.OA.id), false); check(row, 'current options retain authorized B', deniedRead.body.objects.some(x => x.id === f.OB.id), true); check(row, 'native B source still selectable', await d.getByRole('checkbox', { name: f.OB.name, exact: true }).isVisible(), true); }
          row.beforePotentialStaleScopeFailureGraph = await snapshot(row, 'terminal-before-submit-scope-check');
          check(row, 'exact terminal scope transition no domain effects', row.beforePotentialStaleScopeFailureGraph, before);
          check(row, 'create-for-selected-principal submit disabled for denied selected A after old reply', await d.getByRole('button', { name: 'Создать замещение', exact: true }).isDisabled(), true);
          check(row, 'selected source object retained as own draft', await d.getByRole('button', { name: 'Убрать ' + f.OA.name + ' из замещения', exact: true }).isVisible(), true);
          const warning = 'Доступ к части выбранных объектов изменился. Черновик сохранён; создание замещения заблокировано. Уберите недоступные объекты или обновите доступ после его возврата.';
          check(row, 'exact visible unavailable-selected explanation', await d.getByRole('status').filter({ hasText: warning }).isVisible(), true);
          check(row, 'selected projection queried exact A identity', deniedRead.query.selectedObjectIds, f.OA.id);
          check(row, 'no automatic scope substitution to B', await d.getByRole('button', { name: 'Убрать ' + f.OB.name + ' из замещения', exact: true }).count(), 0);
          // Remove the hidden selected A ONLY through its native chip; B selection is a separate explicit user action.
          row.phase = 'explicit-remove-A'; await d.getByRole('button', { name: 'Убрать ' + f.OA.name + ' из замещения', exact: true }).click();
          await until(() => d.getByRole('checkbox', { name: f.OB.name, exact: true }).isEnabled(), 'manual removal did not recover legal B selection');
          check(row, 'empty selection cannot auto-submit', await d.getByRole('button', { name: 'Создать замещение', exact: true }).isDisabled(), true);
          await d.getByRole('checkbox', { name: f.OB.name, exact: true }).check();
          await until(() => d.getByRole('button', { name: 'Создать замещение', exact: true }).isEnabled(), 'exact selected B eligibility not refreshed');
          check(row, 'manual scope correction retains original own reason', await d.getByRole('textbox', { name: 'Основание' }).inputValue(), f.ownDraft);
          check(row, 'manual remove/select never auto-POSTs', mutationRequests(row), []);
          await dom(row, page, 'manual-remove-A-select-B-no-write');

        } else {
          check(row, 'read A expense remains native visible', await expenseCard(page, f).isVisible(), true);
          check(row, 'old source cannot restore denied expense action', await expenseCard(page, f).getByRole('button', { name: f.actionLabel, exact: true }).count(), 0);
          if (isReject) check(row, 'own rejection reason preserved under write-only deny', afterDOM.fields.some(x => x.tag === 'TEXTAREA' && x.value === f.ownDraft), true);
        }
        check(row, 'full domain/membership graph unchanged by reads and admin grant changes', await snapshot(row, 'after-old-response'), before);
        check(row, 'old callback never auto writes domain', mutationRequests(row), []);
        if (isCreate || !isSub) {
          const bp = await (controlContext ?? ctx).newPage(); await bp.goto(ui + f.open, { waitUntil: 'networkidle' });
          if (isCreate) check(row, 'independent recipient B retains native create while actor A globally denied', await bp.getByRole('button', { name: 'Создать замещение', exact: true }).isVisible(), true);
          else {
            const response = bp.waitForResponse(r => new URL(r.url()).pathname === '/api/v1/accountability/accounts/' + f.ownerB.id && r.status() === 200);
            await selectAccount(bp, f.ownerB); row.BNativeResponse = { status: (await response).status(), body: await (await response).json() }; save();
            check(row, 'B native expense action available under exact selected A deny', await expenseCard(bp, f, 'B').getByRole('button', { name: f.actionLabel, exact: true }).isVisible(), true);
          }
          await shot(row, bp, 'B-native-while-A-denied'); check(row, 'B read/control no graph effects while A denied', await snapshot(row, 'B-under-A-deny'), before); await bp.close();
        }
        row.phase = 'regrant'; const grant = await rule(row, code, isSub && !isCreate ? 'allow' : 'default', isSub && !isCreate ? [f.resourceA, f.resourceB] : [], !(isSub && !isCreate)); await refresh(row, page, grant, 'fresh-baseline-restored-profile');
        await until(() => row.reads.some(x => x.phase === 'regrant' && x.status === 200 && (isSub && !isCreate ? x.body.eligibleSelectedObjectIds.includes(f.OB.id) : allowed(x.body) === true)), 'fresh restored exact selected B projection absent'); await delay(300);
        await dom(row, page, 'restored-before-manual'); check(row, 'restore alone never auto writes', mutationRequests(row), []); check(row, 'restore domain no effects', await snapshot(row, 'restored-before-manual'), before);
        if (isSub && !isCreate) { const d = page.getByRole('dialog', { name: 'Создать замещение', exact: true }); check(row, 'regrant does not re-add removed A', await d.getByRole('button', { name: 'Убрать ' + f.OA.name + ' из замещения', exact: true }).count(), 0); check(row, 'explicit selected B preserved on regrant', await d.getByRole('button', { name: 'Убрать ' + f.OB.name + ' из замещения', exact: true }).isVisible(), true); check(row, 'own original reason survives regrant', await d.getByRole('textbox', { name: 'Основание' }).inputValue(), f.ownDraft); }
        row.phase = 'explicit-manual'; let mutationPath;
        if (isSub) { mutationPath = '/api/v1/user-substitutions'; await until(() => page.getByRole('dialog', { name: 'Создать замещение', exact: true }).getByRole('button', { name: 'Создать замещение', exact: true }).isEnabled(), 'restored draft not actionable'); }
        else { if (isReject) { await expenseCard(page, f).getByRole('button', { name: 'Отклонить', exact: true }).click(); await expenseCard(page, f).getByPlaceholder('Укажите причину отклонения').fill(f.ownDraft); } mutationPath = '/api/v1/accountability/expenses/' + f.A.id + '/' + (isReject ? 'reject' : 'approve'); }
        const responsePromise = page.waitForResponse(r => r.request().method() === 'POST' && new URL(r.url()).pathname === mutationPath);
        if (isSub) await page.getByRole('dialog', { name: 'Создать замещение', exact: true }).getByRole('button', { name: 'Создать замещение', exact: true }).click();
        else await expenseCard(page, f).getByRole('button', { name: isReject ? 'Подтвердить отклонение' : 'Подтвердить', exact: true }).click();
        const response = await responsePromise; row.manual = { status: response.status(), body: await response.json() }; save(); check(row, 'one explicit native mutation201', row.manual.status, 201); await delay(600);
        const final = await snapshot(row, 'manual-result'); row.changedModels = Object.keys(before).filter(k => serial(before[k]) !== serial(final[k]));
        const allowedModels = isSub ? ['UserSubstitution', 'UserSubstitutionObject', 'AuditEvent'] : ['AccountabilityExpense', 'AuditEvent'];
        check(row, 'exact changed models only intended source and audit', row.changedModels.sort(), allowedModels.sort());
        const newAudits = final.AuditEvent.filter(x => !before.AuditEvent.some(y => y.id === x.id)); check(row, 'exactly one manual audit', newAudits.length, 1);
        check(row, 'audit exact actor/action/source', [newAudits[0].actorUserId, newAudits[0].action], [a.id, isSub ? 'user_substitution.created' : isReject ? 'accountability_expense_rejected' : 'accountability_expense_approved']);
        if (isSub) {
          const news = final.UserSubstitution.filter(x => !before.UserSubstitution.some(y => y.id === x.id)); check(row, 'exactly one actual created substitution', news.length, 1); const n = news[0];
          check(row, 'created substitution binds actor/principal/replacement/own reason', [n.createdByUserId, n.principalUserId, n.replacementUserId, n.reason], [a.id, isCreate ? a.id : f.principal.id, f.replacement.id, f.ownDraft]);
          const links = final.UserSubstitutionObject.filter(x => x.substitutionId === n.id); check(row, 'created substitution only own A object', links.map(x => x.objectId), [isCreate ? f.OA.id : f.OB.id]);
          check(row, 'existing substitutions unchanged', final.UserSubstitution.filter(x => x.id !== n.id), before.UserSubstitution);
          check(row, 'existing substitution object scopes unchanged', final.UserSubstitutionObject.filter(x => x.substitutionId !== n.id), before.UserSubstitutionObject);
        } else {
          const n = final.AccountabilityExpense.find(x => x.id === f.A.id), old = before.AccountabilityExpense.find(x => x.id === f.A.id);
          check(row, 'exact A status resolved once', n.status, isReject ? 'rejected' : 'approved');
          const normalize = { ...n }; for (const k of ['status', 'approvedByUserId', 'approvedAt', 'rejectedByUserId', 'rejectedAt', 'rejectionComment', 'updatedAt']) normalize[k] = old[k];
          check(row, 'all source cost/owner/reference fields preserved', normalize, old);
          check(row, 'every independent expense B unchanged', final.AccountabilityExpense.filter(x => x.id !== f.A.id), before.AccountabilityExpense.filter(x => x.id !== f.A.id));
        }
        for (const key of Object.keys(before)) if (!allowedModels.includes(key)) check(row, 'manual action preserves full model ' + key, final[key], before[key]);
        check(row, 'all existing audit rows preserved', final.AuditEvent.filter(x => !newAudits.some(y => y.id === x.id)), before.AuditEvent);
        check(row, 'only one native domain mutation with exact route, no replay', mutationRequests(row).map(x => [x.method, x.path]), [['POST', mutationPath]]);
        await dom(row, page, 'manual-terminal');
        row.status = 'passed'; save();
      } catch (error) {
        row.status = row.nativeBaselineReady && row.held?.status === 200 && row.freshDeniedRead?.status === 200 ? 'product_defect_or_exact_native_gap' : 'failed'; row.error = String(error.stack || error); save();
        if (page && !page.isClosed()) try { await dom(row, page, 'exact-failure-before-new-query'); } catch {}
        try { await snapshot(row, 'failure'); } catch {}
      } finally { release(); save(); await ctx.close(); await controlContext?.close(); }
      // Each named native criterion is independent. Stop its broken boundary, retain exact before; no application patches.
      // Stop the group on fixture/oracle failure rather than repeat a shared broken harness.
      if (row.status === 'failed') break;
    }
    await admin.close(); proof.status = proof.cases.length === requested.length && proof.cases.every(c => c.status === 'passed') ? 'passed' : 'completed_with_open_cases'; proof.counts = { requested: requested.length, executed: proof.cases.length, passed: proof.cases.filter(c => c.status === 'passed').length }; save(); assert.equal(proof.status, 'passed', 'requested native case remains open; raw must not be inferred green');
  } catch (e) { proof.status = 'failed'; proof.error = String(e.stack || e); save(); throw e; }
});
