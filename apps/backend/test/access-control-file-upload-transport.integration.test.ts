import 'reflect-metadata';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {appendFileSync,readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {tmpdir} from 'node:os';
import test from 'node:test';
import {Test} from '@nestjs/testing';
import type {INestApplication} from '@nestjs/common';
import {PrismaClient,type Prisma} from '@prisma/client';
import {S3Client,DeleteObjectCommand,ListObjectsV2Command,GetObjectCommand} from '@aws-sdk/client-s3';
import {AppModule} from '../src/app.module';
import {configureApp} from '../src/bootstrap';
import {PrismaService} from '../src/modules/prisma/prisma.service';
import {StorageService} from '../src/modules/storage/storage.service';
import {FilesService} from '../src/modules/files/files.service';
import {loginAndGetCookieHeader} from './helpers/auth';
import {postgresCommitProxy} from './helpers/postgres-commit-proxy';
async function bounded<T>(p:Promise<T>,label:string){let timer:ReturnType<typeof setTimeout>|undefined;try{return await Promise.race([p,new Promise<never>((_,no)=>{timer=setTimeout(()=>no(Error(label)),20000);})]);}finally{clearTimeout(timer);}}
const progressPath=resolve(tmpdir(),'file-upload-transport-'+process.pid+'.progress.log');
const checkpoint=(phase:string)=>{const line='[file-upload-transport] '+new Date().toISOString()+' '+phase;appendFileSync(progressPath,line+'\n');console.error(line);};
const sha=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
test('real PostgreSQL COMMIT transport ambiguity and pending transaction cleanup keep winner bytes',{timeout:180000},async t=>{
 const direct=new URL(process.env.DATABASE_URL!);assert.equal(direct.port,'55432');assert(['127.0.0.1','localhost'].includes(direct.hostname));const schema=direct.searchParams.get('schema')!;assert.match(schema,/^integration_\d+_\d+$/);assert.equal(process.env.TEST_ISOLATED_DATABASE,'true');assert.equal(process.env.MINIO_ENDPOINT,'127.0.0.1');assert.equal(process.env.MINIO_USE_SSL,'false');assert.ok(process.env.MINIO_BUCKET);
 let activeWireObservations:Array<{phase:string;pid:number;intercepted:boolean}>|undefined;
 const db=new PrismaClient({datasourceUrl:direct.toString()}),proxy=await postgresCommitProxy((pid,intercepted)=>activeWireObservations?.push({phase:'wire-commit',pid,intercepted})),applicationName='file-commit-proxy-'+randomUUID();const appUrl=new URL(direct);appUrl.hostname='127.0.0.1';appUrl.port=String(proxy.port);appUrl.searchParams.set('sslmode','disable');appUrl.searchParams.set('application_name',applicationName);appUrl.searchParams.set('connection_limit','2');
 const service=new PrismaService({datasourceUrl:appUrl.toString()});
 const originalTransaction=service.$transaction.bind(service);
 const resources:{app?:INestApplication;storage?:StorageService;original?:StorageService['uploadObject'];s3?:S3Client}={};
 const owned=new Set<string>(),bucket=process.env.MINIO_BUCKET!;
 t.after(async()=>{
  checkpoint('cleanup:start');
  service.$transaction=originalTransaction;
  if(resources.storage&&resources.original)resources.storage.uploadObject=resources.original;
  // Close the transport first: failed startup must not strand Prisma connects.
  await proxy.close();checkpoint('cleanup:proxy-closed');
  try{if(resources.app)await bounded(resources.app.close(),'application close timeout');}
  finally{try{await bounded(service.$disconnect(),'Prisma disconnect timeout');}
   finally{try{if(resources.s3)for(const Key of owned)await resources.s3.send(new DeleteObjectCommand({Bucket:bucket,Key}));}
    finally{resources.s3?.destroy();await db.$disconnect();checkpoint('cleanup:done');}}}
 });
 checkpoint('compile:start');
 const moduleRef=await bounded(Test.createTestingModule({imports:[AppModule]}).overrideProvider(PrismaService).useValue(service).compile(),'application compile timeout');checkpoint('compile:done');const app=moduleRef.createNestApplication();resources.app=app;checkpoint('configure:start');await bounded(configureApp(app),'application configuration timeout');checkpoint('configure:done');checkpoint('listen:start');await bounded(app.listen(0,'127.0.0.1'),'application startup timeout');checkpoint('listen:done');const baseUrl=await app.getUrl();
 const storage=app.get(StorageService);resources.storage=storage;const original=storage.uploadObject;resources.original=original;const s3=new S3Client({region:'us-east-1',forcePathStyle:true,endpoint:`http://127.0.0.1:${process.env.MINIO_PORT}`,credentials:{accessKeyId:process.env.MINIO_ACCESS_KEY!,secretAccessKey:process.env.MINIO_SECRET_KEY!}});resources.s3=s3;assert.equal(storage.getBucketName(),bucket);
 const files=app.get(FilesService) as unknown as {discardUnlinkedUpload:(upload:{bucket:string;objectKey:string},id:string)=>Promise<void>};
 const founder=await db.user.findUniqueOrThrow({where:{login:'founder'}}),template=await db.user.findUniqueOrThrow({where:{login:'manager1'}}),role=await db.role.findUniqueOrThrow({where:{code:'manager'}});
 const sourceHashes=Object.fromEntries(['src/modules/files/files.service.ts','src/modules/storage/storage.service.ts','src/common/access/lock-actor-access-revision.ts','test/helpers/postgres-commit-proxy.ts','test/access-control-file-upload-transport.integration.test.ts'].map(p=>[p,sha(readFileSync(resolve(__dirname,'..',p)))]));
 for(const entityType of ['object_comment','object_arrival_photo','one_time_order_photo'] as const)for(const mode of ['drop-commit-ack','pending-commit-cleanup','pending-rollback-cleanup'] as const)await t.test(entityType+'/'+mode,async()=>{
  checkpoint(entityType+'/'+mode+':start');
  const marker='transport-'+randomUUID(),uploadId=randomUUID(),prefix='integration/'+schema+'/'+marker+'/';let release:(()=>void)|undefined;const proof:any={status:'running',schema,entityType,mode,uploadId,sourceHashes,observations:[]};
  try{
   const actor=await db.user.create({data:{login:marker,fullName:marker,passwordHash:template.passwordHash,isActive:true,roles:{create:{roleId:role.id}}}});proof.recipientId=actor.id;const cookie=await loginAndGetCookieHeader({baseUrl,login:actor.login,password:'manager123'});
   let parentId:string,childId:string;if(entityType!=='one_time_order_photo'){const p=await db.object.create({data:{name:marker,address:marker,status:'active',createdByUserId:founder.id,assignments:{create:{userId:actor.id,assignmentRoleCode:'manager',isActive:true}}}});parentId=p.id;childId=entityType==='object_comment'?(await db.objectComment.create({data:{objectId:p.id,createdByUserId:actor.id,content:marker,commentType:'manual'}})).id:(await db.objectArrivalPhoto.create({data:{objectId:p.id,createdByUserId:actor.id,operationDate:new Date(),photoType:'arrival'}})).id;}else{const p=await db.oneTimeOrder.create({data:{title:marker,executionAddress:marker,status:'new',contactName:marker,createdByUserId:founder.id,assignments:{create:{userId:actor.id,assignmentRoleCode:'one_time_manager',isActive:true}}}});parentId=p.id;childId=(await db.oneTimeOrderPhoto.create({data:{oneTimeOrderId:p.id,createdByUserId:actor.id,photoCategory:'before'}})).id;}
   proof.target={parentId,childId};activeWireObservations=proof.observations;let objectKey='',puts=0;storage.uploadObject=async params=>{objectKey=prefix+randomUUID()+'.txt';owned.add(objectKey);puts++;return original.call(storage,{...params,objectKey});};
   const bytes=Buffer.from(marker+' '+uploadId),upload=()=>{const form=new FormData();form.set('entityType',entityType);form.set('entityId',childId);form.set('uploadId',uploadId);form.set('file',new Blob([new Uint8Array(bytes)],{type:'text/plain'}),uploadId+'.txt');return fetch(baseUrl+'/api/v1/files/upload',{method:'POST',headers:{Cookie:cookie},body:form,signal:AbortSignal.timeout(30000)});};
   const state=async()=>({fileCount:await db.file.count({where:{id:uploadId}}),linkCount:await db.fileAttachment.count({where:{fileId:uploadId}}),auditCount:await db.auditEvent.count({where:{actorUserId:actor.id,entityId:childId,action:'file.attached'}}),storageKeyCount:(await s3.send(new ListObjectsV2Command({Bucket:bucket,Prefix:prefix}))).KeyCount});
   // Arm only after the real callback has written this upload's metadata.
   // Auth/source preparation and background transactions must not consume it.
   let interceptionArmed=false;
   let resolveGate!:(commit:Awaited<ReturnType<typeof proxy.arm>>)=>void;
   const gate=new Promise<Awaited<ReturnType<typeof proxy.arm>>>(resolve=>{resolveGate=resolve;});
   service.$transaction=((work:unknown,options:unknown)=>{
    if(typeof work!=='function')return Reflect.apply(originalTransaction,service,[work,options]);
    return Reflect.apply(originalTransaction,service,[async(tx:Prisma.TransactionClient)=>{
     const result=await work(tx);
     if(!interceptionArmed){
      const metadata=await tx.file.findUnique({where:{id:uploadId},select:{objectKey:true,attachments:{select:{entityType:true,entityId:true}}}});
      const [{pid}]=await tx.$queryRaw<Array<{pid:number}>>`SELECT pg_backend_pid() AS pid`;
      const ownsMetadata=metadata?.objectKey===objectKey&&metadata.attachments.some(a=>a.entityType===entityType&&a.entityId===childId);
      proof.observations.push({phase:'transaction-callback-before-wire-commit',pid,ownsMetadata});
      if(ownsMetadata){
       assert.equal(await tx.auditEvent.count({where:{actorUserId:actor.id,entityId:childId,action:'file.attached'}}),1);
       interceptionArmed=true;proof.metadataBackendPid=pid;
       void proxy.arm(mode==='drop-commit-ack'?'drop-ack':'hold',pid).then(commit=>{release=commit.release;resolveGate(commit);});
       checkpoint(entityType+'/'+mode+':metadata-commit-armed');
      }
     }
     return result;
    },options]);
   }) as typeof service.$transaction;
   const responsePromise=upload();const commit=await bounded(gate,'Owned metadata COMMIT not observed');release=commit.release;proof.backendPid=commit.pid;assert.equal(commit.pid,proof.metadataBackendPid);checkpoint(entityType+'/'+mode+':commit-observed');
   const sessions=await db.$queryRaw<Array<{application_name:string}>>`SELECT application_name FROM pg_stat_activity WHERE pid=${commit.pid}`;
   if(mode!=='drop-commit-ack'){assert.equal(sessions[0]?.application_name,applicationName);assert.deepEqual(await state(),{fileCount:0,linkCount:0,auditCount:0,storageKeyCount:1});let finished=false;const cleanup=files.discardUnlinkedUpload({bucket,objectKey},uploadId).then(()=>{finished=true;});
    await bounded((async()=>{for(;;){const waits=await db.$queryRaw<Array<{waiting:boolean}>>`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name=${applicationName} AND ${commit.pid}=ANY(pg_blocking_pids(pid)) AND wait_event_type='Lock') AS waiting`;if(waits[0]?.waiting)return;await new Promise(r=>setTimeout(r,20));}})(),'Cleanup did not wait on pending transaction advisory lock');assert.equal(finished,false);checkpoint(entityType+'/'+mode+':cleanup-blocked');proof.observations.push({phase:'cleanup-blocked-behind-real-pending-upload-transaction',metadataUncommitted:true,cleanupWaiting:true});
    if(mode==='pending-commit-cleanup')commit.release();else{const terminated=await db.$queryRaw<Array<{terminated:boolean}>>`SELECT pg_terminate_backend(pid) AS terminated FROM pg_stat_activity WHERE pid=${commit.pid} AND application_name=${applicationName}`;assert.equal(terminated[0]?.terminated,true);}await bounded(cleanup,'cleanup never resumed after transaction resolution');
   }else assert.equal(commit.commitAckObserved,true);
   const response=await bounded(responsePromise,'upload response after transport event'),text=await response.text();const expected=mode==='pending-commit-cleanup'?201:500;assert.equal(response.status,expected,text);
   const current=await state();const committed=mode!=='pending-rollback-cleanup';assert.deepEqual(current,{fileCount:committed?1:0,linkCount:committed?1:0,auditCount:committed?1:0,storageKeyCount:committed?1:0});proof.observations.push({phase:mode,status:response.status,commitAckObserved:commit.commitAckObserved,...current});
   const retry=await upload(),retryText=await retry.text();assert.equal(retry.status,201,retryText);assert.equal(JSON.parse(retryText).id,uploadId);const replay=await upload();assert.equal(replay.status,201,await replay.text());const final=await state();assert.deepEqual(final,{fileCount:1,linkCount:1,auditCount:1,storageKeyCount:1});assert.equal(puts,committed?1:2);const f=await db.file.findUniqueOrThrow({where:{id:uploadId}}),stored=await s3.send(new GetObjectCommand({Bucket:bucket,Key:f.objectKey}));assert.deepEqual(Buffer.from(await stored.Body!.transformToByteArray()),bytes);proof.observations.push({phase:'manual-retry-after-real-transport-outcome-and-replay',status:201,...final,puts,bytesSha256:sha(bytes),winnerBytesPreserved:committed});proof.status='passed';checkpoint(entityType+'/'+mode+':passed');
  }catch(error){checkpoint(entityType+'/'+mode+':failed');proof.status='failed';proof.error=String((error as Error).stack??error);throw error;}finally{release?.();activeWireObservations=undefined;service.$transaction=originalTransaction;storage.uploadObject=original;const raw=JSON.stringify(proof);if(process.env.FILE_RACE_OUTPUT)appendFileSync(process.env.FILE_RACE_OUTPUT,raw+'\n');else console.log('FILE_UPLOAD_TRANSPORT='+raw);}
 });
});
