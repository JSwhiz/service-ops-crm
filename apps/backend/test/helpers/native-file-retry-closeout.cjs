const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { createRequire } = require('node:module');
const { randomUUID, createHash } = require('node:crypto');
const backend = process.cwd(), repo = path.resolve(backend, '../..'), req = createRequire(backend + '/package.json');
const { PrismaClient, Prisma } = req('@prisma/client');
const { createTestApp } = req('./test/helpers/create-test-app.ts');
const { FilePreviewService } = req('./src/modules/files/file-preview.service.ts');
const { RedisService } = req('./src/modules/redis/redis.service.ts');
const { chromium } = req('/tmp/crm-acl-browser/node_modules/playwright-core');
const sha = x => createHash('sha256').update(x).digest('hex');
const json = x => JSON.stringify(x, (_k, v) => typeof v === 'bigint' ? String(v) : v);
const sleep = ms => new Promise(r => setTimeout(r, ms));
function bounded(p, ms, label) { let timer; return Promise.race([p, new Promise((_, reject) => { timer = setTimeout(() => reject(Error(label)), ms); })]).finally(() => clearTimeout(timer)); }

test('native files.preview.retry K5: full viewer, embedded card, actual late retry acknowledgements', { timeout: 480000 }, async t => {
  assert.equal(process.env.TEST_ISOLATED_DATABASE, 'true');
  const dbURL = new URL(process.env.DATABASE_URL); assert.equal(dbURL.hostname, '127.0.0.1'); assert.match(dbURL.searchParams.get('schema'), /^integration_\d+_\d+$/);
  assert.equal(process.env.NATIVE_FILE_RETRY_EXCLUSIVE_SLOT, 'main-explicit');
  const output = process.env.CLOSEOUT_NATIVE_FILE_RETRY_OUTPUT, dir = path.dirname(output), mirror = process.env.NATIVE_FILE_RETRY_FRONTEND_DIR;
  assert.equal(path.resolve(mirror), path.resolve(dir, 'frontend'));
  const proof = { criterion: 'files.preview.retry/K5', status: 'running', authorNotIndependentReviewer: true, productionTouched: false, schema: dbURL.searchParams.get('schema'), cases: [], sourceManifest: [], cleanup: {}, fixtureBoundary: 'Failed supported Office metadata state only. No original bytes uploaded/read; worker stopped before fixtures; no conversion, binary download, real-worker failure or upload acceptance claim.' };
  const save = () => fs.writeFileSync(output, json(proof) + '\n');
  const db = new PrismaClient(), { app, baseUrl } = await createTestApp(), api = baseUrl + '/api/v1', ui = 'http://127.0.0.1:3214';
  const preview = app.get(FilePreviewService), redis = app.get(RedisService).getClient();
  await preview.onModuleDestroy();
  proof.workerStoppedBeforeStateFixtures = preview.stopped === true && !preview.workerClient?.isOpen;
  assert.equal(proof.workerStoppedBeforeStateFixtures, true);
  const queueName = preview.queueName;
  let front, browser;
  const logs = [], cacheName = '.next-acl-preview-' + process.pid;
  const configs = ['next-env.d.ts','tsconfig.json'].map(n => ({ path: mirror + '/' + n, before: fs.readFileSync(mirror + '/' + n, 'utf8') }));
  fs.writeFileSync(dir + '/config-before.json', json(configs));
  function freeze(source, originalSource) {
    if (!fs.existsSync(source) || proof.sourceManifest.some(x => x.source === source)) return;
    const bytes = fs.readFileSync(source), hash = sha(bytes), dest = dir + '/source-freeze/' + hash + '/' + path.basename(source);
    fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.writeFileSync(dest, bytes);
    proof.sourceManifest.push({ source, path: dest, sha256: hash, ...(originalSource ? { originalSource } : {}) });
  }
  for (const file of Object.keys(require.cache)) if (file.startsWith(backend + '/src/') || file === __filename || file.endsWith('/test/helpers/create-test-app.ts')) freeze(file);
  function walk(folder) { for (const e of fs.readdirSync(folder, { withFileTypes: true })) { const p = path.join(folder,e.name); if (e.isDirectory()) walk(p); else if (/\.(tsx?|css)$/.test(p)) freeze(p, repo + '/apps/frontend/src/' + path.relative(mirror + '/src',p)); } }
  walk(mirror + '/src'); freeze(mirror + '/next.config.ts'); freeze(backend + '/test/access-control-native-file-retry-closeout.acceptance.test.ts');
  t.after(async () => {
    const errors = [];
    try { await browser?.close(); proof.cleanup.browserClosed = true; } catch (e) { errors.push(String(e)); }
    try {
      if (front && front.exitCode === null) { process.kill(-front.pid, 'SIGTERM'); await bounded(new Promise(r => front.once('exit',r)),10000,'owned frontend process group stop timeout'); }
      proof.cleanup.frontendProcessGroupStopped = true;
    } catch (e) { errors.push(String(e)); }
    fs.writeFileSync(dir + '/frontend.log', logs.join(''));
    proof.cleanup.configRestoration = [];
    for (const cfg of configs) {
      try {
        const current = fs.readFileSync(cfg.path,'utf8');
        if (current !== cfg.before) {
          if (cfg.path.endsWith('next-env.d.ts')) assert.equal(current.replaceAll(cacheName,'.next'),cfg.before,'Concurrent mirror config edit preserved');
          else { const parsed=JSON.parse(current); parsed.include=parsed.include.filter(x=>x!==cacheName+'/types/**/*.ts'); assert.deepEqual(parsed,JSON.parse(cfg.before),'Concurrent mirror config edit preserved'); }
          assert.equal(fs.readFileSync(cfg.path,'utf8'),current); fs.writeFileSync(cfg.path,cfg.before);
        }
        proof.cleanup.configRestoration.push({ path: cfg.path, restoredExactSHA256: sha(fs.readFileSync(cfg.path)) });
      } catch(e) { errors.push(String(e)); }
    }
    try { await app.close(); proof.cleanup.appClosed = true; } catch(e) { errors.push(String(e)); }
    try { await db.$disconnect(); proof.cleanup.dbDisconnected = true; } catch(e) { errors.push(String(e)); }
    proof.cleanup.errors=errors; save(); fs.writeFileSync(dir+'/helper-cleanup.json',json(proof.cleanup)+'\n'); assert.deepEqual(errors,[]);
  });
  const excluded = new Set(['User','AuthSession','UserAccessRule','UserAccessAudit','UserAccessPreview']);
  async function graph() {
    const result={};
    for(const m of Prisma.dmmf.datamodel.models) {
      if(excluded.has(m.name)) continue;
      let rows=await db[m.name[0].toLowerCase()+m.name.slice(1)].findMany();
      if(m.name==='AuditEvent') rows=rows.filter(x=>!['user_access','user_access_rule'].includes(x.entityType)&&!String(x.action).startsWith('user_access'));
      result[m.name]=rows.sort((a,b)=>json(a).localeCompare(json(b)));
    }
    result.userIdentity=await db.user.findMany({select:{id:true,login:true,fullName:true,isActive:true,deletedAt:true},orderBy:{id:'asc'}});
    result.userAbsences=await db.$queryRawUnsafe('SELECT * FROM "user_absences" ORDER BY "id"');
    return JSON.parse(json(result));
  }
  async function snapshot(row,phase) { const value=await graph(),p=dir+'/'+row.key+'-'+phase+'-graph.json'; fs.writeFileSync(p,json(value)+'\n'); row.graphs[phase]={path:p,sha256:sha(fs.readFileSync(p))}; save(); return value; }
  const jobs=async()=> (await redis.lRange(queueName,0,-1)).map(JSON.parse);
  const derivative=id=>db.fileDerivative.findUniqueOrThrow({where:{fileId_derivativeType:{fileId:id,derivativeType:'preview_pdf'}}});
  function check(row,label,actual,expected) { row.assertions.push({label,actual,expected,passed:json(actual)===json(expected)}); save(); assert.deepEqual(actual,expected,label); }
  async function recordUI(row,page,phase) { const p=dir+'/'+row.key+'-'+phase; await page.screenshot({path:p+'.png',fullPage:true}); fs.writeFileSync(p+'.html',await page.content()); row.screenshots.push({phase,path:p+'.png'}); row.dom[phase]=await page.locator('body').innerText(); save(); }
  async function compareOnlyRetryReset(row,before,after,fileId,label) {
    const a=before.FileDerivative.find(x=>x.fileId===fileId),b=after.FileDerivative.find(x=>x.fileId===fileId); assert(a&&b);
    check(row,label+' failed source',a.status,'failed'); check(row,label+' actual pending result',b.status,'pending');
    const allowed=['status','errorMessage','processingStartedAt','attemptCount','lastAttemptAt','updatedAt'];
    const aa={...a},bb={...b}; for(const k of allowed){delete aa[k];delete bb[k];} check(row,label+' immutable derivative identity/reference fields',bb,aa);
    check(row,label+' reset values',{errorMessage:b.errorMessage,processingStartedAt:b.processingStartedAt,attemptCount:b.attemptCount,lastAttemptAt:b.lastAttemptAt},{errorMessage:null,processingStartedAt:null,attemptCount:0,lastAttemptAt:null});
    const normalized=JSON.parse(json(after)); normalized.FileDerivative=normalized.FileDerivative.map(x=>x.id===a.id?a:x); normalized.FileDerivative.sort((a,b)=>json(a).localeCompare(json(b)));
    check(row,label+' all other domain/role/membership and fileB rows unchanged',normalized,before);
    row.transitions.push({phase:label,onlyExpectedDerivativeReset:{before:a,after:b}}); save();
  }
  const founder=await db.user.findUniqueOrThrow({where:{login:'founder'}}),role=await db.role.findUniqueOrThrow({where:{code:'founder'}});
  const scenarios=[{key:'full-viewer-held201',consumer:'viewer',kind:'held201'},{key:'embedded-held201',consumer:'embedded',kind:'held201'},{key:'embedded-old403-after-regrant',consumer:'embedded',kind:'late403'}];
  let admin;
  async function rule(row,actorId,fileId,effect) {
    const user=await db.user.findUniqueOrThrow({where:{id:actorId}}),data={expectedVersion:user.accessVersion,reason:'Native exact file retry callback closeout',changes:[{actionCode:'files.preview.retry',effect,scope:effect==='deny'?'selected':'all',selectedIds:effect==='deny'?[fileId]:[]}]};
    const endpoint=api+'/users-access/admin/users/'+actorId,pr=await admin.request.post(endpoint+'/preview',{data}),pv=await pr.json(); assert.equal(pr.status(),201,json(pv));
    const sr=await admin.request.post(endpoint+'/save',{data:{...data,previewToken:pv.previewToken,previewHash:pv.previewHash}}),body=await sr.json(); assert.equal(sr.status(),201,json(body));
    const state={effect,oldVersion:user.accessVersion,version:body.accessVersion,request:data,status:sr.status(),body}; row.ruleChanges.push(state); save(); return state;
  }
  async function freshProfile(row,page,afterVersion,tag) {
    const wait=page.waitForResponse(async r=>new URL(r.url()).pathname==='/api/v1/auth/me'&&r.status()===200&&(await r.json()).accessVersion>afterVersion,{timeout:20000});
    await page.evaluate(()=>window.dispatchEvent(new Event('focus')));const response=await wait,profile=await response.json();row.profiles.push({tag,at:new Date().toISOString(),profile});save();return profile;
  }
  function target(row,page,file) {return row.consumer==='embedded'?page.locator('#files .attachment-file-card').filter({hasText:file.originalName}):page.locator('body');}
  function retryButton(row,page,file) {return target(row,page,file).getByRole('button',{name:'Повторить',exact:true});}
  async function nativeMetadata(row,page,file,predicate,trigger) {
    const wait=page.waitForResponse(async r=>new URL(r.url()).pathname==='/api/v1/files/'+file.id+'/view'&&r.status()===200&&predicate(await r.json()),{timeout:20000});
    if(trigger) await trigger();const response=await wait,body=await response.json();row.metadata.push({fileId:file.id,at:new Date().toISOString(),status:response.status(),body});save();return body;
  }
  async function downloadAvailable(row,page,file) {
    if(row.consumer==='viewer')return (await page.locator('a[href*="/files/'+file.id+'/content"]').count())>0;
    const trigger=target(row,page,file).getByRole('button',{name:'Действия с файлом: '+file.originalName,exact:true});
    await trigger.click();const present=await page.getByRole('menuitem',{name:'Скачать',exact:true}).count();await page.keyboard.press('Escape');return present===1;
  }
  async function holdRetry(row,page,file,expectedStatus) {
    let arrived,release,finished,used=false;
    const ready=new Promise(r=>arrived=r),gate=new Promise(r=>release=r),delivery=new Promise(r=>finished=r);
    const pattern='**/api/v1/files/'+file.id+'/preview/retry';
    await page.route(pattern,async route=>{
      if(used||route.request().method()!=='POST')return route.continue();used=true;
      const response=await route.fetch();row.held={status:response.status(),body:await response.json(),at:new Date().toISOString(),routeFetchOnly:true};save();arrived();await gate;
      try{await route.fulfill({response});finished('fulfilled');}catch(e){row.deliveryError=String(e);finished('cancelled');}
    });
    return {ready,release,delivery,expectedStatus,remove:()=>page.unroute(pattern)};
  }
  async function fixture(row) {
    const marker='native_retry_'+row.key+'_'+randomUUID(),actor=await db.user.create({data:{login:marker,fullName:marker,passwordHash:founder.passwordHash,roles:{create:{roleId:role.id}}}}),object=await db.object.create({data:{name:marker+' source object',address:'Local metadata-only callback fixture',status:'active',createdByUserId:founder.id}}),files=[];
    for(const suffix of ['A','B']) {
      const file=await db.file.create({data:{bucket:process.env.MINIO_BUCKET,objectKey:'native-file-retry-state/'+marker+'/'+suffix+'.docx',originalName:marker+'_'+suffix+'.docx',mimeType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',sizeBytes:1,uploadedByUserId:actor.id,attachments:{create:{entityType:'object',entityId:object.id,uploadedByUserId:actor.id}}}});
      await db.fileDerivative.create({data:{fileId:file.id,derivativeType:'preview_pdf',status:'failed',errorMessage:'Контрольное состояние ошибки предпросмотра Office',attemptCount:1}});files.push(file);
    }
    row.fixture={actorId:actor.id,objectId:object.id,files,metadataStateOnly:true,originalBinaryExists:false,workerFailureObserved:false};save();return {actor,object,A:files[0],B:files[1]};
  }
  // Explicit new metadata generation between completed-success and manual-recovery phases; never presented as a worker result.
  async function stageFailedRecovery(row,file) {
    const before=await derivative(file.id),raws=await redis.lRange(queueName,0,-1),removed=[];
    for(const raw of raws)if(JSON.parse(raw).fileId===file.id){const count=await redis.lRem(queueName,0,raw);removed.push({job:JSON.parse(raw),count});}
    const key='service-ops:file-preview:queued:'+file.id+':preview_pdf';await redis.del(key);
    const after=await db.fileDerivative.update({where:{id:before.id},data:{status:'failed',errorMessage:'Контрольное состояние перед ручным повтором',processingStartedAt:null,attemptCount:1,lastAttemptAt:null}});
    row.fixtureStages.push({kind:'explicit-failed-state-fixture-not-worker-result',before,after,onlyOwnQueuedJobsRemoved:removed,onlyOwnDedupKeyCleared:key});save();
  }
  try {
    front=spawn('pnpm',['exec','next','dev','--hostname','127.0.0.1','--port','3214'],{cwd:mirror,detached:true,env:{...process.env,CRM_PREVIEW_DIST_DIR:cacheName,NEXT_PUBLIC_API_URL:api,NEXT_TELEMETRY_DISABLED:'1'},stdio:['ignore','pipe','pipe']});
    const onLog=b=>{logs.push(String(b));fs.writeFileSync(dir+'/frontend.log',logs.join(''));};front.stdout.on('data',onLog);front.stderr.on('data',onLog);
    proof.owner={frontendPid:front.pid,frontendPort:3214,cacheName,api:baseUrl,redis:process.env.REDIS_URL,bucket:process.env.MINIO_BUCKET};save();
    let ready=false;for(let i=0;i<120;i++){if(front.exitCode!==null)throw Error(logs.join(''));try{if((await fetch(ui+'/login')).ok){ready=true;break;}}catch{}await sleep(500);}assert(ready);
    browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});admin=await browser.newContext();assert.equal((await admin.request.post(api+'/auth/login',{data:{login:founder.login,password:'founder123'}})).status(),201);
    const selected=process.env.NATIVE_FILE_RETRY_CASES?.split(',');
    for(const scenario of scenarios.filter(x=>!selected||selected.includes(x.key))) {
      const row={...scenario,status:'running',assertions:[],metadata:[],profiles:[],ruleChanges:[],events:[],transitions:[],fixtureStages:[],network:[],console:[],graphs:{},screenshots:[],dom:{}};proof.cases.push(row);save();
      const f=await fixture(row),ctx=await browser.newContext({viewport:{width:1366,height:900}});await ctx.route('**/*',r=>['127.0.0.1','localhost'].includes(new URL(r.request().url()).hostname)?r.continue():r.abort());
      let page,controlPage,hold,profileReleases=[];
      try {
        assert.equal((await ctx.request.post(api+'/auth/login',{data:{login:f.actor.login,password:'founder123'}})).status(),201);
        await ctx.request.get(api+'/chats/rooms'); // Actual header bootstrap before the no-effect baseline.
        page=await ctx.newPage();page.setDefaultTimeout(20000);
        page.on('response',r=>{if(r.url().startsWith(api))row.network.push({method:r.request().method(),path:new URL(r.url()).pathname,status:r.status(),at:new Date().toISOString()});});page.on('pageerror',e=>row.console.push({type:'pageerror',message:String(e)}));page.on('console',m=>{if(['warning','error'].includes(m.type()))row.console.push({type:m.type(),message:m.text()});});
        const initialMetadata=nativeMetadata(row,page,f.A,v=>v.id===f.A.id&&v.previewStatus==='failed'&&v.capabilities.canRetryPreview===true,()=>page.goto(row.consumer==='viewer'?ui+'/files/'+f.A.id+'/view':ui+'/objects/'+f.object.id+'#files',{waitUntil:'networkidle'}));
        await initialMetadata;await retryButton(row,page,f.A).waitFor();check(row,'native retry button present for real failed Office metadata',await retryButton(row,page,f.A).count(),1);
        check(row,'native download availability before operation',await downloadAvailable(row,page,f.A),true);
        if(row.consumer==='viewer'){controlPage=await ctx.newPage();await controlPage.goto(ui+'/files/'+f.B.id+'/view',{waitUntil:'networkidle'});await controlPage.getByRole('heading',{name:f.B.originalName,exact:true}).waitFor();await page.bringToFront();}
        else {await target(row,page,f.B).waitFor();check(row,'separate B retry available',await retryButton(row,page,f.B).count(),1);}
        await recordUI(row,page,'initial-failed-A-B');const initial=await snapshot(row,'initial');row.initialQueue=await jobs();check(row,'failed state fixture creates no A/B queue jobs',row.initialQueue.filter(x=>[f.A.id,f.B.id].includes(x.fileId)).length,0);
        if(row.kind==='held201') {
          hold=await holdRetry(row,page,f.A,201);await retryButton(row,page,f.A).click();await bounded(hold.ready,20000,'actual retry201 not reached');check(row,'held real committed retry acknowledgement',row.held.status,201);
          const committed=await snapshot(row,'actual-retry-committed');await compareOnlyRetryReset(row,initial,committed,f.A.id,'first-actual-retry');check(row,'first retry queues exactly one own A job',(await jobs()).filter(x=>x.fileId===f.A.id).length,1);
          const denied=await rule(row,f.actor.id,f.A.id,'deny');await nativeMetadata(row,page,f.A,v=>v.id===f.A.id&&v.capabilities.canRetryPreview===false&&v.capabilities.canDownload===true,()=>freshProfile(row,page,denied.oldVersion,'retry-denied-read-retained'));
          // A documented failed-state fixture exposes permission gating, rather than letting pending status alone hide Retry.
          await nativeMetadata(row,page,f.A,v=>v.previewStatus==='failed'&&v.capabilities.canRetryPreview===false&&v.capabilities.canDownload===true,()=>stageFailedRecovery(row,f.A));
          const failedDeniedGraph=await snapshot(row,'explicit-failed-state-while-retry-denied');
          await recordUI(row,page,'denied-before-old201');hold.release();row.delivery=await bounded(hold.delivery,10000,'old201 delivery');check(row,'old retry response really delivered',row.delivery,'fulfilled');await sleep(300);
          check(row,'late201 never resurrects denied A retry action',await retryButton(row,page,f.A).count(),0);check(row,'retry deny retains current file read/download availability',await downloadAvailable(row,page,f.A),true);
          const after=await snapshot(row,'after-old201');check(row,'deny and late acknowledgement add no further domain effects',after,failedDeniedGraph);check(row,'late callback creates no job from denied failed-state fixture',(await jobs()).filter(x=>x.fileId===f.A.id).length,0);
          await recordUI(row,page,'after-old201');await hold.remove();
          const staged=await snapshot(row,'explicit-failed-recovery-state');const beforePostCount=row.network.filter(x=>x.method==='POST'&&x.path.endsWith('/preview/retry')).length;
          const granted=await rule(row,f.actor.id,f.A.id,'default');await nativeMetadata(row,page,f.A,v=>v.previewStatus==='failed'&&v.capabilities.canRetryPreview===true&&v.capabilities.canDownload===true,()=>freshProfile(row,page,granted.oldVersion,'regrant-no-auto-retry'));
          await retryButton(row,page,f.A).waitFor();await sleep(300);check(row,'regrant and metadata refresh do not auto POST retry',row.network.filter(x=>x.method==='POST'&&x.path.endsWith('/preview/retry')).length,beforePostCount);check(row,'regrant changes no failed fixture state',await graph(),staged);
          const manual=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/v1/files/'+f.A.id+'/preview/retry'&&r.request().method()==='POST');await retryButton(row,page,f.A).click();const response=await manual;row.manual={status:response.status(),body:await response.json()};check(row,'separate explicit native manual retry succeeds',row.manual.status,201);await sleep(100);
          check(row,'exactly one manual retry after regrant',row.network.filter(x=>x.method==='POST'&&x.path.endsWith('/preview/retry')).length,beforePostCount+1);const final=await snapshot(row,'after-explicit-manual-retry');await compareOnlyRetryReset(row,staged,final,f.A.id,'manual-actual-retry');check(row,'manual retry leaves one actual A queued generation',(await jobs()).filter(x=>x.fileId===f.A.id).length,1);await recordUI(row,page,'manual-result-pending-not-converted');
        } else {
          // Hold real auth responses, not forged profiles, so the stale button definitely precedes a new UI profile.
          const profilePattern='**/api/v1/auth/me*';row.withheldProfiles=[];let profileFreezeActive=true;
          await page.route(profilePattern,async route=>{const response=await route.fetch(),body=await response.json();if(!profileFreezeActive){try{await route.fulfill({response});}catch{}return;}let release;const gate=new Promise(r=>release=r);profileReleases.push(release);row.withheldProfiles.push({status:response.status(),body});save();await gate;try{await route.fulfill({response});}catch{}});
          const denied=await rule(row,f.actor.id,f.A.id,'deny');check(row,'stale authorized A retry button still mounted before profile delivery',await retryButton(row,page,f.A).count(),1);
          hold=await holdRetry(row,page,f.A,403);await retryButton(row,page,f.A).click();await bounded(hold.ready,20000,'actual denied retry403 not reached');check(row,'held reply is actual backend denial',row.held.status,403);check(row,'denied stale click leaves all source/derivative state unchanged',await graph(),initial);check(row,'denied stale click queues no A job',(await jobs()).filter(x=>x.fileId===f.A.id).length,0);
          profileFreezeActive=false;for(const release of profileReleases)release();await page.unroute(profilePattern);await freshProfile(row,page,denied.oldVersion,'deny-profile-delivered-while403-held');
          const granted=await rule(row,f.actor.id,f.A.id,'default');await nativeMetadata(row,page,f.A,v=>v.previewStatus==='failed'&&v.capabilities.canRetryPreview===true&&v.capabilities.canDownload===true,()=>freshProfile(row,page,granted.oldVersion,'regrant-fresh-metadata-before-old403'));
          const currentRetry=retryButton(row,page,f.A);await currentRetry.waitFor();check(row,'new epoch native retry is not blocked by the old request',await currentRetry.isEnabled(),true);check(row,'current native read/download availability restored before old403',await downloadAvailable(row,page,f.A),true);await recordUI(row,page,'current-epoch-before-old403');const current=await snapshot(row,'fresh-current-epoch-before-old403');check(row,'deny and regrant before callback create no domain effects',current,initial);
          hold.release();row.delivery=await bounded(hold.delivery,10000,'old403 delivery');check(row,'old403 actually delivered',row.delivery,'fulfilled');await sleep(200);await recordUI(row,page,'old403-terminal-before-any-new-query');row.terminal={retryButtonCount:await retryButton(row,page,f.A).count(),statusUnavailable:(await target(row,page,f.A).innerText()).includes('Статус предпросмотра недоступен'),downloadAvailable:await downloadAvailable(row,page,f.A),BRetryButtonCount:await retryButton(row,page,f.B).count()};row.serverCurrent=await (await ctx.request.get(api+'/files/'+f.A.id+'/view')).json();save();
          check(row,'current server metadata still allows preview/download/retry',row.serverCurrent.capabilities,{canPreview:true,canDownload:true,canRetryPreview:true});check(row,'old403 callback leaves source and derivative graph exact',await graph(),initial);check(row,'regrant or old403 callback never auto POSTs',row.network.filter(x=>x.method==='POST'&&x.path.endsWith('/preview/retry')).length,1);
          // These three exact expectations expose an old catch poisoning current card state. No catch-and-ignore shortcut.
          check(row,'old403 does not poison current card metadata',row.terminal.statusUnavailable,false);check(row,'current native retry action survives old403',row.terminal.retryButtonCount,1);check(row,'current native download action survives old403',row.terminal.downloadAvailable,true);check(row,'B card remains independently actionable',row.terminal.BRetryButtonCount,1);
          await hold.remove();
        }
        const Bmeta=await (await ctx.request.get(api+'/files/'+f.B.id+'/view')).json();row.BCurrentMetadata=Bmeta;check(row,'B same file identity stays unchanged',Bmeta.id,f.B.id);check(row,'B retry capability is unaffected by A callback',Bmeta.capabilities.canRetryPreview,true);row.status='passed';save();
      } catch(e) {
        row.error=String(e.stack||e);row.status=row.kind==='late403'&&row.held?.status===403&&row.terminal?.statusUnavailable===true?'product_defect':'failed';
        if(page&&!page.isClosed()){try{await recordUI(row,page,'exact-failure-before');}catch{}}
        try{await snapshot(row,'failure');}catch{}save();throw e; // Stop at first broken boundary; Main owns any app fix.
      } finally {hold?.release();for(const release of profileReleases)release();await ctx.close();}
    }
    proof.status='passed';save();
  } catch(e) {proof.status=proof.cases.some(x=>x.status==='product_defect')?'product_defect':'failed';proof.error=String(e.stack||e);save();throw e;}
});
