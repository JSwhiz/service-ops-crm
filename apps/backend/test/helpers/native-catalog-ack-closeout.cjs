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
const targets = ['item', 'template'];

test('E514 native catalog already-sent success ACK only', { timeout: 600000 }, async t => {
  assert.equal(process.env.NATIVE_CATALOG_ACK_EXCLUSIVE_SLOT, 'main-explicit');
  assert.equal(process.env.TEST_ISOLATED_DATABASE, 'true');
  const dbUrl = new URL(process.env.DATABASE_URL);
  assert(['localhost', '127.0.0.1'].includes(dbUrl.hostname));
  assert.match(dbUrl.searchParams.get('schema'), /^integration_\d+_\d+$/);
  const dir = path.dirname(process.env.CLOSEOUT_NATIVE_CATALOG_ACK_OUTPUT);
  fs.mkdirSync(dir, { recursive: true });
  const proof = { status: 'running', reservedEvidenceId: 'E514', packet: 'already-sent-catalog-success-after-read-or-root-loss' , authorIsNotReviewer: true, schema: dbUrl.searchParams.get('schema'), cases: [], sourceManifest: [], cleanup: {}, productionTouched: false };
  const save = () => fs.writeFileSync(process.env.CLOSEOUT_NATIVE_CATALOG_ACK_OUTPUT, serial(proof) + '\n');
  const db = new PrismaClient();
  const { app, baseUrl } = await createTestApp();
  const api = baseUrl + '/api/v1', ui = 'http://127.0.0.1:3214';
  let front, browser;
  const frontendRoot = process.env.NATIVE_CATALOG_ACK_FRONTEND_DIR;
  assert(frontendRoot && path.resolve(frontendRoot) === path.resolve(process.env.NATIVE_CATALOG_ACK_ROOT, 'frontend'), 'owned frontend mirror required');
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
  freeze(frontendRoot + '/next.config.ts'); freeze(backend + '/test/access-control-native-catalog-ack-closeout.acceptance.test.ts');
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
  const founder = await db.user.findUniqueOrThrow({ where: { login: 'founder' } }), role = await db.role.findUniqueOrThrow({ where: { code: 'director' } }); let admin;
  async function until(fn, label) { for (let i=0;i<200;i++){if(await fn())return;await delay(100);}throw Error(label); }
  async function actor(label){return db.user.create({data:{login:'nca_'+randomUUID(),fullName:'E514 '+label,passwordHash:founder.passwordHash,roles:{create:{roleId:role.id}}}});}
  async function context(user){const c=await browser.newContext({viewport:{width:1366,height:900}});await c.route('**/*',r=>['localhost','127.0.0.1'].includes(new URL(r.request().url()).hostname)?r.continue():r.abort());assert.equal((await c.request.post(api+'/auth/login',{data:{login:user.login,password:'founder123'}})).status(),201);assert.equal((await c.request.get(api+'/chats/rooms')).status(),200);return c;}
  async function post(row,endpoint,data){const r=await admin.request.post(api+endpoint,{data}),body=await r.json();row.fixtures.push({endpoint,request:data,status:r.status(),body});save();assert.equal(r.status(),201);return body;}
  async function deny(row,code){const version=(await db.user.findUniqueOrThrow({where:{id:row.actorId}})).accessVersion;const data={expectedVersion:version,reason:'E514 actual native committed catalog reply read/root revoke',changes:[{actionCode:code,effect:'deny',scope:'all'}]},endpoint=api+'/users-access/admin/users/'+row.actorId;const p=await admin.request.post(endpoint+'/preview',{data}),preview=await p.json();row.events.push({phase:'canonical-preview',status:p.status(),request:data,body:preview});save();assert.equal(p.status(),201);const r=await admin.request.post(endpoint+'/save',{data:{...data,previewToken:preview.previewToken,previewHash:preview.previewHash}});row.events.push({phase:'canonical-save',status:r.status(),body:await r.json()});save();assert.equal(r.status(),201);return version;}
  async function dom(row,page,phase){row.dom[phase]=await page.locator('body').evaluate(el=>({text:el.innerText,textContent:el.textContent,fields:[...el.querySelectorAll('input,textarea,select')].map(x=>x.value),attributes:[...el.querySelectorAll('*')].flatMap(x=>[...x.attributes].filter(a=>/^(?:title|aria-label|alt|value)$/.test(a.name)).map(a=>a.value))}));await shot(row,page,phase);save();return row.dom[phase];}
  try{
    front=spawn('pnpm',['exec','next','dev','--hostname','127.0.0.1','--port','3214'],{cwd:frontendRoot,detached:true,env:{...process.env,CRM_PREVIEW_DIST_DIR:cacheName,NEXT_PUBLIC_API_URL:api,NEXT_TELEMETRY_DISABLED:'1'},stdio:['ignore','pipe','pipe']});const log=b=>{frontendLog.push(String(b));fs.writeFileSync(dir+'/frontend.log',frontendLog.join(''));};front.stdout.on('data',log);front.stderr.on('data',log);proof.owner={frontendPid:front.pid,frontendPort:3214,cacheName,api:baseUrl,redis:process.env.REDIS_URL,bucket:process.env.MINIO_BUCKET};save();await until(async()=>{if(front.exitCode!==null)throw Error('owned frontend exited');try{return(await fetch(ui+'/login')).ok;}catch{return false;}},'frontend ready');browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});admin=await context(founder);
    const requested=process.env.NATIVE_CATALOG_ACK_CASES?process.env.NATIVE_CATALOG_ACK_CASES.split(','):targets;assert(requested.length&&requested.every(k=>targets.includes(k)));
    for(const key of requested){
      const a=await actor(key+' recipient'),b=await actor(key+' independent B controller'),ctx=await context(a),control=await context(b),row={key,code:key==='item'?'specification_catalog.read':'specification_catalog.access',status:'running',actorId:a.id,controlActorId:b.id,roleCode:'director',assertions:[],fixtures:[],graphs:{},screenshots:[],dom:{},events:[],network:[],console:[],mutationRequests:[],limits:'Only already-sent native catalog edit success held until read/root revoke/fresh profile. No E50572/live catalog, E512 root-before-commit/API-hook or CRUD acceptance replay. Locked create/update grants never forged: original director baseline authority. All-only denial applies to same actor across catalog; unaffected B uses separate director.'};proof.cases.push(row);save();let page,bp,release=()=>{},heldTask;
      try{
        const marker='E514_'+key+'_'+randomUUID(),route='/one-time-orders/specification-catalog',templates='/one-time-orders/specification-templates',itemA=await post(row,route,{title:marker+'_ITEM_A',description:marker+'_PRIVATE_DESCRIPTION'}),itemB=await post(row,route,{title:marker+'_ITEM_B'}),templateA=await post(row,templates,{name:marker+'_TEMPLATE_A',items:[{catalogItemId:itemA.id,sortOrder:0}]}),templateB=await post(row,templates,{name:marker+'_TEMPLATE_B',items:[{catalogItemId:itemB.id,sortOrder:0}]});row.fixture={itemA,itemB,templateA,templateB,marker,newValue:marker+'_OWN_EDITED_VALUE'};save();
        bp=await control.newPage();await bp.goto(ui+route,{waitUntil:'networkidle'});await bp.getByRole('button',{name:'Изменить пункт: '+itemB.title,exact:true}).waitFor();await shot(row,bp,'independent-B-native-before-baseline');
        page=await ctx.newPage();page.setDefaultTimeout(25000);page.on('pageerror',e=>{row.console.push({type:'pageerror',message:String(e)});save();});page.on('console',m=>{if(['error','warning'].includes(m.type())){row.console.push({type:m.type(),message:m.text()});save();}});page.on('request',r=>{if(r.url().startsWith(api)&&r.method()!=='GET'){row.mutationRequests.push({method:r.method(),path:new URL(r.url()).pathname,payload:r.postData()});save();}});page.on('response',r=>{if(r.url().startsWith(api)){row.network.push({method:r.request().method(),path:new URL(r.url()).pathname,status:r.status(),at:new Date().toISOString()});save();}});
        await page.goto(ui+route,{waitUntil:'networkidle'});await page.getByRole('button',{name:'Изменить пункт: '+itemA.title,exact:true}).waitFor();
        if(key==='item'){await page.getByRole('button',{name:'Изменить пункт: '+itemA.title,exact:true}).click();await page.locator('input[name="catalogItemTitle"]').fill(row.fixture.newValue);}else{await page.getByRole('button',{name:'Изменить шаблон: '+templateA.name,exact:true}).click();await page.locator('input[name="templateName"]').fill(row.fixture.newValue);}
        await dom(row,page,'before-native-submit');const before=await snapshot(row,'before-native-submit');const writePath='/api/v1'+(key==='item'?route+'/'+itemA.id:templates+'/'+templateA.id);let readyResolve,deliveredResolve,captured=false;const ready=new Promise(r=>readyResolve=r),gate=new Promise(r=>release=r),delivered=new Promise(r=>deliveredResolve=r);
        await page.route('**/api/v1/**',r=>{if(r.request().method()!=='PATCH'||new URL(r.request().url()).pathname!==writePath)return r.continue();assert.equal(captured,false,'No second command while reply held');captured=true;heldTask=(async()=>{const response=await r.fetch();row.held={status:response.status(),body:await response.json(),request:JSON.parse(r.request().postData()),responseReceivedAtUTC:new Date().toISOString(),originalRealResponsePreserved:true};save();readyResolve();await gate;try{await r.fulfill({response});row.delivery='fulfilled';}catch(e){row.delivery='cancelled';row.deliveryError=String(e);}save();deliveredResolve();})();return heldTask;});
        await page.getByRole('button',{name:key==='item'?'Сохранить пункт':'Сохранить шаблон',exact:true}).click();await bounded(ready,25000,'actual successful native PATCH response absent');check(row,'held real native successful response200',row.held.status,200);check(row,'held response actual full DTO not forged ACK','outcome'in row.held.body,false);check(row,'actual DTO exact source identity',row.held.body.id,key==='item'?itemA.id:templateA.id);
        const committed=await snapshot(row,'actual-committed-before-read-revoke');row.commitObservedAtUTC=new Date().toISOString();save();
        const model=key==='item'?'OneTimeOrderSpecificationCatalogItem':'OneTimeOrderSpecificationTemplate',id=key==='item'?itemA.id:templateA.id,persisted=committed[model].find(v=>v.id===id);assert(persisted);check(row,'exact own native value independently committed',key==='item'?persisted.title:persisted.name,row.fixture.newValue);check(row,'same returned and committed original source row',persisted.id,row.held.body.id);
        if(key==='template'){check(row,'exact original expectedVersion native input',row.held.request.expectedVersion,templateA.version);check(row,'exactly one native template version increment',persisted.version,templateA.version+1);}
        const audits=committed.AuditEvent.filter(v=>!before.AuditEvent.some(w=>w.id===v.id));check(row,'one exact native catalog mutation audit',audits.map(v=>[v.entityId,v.actorUserId,v.action]),[[id,a.id,key==='item'?'one_time_order.specification_catalog_item_updated':'one_time_order.specification_template_updated']]);
        for(const m of ['OneTimeOrderSpecificationCatalogItem','OneTimeOrderSpecificationTemplate']){const bid=m==='OneTimeOrderSpecificationCatalogItem'?itemB.id:templateB.id;check(row,'independent B persisted source unchanged '+m,committed[m].find(v=>v.id===bid),before[m].find(v=>v.id===bid));}
        const version=await deny(row,row.code),fresh=page.waitForResponse(async r=>r.url()===api+'/auth/me'&&r.status()===200&&(await r.json()).accessVersion>version);await page.evaluate(()=>window.dispatchEvent(new Event('focus')));row.freshProfile=await(await fresh).json();await page.getByText(/^У вас нет доступа к каталогу ТЗ\./).waitFor();await dom(row,page,'fresh-profile-catalog-closed-before-delivery');check(row,'fresh profile advanced while real success held',row.freshProfile.accessVersion>version,true);
        row.currentReads=[];for(const endpoint of [route,templates]){const response=await ctx.request.get(api+endpoint);row.currentReads.push({endpoint,status:response.status(),body:await response.json()});check(row,'actual recipient catalog read403 after exact deny '+endpoint,response.status(),403);}check(row,'canonical read/root revoke causes no domain effects after commit',await snapshot(row,'closed-before-delivery'),committed);
        row.releaseAtUTC=new Date().toISOString();release();await bounded(delivered,10000,'actual unchanged response delivery absent');check(row,'same successful original response fulfilled unchanged',row.delivery,'fulfilled');const success='Изменение сохранено. Подробности сейчас недоступны.';await page.getByRole('status').filter({hasText:success}).waitFor();const terminal=await dom(row,page,'generic-root-ACK-terminal');check(row,'generic central native saved ACK visible',terminal.text.includes(success),true);
        for(const value of [itemA.title,itemA.description,itemB.title,templateA.name,templateB.name,row.fixture.newValue])check(row,'no protected catalog/editor marker in terminal '+value,serial(terminal).includes(value),false);check(row,'no item/template editor after ACK',await page.locator('input[name="catalogItemTitle"],input[name="templateName"]').count(),0);check(row,'ACK preserves exact already committed domain graph',await snapshot(row,'after-ACK'),committed);
        await bp.reload({waitUntil:'networkidle'});check(row,'separate unaffected B native catalog control visible',await bp.getByRole('button',{name:'Изменить пункт: '+itemB.title,exact:true}).isVisible(),true);await shot(row,bp,'independent-B-native-after-A-ACK');const br=await control.request.get(api+route);row.independentBRead={status:br.status(),body:await br.json()};check(row,'independent B actual catalog read200',br.status(),200);check(row,'independent B native/read control leaves committed graph exact',await snapshot(row,'after-B-native-control'),committed);
        check(row,'one original native PATCH only no second command/replay',row.mutationRequests.filter(v=>!v.path.startsWith('/api/v1/auth/')).map(v=>[v.method,v.path,JSON.parse(v.payload)]),[['PATCH',writePath,row.held.request]]);check(row,'terminal ACK did not auto-load catalog again',row.network.filter(v=>v.method==='GET'&&[ '/api/v1'+route,'/api/v1'+templates].includes(v.path)&&v.at>row.releaseAtUTC).length,0);row.status='passed';save();
      }catch(e){row.status='failed';row.error=String(e.stack||e);save();if(page&&!page.isClosed())try{await dom(row,page,'actual-failure');}catch{}try{await snapshot(row,'failure');}catch{}}
      finally{release();if(heldTask)await Promise.allSettled([heldTask]);await ctx.close();await control.close();}
    }
    await admin.close();proof.counts={requested:requested.length,executed:proof.cases.length,passed:proof.cases.filter(v=>v.status==='passed').length};proof.status=proof.counts.passed===requested.length?'passed':'completed_with_open_cases';save();assert.equal(proof.status,'passed');
  }catch(e){proof.error=String(e.stack||e);if(proof.status==='running')proof.status='failed';save();throw e;}
});
