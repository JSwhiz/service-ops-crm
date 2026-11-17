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
const targets = ['rates', 'budget'];

test('E504 native financial already-sent success ACK only', { timeout: 600000 }, async t => {
  assert.equal(process.env.NATIVE_FINANCIAL_ACK_EXCLUSIVE_SLOT, 'main-explicit');
  assert.equal(process.env.TEST_ISOLATED_DATABASE, 'true');
  const dbUrl = new URL(process.env.DATABASE_URL);
  assert(['localhost', '127.0.0.1'].includes(dbUrl.hostname));
  assert.match(dbUrl.searchParams.get('schema'), /^integration_\d+_\d+$/);
  const dir = path.dirname(process.env.CLOSEOUT_NATIVE_FINANCIAL_ACK_OUTPUT);
  fs.mkdirSync(dir, { recursive: true });
  const proof = { status: 'running', reservedEvidenceId: 'E504', packet: 'already-sent-financial-success-after-read-loss' , authorIsNotReviewer: true, schema: dbUrl.searchParams.get('schema'), cases: [], sourceManifest: [], cleanup: {}, productionTouched: false };
  const save = () => fs.writeFileSync(process.env.CLOSEOUT_NATIVE_FINANCIAL_ACK_OUTPUT, serial(proof) + '\n');
  const db = new PrismaClient();
  const { app, baseUrl } = await createTestApp();
  const api = baseUrl + '/api/v1', ui = 'http://127.0.0.1:3214';
  let front, browser;
  const frontendRoot = process.env.NATIVE_FINANCIAL_ACK_FRONTEND_DIR;
  assert(frontendRoot && path.resolve(frontendRoot) === path.resolve(process.env.NATIVE_FINANCIAL_ACK_ROOT, 'frontend'), 'owned frontend mirror required');
  const freshCopy = require('node:child_process').spawnSync('python3', [dir + '/prepare-mirror.py'], { encoding: 'utf8' }); assert.equal(freshCopy.status, 0, freshCopy.stderr);
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
  freeze(frontendRoot + '/next.config.ts'); freeze(backend + '/test/access-control-native-financial-ack-closeout.acceptance.test.ts');
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
  const founder = await db.user.findUniqueOrThrow({ where: { login: 'founder' } }), role = await db.role.findUniqueOrThrow({ where: { code: 'director' } });
  let admin;
  async function until(fn, label) { for (let i = 0; i < 200; i++) { if (await fn()) return; await delay(100); } throw Error(label); }
  async function context(user) { const c = await browser.newContext({ viewport: { width: 1366, height: 900 } }); await c.route('**/*', r => ['localhost', '127.0.0.1'].includes(new URL(r.request().url()).hostname) ? r.continue() : r.abort()); assert.equal((await c.request.post(api + '/auth/login', { data: { login: user.login, password: 'founder123' } })).status(), 201); assert.equal((await c.request.get(api + '/chats/rooms')).status(), 200); return c; }
  async function post(row, endpoint, data) { const r = await admin.request.post(api + endpoint, { data }), body = await r.json(); row.fixtures.push({ endpoint, request: data, status: r.status(), body }); save(); assert.equal(r.status(), 201); return body; }
  async function denyRead(row, A) {
    const version = (await db.user.findUniqueOrThrow({ where: { id: row.actorId } })).accessVersion;
    const data = { expectedVersion: version, reason: 'E504 actual already committed native write read revoke', changes: [{ actionCode: 'objects.read', effect: 'deny', scope: 'selected', selectedIds: [A.id] }] }, endpoint = api + '/users-access/admin/users/' + row.actorId;
    const p = await admin.request.post(endpoint + '/preview', { data }), preview = await p.json(); row.events.push({ phase: 'canonical-preview', status: p.status(), request: data, body: preview }); save(); assert.equal(p.status(), 201);
    const r = await admin.request.post(endpoint + '/save', { data: { ...data, previewToken: preview.previewToken, previewHash: preview.previewHash } }); row.events.push({ phase: 'canonical-save', status: r.status(), body: await r.json() }); save(); assert.equal(r.status(), 201); return version;
  }
  async function dom(row, page, phase) { row.dom[phase] = await page.locator('body').evaluate(el => ({ text: el.innerText, textContent: el.textContent, fields: [...el.querySelectorAll('input,textarea,select')].map(x => x.value), attributes: [...el.querySelectorAll('*')].flatMap(x => [...x.attributes].filter(a => /^(?:title|aria-label|alt|value)$/.test(a.name)).map(a => a.value)) })); await shot(row, page, phase); save(); return row.dom[phase]; }
  try {
    front = spawn('pnpm', ['exec', 'next', 'dev', '--hostname', '127.0.0.1', '--port', '3214'], { cwd: frontendRoot, detached: true, env: { ...process.env, CRM_PREVIEW_DIST_DIR: cacheName, NEXT_PUBLIC_API_URL: api, NEXT_TELEMETRY_DISABLED: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
    const log = b => { frontendLog.push(String(b)); fs.writeFileSync(dir + '/frontend.log', frontendLog.join('')); }; front.stdout.on('data', log); front.stderr.on('data', log);
    proof.owner = { frontendPid: front.pid, frontendPort: 3214, cacheName, api: baseUrl, redis: process.env.REDIS_URL, bucket: process.env.MINIO_BUCKET }; save();
    await until(async () => { if (front.exitCode !== null) throw Error('owned frontend exited'); try { return (await fetch(ui + '/login')).ok; } catch { return false; } }, 'frontend ready');
    browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true }); admin = await context(founder);
    const requested = process.env.NATIVE_FINANCIAL_ACK_CASES ? process.env.NATIVE_FINANCIAL_ACK_CASES.split(',') : targets; assert(requested.length && requested.every(c => targets.includes(c)));
    for (const key of requested) {
      const actor = await db.user.create({ data: { login: 'nfa_' + randomUUID(), fullName: 'E504 recipient ' + key, passwordHash: founder.passwordHash, roles: { create: { roleId: role.id } } } }), ctx = await context(actor);
      const row = { key, code: key === 'rates' ? 'objects.rates.manage' : 'objects.budget.edit', status: 'running', actorId: actor.id, roleCode: 'director', assertions: [], fixtures: [], graphs: {}, screenshots: [], dom: {}, events: [], network: [], console: [], mutationRequests: [], limits: 'Native already-sent successful DTO delivery after read loss only. No E496 write-leaf phases or E501 server postcommit projection hook replay. K5/K7 existing admission not requested again; native closeout addendum pending independent review.' }; proof.cases.push(row); save();
      let page, bp, release = () => {}, heldTask;
      try {
        const prefix = 'E504_' + key + '_' + randomUUID();
        const A = await post(row, '/objects', { name: prefix + '_PRIVATE_A', address: prefix + '_PRIVATE_ADDRESS', notes: prefix + '_PRIVATE_NOTES', status: 'active' });
        const B = await post(row, '/objects', { name: prefix + '_CONTROL_B', address: 'Own isolated B', status: 'active' });
        row.fixture = { A, B, marker: prefix, amount: 1749, notes: prefix + '_OWN_RATE_REASON', moscowDay: new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Moscow' }).format(new Date()), fixtureSource: 'E496 existing canonical director/native money editor; simplified real object APIs with defaults only, no staffing/lifecycle setup' }; save();
        bp = await ctx.newPage(); await bp.goto(ui + '/objects/' + B.id + '#planning', { waitUntil: 'networkidle' }); await bp.getByRole('heading', { name: B.name, exact: true }).waitFor(); await shot(row, bp, 'B-native-before-baseline');
        page = await ctx.newPage(); page.setDefaultTimeout(25000);
        page.on('pageerror', e => { row.console.push({ type: 'pageerror', message: String(e) }); save(); }); page.on('console', m => { if (['error','warning'].includes(m.type())) { row.console.push({ type: m.type(), message: m.text() }); save(); } });
        page.on('request', r => { if (r.url().startsWith(api) && r.method() !== 'GET') { row.mutationRequests.push({ method: r.method(), path: new URL(r.url()).pathname, payload: r.postData() }); save(); } });
        page.on('response', r => { if (r.url().startsWith(api)) { row.network.push({ method: r.request().method(), path: new URL(r.url()).pathname, status: r.status(), at: new Date().toISOString() }); save(); } });
        await page.goto(ui + '/objects/' + A.id + '#planning', { waitUntil: 'networkidle' }); await page.getByRole('heading', { name: A.name, exact: true }).waitFor();
        let dialog;
        if (key === 'rates') {
          await page.locator('#compensation-versions').getByRole('button', { name: 'Изменить с даты', exact: true }).first().click(); dialog = page.getByRole('dialog', { name: 'Новые условия · Базовые условия объекта', exact: true });
          await dialog.locator('input[name="baseAmount"]').fill('1749'); await dialog.locator('textarea[name="notes"]').fill(row.fixture.notes);
        } else { await page.getByRole('button', { name: 'Изменить бюджет', exact: true }).click(); dialog = page.getByRole('dialog', { name: 'Плановый бюджет расходников', exact: true }); await dialog.getByLabel(/^План на месяц/).fill('1749'); }
        await dom(row, page, 'before-native-submit'); const before = await snapshot(row, 'before-native-submit');
        const writePath = '/api/v1/objects/' + A.id + (key === 'rates' ? '/scheduling/compensation/versions' : '/planning'), method = key === 'rates' ? 'POST' : 'PATCH'; let readyResolve, deliveredResolve, captured = false;
        const ready = new Promise(r => readyResolve = r), deliveryGate = new Promise(r => release = r), delivered = new Promise(r => deliveredResolve = r);
        await page.route('**/api/v1/**', route => {
          if (route.request().method() !== method || new URL(route.request().url()).pathname !== writePath) return route.continue();
          assert.equal(captured, false, 'No second native write before held response'); captured = true;
          heldTask = (async () => { const response = await route.fetch(); row.held = { status: response.status(), body: await response.json(), request: JSON.parse(route.request().postData()), responseReceivedAtUTC: new Date().toISOString(), originalRealResponsePreserved: true }; save(); readyResolve(); await deliveryGate; try { await route.fulfill({ response }); row.delivery = 'fulfilled'; } catch (e) { row.delivery = 'cancelled'; row.deliveryError = String(e); } save(); deliveredResolve(); })(); return heldTask;
        });
        await dialog.getByRole('button', { name: key === 'rates' ? 'Сохранить условия' : 'Сохранить', exact: true }).click(); await bounded(ready, 25000, 'Actual successful native write response not captured');
        check(row, 'held real successful response after actual native commit', row.held.status, key === 'rates' ? 201 : 200); check(row, 'held response is actual authorized DTO not fabricated ACK', 'outcome' in row.held.body, false);
        const committed = await snapshot(row, 'actual-committed-before-read-revoke'); row.commitObservedAtUTC = new Date().toISOString(); save();
        if (key === 'rates') {
          const versions = committed.ObjectCompensationVersion.filter(v => v.objectId === A.id); check(row, 'one exact committed native version independently visible', versions.length, 1); check(row, 'exact requestKey binding from native payload to committed row', versions[0].requestKey, row.held.request.requestKey); check(row, 'same returned and persisted rate version', versions[0].id, row.held.body.version.id); check(row, 'exact persisted amount and own notes', { amount: versions[0].terms.baseAmount, notes: versions[0].terms.notes }, { amount:1749, notes: row.fixture.notes });
        } else { const settings = committed.ObjectPlanningSettings.find(v => v.objectId === A.id); assert(settings); check(row, 'one actual planning update amount independently visible', Number(settings.monthlyBudget),1749); check(row, 'actual planning version increment exactly one', settings.version, row.held.request.expectedVersion + 1); }
        const auditBefore = before.ObjectAuditLog.filter(v => v.objectId === A.id && v.actorUserId === actor.id), auditCommit = committed.ObjectAuditLog.filter(v => v.objectId === A.id && v.actorUserId === actor.id); check(row, 'one native mutation domain audit', auditCommit.length-auditBefore.length,1);
        const bRows = g => Object.fromEntries(Object.entries(g).map(([k,vs]) => [k, vs.filter(v => v.objectId === B.id || v.id === B.id)])); check(row, 'native A commit preserves independent B rows', bRows(committed), bRows(before));
        const version = await denyRead(row,A); const fresh = page.waitForResponse(async r => r.url() === api + '/auth/me' && r.status() === 200 && (await r.json()).accessVersion > version);
        const nativeClosed = page.waitForResponse(r => r.request().method() === 'GET' && new URL(r.url()).pathname === '/api/v1/objects/' + A.id && r.status() === 404);
        await page.evaluate(() => window.dispatchEvent(new Event('focus'))); row.freshProfile = await (await fresh).json(); await bounded(nativeClosed,20000,'native A card404 after selected read revoke absent');
        await page.getByText('Объект не найден или недоступен.', {exact:true}).waitFor(); const closed = await dom(row,page,'fresh-profile-A-card-closed-before-delivery'); check(row,'fresh profile advances while actual successful reply held',row.freshProfile.accessVersion>version,true); check(row,'closed visible body excludes private A marker',closed.text.includes(A.name),false);
        const ar = await ctx.request.get(api + '/objects/' + A.id), br = await ctx.request.get(api + '/objects/' + B.id); row.currentReads = { A:{status:ar.status(),body:await ar.json()}, B:{status:br.status(),body:await br.json()} }; check(row,'fresh A actual API404',ar.status(),404); check(row,'unaffected B actual read200',br.status(),200); check(row,'read revocation causes no domain effects after commit',await snapshot(row,'closed-before-delivery'),committed);
        row.releaseAtUTC = new Date().toISOString(); release(); await bounded(delivered,10000,'actual old successful response delivery absent'); check(row,'same real old response fulfilled',row.delivery,'fulfilled');
        const success = 'Изменение сохранено. Подробности сейчас недоступны.'; await page.getByRole('status').filter({hasText:success}).waitFor(); const terminal = await dom(row,page,'generic-root-ACK-terminal');
        check(row,'native root generic saved acknowledgement visible',terminal.text.includes(success),true);
        for (const marker of [A.name,A.address,A.notes,row.fixture.notes]) check(row,'generic root terminal contains no private source/input marker '+marker,serial(terminal).includes(marker),false);
        check(row,'no financial editor or private card after acknowledgement',await page.getByRole('dialog').count(),0); check(row,'root ACK no second domain write',await snapshot(row,'after-ACK'),committed);
        await bp.reload({waitUntil:'networkidle'}); check(row,'unaffected B still native visible after A ACK',await bp.getByRole('heading',{name:B.name,exact:true}).isVisible(),true); await shot(row,bp,'B-native-after-A-ACK'); check(row,'B native control preserves entire committed domain graph',await snapshot(row,'after-B-native-control'),committed);
        const writes = row.mutationRequests.filter(v => !v.path.startsWith('/api/v1/auth/') && !(v.method === 'POST' && v.path === '/api/v1/objects/'+A.id+'/scheduling/preview' && serial(JSON.parse(v.payload)) === serial({from:row.fixture.moscowDay,to:row.fixture.moscowDay})));
        check(row,'one original native financial command only no replay',writes.map(v=>[v.method,v.path,JSON.parse(v.payload)]),[[method,writePath,row.held.request]]); row.status='passed';save();
      } catch(e) { row.status='failed';row.error=String(e.stack||e);save(); if(page&&!page.isClosed())try{await dom(row,page,'actual-failure');}catch{} try{await snapshot(row,'failure');}catch{} }
      finally { release();if(heldTask)await Promise.allSettled([heldTask]);await ctx.close(); }
    }
    await admin.close();proof.counts={requested:requested.length,executed:proof.cases.length,passed:proof.cases.filter(c=>c.status==='passed').length};proof.status=proof.counts.passed===requested.length?'passed':'completed_with_open_cases';save();assert.equal(proof.status,'passed');
  } catch(e){proof.error=String(e.stack||e);if(proof.status==='running')proof.status='failed';save();throw e;}
});
