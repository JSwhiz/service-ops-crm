#!/usr/bin/env node
// Finds CSS that no component uses, and comments that swallow rules.
//
//   node scripts/audit-css.mjs            # report, exit 1 when something is found
//   node scripts/audit-css.mjs --json     # machine-readable report
//
// Global stylesheets: a class is used when its name appears in any .ts/.tsx
// file, or when it starts with a prefix built in a template next to a class
// (e.g. `ui-badge--${tone}`). CSS modules: a class is used when the importing
// file reads `styles.name` / `styles['name']`; modules indexed dynamically
// (`styles[value]`) are skipped.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../apps/frontend/src');
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
  const full = path.join(dir, entry.name);
  return entry.isDirectory() ? walk(full) : [full];
});
const files = walk(root);
const sources = new Map(files.filter((f) => /\.tsx?$/.test(f) && !f.endsWith('.d.ts')).map((f) => [f, fs.readFileSync(f, 'utf8')]));
const allText = [...sources.values()].join('\n');
const cssFiles = files.filter((f) => f.endsWith('.css'));

const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');
const selectorsOf = (css) => [...stripComments(css).matchAll(/([^{}]+)\{/g)]
  .map((match) => match[1].trim())
  .filter((selector) => !selector.startsWith('@') && !/^(from|to|\d+%)/.test(selector));
const classesOf = (selector) => new Set([...selector.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map((m) => m[1]));

const classLines = allText.split('\n').filter((line) => /class/i.test(line)).join('\n');
const prefixes = new Set([
  ...[...classLines.matchAll(/([a-zA-Z][\w-]*[-_])\$\{/g)].map((m) => m[1]),
  ...[...allText.matchAll(/([a-zA-Z][\w-]*--)\$\{/g)].map((m) => m[1]),
]);
const usedGlobally = (name) => new RegExp(`(?<![\\w-])${escape(name)}(?![\\w-])`).test(allText)
  || [...prefixes].some((prefix) => name.startsWith(prefix));

const report = { globals: {}, modules: {}, brokenComments: [], missingModuleClasses: {}, undefinedTokens: {} };
const definedTokens = new Set(cssFiles.flatMap((file) =>
  [...stripComments(fs.readFileSync(file, 'utf8')).matchAll(/(--ui-[\w-]+)\s*:/g)].map((match) => match[1]),
));

// Orphan rules alone do not catch markup that asks for a missing CSS-module
// export. Resolve each import independently (several modules share a basename).
for (const [file, source] of sources) {
  const syntax = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  for (const match of source.matchAll(/import\s+(\w+)\s+from\s+['"]([^'"]+\.module\.css)['"]/g)) {
    const [, id, specifier] = match;
    const cssFile = specifier.startsWith('@/')
      ? path.resolve(root, specifier.slice(2))
      : path.resolve(path.dirname(file), specifier);
    if (!fs.existsSync(cssFile)) continue;
    const localNames = new Set(selectorsOf(fs.readFileSync(cssFile, 'utf8'))
      .flatMap((selector) => [...classesOf(selector.replace(/:global\([^)]*\)/g, ''))]));
    const reads = [];
    const visit = (node) => {
      if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === id) reads.push(node.name.text);
      if (ts.isElementAccessExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === id && node.argumentExpression && ts.isStringLiteral(node.argumentExpression)) reads.push(node.argumentExpression.text);
      ts.forEachChild(node, visit);
    };
    visit(syntax);
    const missing = [...new Set(reads.filter((name) => !localNames.has(name)))];
    if (missing.length) report.missingModuleClasses[path.relative(root, file)] = missing;
  }
}

for (const file of cssFiles) {
  const css = fs.readFileSync(file, 'utf8');
  const rel = path.relative(root, file);
  const missingTokens = [...new Set([...stripComments(css).matchAll(/var\((--ui-[\w-]+)\s*\)/g)]
    .map((match) => match[1]).filter((name) => !definedTokens.has(name)))];
  if (missingTokens.length) report.undefinedTokens[rel] = missingTokens;
  for (const comment of css.matchAll(/\/\*([\s\S]*?)\*\//g)) {
    if (comment[1].includes('{')) report.brokenComments.push(`${rel}:${css.slice(0, comment.index).split('\n').length}`);
  }
  if (!file.endsWith('.module.css')) {
    const names = new Set();
    for (const selector of selectorsOf(css)) for (const name of classesOf(selector)) names.add(name);
    const dead = [...names].filter((name) => !usedGlobally(name)).sort();
    if (dead.length) report.globals[rel] = dead;
    continue;
  }
  const base = path.basename(file);
  const local = new Set();
  const globalRefs = new Set();
  for (const selector of selectorsOf(css)) {
    for (const inner of selector.matchAll(/:global\(([^)]*)\)/g)) for (const name of classesOf(inner[1])) globalRefs.add(name);
    for (const name of classesOf(selector.replace(/:global\([^)]*\)/g, ''))) local.add(name);
  }
  const used = new Set();
  let dynamic = false;
  for (const [, text] of sources) {
    const match = text.match(new RegExp(`import\\s+(\\w+)\\s+from\\s+['"][^'"]*${escape(base)}['"]`));
    if (!match) continue;
    const id = escape(match[1]);
    for (const m of text.matchAll(new RegExp(`${id}\\.(\\w+)`, 'g'))) used.add(m[1]);
    for (const m of text.matchAll(new RegExp(`${id}\\[['"]([\\w-]+)['"]\\]`, 'g'))) used.add(m[1]);
    if (new RegExp(`${id}\\[(?!['"])`).test(text)) dynamic = true;
  }
  for (const m of css.matchAll(/composes:\s*([^;]+);/g)) for (const name of m[1].split(/\s+/)) used.add(name);
  const dead = dynamic ? [] : [...local].filter((name) => !used.has(name)).sort();
  const deadGlobal = [...globalRefs].filter((name) => !usedGlobally(name)).sort();
  if (dead.length || deadGlobal.length) report.modules[rel] = { dead, deadGlobalRefs: deadGlobal };
}

const problems = Object.keys(report.globals).length + Object.keys(report.modules).length + report.brokenComments.length
  + Object.keys(report.missingModuleClasses).length + Object.keys(report.undefinedTokens).length;
if (process.argv.includes('--json')) {
  console.log(JSON.stringify(report, null, 2));
} else if (problems) {
  for (const [file, dead] of Object.entries(report.globals)) console.log(`${file}: unused global classes: ${dead.join(', ')}`);
  for (const [file, item] of Object.entries(report.modules)) {
    if (item.dead.length) console.log(`${file}: unused module classes: ${item.dead.join(', ')}`);
    if (item.deadGlobalRefs.length) console.log(`${file}: :global() refers to unused classes: ${item.deadGlobalRefs.join(', ')}`);
  }
  for (const location of report.brokenComments) console.log(`${location}: comment contains "{" — a rule may be commented out`);
  for (const [file, names] of Object.entries(report.missingModuleClasses)) console.log(`${file}: missing CSS-module classes: ${names.join(', ')}`);
  for (const [file, names] of Object.entries(report.undefinedTokens)) console.log(`${file}: undefined UI tokens without fallback: ${names.join(', ')}`);
} else {
  console.log(`CSS audit: ${cssFiles.length} files, no orphan or missing classes, no undefined UI tokens.`);
}
process.exit(problems ? 1 : 0);
