import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

// Execute the actual page callback and refresh effect, not a copied algorithm.
const source = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('page.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let loader;
let refreshEffect;
function visit(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'loadRoomParticipants') loader = node.initializer.arguments[0];
  if (ts.isCallExpression(node) && node.expression.getText(ast) === 'useEffect' && node.arguments[1]?.getText(ast) === '[isParticipantsPanelOpen, activeRoomId, accessRevision, loadRoomParticipants]') refreshEffect = node.arguments[0];
  ts.forEachChild(node, visit);
}
visit(ast);
assert.ok(loader);
assert.ok(refreshEffect);
const compile = node => ts.transpileModule(`(${node.getText(ast)})`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
function host() {
  const state = { rows: [], loading: false, error: null, generation: 1, session: 1, calls: [] };
  const context = vm.createContext({
    chatOperationRef: { current: { roomId: 'room-A', accessRevision: 'v1' } },
    participantRequestSequence: { current: 0 }, memberRenderSession: 1, memberRenderGeneration: 1,
    getAccessSessionGeneration: () => state.session,
    isAccessGenerationCurrent: generation => generation === state.generation,
    setRoomParticipants: rows => { state.rows = rows; },
    setIsLoadingParticipants: value => { state.loading = value; },
    setParticipantsError: value => { state.error = value; },
    getErrorMessage: error => error.message,
    listChatRoomParticipants: () => new Promise((resolve, reject) => state.calls.push({ resolve, reject })),
    isParticipantsPanelOpen: true, activeRoomId: 'room-A',
  });
  const render = () => { context.loadRoomParticipants = vm.runInContext(compile(loader), context); return context.loadRoomParticipants; };
  return { state, context, render, effect: () => vm.runInContext(compile(refreshEffect), context)() };
}

test('current roster succeeds and completes loading', async () => {
  const h = host(); const read = h.render()('room-A');
  assert.equal(h.state.loading, true);
  const rows = [{ id: 'member-A' }]; h.state.calls[0].resolve(rows); await read;
  assert.equal(h.state.rows, rows); assert.equal(h.state.loading, false); assert.equal(h.state.error, null);
});

test('access invalidation rejects stale rows and completes its spinner', async () => {
  const h = host(); const read = h.render()('room-A'); h.state.generation++;
  h.state.calls[0].resolve([{ id: 'private-old-member' }]); await read;
  assert.equal(h.state.rows.length, 0); assert.equal(h.state.loading, false); assert.match(h.state.error, /Доступ обновился/);
});

test('late failure after session change does not reveal stale error or leave loading', async () => {
  const h = host(); const read = h.render()('room-A'); h.state.session++;
  h.state.calls[0].reject(new Error('old private server detail')); await read;
  assert.equal(h.state.loading, false); assert.equal(h.state.rows.length, 0); assert.doesNotMatch(h.state.error, /private/);
});

test('old reply cannot end a newer request spinner', async () => {
  const h = host(); const load = h.render(); const old = load('room-A'); const fresh = load('room-A');
  h.state.calls[0].resolve([{ id: 'old' }]); await old;
  assert.equal(h.state.loading, true); assert.equal(h.state.rows.length, 0);
  const rows = [{ id: 'fresh' }]; h.state.calls[1].resolve(rows); await fresh;
  assert.equal(h.state.rows, rows); assert.equal(h.state.loading, false);
});

test('access refresh effect retriggers the actual reader with fresh ownership', async () => {
  const h = host(); const old = h.render()('room-A');
  h.state.generation = 2; h.context.memberRenderGeneration = 2;
  h.context.chatOperationRef.current = { roomId: 'room-A', accessRevision: 'v2' };
  const freshLoad = h.render(); let fresh;
  h.context.loadRoomParticipants = roomId => { fresh = freshLoad(roomId); return fresh; };
  h.effect(); assert.equal(h.state.calls.length, 2);
  h.state.calls[0].resolve([{ id: 'old' }]); await old; assert.equal(h.state.loading, true);
  h.state.calls[1].resolve([{ id: 'current' }]); await fresh;
  assert.equal(h.state.rows[0].id, 'current'); assert.equal(h.state.loading, false);
});
