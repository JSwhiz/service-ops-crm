import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { getCellRevealScroll } from '../../../apps/frontend/src/features/timesheet-grid/model/matrix-navigation.ts';
import { getOverviewRefreshState } from '../../../apps/frontend/src/features/timesheet-overview/model/overview-refresh.ts';
import { humanizeCellCorrectionError, isCellCorrectionRetryBlocked } from '../../../apps/frontend/src/features/timesheet-cell-editing/model/cell-presentation.ts';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const require = createRequire(import.meta.url);
const ts = require('typescript');
const source = rel => fs.readFileSync(path.join(root, 'apps/frontend/src', rel), 'utf8');
const parse = rel => ts.createSourceFile(rel, source(rel), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function nodes(tree, predicate) { const result=[]; function visit(node) {if(predicate(node))result.push(node);ts.forEachChild(node,visit);} visit(tree);return result; }
function attributes(node) { return Object.fromEntries(node.attributes.properties.filter(ts.isJsxAttribute).map(a=>[a.name.getText(),a.initializer?.getText()??'true'])); }

test('D: row reveal leaves full focused cells inside the matrix below sticky headers on both axes', () => {
  const viewport={left:100,right:900,top:200,bottom:650};
  const sticky={left:240,right:120,top:56};
  for(const left of [220,339,340,460,704,705,820]) for(const top of [100,212,255,256,400,606,607,720]) {
    const cell={left,right:left+76,top,bottom:top+44};
    const delta=getCellRevealScroll(cell,viewport,sticky);
    assert.ok(cell.left-delta.left>=viewport.left+sticky.left);
    assert.ok(cell.right-delta.left<=viewport.right-sticky.right);
    assert.ok(cell.top-delta.top>=viewport.top+sticky.top);
    assert.ok(cell.bottom-delta.top<=viewport.bottom);
  }
});

test('D: failed and overlapping refresh revisions retain row identity but never unlock stale financial actions', () => {
  const data={rows:[{employeeId:'E',entries:[{dayOfMonth:1,finalValue:1000}]}]};
  const snapshot={data,scope:'S',revision:4};
  for(const revision of [5,6,7]) for(const loading of [true,false]) {
    const state=getOverviewRefreshState(snapshot,'S',revision,loading);
    assert.strictEqual(state.overview,data);
    assert.strictEqual(state.overview.rows[0],data.rows[0]);
    assert.equal(state.mutationsBlocked,true);
  }
  assert.equal(getOverviewRefreshState({...snapshot,revision:7},'S',7,false).mutationsBlocked,false);
  assert.equal(getOverviewRefreshState(snapshot,'other scope',4,false).overview,null);
});

function fetcherFixture(body,status) {
  const file=source('shared/api/fetcher.ts');
  const output=ts.transpileModule(file,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const module={exports:{}};
  let requests=0;
  const fixtureFetch=async()=>{requests++;return new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});};
  const wrapper=vm.runInNewContext('(function(require,module,exports){'+output+'\n})',{fetch:fixtureFetch,Response,FormData,TypeError,Error,JSON});
  wrapper(id=>{
    if(id==='@/shared/config/app-config')return {appConfig:{apiUrl:'https://offline.invalid'}};
    if(id==='@/shared/auth/auth-session')return {refreshSession:async()=>false};
    throw new Error('Unexpected fixture dependency: '+id);
  },module,module.exports);
  return {...module.exports,requests:()=>requests};
}

test('D: actual fetcher decodes the real pending-409 response into an actionable blocked request', async () => {
  const message='Timesheet manual exception approval is already pending for this day';
  assert.ok(fs.readFileSync(path.join(root,'apps/backend/src/modules/timesheets/timesheets.service.ts'),'utf8').includes(message));
  const fixture=fetcherFixture({statusCode:409,message,error:'Conflict'},409);
  let error;try{await fixture.fetcher('/offline-only');}catch(failure){error=failure;}
  assert.ok(error instanceof fixture.ApiError);
  assert.equal(error.message,message);
  const result=humanizeCellCorrectionError(error);
  assert.equal(result.recovery,'pending');
  assert.match(result.message,/Дождитесь решения|повторный запрос не нужен/);
  assert.equal(isCellCorrectionRetryBlocked(true,null,12),true);
  assert.equal(fixture.requests(),1);
});

