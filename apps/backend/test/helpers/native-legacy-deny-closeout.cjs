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
const targets = ['legacy-founder-workflow-ACK'];

test('E508 native legacy deny founder workflow and knowncommit ACK only', { timeout: 600000 }, async t => {
  assert.equal(process.env.NATIVE_LEGACY_DENY_EXCLUSIVE_SLOT, 'main-explicit');
  assert.equal(process.env.TEST_ISOLATED_DATABASE, 'true');
  const dbUrl = new URL(process.env.DATABASE_URL);
  assert(['localhost', '127.0.0.1'].includes(dbUrl.hostname));
  assert.match(dbUrl.searchParams.get('schema'), /^integration_\d+_\d+$/);
  const dir = path.dirname(process.env.CLOSEOUT_NATIVE_LEGACY_DENY_OUTPUT);
  fs.mkdirSync(dir, { recursive: true });
  const proof = { status: 'running', reservedEvidenceId: 'E508', packet: 'legacy-founder-native-only-missing-workflow' , authorIsNotReviewer: true, schema: dbUrl.searchParams.get('schema'), cases: [], sourceManifest: [], cleanup: {}, productionTouched: false };
  const save = () => fs.writeFileSync(process.env.CLOSEOUT_NATIVE_LEGACY_DENY_OUTPUT, serial(proof) + '\n');
  const db = new PrismaClient();
  const { app, baseUrl } = await createTestApp();
  const api = baseUrl + '/api/v1', ui = 'http://127.0.0.1:3214';
  const notifications = app.get(req('./src/modules/notifications/notifications.service.ts').NotificationsService); while (notifications.isFlushingOutbox) await delay(20); notifications.onModuleDestroy(); proof.ownNotificationPublisherStoppedBeforeFixtures = notifications.outboxTimer === null;
  let front, browser;
  const frontendRoot = process.env.NATIVE_LEGACY_DENY_FRONTEND_DIR;
  assert(frontendRoot && path.resolve(frontendRoot) === path.resolve(process.env.NATIVE_LEGACY_DENY_ROOT, 'frontend'), 'owned frontend mirror required');
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
  freeze(frontendRoot + '/next.config.ts'); freeze(backend + '/test/access-control-native-legacy-deny-closeout.acceptance.test.ts');
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
  const founder=await db.user.findUniqueOrThrow({where:{login:'founder'}}),founderRole=await db.role.findUniqueOrThrow({where:{code:'founder'}}),hrRole=await db.role.findUniqueOrThrow({where:{code:'hr'}}),negative=await db.permission.findUniqueOrThrow({where:{code:'candidates.denied'}});let admin,ctx,targetCtx,control;
  const row={key:'legacy-founder-workflow-ACK',id:'candidates.denied/K5',status:'running',assertions:[],graphs:{},screenshots:[],dom:{},events:[],network:[],console:[],mutationRequests:[],limits:'Only native founder reason/preview/late old version catch/one manual legacy-removal201+same-cookie Candidate recovery and known successful reply after admin root revoke. Existing API59/E515post4x72/controlUI10/P01 not rerun. Actor/HR historical UserPermission/Candidate/object bootstrap states explicitly fixtures, not business lifecycle execution. Generic admin-save native consumer not claimed.'};proof.cases.push(row);save();let page,tp,bp,previewRelease=()=>{},oldDeliveryRelease=()=>{},saveRelease=()=>{},oldTask,saveTask;
  async function until(fn,label){for(let i=0;i<200;i++){if(await fn())return;await delay(100);}throw Error(label);}
  async function context(user){const c=await browser.newContext({viewport:{width:1366,height:900}});await c.route('**/*',r=>['localhost','127.0.0.1'].includes(new URL(r.request().url()).hostname)?r.continue():r.abort());assert.equal((await c.request.post(api+'/auth/login',{data:{login:user.login,password:'founder123'}})).status(),201);assert.equal((await c.request.get(api+'/chats/rooms')).status(),200);return c;}
  async function rule(target,code,ids=[]){const version=(await db.user.findUniqueOrThrow({where:{id:target}})).accessVersion,data={expectedVersion:version,reason:row.marker+'_canonical_intervening_'+code,changes:[{actionCode:code,effect:'deny',scope:ids.length?'selected':'all',selectedIds:ids}]},ep=api+'/users-access/admin/users/'+target;const p=await admin.request.post(ep+'/preview',{data}),pv=await p.json();row.events.push({phase:'canonical-preview',target,status:p.status(),request:data,body:pv});save();assert.equal(p.status(),201);const r=await admin.request.post(ep+'/save',{data:{...data,previewToken:pv.previewToken,previewHash:pv.previewHash}});row.events.push({phase:'canonical-save',target,status:r.status(),body:await r.json()});save();assert.equal(r.status(),201);return version;}
  async function fresh(p,version,label){const r=p.waitForResponse(async z=>z.url()===api+'/auth/me'&&z.status()===200&&(await z.json()).accessVersion>version);await p.evaluate(()=>window.dispatchEvent(new Event('focus')));row.events.push({phase:label,profile:await(await r).json(),at:new Date().toISOString()});save();}
  async function dom(p,phase){row.dom[phase]=await p.locator('body').evaluate(el=>{const clone=el.cloneNode(true);clone.querySelectorAll('script,style,noscript').forEach(z=>z.remove());return{text:el.innerText,rawTextContent:el.textContent,semanticText:clone.textContent,fields:[...el.querySelectorAll('input,textarea,select')].map(z=>z.value),attributes:[...el.querySelectorAll('*')].filter(z=>!['SCRIPT','STYLE'].includes(z.tagName)).flatMap(z=>[...z.attributes].filter(a=>/^(?:title|aria-label|alt|value|href)$/.test(a.name)).map(a=>a.value))};});await shot(row,p,phase);save();return row.dom[phase];}
  let target;
  async function targetState(){return JSON.parse(serial({user:await db.user.findUniqueOrThrow({where:{id:target.id},select:{id:true,accessVersion:true}}),permissions:await db.userPermission.findMany({where:{userId:target.id},orderBy:{id:'asc'}}),rules:await db.userAccessRule.findMany({where:{userId:target.id},orderBy:{id:'asc'}}),audit:await db.userAccessAudit.findMany({where:{userId:target.id},orderBy:{versionAfter:'asc'}})}));}
  try{
    front=spawn('pnpm',['exec','next','dev','--hostname','127.0.0.1','--port','3214'],{cwd:frontendRoot,detached:true,env:{...process.env,CRM_PREVIEW_DIST_DIR:cacheName,NEXT_PUBLIC_API_URL:api,NEXT_TELEMETRY_DISABLED:'1'},stdio:['ignore','pipe','pipe']});const log=z=>{frontendLog.push(String(z));fs.writeFileSync(dir+'/frontend.log',frontendLog.join(''));};front.stdout.on('data',log);front.stderr.on('data',log);proof.owner={frontendPid:front.pid,frontendPort:3214,cacheName,api:baseUrl,redis:process.env.REDIS_URL,bucket:process.env.MINIO_BUCKET};save();await until(async()=>{if(front.exitCode!==null)throw Error('owned frontend exited');try{return(await fetch(ui+'/login')).ok;}catch{return false;}},'frontend ready');browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
    row.marker='E508_'+randomUUID();const actor=await db.user.create({data:{login:row.marker+'_FOUNDER',fullName:row.marker+'_FOUNDER',passwordHash:founder.passwordHash,roles:{create:{roleId:founderRole.id}}}});target=await db.user.create({data:{login:row.marker+'_RECIPIENT',fullName:row.marker+'_PRIVATE_RECIPIENT',passwordHash:founder.passwordHash,roles:{create:{roleId:hrRole.id}}}});const b=await db.user.create({data:{login:row.marker+'_B',fullName:row.marker+'_B',passwordHash:founder.passwordHash,roles:{create:{roleId:hrRole.id}}}}),permission=await db.userPermission.create({data:{userId:target.id,permissionId:negative.id}}),object=await db.object.create({data:{name:row.marker+'_PRIVATE_SOURCE',address:'E508 isolated target rule fixture',createdByUserId:founder.id,status:'active'}}),A=await db.candidate.create({data:{fullName:row.marker+'_CANDIDATE_A',candidateType:'reserve',createdByUserId:founder.id}}),B=await db.candidate.create({data:{fullName:row.marker+'_CANDIDATE_B',candidateType:'reserve',createdByUserId:founder.id}});row.actorId=actor.id;row.targetId=target.id;row.controlRecipientId=b.id;row.fixture={actor,target,b,permission,object,A,B,kind:'Explicit new accounts/roles/historical personal deny/Candidate state bootstrap as existing E503 fixture; no candidate CRUD acceptance'};row.reason=row.marker+'_ORIGINAL_OWN_REMOVAL_REASON';save();admin=await context(founder);ctx=await context(actor);targetCtx=await context(target);control=await context(b);
    tp=await targetCtx.newPage();await tp.goto(ui+'/candidates?candidateType=reserve&q='+encodeURIComponent(A.fullName),{waitUntil:'networkidle'});const denied=await targetCtx.request.get(api+'/candidates?candidateType=reserve&q='+encodeURIComponent(A.fullName));row.targetReadBefore={status:denied.status(),body:await denied.json()};check(row,'actual same-cookie target Candidate read403 before removal',denied.status(),403);check(row,'native denied target has no Candidate A marker',(await dom(tp,'target-before-personal-removal')).text.includes(A.fullName),false);
    bp=await control.newPage();await bp.goto(ui+'/candidates?candidateType=reserve&q='+encodeURIComponent(B.fullName),{waitUntil:'networkidle'});await bp.getByText(B.fullName,{exact:true}).first().waitFor();await dom(bp,'B-native-before-baseline');
    page=await ctx.newPage();page.setDefaultTimeout(25000);page.on('pageerror',e=>{row.console.push({type:'pageerror',message:String(e)});save();});page.on('console',m=>{if(['error','warning'].includes(m.type())){row.console.push({type:m.type(),message:m.text()});save();}});page.on('request',r=>{if(r.url().startsWith(api)&&r.method()!=='GET'){row.mutationRequests.push({method:r.method(),path:new URL(r.url()).pathname,payload:r.postData()});save();}});page.on('response',r=>{if(r.url().startsWith(api)){row.network.push({method:r.request().method(),path:new URL(r.url()).pathname,status:r.status(),at:new Date().toISOString()});save();}});await page.goto(ui+'/settings?user='+target.id+'&accessTab=rights',{waitUntil:'networkidle'});const section=page.getByRole('region',{name:'Снятие прежнего персонального запрета кандидатов',exact:true});await section.waitFor();await section.getByLabel('Причина снятия запрета',{exact:false}).fill(row.reason);await dom(page,'founder-own-reason-before-preview');row.targetBefore=await targetState();const before=await snapshot(row,'before-preview');
    const ep='/api/v1/users-access/admin/users/'+target.id+'/legacy-candidate-deny';let oldReached,oldResponseReached,oldDelivered,used=false;const reached=new Promise(r=>oldReached=r),fetchGate=new Promise(r=>previewRelease=r),responseReady=new Promise(r=>oldResponseReached=r),deliveryGate=new Promise(r=>oldDeliveryRelease=r),delivered=new Promise(r=>oldDelivered=r);
    await page.route('**/api/v1/**',route=>{if(route.request().method()!=='POST'||new URL(route.request().url()).pathname!==ep+'/preview'||used)return route.continue();used=true;oldTask=(async()=>{row.oldPreviewRequest=JSON.parse(route.request().postData());save();oldReached();await fetchGate;const response=await route.fetch();row.oldPreviewReply={status:response.status(),body:await response.json()};save();oldResponseReached();await deliveryGate;await route.fulfill({response});row.oldPreviewDelivery='fulfilled';save();oldDelivered();})();return oldTask;});
    await section.getByRole('button',{name:'Проверить снятие запрета',exact:true}).click();await bounded(reached,15000,'native original preview request not reached');check(row,'original typed reason bound in native preview',row.oldPreviewRequest.reason,row.reason);check(row,'initial preview before any target write v0',row.oldPreviewRequest.expectedVersion,0);check(row,'native preview before server handling has no domain effects',await snapshot(row,'preview-request-held-before-canonical-epoch'),before);check(row,'native preview has no target mutation before confirmation',await targetState(),row.targetBefore);
    await rule(target.id,'objects.read',[object.id]);const epoch=await rule(actor.id,'objects.read',[object.id]);const updatedDetail=page.waitForResponse(async r=>new URL(r.url()).pathname==='/api/v1/users-access/admin/users/'+target.id&&r.status()===200&&(await r.json()).accessVersion===1);await fresh(page,epoch,'founder-new-scope-before-old-preview');await bounded(updatedDetail,20000,'fresh actual target detail v1 not reached');previewRelease();await bounded(responseReady,15000,'real old preview conflict response absent');check(row,'real old native target-version preview409',row.oldPreviewReply.status,409);oldDeliveryRelease();await bounded(delivered,10000,'real old409 delivery absent');await until(async()=>!(await section.getByRole('button',{name:'Проверить снятие запрета',exact:true}).isDisabled()),'old preview pending lock not released');check(row,'late old409 preserves same original own reason',await section.getByLabel('Причина снятия запрета',{exact:false}).inputValue(),row.reason);check(row,'late old scope409 installs no stale error',await section.getByRole('alert').count(),0);await dom(page,'old409-after-fresh-scope-original-reason-retained');
    row.targetAfterIntervening=await targetState();const previewResponse=page.waitForResponse(r=>r.request().method()==='POST'&&new URL(r.url()).pathname===ep+'/preview');await section.getByRole('button',{name:'Проверить снятие запрета',exact:true}).click();const preview=await previewResponse;row.nativePreview={status:preview.status(),body:await preview.json()};save();check(row,'fresh native dedicated preview201',preview.status(),201);check(row,'preview exact original reason',row.nativePreview.body.reason,row.reason);check(row,'preview exact current target version1',row.nativePreview.body.expectedVersion,1);check(row,'preview shows effective Candidate view restoration',row.nativePreview.body.effective.find(v=>v.actionCode==='candidates.view').allowed,true);await section.getByRole('button',{name:'Подтвердить снятие запрета',exact:true}).waitFor();check(row,'dedicated preview has no target permission/version/audit write',await targetState(),row.targetAfterIntervening);const previewGraph=await snapshot(row,'fresh-preview-before-manual-confirm');check(row,'canonical intervening access rules do not mutate domain graph',previewGraph,before);await dom(page,'native-preview-visible-before-explicit-confirm');
    let saveReached,saveDelivered,saveUsed=false;const successReady=new Promise(r=>saveReached=r),saveGate=new Promise(r=>saveRelease=r),saveDone=new Promise(r=>saveDelivered=r);
    await page.route('**/api/v1/**',route=>{if(route.request().method()!=='POST'||new URL(route.request().url()).pathname!==ep+'/save')return route.continue();assert.equal(saveUsed,false,'No repeated legacy save command');saveUsed=true;saveTask=(async()=>{const response=await route.fetch();row.heldSave={status:response.status(),body:await response.json(),request:JSON.parse(route.request().postData()),at:new Date().toISOString()};save();saveReached();await saveGate;await route.fulfill({response});row.heldSaveDelivery='fulfilled';save();saveDelivered();})();return saveTask;});
    await section.getByRole('button',{name:'Подтвердить снятие запрета',exact:true}).click();await bounded(successReady,25000,'real native committed legacy save response absent');check(row,'actual known committed save201',row.heldSave.status,201);check(row,'actual authorized original full response, not mocked ACK','outcome'in row.heldSave.body,false);row.targetCommitted=await targetState();check(row,'target version increments once after own manual removal',row.targetCommitted.user.accessVersion,2);check(row,'exact original personal deny removed',row.targetCommitted.permissions.some(v=>v.id===permission.id),false);check(row,'existing target rules preserved no synthetic Candidate allow',row.targetCommitted.rules,row.targetAfterIntervening.rules);const newAudits=row.targetCommitted.audit.filter(v=>!row.targetAfterIntervening.audit.some(w=>w.id===v.id));check(row,'exact one dedicated removal access history',newAudits.length,1);check(row,'audit original actor reason and versions',{actor:newAudits[0].actorUserId,reason:newAudits[0].reason,before:newAudits[0].versionBefore,after:newAudits[0].versionAfter},{actor:actor.id,reason:row.reason,before:1,after:2});check(row,'audit operation binds exact removed historical source row',newAudits[0].changes.map(v=>[v.operation,v.userPermissionId]),[['remove_legacy_user_permission',permission.id]]);
    const committed=await snapshot(row,'real-committed-removal-before-ACK');for(const model of Object.keys(before)){const removed=model==='UserPermission'?[permission.id]:[];check(row,'manual native removal preserves every other domain row '+model,committed[model],before[model].filter(v=>!removed.includes(v.id)));}
    await fresh(tp,1,'same-cookie-recipient-fresh-profile-after-removal');await tp.getByText(A.fullName,{exact:true}).first().waitFor();await dom(tp,'recipient-Candidate-native-restored-before-admin-ACK');const actualA=await targetCtx.request.get(api+'/candidates?candidateType=reserve&q='+encodeURIComponent(A.fullName));row.targetReadAfter={status:actualA.status(),body:await actualA.json()};check(row,'same-cookie recipient actual Candidate read200',actualA.status(),200);check(row,'exact Candidate A restored in native recipient',await tp.getByText(A.fullName,{exact:true}).first().isVisible(),true);
    const rootEpoch=await rule(actor.id,'users_access.access');await fresh(page,rootEpoch,'founder-admin-root-denied-while-committed-success-held');await page.getByText('Доступ закрыт',{exact:true}).waitFor();await dom(page,'founder-admin-closed-before-old-success-delivery');const deniedAdmin=await ctx.request.get(api+'/users-access/admin/users/'+target.id),adminB=await admin.request.get(api+'/users-access/admin/users/'+target.id);row.adminReads={A:{status:deniedAdmin.status(),body:await deniedAdmin.json()},B:{status:adminB.status(),body:await adminB.json()}};check(row,'original founder admin now actual403',deniedAdmin.status(),403);check(row,'independent founder admin actual200',adminB.status(),200);check(row,'target Candidate reads/admin revoke have no further domain effect',await snapshot(row,'before-old-save-response-delivery'),committed);
    row.deliveryAt=new Date().toISOString();saveRelease();await bounded(saveDone,10000,'same original committed save response delivery absent');check(row,'same actual successful native response delivered',row.heldSaveDelivery,'fulfilled');const success='Изменение сохранено. Подробности прав сейчас недоступны. Повторно сохранять изменение не нужно.';await page.getByRole('status').filter({hasText:success}).waitFor();const terminal=await dom(page,'generic-parent-admin-ACK-terminal');check(row,'same-session parent generic knowncommit success visible',terminal.text.includes(success),true);const semantic=serial({text:terminal.text,semanticText:terminal.semanticText,fields:terminal.fields,attributes:terminal.attributes});for(const marker of [target.fullName,target.id,object.name,object.id,row.reason])check(row,'no private target/rule/reason marker in semantic terminal '+marker,semantic.includes(marker),false);check(row,'private admin dialog unmounted after ACK',await page.getByRole('dialog').count(),0);check(row,'target query stripped at parent terminal',new URL(page.url()).searchParams.has('user'),false);check(row,'ACK no extra target rule/version/history effects',await targetState(),row.targetCommitted);check(row,'ACK no duplicate/rollback/domain writes',await snapshot(row,'after-ACK'),committed);
    await bp.reload({waitUntil:'networkidle'});check(row,'independent Candidate B native remains visible',await bp.getByText(B.fullName,{exact:true}).first().isVisible(),true);await dom(bp,'B-native-after-removal-ACK');check(row,'B native control leaves exact committed graph unchanged',await snapshot(row,'after-B-control'),committed);const saves=row.mutationRequests.filter(v=>v.path===ep+'/save');check(row,'one original native legacy save only no retry',saves.map(v=>JSON.parse(v.payload).reason),[row.reason]);check(row,'late ACK sends no private target detail GET',row.network.filter(v=>v.method==='GET'&&v.path==='/api/v1/users-access/admin/users/'+target.id&&v.at>row.deliveryAt).length,0);row.status='passed';proof.status='passed';proof.counts={requested:1,executed:1,passed:1};save();
  }catch(e){row.status='failed';row.error=String(e.stack||e);proof.status='failed';save();if(page&&!page.isClosed())try{await dom(page,'actual-failure');}catch{}try{await snapshot(row,'failure');}catch{}throw e;}
  finally{previewRelease();oldDeliveryRelease();saveRelease();await Promise.allSettled([oldTask,saveTask].filter(Boolean));await ctx?.close();await targetCtx?.close();await control?.close();await admin?.close();}
});
