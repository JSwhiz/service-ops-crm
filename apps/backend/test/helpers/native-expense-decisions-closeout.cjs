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
const targets = ['accountability.expenses.approve', 'accountability.expenses.reject'];

test('E502 only retained-write-intent manual native reject continuation', { timeout: 600000 }, async t => {
  assert.equal(process.env.NATIVE_EXPENSE_DECISIONS_EXCLUSIVE_SLOT, 'main-explicit');
  assert.equal(process.env.TEST_ISOLATED_DATABASE, 'true');
  const dbUrl = new URL(process.env.DATABASE_URL);
  assert(['localhost', '127.0.0.1'].includes(dbUrl.hostname));
  assert.match(dbUrl.searchParams.get('schema'), /^integration_\d+_\d+$/);
  const dir = path.dirname(process.env.CLOSEOUT_NATIVE_EXPENSE_DECISIONS_OUTPUT);
  fs.mkdirSync(dir, { recursive: true });
  const proof = { status: 'running', reservedEvidenceId: 'E502', packet: 'approved-personal-expense-decisions' , authorIsNotReviewer: true, schema: dbUrl.searchParams.get('schema'), cases: [], sourceManifest: [], cleanup: {}, productionTouched: false };
  const save = () => fs.writeFileSync(process.env.CLOSEOUT_NATIVE_EXPENSE_DECISIONS_OUTPUT, serial(proof) + '\n');
  const db = new PrismaClient();
  const { app, baseUrl } = await createTestApp();
  const api = baseUrl + '/api/v1', ui = 'http://127.0.0.1:3214';
  let front, browser;
  const frontendRoot = process.env.NATIVE_EXPENSE_DECISIONS_FRONTEND_DIR;
  assert(frontendRoot && path.resolve(frontendRoot) === path.resolve(process.env.NATIVE_EXPENSE_DECISIONS_ROOT, 'frontend'), 'owned frontend mirror required');
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
  freeze(frontendRoot + '/next.config.ts'); freeze(backend + '/test/access-control-native-expense-decisions-closeout.acceptance.test.ts');
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
  const founder = await db.user.findUniqueOrThrow({ where: { login: 'founder' } }), managerRole = await db.role.findUniqueOrThrow({ where: { code: 'manager' } });
  async function actor(label) { return db.user.create({ data: { login: 'nep_' + randomUUID(), fullName: label + '_' + randomUUID(), passwordHash: founder.passwordHash, roles: { create: { roleId: managerRole.id } } } }); }
  async function until(fn, label) { for (let i = 0; i < 200; i++) { if (await fn()) return; await delay(100); } throw Error(label); }
  let admin;
  async function context(user) { const c = await browser.newContext({ viewport: { width: 1366, height: 900 } }); await c.route('**/*', r => ['localhost', '127.0.0.1'].includes(new URL(r.request().url()).hostname) ? r.continue() : r.abort()); assert.equal((await c.request.post(api + '/auth/login', { data: { login: user.login, password: 'founder123' } })).status(), 201); assert.equal((await c.request.get(api + '/chats/rooms')).status(), 200); return c; }
  async function post(row, c, endpoint, data, expected = 201) { const r = await c.request.post(api + endpoint, { data }), body = await r.json(); row.fixtures.push({ endpoint, status: r.status(), request: data, body }); save(); assert.equal(r.status(), expected, 'exact source fixture ' + endpoint); return body; }
  async function rule(row, code, effect, ids, target = row.actorId) {
    const version = (await db.user.findUniqueOrThrow({ where: { id: target } })).accessVersion;
    const data = { expectedVersion: version, reason: 'E502 owner-approved personal expense exact source ' + effect, changes: [{ actionCode: code, effect, scope: 'selected', selectedIds: ids }] }, endpoint = api + '/users-access/admin/users/' + target;
    const p = await admin.request.post(endpoint + '/preview', { data }), preview = await p.json(); row.events.push({ phase: 'preview', target, issuer: founder.id, request: data, status: p.status(), body: preview }); save(); assert.equal(p.status(), 201);
    const r = await admin.request.post(endpoint + '/save', { data: { ...data, previewToken: preview.previewToken, previewHash: preview.previewHash } }); row.events.push({ phase: 'save', target, status: r.status(), body: await r.json() }); save(); assert.equal(r.status(), 201); return version;
  }
  async function refresh(row, page, version, label) { const promise = page.waitForResponse(async r => r.url() === api + '/auth/me' && r.status() === 200 && (await r.json()).accessVersion > version); await page.evaluate(() => window.dispatchEvent(new Event('focus'))); row.events.push({ phase: label, profile: await (await promise).json(), at: new Date().toISOString() }); save(); await delay(200); }
  async function dom(row, page, phase) { const d = { text: await page.locator('body').innerText(), fields: await page.locator('input,textarea').evaluateAll(xs => xs.map(x => ({ value: x.value, disabled: x.disabled, visible: !!x.getClientRects().length, tag: x.tagName }))) }; row.dom[phase] = d; await shot(row, page, phase); save(); return d; }
  const mutations = row => row.mutationRequests.filter(x => !x.path.startsWith('/api/v1/auth/'));
  async function selectAccount(page, owner) { await page.getByRole('button', { name: 'Пользователь', exact: true }).click(); const option = page.getByRole('option').filter({ hasText: owner.fullName }); assert.equal(await option.count(), 1, 'exact own fixture account option'); await option.click(); }
  function card(page, expense, own = false) { return page.locator('#' + (own ? 'own' : 'review') + '-account-panel-expenses .record-list > div').filter({ hasText: expense.description }); }
  async function expense(row, owner, description) { const c = await context(owner); try { await post(row, admin, '/accountability/accounts/' + owner.id + '/fundings', { amount: 1000, comment: 'E502 own isolated account fixture' }); const e = await post(row, c, '/accountability/me/expenses', { amount: 137, description, expenseDate: new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Moscow' }).format(new Date()) }); await post(row, c, '/accountability/me/expenses/' + e.id + '/submit', {}, 200); return e; } finally { await c.close(); } }
  try {
    front = spawn('pnpm', ['exec', 'next', 'dev', '--hostname', '127.0.0.1', '--port', '3214'], { cwd: frontendRoot, detached: true, env: { ...process.env, CRM_PREVIEW_DIST_DIR: cacheName, NEXT_PUBLIC_API_URL: api, NEXT_TELEMETRY_DISABLED: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
    const log = b => { frontendLog.push(String(b)); fs.writeFileSync(dir + '/frontend.log', frontendLog.join('')); }; front.stdout.on('data', log); front.stderr.on('data', log);
    proof.owner = { frontendPid: front.pid, frontendPort: 3214, cacheName, api: baseUrl, redis: process.env.REDIS_URL, bucket: process.env.MINIO_BUCKET }; save();
    await until(async () => { if (front.exitCode !== null) throw Error('owned frontend exited'); try { return (await fetch(ui + '/login')).ok; } catch { return false; } }, 'frontend ready');
    browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true }); admin = await context(founder);
    assert.equal(process.env.NATIVE_EXPENSE_DECISIONS_CASES,'accountability.expenses.reject');
    const a=await actor('E502 manual-only recipient'),ownerA=await actor('E502 manual-only owner A'),ownerB=await actor('E502 manual-only unchanged owner B'),ctx=await context(a),prefix='E502_MANUAL_'+randomUUID(),code='accountability.expenses.reject';
    const row={key:'accountability-expenses-reject-manual-only',id:code+'/K5',code,actorId:a.id,status:'running',assertions:[],fixtures:[],graphs:{},screenshots:[],dom:{},network:[],console:[],mutationRequests:[],events:[],limits:'Only missing explicit native manual reject from original write-only retained typed reason/source. Old isolated cohort deleted: new actual API expense/read+review+reject selected grants and minimal deny/regrant readiness overlap required to bind same typed text. Approve130 and reject23 held/B/read-closure proof retained; no held-response, parent READcycle, selfapproval or API policy replay.'};proof.cases.push(row);save();let page;
    try{
      const A=await expense(row,ownerA,prefix+'_EXPENSE_A'),B=await expense(row,ownerB,prefix+'_EXPENSE_B');row.fixture={A,B,ownerA,ownerB,recipient:a.id,ownReason:prefix+'_ORIGINAL_TYPED_BEFORE_WRITE_DENY',page:'/accountability?section=accounts&accountSection=expenses'};const f=row.fixture;save();
      await rule(row,'accountability.read','allow',[ownerA.id,ownerB.id]);await rule(row,'accountability.review','allow',[ownerA.id,ownerB.id]);await rule(row,code,'allow',[ownerA.id]);
      page=await ctx.newPage();page.setDefaultTimeout(25000);page.on('pageerror',e=>{row.console.push({type:'pageerror',message:String(e)});save();});page.on('console',m=>{if(['error','warning'].includes(m.type())){row.console.push({type:m.type(),message:m.text()});save();}});page.on('request',r=>{if(r.url().startsWith(api)&&r.method()!=='GET'){row.mutationRequests.push({method:r.method(),path:new URL(r.url()).pathname,payload:r.postData()});save();}});page.on('response',r=>{if(r.url().startsWith(api)){row.network.push({method:r.request().method(),path:new URL(r.url()).pathname,status:r.status(),at:new Date().toISOString()});save();}});
      await page.goto(ui+f.page,{waitUntil:'networkidle'});await selectAccount(page,ownerA);await card(page,A).getByRole('button',{name:'Отклонить',exact:true}).click();await card(page,A).getByPlaceholder('Укажите причину отклонения').fill(f.ownReason);await dom(row,page,'original-typed-reason-before-minimal-write-deny');const before=await snapshot(row,'original-typed-before-write-deny');
      const deny=await rule(row,code,'deny',[ownerA.id]);await refresh(row,page,deny,'minimal-fresh-write-only-deny');await card(page,A).getByText('Отклонение расхода недоступно. Причина сохранена в черновике. Проверьте доступ и состояние расхода перед повторным действием.',{exact:true}).waitFor();
      check(row,'minimal new-cohort same typed reason retained under write-only revoke',await card(page,A).getByPlaceholder('Укажите причину отклонения').inputValue(),f.ownReason);check(row,'minimal current denied confirm disabled',await card(page,A).getByRole('button',{name:'Подтвердить отклонение',exact:true}).isDisabled(),true);const denied=await ctx.request.get(api+'/accountability/accounts/'+ownerA.id);row.currentDeniedRead={status:denied.status(),body:await denied.json()};check(row,'minimal write-denied source still actual read200',denied.status(),200);check(row,'same exact target current denied capability',row.currentDeniedRead.body.expenses.find(v=>v.id===A.id).capabilities.canReject,false);check(row,'minimal write-deny graph unchanged',await snapshot(row,'write-only-denied'),before);await dom(row,page,'same-original-reason-current-write-deny');
      const grant=await rule(row,code,'allow',[ownerA.id]);await refresh(row,page,grant,'minimal-fresh-write-regrant');await until(async()=>!(await card(page,A).getByRole('button',{name:'Подтвердить отклонение',exact:true}).isDisabled()),'fresh authorized original confirm absent');const current=await ctx.request.get(api+'/accountability/accounts/'+ownerA.id);row.currentAuthorizedRead={status:current.status(),body:await current.json()};check(row,'fresh exact target read200 before separate manual submit',current.status(),200);check(row,'fresh exact original source currently rejectable',row.currentAuthorizedRead.body.expenses.find(v=>v.id===A.id).capabilities.canReject,true);check(row,'same original typed reason recovered without second input',await card(page,A).getByPlaceholder('Укажите причину отклонения').inputValue(),f.ownReason);check(row,'no auto decision before explicit manual continuation',mutations(row),[]);check(row,'minimal access-check/regrant full graph unchanged',await snapshot(row,'fresh-authorized-before-manual'),before);await dom(row,page,'same-original-intent-before-one-manual-submit');
      const path='/api/v1/accountability/expenses/'+A.id+'/reject',pending=page.waitForResponse(r=>r.request().method()==='POST'&&new URL(r.url()).pathname===path);await card(page,A).getByRole('button',{name:'Подтвердить отклонение',exact:true}).click();const response=await pending;row.manual={status:response.status(),body:await response.json()};save();check(row,'actual explicit native original-intent reject200',response.status(),200);await until(async()=>(await db.accountabilityExpense.findUniqueOrThrow({where:{id:A.id}})).status==='rejected','real native rejection commit absent');await delay(350);
      const final=await snapshot(row,'one-manual-reject-result'),oldSource=before.AccountabilityExpense.find(v=>v.id===A.id),source=final.AccountabilityExpense.find(v=>v.id===A.id);check(row,'one exact original expense rejected','rejected',source.status);check(row,'same actor applied native rejection',source.rejectedByUserId,a.id);check(row,'exact original typed before-revoke reason committed',source.rejectionComment,f.ownReason);
      const normalized={...source};for(const field of ['status','approvedByUserId','approvedAt','rejectedByUserId','rejectedAt','rejectionComment','updatedAt'])normalized[field]=oldSource[field];check(row,'original A identity amount day and all references unchanged',normalized,oldSource);const audits=final.AuditEvent.filter(v=>!before.AuditEvent.some(w=>w.id===v.id));check(row,'one exact A native decision audit only',audits.map(v=>[v.entityId,v.actorUserId,v.action]),[[A.id,a.id,'accountability_expense_rejected']]);
      for(const model of Object.keys(before)){const skip=model==='AccountabilityExpense'?[A.id]:model==='AuditEvent'?audits.map(v=>v.id):[];check(row,'manual reject preserves every prior and independent B row '+model,final[model].filter(v=>!skip.includes(v.id)),before[model].filter(v=>!skip.includes(v.id)));}
      check(row,'exact one original manual reject command no retry',mutations(row).map(v=>[v.method,v.path,JSON.parse(v.payload)]),[['POST',path,{comment:f.ownReason}]]);await dom(row,page,'native-manual-original-reason-terminal');row.status='passed';proof.status='passed';proof.counts={requested:1,executed:1,passed:1};save();
    }catch(e){row.status='failed';row.error=String(e.stack||e);proof.status='failed';save();if(page&&!page.isClosed())try{await dom(row,page,'actual-failure');}catch{}try{await snapshot(row,'failure');}catch{}throw e;}
    finally{await ctx.close();await admin.close();}
  }catch(e){proof.error=String(e.stack||e);if(proof.status==='running')proof.status='failed';save();throw e;}
});
