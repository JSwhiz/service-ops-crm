import assert from 'node:assert/strict';
import test from 'node:test';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const require=createRequire(import.meta.url),ts=require('typescript');
const {assignManagerWithConflictConfirmation:assign}=await import(new URL('./assign-manager-with-conflicts.ts',import.meta.url));
const compiled=ts.transpileModule(readFileSync(new URL('../../../shared/api/fetcher.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const body={statusCode:409,error:{message:'Schedule conflicts require confirmation',hasConflicts:true,conflictFingerprint:'a'.repeat(64),conflicts:[{date:'2041-05-02',type:'existing_order',user:{fullName:'Private target'},relatedOrder:null,detailsRestricted:true}]}};
async function serverError(status=409,payload=body){
 const exports={};runInNewContext(compiled,{exports,FormData,Error,TypeError,fetch:async()=>new Response(JSON.stringify(payload),{status}),require(name){if(name==='@/shared/config/app-config')return{appConfig:{apiUrl:'https://local.test'}};if(name==='@/shared/auth/access-generation')return{getAccessGeneration:()=>0,getAccessSessionGeneration:()=>0,isAccessGenerationCurrent:()=>true};if(name==='@/shared/auth/auth-session')return{refreshSession:async()=>false};throw Error(name);}});
 try{await exports.fetcher('/one-time-orders/exact/managers',{method:'POST',body:'{}'});}catch(error){return error;}throw Error('Expected server error');
}
test('normal assignment save performs one POST, without a calendar preflight',async()=>{
 const calls=[],result=await assign({save:async fingerprint=>{calls.push(fingerprint);return{id:'order'};},isCurrent:()=>true,confirm:async()=>{throw Error('No conflict should be shown');}});assert.deepEqual(result,{id:'order'});assert.deepEqual(calls,[undefined]);
});
test('actual fetcher preserves structured409 and only explicit confirmation resubmits its fingerprint',async()=>{
 const error=await serverError(),calls=[],confirmations=[];assert.equal(error.statusCode,409);assert.deepEqual(JSON.parse(JSON.stringify(error.cause)),body);
 const result=await assign({save:async fingerprint=>{calls.push(fingerprint);if(calls.length===1)throw error;return{saved:true};},isCurrent:()=>true,confirm:async conflicts=>{confirmations.push(conflicts);return true;}});
 assert.deepEqual(result,{saved:true});assert.deepEqual(calls,[undefined,'a'.repeat(64)]);assert.deepEqual(JSON.parse(JSON.stringify(confirmations)),[body.error.conflicts]);
});
test('declining a real conflict preserves one failed request and never retries',async()=>{
 const error=await serverError(),calls=[];assert.equal(await assign({save:async fp=>{calls.push(fp);throw error;},isCurrent:()=>true,confirm:async()=>false}),null);assert.deepEqual(calls,[undefined]);
});
test('grant revocation while confirmation is open prevents resubmission',async()=>{
 const error=await serverError(),calls=[];let current=true;assert.equal(await assign({save:async fp=>{calls.push(fp);throw error;},isCurrent:()=>current,confirm:async()=>{current=false;return true;}}),null);assert.deepEqual(calls,[undefined]);
});
test('403, 500 and unrelated409 are never automatically replayed',async()=>{
 for(const error of [await serverError(403,{error:{message:'Denied'}}),await serverError(500,{error:'Internal server error'}),await serverError(409,{error:{message:'State changed'}})]){
  let calls=0;await assert.rejects(assign({save:async()=>{calls++;throw error;},isCurrent:()=>true,confirm:async()=>{throw Error('Unexpected confirmation');}}),e=>e===error);assert.equal(calls,1);
 }
});
