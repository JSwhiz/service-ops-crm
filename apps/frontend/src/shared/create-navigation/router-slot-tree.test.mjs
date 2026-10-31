import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const nextPath = (suffix) => require.resolve(`next/dist/${suffix}`);
// The tree reducer only needs the refresh-marker callback from this browser module.
const refetchPath = nextPath('client/components/router-reducer/refetch-inactive-parallel-segments.js');
const previous = require.cache[refetchPath];
require.cache[refetchPath] = { exports: { addRefreshMarkerToActiveParallelSegments() {} } };
const { applyRouterStatePatchToTree } = require(nextPath('client/components/router-reducer/apply-router-state-patch-to-tree.js'));
if (previous) require.cache[refetchPath] = previous;
else delete require.cache[refetchPath];

const loader = require(nextPath('build/webpack/loaders/next-app-loader/index.js')).default;
const frontendDir = fileURLToPath(new URL('../../..', import.meta.url));
const pilots = [
  ['counterparties', 'CounterpartiesPage', 'CounterpartyCreateDialog'],
  ['inventory', 'InventoryPage', 'InventoryItemForm'],
  ['rubber-mats', 'RubberMatsPage', 'RubberMatSizeCreateDialog'],
  ['user-absences', 'UserAbsencesPage', 'UserAbsenceCreateDialog'],
  ['objects', 'ObjectsRegistryPage', 'ObjectCreateDialog'],
  ['one-time-orders', 'OneTimeOrdersRegistryPage', 'OneTimeOrderCreateDialog'],
];

async function routeTree(page, appPaths = [page]) {
  const code = await loader.call({
    _module: { buildInfo: {} },
    getOptions: () => ({
      name: `app${page}`,
      appDir: path.join(frontendDir, 'src/app'),
      appPaths,
      pagePath: `private-next-app-dir${page}.tsx`,
      pageExtensions: ['tsx', 'ts', 'jsx', 'js'],
      rootDir: frontendDir,
      tsconfigPath: 'tsconfig.json',
      isDev: true,
      basePath: '',
      middlewareConfig: 'e30=',
    }),
    addMissingDependency() {},
  }, '');
  const expression = code.match(/const tree = ([\s\S]*?);\nconst pages/)[1];
  const imports = Object.fromEntries([...code.matchAll(/const (\w+) = \(\) => import/g)].map((match) => [match[1], () => {}]));
  const loaderTree = vm.runInNewContext(`(${expression})`, imports);
  const toRouterState = ([segment, routes]) => [segment, Object.fromEntries(Object.entries(routes).map(([key, subtree]) => [key, toRouterState(subtree)]))];
  return toRouterState(loaderTree);
}

const registryTree = () => routeTree('/(app)/counterparties/page');

test('registry loader declares the create slot before any modal navigation', async () => {
  const tree = await registryTree();
  assert.equal(tree[1].children[1].create[0], '__DEFAULT__');
});

test('native Next reducer patches a modal slot while retaining registry children', async () => {
  const tree = await registryTree();
  const registryChildren = tree[1].children[1].children;
  const patch = ['(slot)', { children: ['(.)counterparties', { children: ['new', { children: ['__PAGE__', {}] }] }] }];
  const patched = applyRouterStatePatchToTree(['', 'children', '(app)', 'create'], tree, patch, '/counterparties/new?q=Test');
  assert.deepEqual(patched[1].children[1].children, registryChildren);
  assert.equal(patched[1].children[1].create[0], '(slot)');

  const staleTree = ['', { children: ['(app)', { children: registryChildren }] }];
  assert.throws(() => applyRouterStatePatchToTree(['', 'children', '(app)', 'create'], staleTree, patch, '/counterparties/new'), /not iterable/);
});

test('all six direct entries compose one fallback and one shared dialog without a regular slot entry', () => {
  const ts = require('typescript');
  for (const [module, fallback, dialog] of pilots) {
    const base = path.join(frontendDir, 'src/app/(app)');
    assert.equal(fs.existsSync(path.join(base, '@create', module, 'new/page.tsx')), false);
    assert.equal(fs.existsSync(path.join(base, '@create', `(.)${module}`, 'new/page.tsx')), true);
    const source = fs.readFileSync(path.join(base, module, 'new/page.tsx'), 'utf8');
    const tree = ts.createSourceFile('page.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const tags = [];
    const visit = (node) => {
      if (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) tags.push(node.tagName.getText(tree));
      ts.forEachChild(node, visit);
    };
    visit(tree);
    assert.equal(tags.filter((tag) => tag === fallback).length, 1, module);
    assert.equal(tags.filter((tag) => tag === dialog).length, 1, module);
  }
});

test('real intercepted loader trees preserve the registry subtree for all six entries', async () => {
  for (const [module] of pilots) {
    const initial = await routeTree(`/(app)/${module}/page`);
    const background = initial[1].children[1].children;
    const intercepted = await routeTree(`/(app)/@create/(.)${module}/new/page`);
    const opened = applyRouterStatePatchToTree([''], initial, intercepted, `/${module}/new`);
    assert.strictEqual(opened[1].children[1].children, background, module);
    assert.notEqual(opened[1].children[1].create[0], '__DEFAULT__', module);
  }
});

test('extracted create pages export only default and both entry points import the same feature', () => {
  const ts = require('typescript');
  const base = path.join(frontendDir, 'src/app/(app)');
  for (const [module, feature] of [
    ['objects', '@/features/object-create/ui/object-create-dialog'],
    ['one-time-orders', '@/features/one-time-order-form/ui/one-time-order-create-dialog'],
  ]) {
    for (const relative of [`${module}/new/page.tsx`, `@create/(.)${module}/new/page.tsx`]) {
      const source = fs.readFileSync(path.join(base, relative), 'utf8');
      const tree = ts.createSourceFile('page.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
      const exports = tree.statements.filter((node) => node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword));
      assert.equal(exports.length, 1, relative);
      assert.ok(exports[0].modifiers.some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword), relative);
      const imports = tree.statements.filter(ts.isImportDeclaration).map((node) => node.moduleSpecifier.text);
      assert.ok(imports.includes(feature), relative);
      assert.ok(!imports.some((name) => name.includes('/new/page')), relative);
    }
    const featureSource = fs.readFileSync(path.join(frontendDir, 'src', feature.slice(2) + '.tsx'), 'utf8');
    assert.doesNotMatch(featureSource, /@\/app\//);
  }
});
