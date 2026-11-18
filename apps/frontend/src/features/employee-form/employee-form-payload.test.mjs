import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {runInNewContext} from 'node:vm';
const require=createRequire(import.meta.url),ts=require('typescript');
function load(url){const exports={};const code=ts.transpileModule(readFileSync(url,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;runInNewContext(code,{exports,require(name){if(name==='@/shared/ui/phone-list-field/phone-list-field')return load(new URL('../../shared/ui/phone-list-field/phone-list-field.tsx',import.meta.url));if(name.endsWith('.module.css')||name==='@/shared/ui/foundation'||name==='@/shared/ui/icons/icons')return{};return require(name);}});return exports;}
const {toEmployeeMutationPayload}=load(new URL('./employee-form-payload.ts',import.meta.url));
const form={passportReceived:false,contractReceived:false,fullName:' Имя ',phones:[],position:'',birthDate:'',residenceAddress:'',shiftPreferences:'',baseDailyRate:'',notes:'',employmentStatus:'active',employeeType:'regular',workScheduleCode:'',workScheduleCustom:'',workTimeText:''};
test('ordinary create omits untouched document flags',()=>{const p=toEmployeeMutationPayload(form);assert.equal(Object.hasOwn(p,'passportReceived'),false);assert.equal(Object.hasOwn(p,'contractReceived'),false);assert.equal(p.fullName,'Имя');});
test('explicit create document receipt remains in payload for independent authorization',()=>{const p=toEmployeeMutationPayload({...form,passportReceived:true});assert.equal(p.passportReceived,true);assert.equal(Object.hasOwn(p,'contractReceived'),false);});
test('profile edit omits unchanged true document state and does not reset receipt metadata',()=>{const p=toEmployeeMutationPayload({...form,passportReceived:true,contractReceived:true},{passportReceived:true,contractReceived:true});assert.equal(Object.hasOwn(p,'passportReceived'),false);assert.equal(Object.hasOwn(p,'contractReceived'),false);assert.equal(Object.hasOwn(p,'passportReceivedAt'),false);});
test('intentional document true→false and false→true are retained independently',()=>{const p=toEmployeeMutationPayload({...form,passportReceived:false,contractReceived:true},{passportReceived:true,contractReceived:false});assert.equal(p.passportReceived,false);assert.equal(p.contractReceived,true);});
