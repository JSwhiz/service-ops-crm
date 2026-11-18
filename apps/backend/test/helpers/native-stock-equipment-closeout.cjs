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
const targets = ['inventory.movement.correct', 'equipment.unit.delete', 'equipment.writeoff'];

test('E489 missing native stock/equipment epochs only', { timeout: 480000 }, async t => {
  assert.equal(process.env.NATIVE_STOCK_EQUIPMENT_EXCLUSIVE_SLOT, 'main-explicit');
  assert.equal(process.env.TEST_ISOLATED_DATABASE, 'true');
  const dbUrl = new URL(process.env.DATABASE_URL);
  assert(['localhost', '127.0.0.1'].includes(dbUrl.hostname));
  assert.match(dbUrl.searchParams.get('schema'), /^integration_\d+_\d+$/);
  const dir = path.dirname(process.env.CLOSEOUT_NATIVE_STOCK_EQUIPMENT_OUTPUT);
  fs.mkdirSync(dir, { recursive: true });
  const proof = { status: 'running', reservedEvidenceId: 'E489', authorIsNotReviewer: true, schema: dbUrl.searchParams.get('schema'), cases: [], sourceManifest: [], cleanup: {}, productionTouched: false };
  const save = () => fs.writeFileSync(process.env.CLOSEOUT_NATIVE_STOCK_EQUIPMENT_OUTPUT, serial(proof) + '\n');
  const db = new PrismaClient();
  const { app, baseUrl } = await createTestApp();
  const api = baseUrl + '/api/v1', ui = 'http://127.0.0.1:3214';
  let front, browser;
  const frontendRoot = process.env.NATIVE_STOCK_EQUIPMENT_FRONTEND_DIR;
  assert(frontendRoot && path.resolve(frontendRoot) === path.resolve(process.env.NATIVE_STOCK_EQUIPMENT_ROOT, 'frontend'), 'owned frontend mirror required');
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
  freeze(frontendRoot + '/next.config.ts'); freeze(backend + '/test/access-control-native-stock-equipment-closeout.acceptance.test.ts');
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
  const requested = process.env.NATIVE_STOCK_EQUIPMENT_CASES ? process.env.NATIVE_STOCK_EQUIPMENT_CASES.split(',') : targets;
  assert(requested.every(x => targets.includes(x)));
  async function post(row, ctx, endpoint, data) {
    const response = await ctx.request.post(api + endpoint, { data }), body = await response.json();
    row.fixtures.push({ method: 'POST', endpoint, request: data, status: response.status(), body }); save();
    assert.equal(response.status(), 201, endpoint + ' actual source fixture'); return body;
  }
  async function rule(row, code, effect, ids) {
    const version = (await db.user.findUniqueOrThrow({ where: { id: row.actorId } })).accessVersion;
    const data = { expectedVersion: version, reason: 'E489 missing-only native epoch ' + effect, changes: [{ actionCode: code, effect, scope: 'selected', selectedIds: ids }] };
    const endpoint = api + '/users-access/admin/users/' + row.actorId;
    const pr = await admin.request.post(endpoint + '/preview', { data }), pv = await pr.json();
    row.events.push({ phase: 'preview-' + effect, status: pr.status(), body: pv }); save(); assert.equal(pr.status(), 201);
    const sr = await admin.request.post(endpoint + '/save', { data: { ...data, previewToken: pv.previewToken, previewHash: pv.previewHash } });
    row.events.push({ phase: 'save-' + effect, status: sr.status(), body: await sr.json(), priorVersion: version }); save(); assert.equal(sr.status(), 201); return version;
  }
  async function refresh(row, page, priorVersion, phase) {
    const response = page.waitForResponse(async r => r.url() === api + '/auth/me' && r.status() === 200 && (await r.json()).accessVersion > priorVersion);
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    const profile = await (await response).json(); row.events.push({ phase, profile, at: new Date().toISOString() }); save();
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    return profile;
  }
  async function until(fn, label) { for (let i = 0; i < 100; i++) { if (await fn()) return; await delay(100); } throw Error(label); }
  function capability(f, body, side = 'A') {
    if (f.inventory) return body.movements.find(m => m.id === f[side].movementId)?.projection.canCorrectMovement;
    assert.equal(body.id, f[side].id, 'exact unit read identity'); return body.capabilities[f.capability];
  }
  function card(page, f, side = 'A') { return page.locator('#inventory .record-list > div').filter({ hasText: f[side].name }); }
  function domainRequests(row, f) {
    return (row.mutationRequests ?? []).filter(r => {
      if (r.path.startsWith('/api/v1/auth/')) return false;
      if (f.inventory && r.method === 'POST' && r.path === '/api/v1/objects/' + f.objectId + '/scheduling/preview') {
        const p = JSON.parse(r.payload), date = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Moscow' }).format(new Date());
        assert.deepEqual(p, { from: date, to: date }, 'only exact current-day native scheduling read preview is classified read-only');
        (row.schedulingReadPreviews ??= []).push(r); save(); return false;
      }
      return true;
    });
  }
  async function observe(row, page, f, phase) {
    const dom = { body: await page.locator('body').innerText(), forms: await page.locator('textarea').evaluateAll(xs => xs.map(x => ({ value: x.value, disabled: x.disabled, inDialog: !!x.closest('dialog'), dialogOpen: x.closest('dialog')?.open ?? null, visible: !!x.getClientRects().length }))), actionButtons: await page.getByRole('button', { name: f.inventory ? 'Исправить выдачу' : 'Удалить', exact: true }).count() };
    row.dom[phase] = dom; await shot(row, page, phase); save(); return dom;
  }
  let admin;
  try {
    front = spawn('pnpm', ['exec', 'next', 'dev', '--hostname', '127.0.0.1', '--port', '3214'], { cwd: frontendRoot, detached: true, env: { ...process.env, CRM_PREVIEW_DIST_DIR: cacheName, NEXT_PUBLIC_API_URL: api, NEXT_TELEMETRY_DISABLED: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
    const frontData = b => { frontendLog.push(String(b)); fs.writeFileSync(dir + '/frontend.log', frontendLog.join('')); }; front.stdout.on('data', frontData); front.stderr.on('data', frontData);
    proof.owner = { frontendPid: front.pid, cacheName, frontendPort: 3214, api: baseUrl, redis: process.env.REDIS_URL, bucket: process.env.MINIO_BUCKET }; save();
    await until(async () => { if (front.exitCode !== null) throw Error('owned frontend exited'); try { return (await fetch(ui + '/login')).ok; } catch { return false; } }, 'frontend3214 not ready');
    browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
    admin = await browser.newContext(); assert.equal((await admin.request.post(api + '/auth/login', { data: { login: founder.login, password: 'founder123' } })).status(), 201);
    assert.equal((await admin.request.get(api + '/chats/rooms')).status(), 200);
    for (const code of requested) {
      const a = await db.user.create({ data: { login: 'nse_' + randomUUID(), fullName: 'E489 native actor', passwordHash: founder.passwordHash, roles: { create: { roleId: role.id } } } });
      const row = { id: code + '/K5', code, key: code.replaceAll('.', '-'), status: 'running', actorId: a.id, fixtures: [], assertions: [], network: [], console: [], screenshots: [], graphs: {}, events: [], dom: {}, freshReads: [], limits: code === 'equipment.unit.delete' ? 'Only late reply/generation callback; no DELETE, no default or regrant test' : 'Native write revocation retains read; no denied API POST replay' };
      const continuationOnly = code === 'inventory.movement.correct'; row.continuationOnly = continuationOnly;
      proof.cases.push(row); save();
      const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
      await ctx.route('**/*', route => ['localhost', '127.0.0.1'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
      let page, release = () => {}, phase = 'baseline';
      try {
        assert.equal((await ctx.request.post(api + '/auth/login', { data: { login: a.login, password: 'founder123' } })).status(), 201);
        assert.equal((await ctx.request.get(api + '/chats/rooms')).status(), 200);
        const prefix = 'E489_' + randomUUID(); let f;
        if (code === 'inventory.movement.correct') {
          const object = await post(row, ctx, '/objects', { name: prefix + '_OBJECT', address: 'Isolated native E489', status: 'active' });
          const sides = [];
          for (const side of ['A', 'B']) {
            const item = await post(row, ctx, '/inventory/items', { name: prefix + '_' + side, category: 'Native E489', unit: 'шт' });
            await post(row, ctx, '/inventory/movements', { inventoryItemId: item.id, movementType: 'receipt', quantity: 10, unitPrice: 7 });
            const issue = await post(row, ctx, '/inventory/movements', { inventoryItemId: item.id, movementType: 'issue_to_object', relatedObjectId: object.id, quantity: 2, evidenceRequired: true, comment: prefix + '_ISSUE_' + side });
            sides.push({ id: item.id, name: item.name, movementId: issue.id });
          }
          f = { inventory: true, A: sides[0], B: sides[1], objectId: object.id, open: '/objects/' + object.id + '#inventory', endpoint: '/objects/' + object.id + '/inventory' };
        } else {
          const catalog = await post(row, ctx, '/equipment/catalog', { category: 'Native E489', name: prefix + '_CATALOG' });
          const A = await post(row, ctx, '/equipment/units', { catalogItemId: catalog.id, inventoryNumber: prefix + '_A' });
          const B = await post(row, ctx, '/equipment/units', { catalogItemId: catalog.id, inventoryNumber: prefix + '_B' });
          f = { A, B, open: '/equipment/' + A.id, endpoint: '/equipment/units/' + A.id, control: '/equipment/' + B.id, capability: code === 'equipment.unit.delete' ? 'canDelete' : 'canWriteoff' };
        }
        row.fixture = f; row.ownDraft = prefix + '_OWN_DRAFT'; save();
        page = await ctx.newPage(); page.setDefaultTimeout(20000);
        page.on('pageerror', e => { row.console.push({ type: 'pageerror', message: String(e) }); save(); });
        page.on('console', m => { if (['error', 'warning'].includes(m.type())) { row.console.push({ type: m.type(), message: m.text() }); save(); } });
        page.on('response', r => { if (r.url().startsWith(api)) { row.network.push({ at: new Date().toISOString(), method: r.request().method(), path: new URL(r.url()).pathname + new URL(r.url()).search, status: r.status() }); save(); } });
        page.on('request', r => { if (r.url().startsWith(api) && r.method() !== 'GET') { (row.mutationRequests ??= []).push({ phase, method: r.method(), path: new URL(r.url()).pathname, payload: r.postData() }); save(); } });
        if (continuationOnly) {
          row.reusesLatePhase = { path: process.env.NATIVE_STOCK_EQUIPMENT_ORIGINAL_RAW, sha256: sha(fs.readFileSync(process.env.NATIVE_STOCK_EQUIPMENT_ORIGINAL_RAW)), pointer: '/cases/0', binding: 'Original isolated schema was cleaned. New A/B IDs and actor explicitly differ; same exact correction consumer/source and founder capability class. Original held200/freshdeny/terminal B/reason/domain snapshots reused without replay.' };
          await rule(row, code, 'deny', [f.A.id]);
        }
        await page.goto(ui + f.open, { waitUntil: 'networkidle' });
        if (f.inventory && !continuationOnly) {
          check(row, 'exact A movement card count', await card(page, f).count(), 1);
          await card(page, f).getByRole('button', { name: 'Исправить выдачу', exact: true }).click();
          await page.getByRole('dialog', { name: 'Исправить выдачу?' }).getByRole('textbox', { name: 'Причина' }).fill(row.ownDraft);
        } else if (f.inventory) {
          await card(page, f).waitFor();
          check(row, 'continuation starts with A correction denied in native UI', await card(page, f).getByRole('button', { name: 'Исправить выдачу', exact: true }).count(), 0);
          check(row, 'continuation B native correction available', await card(page, f, 'B').getByRole('button', { name: 'Исправить выдачу', exact: true }).isVisible(), true);
        } else if (code === 'equipment.unit.delete') {
          await page.getByRole('button', { name: 'Удалить', exact: true }).click();
          check(row, 'real confirmation has opener and explicit confirm', await page.getByRole('button', { name: 'Удалить', exact: true }).count(), 2);
        } else {
          await page.getByRole('button', { name: 'Операция', exact: true }).click();
          await page.getByRole('option', { name: 'Списание', exact: true }).click();
          await page.getByRole('textbox', { name: 'Комментарий', exact: true }).fill(row.ownDraft);
        }
        await observe(row, page, f, 'mounted-before-epoch');
        const before = await snapshot(row, 'baseline-after-real-header-bootstrap');
        if (!continuationOnly) {
        let heldResolve, deliveredResolve, used = false;
        const heldReady = new Promise(r => heldResolve = r), gate = new Promise(r => release = r), delivered = new Promise(r => deliveredResolve = r);
        await page.route('**/api/v1/**', async route => {
          if (route.request().method() !== 'GET' || new URL(route.request().url()).pathname !== '/api/v1' + f.endpoint) return route.continue();
          const requestPhase = phase, response = await route.fetch(), body = await response.json();
          if (!used) {
            used = true; row.held = { phase: requestPhase, path: f.endpoint, status: response.status(), body, at: new Date().toISOString() }; save(); heldResolve(); await gate;
            try { await route.fulfill({ response }); row.delivery = 'fulfilled'; deliveredResolve(); } catch (e) { row.delivery = 'cancelled'; row.deliveryError = String(e); deliveredResolve(); } save();
          } else { row.freshReads.push({ phase: requestPhase, path: f.endpoint, status: response.status(), body, at: new Date().toISOString() }); save(); await route.fulfill({ response }); }
        });
        // Same-capability selected allow is only a real native refresh trigger: no reload/remount or forged response.
        phase = 'authorized-refresh'; const setupVersion = await rule(row, code, 'allow', [f.A.id, f.B.id]);
        await refresh(row, page, setupVersion, 'authorized-refresh-profile');
        await bounded(heldReady, 20000, 'actual native authorized GET not reached');
        check(row, 'held original source response is authorized200', row.held.status, 200);
        check(row, 'held source exact A capability true', capability(f, row.held.body), true);
        if (f.inventory) check(row, 'held source binds B capability independently', capability(f, row.held.body, 'B'), true);
        phase = 'deny'; const denyVersion = await rule(row, code, 'deny', [f.A.id]);
        const deniedProfile = await refresh(row, page, denyVersion, 'fresh-denied-profile'); row.freshDeniedVersion = deniedProfile.accessVersion;
        await until(() => row.freshReads.some(r => r.phase === 'deny' && r.status === 200 && capability(f, r.body) === false), 'fresh native A read200 with exact leaf denied absent');
        if (f.inventory) await card(page, f).getByRole('button', { name: 'Исправить выдачу', exact: true }).waitFor({ state: 'hidden' });
        else if (code === 'equipment.unit.delete') await page.getByRole('button', { name: 'Удалить', exact: true }).waitFor({ state: 'hidden' });
        else { await page.getByRole('button', { name: 'Операция', exact: true }).click(); check(row, 'selected writeoff option absent while unrelated write/read retained', await page.getByRole('option', { name: 'Списание', exact: true }).count(), 0); await page.keyboard.press('Escape'); }
        await observe(row, page, f, 'fresh-deny-before-delivery');
        phase = 'late-delivery'; release(); await bounded(delivered, 10000, 'real old source delivery');
        check(row, 'real held old200 delivered', row.delivery, 'fulfilled'); await delay(500);
        const afterDOM = await observe(row, page, f, 'late-delivery-terminal');
        if (f.inventory) {
          check(row, 'A still read visible with denied correction', await card(page, f).isVisible(), true);
          check(row, 'old source cannot restore A correction', await card(page, f).getByRole('button', { name: 'Исправить выдачу', exact: true }).count(), 0);
          check(row, 'B native correction remains available', await card(page, f, 'B').getByRole('button', { name: 'Исправить выдачу', exact: true }).isVisible(), true);
          check(row, 'own suspended reason preserved without harness refill', afterDOM.forms.some(x => x.inDialog && x.value === row.ownDraft), true);
          check(row, 'old prompt not actionable', await page.getByRole('dialog', { name: 'Исправить выдачу?' }).count(), 0);
        } else if (code === 'equipment.unit.delete') {
          check(row, 'A read remains visible after leaf deny', afterDOM.body.includes(f.A.inventoryNumber), true);
          check(row, 'late source cannot restore delete action', await page.getByRole('button', { name: 'Удалить', exact: true }).count(), 0);
        } else {
          check(row, 'own writeoff comment retained', await page.getByRole('textbox', { name: 'Комментарий', exact: true }).inputValue(), row.ownDraft);
          await page.getByRole('button', { name: 'Операция', exact: true }).click(); check(row, 'late old source cannot restore writeoff choice', await page.getByRole('option', { name: 'Списание', exact: true }).count(), 0); await page.keyboard.press('Escape');
        }
        const after = await snapshot(row, 'after-late-delivery');
        row.changedModels = Object.keys(before).filter(k => serial(before[k]) !== serial(after[k]));
        check(row, 'complete domain and existing header memberships unchanged', after, before);
        check(row, 'no automatic domain write from deny or old delivery', domainRequests(row, f), []);
        } else {
          await page.route('**/api/v1/**', async route => {
            if (route.request().method() !== 'GET' || new URL(route.request().url()).pathname !== '/api/v1' + f.endpoint) return route.continue();
            const requestPhase = phase, response = await route.fetch(); row.freshReads.push({ phase: requestPhase, status: response.status(), body: await response.json() }); save(); await route.fulfill({ response });
          });
        }
        if (code !== 'equipment.unit.delete') {
          phase = 'regrant'; const prior = await rule(row, code, 'allow', [f.A.id, f.B.id]); await refresh(row, page, prior, 'fresh-regrant-profile');
          await until(() => row.freshReads.some(r => r.phase === 'regrant' && r.status === 200 && capability(f, r.body) === true), 'fresh native regrant source absent');
          await delay(300); const restoredDOM = await observe(row, page, f, 'regrant-before-manual');
          check(row, 'regrant alone does not replay domain write', domainRequests(row, f), []);
          const restored = await snapshot(row, 'regrant-before-manual'); check(row, 'regrant produces zero domain effects', restored, before);
          if (f.inventory) {
            check(row, 'regrant restores A correction affordance', await card(page, f).getByRole('button', { name: 'Исправить выдачу', exact: true }).isVisible(), true);
            if (!continuationOnly) check(row, 'regrant retains own suspended reason without reopening or refill', restoredDOM.forms.some(x => x.inDialog && x.value === row.ownDraft), true);
            // Preserve the suspended old prompt above. A new explicit click is a NEW prompt per ask() source.
            // Its new typed reason is never represented as restored old-draft evidence.
            phase = 'explicit-manual-correction';
            await card(page, f).getByRole('button', { name: 'Исправить выдачу', exact: true }).click();
            const prompt = page.getByRole('dialog', { name: 'Исправить выдачу?', exact: true });
            await prompt.waitFor(); await observe(row, page, f, 'explicit-reopen-reason-before-submit');
            row.newPromptBeforeInput = await prompt.getByRole('textbox', { name: 'Причина' }).inputValue();
            row.manualReason = row.ownDraft + '_EXPLICIT_NEW_INTENT';
            row.limits += '; old suspended reason retained separately; explicit new correction click creates a fresh prompt per ask(). New manual input is distinct, not proof of restored old prompt.'; save();
            await prompt.getByRole('textbox', { name: 'Причина' }).fill(row.manualReason);
            check(row, 'fresh source fixture has no configured monthly budget effects', before.ObjectPlanningSettings.filter(x => x.objectId === f.objectId && x.monthlyBudget != null), []);
            const response = page.waitForResponse(r => r.request().method() === 'POST' && new URL(r.url()).pathname === '/api/v1/inventory/movements/' + f.A.movementId + '/correct');
            await prompt.getByRole('button', { name: 'Исправить', exact: true }).click();
            const submitted = await response, body = await submitted.json(); row.manual = { status: submitted.status(), body }; save();
            check(row, 'one explicit native correction returns201', submitted.status(), 201);
            check(row, 'real unconfirmed source cancelled exactly', body, { id: f.A.movementId, mode: 'cancelled' });
            await prompt.waitFor({ state: 'hidden' }); await delay(250);
            const final = await snapshot(row, 'after-one-explicit-manual-correction');
            const sourceBefore = before.InventoryMovement.find(x => x.id === f.A.movementId), sourceAfter = final.InventoryMovement.find(x => x.id === f.A.movementId);
            check(row, 'source cancellation status', sourceAfter.status, 'cancelled');
            check(row, 'same movement identity/references/quantity/cost/comment retained', { ...sourceAfter, status: sourceBefore.status, updatedAt: sourceBefore.updatedAt }, sourceBefore);
            const sourceApprovals = before.ApprovalRequest.filter(x => x.sourceEntityType === 'inventory_movement' && x.sourceEntityId === f.A.movementId && x.status === 'pending');
            check(row, 'one actual source approval before correction', sourceApprovals.length, 1);
            const approval = final.ApprovalRequest.find(x => x.id === sourceApprovals[0].id), oldApproval = sourceApprovals[0];
            check(row, 'one source approval cancelled by actor with own reason', [approval.status, approval.cancelledByUserId, approval.decisionComment, !!approval.cancelledAt], ['cancelled', a.id, row.manualReason, true]);
            check(row, 'source approval other fields unchanged', { ...approval, status: oldApproval.status, cancelledByUserId: oldApproval.cancelledByUserId, cancelledAt: oldApproval.cancelledAt, decisionComment: oldApproval.decisionComment, updatedAt: oldApproval.updatedAt }, oldApproval);
            const oldAudits = new Set(before.AuditEvent.map(x => x.id)), audits = final.AuditEvent.filter(x => !oldAudits.has(x.id));
            check(row, 'one exact cancellation audit', audits.map(x => [x.entityId, x.actorUserId, x.action, x.newValues]), [[f.A.movementId, a.id, 'inventory.movement.cancelled', { reason: row.manualReason }]]);
            for (const key of Object.keys(before)) {
              const skip = key === 'InventoryMovement' ? [f.A.movementId] : key === 'ApprovalRequest' ? [approval.id] : key === 'AuditEvent' ? audits.map(x => x.id) : [];
              check(row, 'correction preserves all independent/existing rows ' + key, final[key].filter(x => !skip.includes(x.id)), before[key].filter(x => !skip.includes(x.id)));
            }
            check(row, 'one explicit native correction only and no replay', domainRequests(row, f).map(r => [r.method, r.path, JSON.parse(r.payload)]), [['POST', '/api/v1/inventory/movements/' + f.A.movementId + '/correct', { reason: row.manualReason }]]);
            await observe(row, page, f, 'manual-correction-result');
          } else {
            check(row, 'regrant retains exact writeoff choice', await page.getByRole('button', { name: 'Операция', exact: true }).innerText(), 'Списание');
            check(row, 'regrant retains exact own comment', await page.getByRole('textbox', { name: 'Комментарий', exact: true }).inputValue(), row.ownDraft);
            phase = 'explicit-manual-writeoff';
            const response = page.waitForResponse(r => r.request().method() === 'POST' && new URL(r.url()).pathname === '/api/v1/equipment/units/' + f.A.id + '/movements');
            await page.getByRole('button', { name: 'Записать операцию', exact: true }).click();
            const submitted = await response, body = await submitted.json(); row.manual = { status: submitted.status(), body }; save();
            check(row, 'one explicit native writeoff returns201', submitted.status(), 201);
            check(row, 'writeoff is pending approval, not actual disposal', body.status, 'pending_approval');
            check(row, 'exact native movement request comment retained', body.comment, row.ownDraft);
            await page.getByText('Ожидает согласования', { exact: true }).waitFor(); await delay(200);
            const final = await snapshot(row, 'after-one-explicit-manual-writeoff');
            const ids = new Set(before.EquipmentMovement.map(x => x.id)), newMovements = final.EquipmentMovement.filter(x => !ids.has(x.id));
            check(row, 'exactly one new movement from manual writeoff', newMovements.length, 1);
            check(row, 'one movement binds exact A/actor/comment/pending', newMovements.map(x => [x.equipmentUnitId, x.createdByUserId, x.comment, x.status, x.movementType]), [[f.A.id, a.id, row.ownDraft, 'pending_approval', 'writeoff']]);
            const approvalIds = new Set(before.ApprovalRequest.map(x => x.id)), approvals = final.ApprovalRequest.filter(x => !approvalIds.has(x.id));
            check(row, 'one independent pending writeoff approval', approvals.map(x => [x.sourceEntityId, x.sourceEntityType, x.status, x.approvalType]), [[body.id, 'equipment_movement', 'pending', 'equipment_writeoff_confirmation']]);
            const auditIds = new Set(before.AuditEvent.map(x => x.id)), audits = final.AuditEvent.filter(x => !auditIds.has(x.id));
            check(row, 'only two exact actor/source manual audits', audits.map(x => [x.action, x.entityId, x.actorUserId]).sort(), [['equipment.writeoff', body.id, a.id], ['approval.request.created', approvals[0].id, a.id]].sort());
            // Preserve all pre-existing rows in these three models; no whole-model exclusion.
            for (const key of Object.keys(before)) {
              const additions = { EquipmentMovement: newMovements, ApprovalRequest: approvals, AuditEvent: audits }[key] ?? [];
              const added = new Set(additions.map(x => x.id)); check(row, 'manual write preserves existing model ' + key, final[key].filter(x => !added.has(x.id)), before[key]);
            }
            check(row, 'exactly one native manual mutation and no replay', domainRequests(row, f).map(r => [r.method, r.path, JSON.parse(r.payload)]), [['POST', '/api/v1/equipment/units/' + f.A.id + '/movements', { movementType: 'writeoff', comment: row.ownDraft }]]);
            await observe(row, page, f, 'manual-pending-not-disposed');
          }
        }
        if (!f.inventory) {
          // Independent native B page, same actor, no B mutation; preserves A's terminal evidence first.
          phase = 'B-native-control'; const controlBefore = await snapshot(row, 'before-B-control');
          const bp = await ctx.newPage(); await bp.goto(ui + f.control, { waitUntil: 'networkidle' });
          if (code === 'equipment.unit.delete') check(row, 'B native delete affordance unaffected by selected A deny', await bp.getByRole('button', { name: 'Удалить', exact: true }).isVisible(), true);
          else { await bp.getByRole('button', { name: 'Операция', exact: true }).click(); check(row, 'B native writeoff option unaffected', await bp.getByRole('option', { name: 'Списание', exact: true }).isVisible(), true); await bp.keyboard.press('Escape'); }
          await observe(row, bp, f, 'B-native-control');
          check(row, 'B control read causes no domain effect', await snapshot(row, 'after-B-control'), controlBefore); await bp.close();
        }
        if (code === 'equipment.unit.delete') check(row, 'missing-only delete case sent zero DELETE requests', row.network.filter(x => x.method === 'DELETE'), []);
        row.status = 'passed'; save();
      } catch (error) {
        row.status = 'failed'; row.error = String(error.stack || error); save();
        if (page && !page.isClosed()) try { await observe(row, page, row.fixture, 'failure-before-any-new-query'); } catch {}
        try { await snapshot(row, 'failure'); } catch {}
      } finally { release(); save(); await ctx.close(); }
      // Adaptive stop: preserve first raw failure, never repeat an identical broken oracle in three browsers.
      if (row.status !== 'passed') break;
    }
    await admin.close(); proof.status = proof.cases.length === requested.length && proof.cases.every(x => x.status === 'passed') ? 'passed' : 'completed_with_open_cases';
    proof.counts = { requested: requested.length, executed: proof.cases.length, passed: proof.cases.filter(x => x.status === 'passed').length }; save();
    assert.equal(proof.status, 'passed', 'bounded packet contains open cases; do not infer whole');
  } catch (error) { proof.status = 'failed'; proof.error = String(error.stack || error); save(); throw error; }
});
