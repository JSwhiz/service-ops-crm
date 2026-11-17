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

test('E499 only remaining feedback and original-intent recovery', { timeout: 480000 }, async t => {
  assert.equal(process.env.NATIVE_STOCK_EQUIPMENT_FEEDBACK_EXCLUSIVE_SLOT, 'main-explicit');
  assert.equal(process.env.TEST_ISOLATED_DATABASE, 'true');
  const dbUrl = new URL(process.env.DATABASE_URL);
  assert(['localhost', '127.0.0.1'].includes(dbUrl.hostname));
  assert.match(dbUrl.searchParams.get('schema'), /^integration_\d+_\d+$/);
  const dir = path.dirname(process.env.CLOSEOUT_NATIVE_STOCK_EQUIPMENT_FEEDBACK_OUTPUT);
  fs.mkdirSync(dir, { recursive: true });
  const proof = { status: 'running', reservedEvidenceId: 'E499', authorIsNotReviewer: true, schema: dbUrl.searchParams.get('schema'), cases: [], sourceManifest: [], cleanup: {}, productionTouched: false };
  const save = () => fs.writeFileSync(process.env.CLOSEOUT_NATIVE_STOCK_EQUIPMENT_FEEDBACK_OUTPUT, serial(proof) + '\n');
  const db = new PrismaClient();
  const { app, baseUrl } = await createTestApp();
  const api = baseUrl + '/api/v1', ui = 'http://127.0.0.1:3214';
  let front, browser;
  const frontendRoot = process.env.NATIVE_STOCK_EQUIPMENT_FEEDBACK_FRONTEND_DIR;
  assert(frontendRoot && path.resolve(frontendRoot) === path.resolve(process.env.NATIVE_STOCK_EQUIPMENT_FEEDBACK_ROOT, 'frontend'), 'owned frontend mirror required');
  const frontendLog = [], cacheName = '.next-acl-preview-' + process.pid;
  const configs = ['next-env.d.ts', 'tsconfig.json'].map(n => ({ path: frontendRoot + '/' + n, before: fs.readFileSync(frontendRoot + '/' + n, 'utf8') }));
  fs.writeFileSync(dir + '/config-before.json', serial(configs));
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
  freeze(frontendRoot + '/next.config.ts'); freeze(backend + '/test/access-control-native-stock-equipment-feedback-closeout.acceptance.test.ts');
  save();
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
  const requested = process.env.NATIVE_STOCK_EQUIPMENT_FEEDBACK_CASES ? process.env.NATIVE_STOCK_EQUIPMENT_FEEDBACK_CASES.split(',') : targets;
  assert(requested.every(x => targets.includes(x)));
  async function post(row, ctx, endpoint, data) {
    const response = await ctx.request.post(api + endpoint, { data }), body = await response.json();
    row.fixtures.push({ method: 'POST', endpoint, request: data, status: response.status(), body }); save();
    assert.equal(response.status(), 201, endpoint + ' actual source fixture'); return body;
  }
  async function rule(row, code, effect, ids) {
    const version = (await db.user.findUniqueOrThrow({ where: { id: row.actorId } })).accessVersion;
    const data = { expectedVersion: version, reason: 'E499 missing-only native epoch ' + effect, changes: [{ actionCode: code, effect, scope: 'selected', selectedIds: ids }] };
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
        const date = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Moscow' }).format(new Date());
        assert.deepEqual(JSON.parse(r.payload), { from: date, to: date }, 'only exact current-day native scheduling calculation is read-only');
        return false;
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
      const a = await db.user.create({ data: { login: 'nse_' + randomUUID(), fullName: 'E499 native actor', passwordHash: founder.passwordHash, roles: { create: { roleId: role.id } } } });
      const row = { id: code + '/K5', code, key: code.replaceAll('.', '-'), status: 'running', actorId: a.id, fixtures: [], assertions: [], network: [], console: [], screenshots: [], graphs: {}, events: [], dom: {}, freshReads: [], limits: code === 'equipment.unit.delete' ? 'Only missing visible pending-confirmation denial feedback; zero DELETE/regrant; accepted late callback reused' : 'Missing feedback/original-intent recovery only. No held old response replay; existing E489 late phases and writeoff pending201 reused' };
      proof.cases.push(row); save();
      const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
      await ctx.route('**/*', route => ['localhost', '127.0.0.1'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
      let page, release = () => {}, phase = 'baseline';
      try {
        assert.equal((await ctx.request.post(api + '/auth/login', { data: { login: a.login, password: 'founder123' } })).status(), 201);
        assert.equal((await ctx.request.get(api + '/chats/rooms')).status(), 200);
        const prefix = 'E499_' + randomUUID(); let f;
        if (code === 'inventory.movement.correct') {
          const object = await post(row, ctx, '/objects', { name: prefix + '_OBJECT', address: 'Isolated native E499', status: 'active' });
          const sides = [];
          for (const side of ['A', 'B']) {
            const item = await post(row, ctx, '/inventory/items', { name: prefix + '_' + side, category: 'Native E499', unit: 'шт' });
            await post(row, ctx, '/inventory/movements', { inventoryItemId: item.id, movementType: 'receipt', quantity: 10, unitPrice: 7 });
            const issue = await post(row, ctx, '/inventory/movements', { inventoryItemId: item.id, movementType: 'issue_to_object', relatedObjectId: object.id, quantity: 2, evidenceRequired: true, comment: prefix + '_ISSUE_' + side });
            sides.push({ id: item.id, name: item.name, movementId: issue.id });
          }
          f = { inventory: true, A: sides[0], B: sides[1], objectId: object.id, open: '/objects/' + object.id + '#inventory', endpoint: '/objects/' + object.id + '/inventory' };
        } else {
          const catalog = await post(row, ctx, '/equipment/catalog', { category: 'Native E499', name: prefix + '_CATALOG' });
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
        await page.goto(ui + f.open, { waitUntil: 'networkidle' });
        if (f.inventory) {
          check(row, 'exact A movement card count', await card(page, f).count(), 1);
          await card(page, f).getByRole('button', { name: 'Исправить выдачу', exact: true }).click();
          await page.getByRole('dialog', { name: 'Исправить выдачу?' }).getByRole('textbox', { name: 'Причина' }).fill(row.ownDraft);
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
        row.reusesE489 = { originalFailedPrefix: process.env.E499_ORIGINAL_PREFIX, actualPassedContinuationAndEquipment: process.env.E499_PRIOR_PASSED, reviewerPartialClaim: process.env.E499_REVIEWED_PARTIAL, limit: 'E499 executes only residual feedback/recovery on new coherent source A/B. Original raw statuses/source epochs stay unchanged. No held-response replay, no equipment DELETE or repeated writeoff201.' };
        if (f.inventory) row.originalDialogLabelId = await page.getByRole('dialog', { name: 'Исправить выдачу?', exact: true }).getAttribute('aria-labelledby');
        await page.route('**/api/v1/**', async route => {
          if (route.request().method() !== 'GET' || new URL(route.request().url()).pathname !== '/api/v1' + f.endpoint) return route.continue();
          const requestPhase = phase, response = await route.fetch(), body = await response.json();
          row.freshReads.push({ phase: requestPhase, path: f.endpoint, status: response.status(), body }); save(); await route.fulfill({ response });
        });
        phase = 'deny-feedback'; const prior = await rule(row, code, 'deny', [f.A.id]); await refresh(row, page, prior, 'fresh-profile-exact-write-deny');
        await until(() => row.freshReads.some(x => x.phase === phase && x.status === 200 && capability(f, x.body) === false), 'native fresh read200 with exact leaf denied absent');
        await delay(200);
        if (f.inventory) {
          const prompt = page.getByRole('dialog', { name: 'Исправить выдачу?', exact: true });
          const warning = 'Исправление выдачи недоступно. Причина сохранена в черновике. После возврата доступа подтвердите исправление вручную.';
          await prompt.waitFor({ state: 'visible' }); await prompt.getByRole('status').filter({ hasText: warning }).waitFor();
          check(row, 'original reason dialog accessible while correction denied', await prompt.isVisible(), true);
          check(row, 'exact correction denial explanation visible', await prompt.getByRole('status').filter({ hasText: warning }).isVisible(), true);
          check(row, 'same original reason retained without reopen/refill', await prompt.getByRole('textbox', { name: 'Причина' }).inputValue(), row.ownDraft);
          check(row, 'original correction confirm disabled', await prompt.getByRole('button', { name: 'Исправить', exact: true }).isDisabled(), true);
          check(row, 'same original dialog identity under deny', await prompt.getAttribute('aria-labelledby'), row.originalDialogLabelId);
        } else if (code === 'equipment.unit.delete') {
          const warning = 'Удаление оборудования недоступно. Карточка не удалена. После возврата доступа подтвердите удаление вручную.';
          await page.getByRole('status').filter({ hasText: warning }).waitFor();
          check(row, 'exact visible pending-delete explanation outside absent action subtree', await page.getByRole('status').filter({ hasText: warning }).isVisible(), true);
          check(row, 'no actionable delete during exact leaf deny', await page.getByRole('button', { name: 'Удалить', exact: true }).count(), 0);
          check(row, 'legal A read retained in native card', (await page.locator('body').innerText()).includes(f.A.inventoryNumber), true);
        } else {
          const warning = 'Выбранная операция «Списание» недоступна. Черновик сохранён. Выберите другую разрешённую операцию или дождитесь возврата доступа.';
          await page.getByRole('status').filter({ hasText: warning }).waitFor();
          check(row, 'exact unavailable original-operation explanation visible', await page.getByRole('status').filter({ hasText: warning }).isVisible(), true);
          check(row, 'no silent fallback to another operation', await page.getByRole('button', { name: 'Операция', exact: true }).innerText(), 'Выберите операцию');
          check(row, 'unavailable intended operation cannot submit', await page.getByRole('button', { name: 'Записать операцию', exact: true }).isDisabled(), true);
          check(row, 'own comment unchanged while intended operation unavailable', await page.getByRole('textbox', { name: 'Комментарий', exact: true }).inputValue(), row.ownDraft);
        }
        await observe(row, page, f, 'exact-denial-feedback'); check(row, 'deny feedback complete graph unchanged', await snapshot(row, 'exact-denial-feedback'), before);
        check(row, 'feedback never automatically submits domain action', domainRequests(row, f), []);
        if (code === 'equipment.unit.delete') {
          check(row, 'feedback-only delete case has zero DELETE', row.network.filter(x => x.method === 'DELETE'), []);
        } else {
          if (!f.inventory) {
            phase = 'explicit-other-operation-choice';
            await page.getByRole('button', { name: 'Операция', exact: true }).click(); await page.getByRole('option', { name: 'Передача в ремонт', exact: true }).click();
            check(row, 'another allowed operation selected only by explicit native choice', await page.getByRole('button', { name: 'Операция', exact: true }).innerText(), 'Передача в ремонт');
            check(row, 'explicit legal operation recovers submit availability', await page.getByRole('button', { name: 'Записать операцию', exact: true }).isEnabled(), true);
            check(row, 'explicit choice preserves original own comment', await page.getByRole('textbox', { name: 'Комментарий', exact: true }).inputValue(), row.ownDraft);
            await observe(row, page, f, 'explicit-other-operation-no-write'); check(row, 'operation selection alone no domain effects', await snapshot(row, 'explicit-other-operation-no-write'), before);
          }
          phase = 'regrant-original-intent'; const version = await rule(row, code, 'allow', [f.A.id, f.B.id]); await refresh(row, page, version, 'fresh-restored-profile');
          await until(() => row.freshReads.some(x => x.phase === phase && x.status === 200 && capability(f, x.body) === true), 'actual restored native source absent');
          await delay(200); await observe(row, page, f, 'restored-before-manual');
          check(row, 'regrant never auto-replays domain action', domainRequests(row, f), []); check(row, 'regrant full domain graph unchanged', await snapshot(row, 'restored-before-manual'), before);
          if (f.inventory) {
            const prompt = page.getByRole('dialog', { name: 'Исправить выдачу?', exact: true });
            await until(() => prompt.getByRole('button', { name: 'Исправить', exact: true }).isEnabled(), 'original intent not recovered');
            check(row, 'original reason dialog accessible after regrant without a new ask', await prompt.isVisible(), true);
            check(row, 'exact same original reason recovered with no new input', await prompt.getByRole('textbox', { name: 'Причина' }).inputValue(), row.ownDraft);
            check(row, 'same dialog identity after regrant', await prompt.getAttribute('aria-labelledby'), row.originalDialogLabelId);
            check(row, 'original confirm enabled after fresh access check', await prompt.getByRole('button', { name: 'Исправить', exact: true }).isEnabled(), true);
            phase = 'manual-original-reason-confirm';
            const responsePromise = page.waitForResponse(r => r.request().method() === 'POST' && new URL(r.url()).pathname === '/api/v1/inventory/movements/' + f.A.movementId + '/correct');
            await prompt.getByRole('button', { name: 'Исправить', exact: true }).click(); const response = await responsePromise;
            row.manual = { status: response.status(), body: await response.json(), reasonInputWasNotRefilled: true, noNewAskAfterRegrant: true }; save();
            check(row, 'original manual intent succeeds on fresh generation201', row.manual.status, 201); check(row, 'same source cancelled by original intent', row.manual.body, { id: f.A.movementId, mode: 'cancelled' });
            await prompt.waitFor({ state: 'hidden' }); await delay(200); const final = await snapshot(row, 'same-original-reason-manual-result');
            const oldSource = before.InventoryMovement.find(x => x.id === f.A.movementId), source = final.InventoryMovement.find(x => x.id === f.A.movementId);
            check(row, 'exact source status cancelled', source.status, 'cancelled'); check(row, 'source identity/cost/quantity/references unchanged', { ...source, status: oldSource.status, updatedAt: oldSource.updatedAt }, oldSource);
            const oldApprovals = before.ApprovalRequest.filter(x => x.sourceEntityType === 'inventory_movement' && x.sourceEntityId === f.A.movementId && x.status === 'pending'); check(row, 'one exact pending source approval before manual recovery', oldApprovals.length, 1);
            const oldApproval = oldApprovals[0], approval = final.ApprovalRequest.find(x => x.id === oldApproval.id);
            check(row, 'same original reason reaches actual cancellation approval', [approval.status, approval.cancelledByUserId, approval.decisionComment, !!approval.cancelledAt], ['cancelled', a.id, row.ownDraft, true]);
            check(row, 'all other approval fields unchanged', { ...approval, status: oldApproval.status, cancelledByUserId: oldApproval.cancelledByUserId, cancelledAt: oldApproval.cancelledAt, decisionComment: oldApproval.decisionComment, updatedAt: oldApproval.updatedAt }, oldApproval);
            const auditIds = new Set(before.AuditEvent.map(x => x.id)), audits = final.AuditEvent.filter(x => !auditIds.has(x.id));
            check(row, 'one actual cancellation audit with same original reason', audits.map(x => [x.entityId, x.actorUserId, x.action, x.newValues]), [[f.A.movementId, a.id, 'inventory.movement.cancelled', { reason: row.ownDraft }]]);
            for (const key of Object.keys(before)) {
              const skip = key === 'InventoryMovement' ? [f.A.movementId] : key === 'ApprovalRequest' ? [approval.id] : key === 'AuditEvent' ? audits.map(x => x.id) : [];
              check(row, 'original-intent recovery preserves all other model rows ' + key, final[key].filter(x => !skip.includes(x.id)), before[key].filter(x => !skip.includes(x.id)));
            }
            check(row, 'only one original-intent native POST with exact reason and no replay', domainRequests(row, f).map(x => [x.method, x.path, JSON.parse(x.payload)]), [['POST', '/api/v1/inventory/movements/' + f.A.movementId + '/correct', { reason: row.ownDraft }]]);
            await observe(row, page, f, 'original-intent-recovered-terminal');
          } else {
            check(row, 'regrant never silently changes explicitly chosen operation', await page.getByRole('button', { name: 'Операция', exact: true }).innerText(), 'Передача в ремонт');
            await page.getByRole('button', { name: 'Операция', exact: true }).click(); await page.getByRole('option', { name: 'Списание', exact: true }).click();
            check(row, 'restored writeoff chosen explicitly', await page.getByRole('button', { name: 'Операция', exact: true }).innerText(), 'Списание');
            check(row, 'explicit restored writeoff submit available', await page.getByRole('button', { name: 'Записать операцию', exact: true }).isEnabled(), true);
            check(row, 'original own comment survives all explicit operation choices', await page.getByRole('textbox', { name: 'Комментарий', exact: true }).inputValue(), row.ownDraft);
            check(row, 'no repeated writeoff201; explicit choices/restoration never autoPOST', domainRequests(row, f), []); check(row, 'explicit choices full no-effect graph', await snapshot(row, 'explicit-restored-choice-no-write'), before);
            await observe(row, page, f, 'explicit-restored-writeoff-choice-no-repeat');
          }
        }
        row.status = 'passed'; save();
      } catch (error) {
        row.status = 'failed'; row.error = String(error.stack || error); save();
        if (page && !page.isClosed()) try { await observe(row, page, row.fixture, 'failure-before-new-query'); } catch {}
        try { await snapshot(row, 'failure'); } catch {}
      } finally { release(); save(); await ctx.close(); }
      if (row.status !== 'passed') break;
    }
    await admin.close(); proof.status = proof.cases.length === requested.length && proof.cases.every(x => x.status === 'passed') ? 'passed' : 'completed_with_open_cases'; proof.counts = { requested: requested.length, executed: proof.cases.length, passed: proof.cases.filter(x => x.status === 'passed').length }; save(); assert.equal(proof.status, 'passed', 'E499 missing cases remain open');
  } catch (error) { proof.status = 'failed'; proof.error = String(error.stack || error); save(); throw error; }
});