test('D: actual 409 conflict and ambiguous failure require a fresh revision before retry', async () => {
  for(const [status,message] of [[409,'Timesheet cell changed after approval request was created'],[500,'Prisma stack trace SECRET']]) {
    const fixture=fetcherFixture({statusCode:status,message},status);
    let error;try{await fixture.fetcher('/offline-only');}catch(failure){error=failure;}
    const result=humanizeCellCorrectionError(error);
    assert.equal(result.recovery,'refresh');
    assert.doesNotMatch(result.message,/Prisma|SECRET/);
    assert.equal(isCellCorrectionRetryBlocked(false,12,12),true);
    assert.equal(isCellCorrectionRetryBlocked(false,12,11),true);
    assert.equal(isCellCorrectionRetryBlocked(false,12,13),false);
  }
});

test('D source wiring: overview rendering is independent of loading/error and has a stable scope key', () => {
  const tree=parse('app/(app)/timesheet/page.tsx');
  const grid=nodes(tree,n=>ts.isJsxSelfClosingElement(n)&&n.tagName.getText()==='TimesheetOverviewGrid');
  assert.equal(grid.length,1);
  let parent=grid[0].parent;while(parent&&!ts.isConditionalExpression(parent))parent=parent.parent;
  assert.equal(parent.condition.getText(),'overview');
  const attrs=attributes(grid[0]);
  assert.doesNotMatch(attrs.key,/refresh|revision|loading|error/i);
  for(const field of ['year','month','objectId','employeeId'])assert.ok(attrs.key.includes(field));
  assert.equal(attrs.mutationsBlocked,'{mutationsBlocked}');
  assert.equal(attrs.refreshing,'{loading}');
  assert.equal(nodes(tree,n=>ts.isCallExpression(n)&&n.expression.getText()==='setOverviewSnapshot').length,1);
  const view=parse('features/timesheet-overview/ui/timesheet-overview-grid.tsx');
  const cells=nodes(view,n=>ts.isJsxSelfClosingElement(n)&&n.tagName.getText()==='TimesheetCellEditor');
  const props=attributes(cells[0]);
  for(const name of ['mutationsBlocked','refreshing','dataRevision','onRefresh'])assert.equal(props[name],'{'+name+'}');
  assert.match(source('features/timesheet-overview/ui/timesheet-overview-grid.tsx'),/key=\{entry\.dayOfMonth\}/);
});

test('D source wiring: retained drawer keeps local success and guards both submit paths while stale', () => {
  const editor=source('features/timesheet-cell-editing/ui/timesheet-cell-editor.tsx');
  assert.match(editor,/canOfferCorrection && !mutationsBlocked && !retryBlocked/);
  assert.match(editor,/if \(savingRef\.current \|\| !canMutate \|\| !editing\) return/);
  assert.match(editor,/if \(restore && \(!canDirectEdit \|\| finalValue === autoValue\)\) return/);
  assert.match(editor,/failure\.recovery === 'refresh'\) setBlockedAtRevision\(dataRevision\)/);
  assert.match(editor,/failure\.recovery === 'pending'\) setPendingRequest\(true\)/);
  assert.match(editor,/\{success \? <Alert tone="success" role="status">/);
  assert.match(editor,/disabled=\{saving \|\| !canMutate\}/);
  assert.match(editor,/pending=\{saving\} disabled=\{!canMutate\}/);
  const effects=nodes(parse('features/timesheet-cell-editing/ui/timesheet-cell-editor.tsx'),n=>ts.isCallExpression(n)&&n.expression.getText()==='useEffect');
  assert.equal(effects.length,1);
  assert.equal(effects[0].arguments[1].getText(),'[open]');
  assert.doesNotMatch(effects[0].getText(),/setOpen|setSuccess|setEditing/);
});

test('D source wiring: focus calls matrix-only two-axis reveal and the region has vertical overflow', () => {
  const scroll=source('features/timesheet-grid/ui/timesheet-scroll-region.tsx');
  assert.match(scroll,/target\.focus\(\{ preventScroll: true \}\)/);
  assert.match(scroll,/revealCell\(cell\)/);
  assert.match(scroll,/scroll\.scrollBy\(getCellRevealScroll/);
  assert.match(scroll,/top: headerHeight/);
  assert.match(scroll,/bottom: rect\.top \+ scroll\.clientTop \+ scroll\.clientHeight/);
  assert.doesNotMatch(scroll,/window\.scroll|scrollIntoView/);
  assert.match(source('features/timesheet-grid/ui/timesheet-scroll-region.module.css'),/overflow: auto; max-height: 65dvh/);
});
