const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{createRequire}=require('node:module'),{createHash,randomUUID}=require('node:crypto');
const req=createRequire(process.cwd()+'/package.json'),{PrismaClient}=req('@prisma/client'),{createTestApp}=req('./test/helpers/create-test-app.ts'),{loginAndGetCookieHeader}=req('./test/helpers/auth.ts');
const plain=x=>JSON.parse(JSON.stringify(x)),pause=ms=>new Promise(r=>setTimeout(r,ms)),barrier=()=>{let release;return {promise:new Promise(r=>release=r),release:()=>release()};};
test('employee destructive writes recheck dependency created while waiting on employee row',{timeout:120000},async t=>{
 assert.equal(process.env.TEST_ISOLATED_DATABASE,'true');const u=new URL(process.env.DATABASE_URL);assert.equal(u.hostname,'127.0.0.1');assert.equal(u.port,'55432');assert.match(u.searchParams.get('schema'),/^integration_\d+_\d+$/);
 const out=process.env.CLOSEOUT_EMPLOYEE_OUTPUT||path.join(fs.mkdtempSync(path.join(require('node:os').tmpdir(),'acl-employee-dependency-')),'proof.json'),proof={status:'running',productionTouched:false,cases:[],sourceManifest:[]},save=()=>fs.writeFileSync(out,JSON.stringify(proof,null,2)+'\n');
 for(const rel of ['src/modules/employees/employees.service.ts','src/modules/employees/employees.controller.ts','src/common/access/lock-actor-access-revision.ts','src/modules/employees/utils/employee-action-access.util.ts']){const source=path.join(process.cwd(),rel);if(!fs.existsSync(source))continue;const bytes=fs.readFileSync(source),sha256=createHash('sha256').update(bytes).digest('hex'),f=path.join(path.dirname(out),'source-freeze',sha256,path.basename(source));fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,bytes);proof.sourceManifest.push({source,path:f,sha256});}save();
 const db=new PrismaClient(),{app,baseUrl}=await createTestApp();t.after(async()=>{await app.close();await db.$disconnect();});
 try{
 const actor=await db.user.findUniqueOrThrow({where:{login:'manager1'}}),founder=await db.user.findUniqueOrThrow({where:{login:'founder'}}),cookie=await loginAndGetCookieHeader({baseUrl,login:'manager1',password:'manager123'});
 const http=async(method,url,body)=>{const r=await fetch(baseUrl+'/api/v1/'+url,{method,headers:{Cookie:cookie,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(20000)});return {status:r.status,body:await r.json()};};
 const selected=process.env.CLOSEOUT_EMPLOYEE_CASE?[process.env.CLOSEOUT_EMPLOYEE_CASE]:['employees.delete_permanently','employees.assignments.delete_as_error']; for(const code of selected)await t.test(code+' dependency winner',async()=>{
  const a=await db.employee.create({data:{fullName:'Dependency A '+randomUUID(),employmentStatus:'active'}}),b=await db.employee.create({data:{fullName:'Control B '+randomUUID(),employmentStatus:'active'}}),o=await db.object.create({data:{name:'Owned dependency source '+randomUUID(),address:'Local isolated acceptance only',status:'active',createdByUserId:founder.id}});
  await db.userAccessRule.create({data:{userId:actor.id,actionCode:code,effect:'allow',scope:'selected',selectedIds:[a.id]}});
  let history;
  if(code.endsWith('delete_as_error')){
   const startDate=new Date('2025-01-01T00:00:00Z'),endDate=new Date('2025-01-31T23:59:59Z');
   await db.objectEmployeeAssignment.create({data:{employeeId:a.id,objectId:o.id,startDate,endDate,isActive:false}});
   history=await db.employeeObjectAssignmentHistory.create({data:{employeeId:a.id,objectId:o.id,startedAt:startDate,endedAt:endDate,createdByUserId:founder.id,closedByUserId:founder.id}});
  }
  const snap=async(client=db)=>{const w={employeeId:{in:[a.id,b.id]}},orderBy={id:'asc'};return plain({employees:await client.employee.findMany({where:{id:{in:[a.id,b.id]}},orderBy}),assignments:await client.objectEmployeeAssignment.findMany({where:w,orderBy}),history:await client.employeeObjectAssignmentHistory.findMany({where:w,orderBy}),availability:await client.employeeAvailabilityWindow.findMany({where:w,orderBy}),attendance:await client.objectAttendanceFact.findMany({where:w,orderBy}),timesheet:await client.timesheetEmployeeRow.findMany({where:w,include:{entries:{orderBy}},orderBy}),exceptions:await client.timesheetManualException.findMany({where:w,orderBy}),credits:await client.objectPayrollCredit.findMany({where:w,orderBy}),audit:await client.auditEvent.findMany({where:{entityType:'employee',entityId:{in:[a.id,b.id]}},orderBy}),object:await client.object.findUnique({where:{id:o.id}})});};
  const row={code,criterion:'K7',status:'running',employeeA:a.id,employeeB:b.id,objectId:o.id,historyId:history?.id,assertions:[]};proof.cases.push(row);save();const check=(phase,actual,expected)=>{row.assertions.push({phase,actual,expected});save();assert.deepEqual(actual,expected,phase);};
  check('B remains readable before wait',(await http('GET','employees/'+b.id)).status,200);
  const entered=barrier(),release=barrier();let holderPid,expected;
  const holding=db.$transaction(async tx=>{[{pid:holderPid}]=await tx.$queryRaw`SELECT pg_backend_pid() AS pid`;await tx.$queryRaw`SELECT id FROM employees WHERE id=${a.id} FOR UPDATE`;entered.release();await release.promise;
   if(history)row.dependency=plain(await tx.objectAttendanceFact.create({data:{employeeId:a.id,objectId:o.id,operationDate:new Date('2025-01-15T12:00:00Z'),dailyRateSnapshot:1200}}));
   else row.dependency=plain(await tx.employeeAvailabilityWindow.create({data:{employeeId:a.id,startDate:new Date('2025-01-01T00:00:00Z'),availabilityStatus:'unavailable',createdByUserId:founder.id}}));
   expected=await snap(tx);row.winnerSnapshot=expected;save();},{timeout:20000});void holding.catch(()=>{});await entered.promise;
  const endpoint=history?'employees/'+a.id+'/object-assignment-history/'+history.id+'/delete-as-error':'employees/'+a.id+'/delete-permanently';
  const pending=http('POST',endpoint,{...(!history?{expectedVersion:a.version}:{}),reason:'Isolated dependency race acceptance'});void pending.catch(()=>{});
  try{
   for(let i=0;i<150;i++){const waiting=await db.$queryRaw`SELECT pid,wait_event_type,wait_event,query FROM pg_stat_activity WHERE ${holderPid} = ANY(pg_blocking_pids(pid)) AND query LIKE '%employees%'`;if(waiting.length){row.actualWait=plain(waiting);break;}await pause(20);}
   check('actual PostgreSQL employee row lock observed',Boolean(row.actualWait?.length),true);release.release();await holding;row.response=await pending;
   check('late destructive request refuses saved dependency',row.response.status,409);
   check('exact conflict code',row.response.body.code,history?'ASSIGNMENT_HAS_OPERATIONAL_HISTORY':'EMPLOYEE_HAS_OPERATIONAL_HISTORY');
   check('expected dependency blocker retained',row.response.body.blockers.some(x=>x.code===(history?'attendance_facts':'availability_windows')&&x.count===1),true);
   row.after=await snap();check('loser creates no deletion ledger history audit effects',row.after,expected);check('B remains readable after refusal',(await http('GET','employees/'+b.id)).status,200);row.status='passed';save();
  }finally{release.release();await Promise.allSettled([holding,pending]);}
 });
 proof.status=proof.cases.length===selected.length&&proof.cases.every(x=>x.status==='passed')?'passed':'failed';save();
 }catch(e){proof.status='failed';proof.error=String(e.stack||e);save();throw e;}
});
