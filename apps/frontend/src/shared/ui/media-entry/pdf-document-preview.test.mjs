import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';
import { deflateSync } from 'node:zlib';
import ts from 'typescript';

// Execute the component's actual effects without a browser, worker, or user file.
// Only import.meta (unsupported by CommonJS) is substituted before transpiling.
const sourceUrl = new URL('./pdf-document-preview.tsx', import.meta.url);
const compiled = ts.transpileModule(
  readFileSync(sourceUrl, 'utf8').replaceAll('import.meta.url', JSON.stringify(sourceUrl.href)),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true } },
).outputText;

const flush = () => new Promise((resolve) => setImmediate(resolve));
function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function harness({ document = null, zoom = 100, pdfjs, fetch, canvas: suppliedCanvas, resizeSupported = true } = {}) {
  const states = [];
  const effects = [];
  const context = {};
  const canvas = suppliedCanvas ?? { width: 300, height: 150, style: {}, getContext: () => context };
  const refs = [{ current: canvas }, { current: { clientWidth: 600 } }];
  const logs = [];
  const subscriptions = new Set();
  let stateIndex = 0;
  let refIndex = 0;
  const seeds = { 0: document, 3: zoom, 4: 600 };
  const react = {
    createElement: (type, props, ...children) => ({ type, props, children }),
    useEffect: (effect) => effects.push(effect),
    useRef: (initial) => {
      const index = refIndex++;
      refs[index] ??= { current: initial };
      return refs[index];
    },
    useState(initial) {
      const index = stateIndex++;
      if (!(index in states)) states[index] = index in seeds ? seeds[index] : initial;
      return [states[index], (next) => {
        states[index] = typeof next === 'function' ? next(states[index]) : next;
        for (const notify of subscriptions) notify();
      }];
    },
  };
  const module = { exports: {} };
  vm.runInNewContext(compiled, {
    module, exports: module.exports, AbortController, URL,
    setTimeout, clearTimeout,
    OffscreenCanvas: resizeSupported ? class {} : undefined,
    window: { devicePixelRatio: 1 },
    process: { env: { NODE_ENV: 'development' } },
    console: { error: (...args) => logs.push(args) },
    fetch,
    require(name) {
      if (name === 'react') return react;
      if (name === 'pdfjs-dist') return typeof pdfjs === 'function' ? pdfjs() : pdfjs;
      if (name.endsWith('.module.css')) return new Proxy({}, { get: (_, key) => key });
      if (name.startsWith('@/shared/ui/')) return {};
      throw new Error(`Unexpected test import: ${name}`);
    },
  }, { filename: 'pdf-document-preview.cjs' });
  const render = () => {
    stateIndex = 0;
    refIndex = 0;
    effects.length = 0;
    return module.exports.PdfDocumentPreview({ url: '/authenticated-preview', title: 'Synthetic PDF', downloadUrl: '/original' });
  };
  render();
  const waitForState = (index, predicate) => new Promise((resolve) => {
    const check = () => {
      if (predicate(states[index])) {
        subscriptions.delete(check);
        resolve();
      }
    };
    subscriptions.add(check);
    check();
  });
  return { states, effects, canvas, context, render, logs, waitForState };
}

function fakePage() {
  const renders = [];
  const page = {
    getViewport: ({ scale }) => ({ width: 800 * scale, height: 600 * scale }),
    render(parameters) {
      renders.push(parameters);
      parameters.canvasContext.rendered = true;
      return { promise: Promise.resolve(), cancel() {} };
    },
    getTextContent: async () => ({ items: [{ str: 'Synthetic worksheet text' }] }),
    cleanup() { return true; },
  };
  return { page, renders };
}

test('renders a PDF page and zooms the same cached page instead of leaving the default canvas', async () => {
  const { page, renders } = fakePage();
  const h = harness({ document: { getPage: async () => page } });
  const close = h.effects[2]();
  await flush();
  assert.equal(h.states[8], false, 'render error must stay cleared');
  assert.equal(renders.length, 1);
  assert.equal(h.context.rendered, true);
  assert.equal(h.canvas.width, 568);
  assert.equal(h.canvas.height, 426);
  assert.equal(h.states[10], 'Synthetic worksheet text');

  close();
  h.states[3] = 200;
  h.render();
  const closeZoom = h.effects[2]();
  await flush();
  assert.equal(h.states[8], false);
  assert.equal(renders.length, 2);
  assert.equal(h.canvas.width, 1136);
  assert.equal(h.canvas.height, 852);
  closeZoom();
});

test('closing while getPage is pending never starts rendering the abandoned page', async () => {
  const pending = deferred();
  const { page, renders } = fakePage();
  const h = harness({ document: { getPage: () => pending.promise } });
  const close = h.effects[2]();
  close();
  pending.resolve(page);
  await flush();
  assert.equal(renders.length, 0);
  assert.equal(h.canvas.width, 300);
  assert.equal(h.states[8], false);
});

test('closing during the library import does not create a PDF loading task', async () => {
  const pending = deferred();
  pending.promise.__esModule = true;
  let importStarted = false;
  let loads = 0;
  const h = harness({
    fetch: async () => new Response(new Uint8Array(8)),
    pdfjs: () => { importStarted = true; return pending.promise; },
  });
  const close = h.effects[1]();
  await flush();
  assert.equal(importStarted, true);
  close();
  pending.resolve({ GlobalWorkerOptions: {}, getDocument() { loads += 1; } });
  await flush();
  assert.equal(loads, 0);
});

test('loads authenticated preview bytes with explicit image budgets and aborts on close', async () => {
  let request;
  let options;
  let destroys = 0;
  const document = {};
  const h = harness({
    fetch: async (url, init) => {
      request = { url, ...init };
      return new Response(new Uint8Array(8));
    },
    pdfjs: {
      GlobalWorkerOptions: {},
      getDocument(value) {
        options = value;
        return { promise: Promise.resolve(document), destroy: async () => { destroys += 1; } };
      },
    },
  });
  const close = h.effects[1]();
  await flush();
  assert.equal(request.url, '/authenticated-preview');
  assert.equal(request.credentials, 'include');
  assert.equal(request.cache, 'no-store');
  assert.equal(options.data.byteLength, 8);
  assert.equal(options.maxImageSize, -1);
  assert.equal(options.canvasMaxAreaInBytes, 32 * 1024 * 1024);
  assert.equal(h.states[0], document);
  close();
  assert.equal(request.signal.aborted, true);
  assert.equal(destroys, 1);
});

// A valid, compressed monochrome scan. The 4001x4000 variant exceeds 16 MP;
// it occupies only ~2 MB before compression and never needs a huge test canvas.
function scanPdf(width, height) {
  const image = deflateSync(Buffer.alloc(Math.ceil(width / 8) * height));
  const commands = Buffer.from('q 600 0 0 800 0 0 cm /Scan Do Q');
  const stream = (dictionary, bytes) => Buffer.concat([
    Buffer.from(`<< ${dictionary} /Length ${bytes.length} >>\nstream\n`), bytes, Buffer.from('\nendstream'),
  ]);
  const objects = [
    Buffer.from('<< /Type /Catalog /Pages 2 0 R >>'),
    Buffer.from('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'),
    Buffer.from('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /XObject << /Scan 5 0 R >> >> /Contents 4 0 R >>'),
    stream('', commands),
    stream(`/Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceGray /BitsPerComponent 1 /Filter /FlateDecode`, image),
  ];
  const parts = [Buffer.from('%PDF-1.7\n')];
  const offsets = [0];
  let length = parts[0].length;
  for (const [index, object] of objects.entries()) {
    offsets.push(length);
    const part = Buffer.concat([Buffer.from(`${index + 1} 0 obj\n`), object, Buffer.from('\nendobj\n')]);
    parts.push(part);
    length += part.length;
  }
  parts.push(Buffer.from(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Root 1 0 R /Size ${objects.length + 1} >>\nstartxref\n${length}\n%%EOF`));
  return new Uint8Array(Buffer.concat(parts));
}

test('pinned PDF.js retains the oversized scan image operators with the approved resize configuration', { timeout: 10_000 }, async () => {
  const pdfjs = await import('pdfjs-dist');
  for (const limit of [16_000_000, -1]) {
    const task = pdfjs.getDocument({ data: scanPdf(4001, 4000), maxImageSize: limit, canvasMaxAreaInBytes: 32 * 1024 * 1024, verbosity: 0 });
    try {
      const document = await task.promise;
      const page = await document.getPage(1);
      const operators = await page.getOperatorList();
      assert.equal(operators.fnArray.includes(pdfjs.OPS.paintImageXObject), limit === -1, 'the approved configuration must retain the image');
    } finally {
      await task.destroy();
    }
  }
});

function nodes(tree) {
  if (!tree || typeof tree !== 'object') return [];
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  return [tree, ...nodes(tree.children)];
}

test('oversized scan paints actual content through the component with a bounded output canvas', { timeout: 10_000 }, async () => {
  const pdfjs = await import('pdfjs-dist');
  const requirePdf = createRequire(import.meta.resolve('pdfjs-dist'));
  const { createCanvas } = requirePdf('@napi-rs/canvas');
  const canvas = createCanvas(300, 150);
  canvas.style = {};
  const h = harness({
    canvas,
    fetch: async () => new Response(scanPdf(4001, 4000)),
    pdfjs: { GlobalWorkerOptions: {}, getDocument: (options) => pdfjs.getDocument({ ...options, verbosity: 0 }) },
  });
  const closeDocument = h.effects[1]();
  try {
    await h.waitForState(5, (value) => value === false);
    assert.equal(h.states[7], null);
    h.render();
    const closePage = h.effects[2]();
    try {
      await h.waitForState(6, (value) => value === true);
      await h.waitForState(6, (value) => value === false);
      assert.equal(h.states[8], false);
      assert.ok(canvas.width * canvas.height <= 16_000_000);
      assert.ok(canvas.width <= 8192 && canvas.height <= 8192);
      const pixel = canvas.getContext('2d').getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1).data;
      assert.deepEqual([...pixel], [0, 0, 0, 255], 'the scan must paint black pixels, not a blank white success');
    } finally {
      closePage();
    }
  } finally {
    closeDocument();
  }
});

test('a small scan still paints real image pixels with the approved resize policy', { timeout: 10_000 }, async () => {
  const pdfjs = await import('pdfjs-dist');
  const requirePdf = createRequire(import.meta.resolve('pdfjs-dist'));
  const { createCanvas } = requirePdf('@napi-rs/canvas');
  const canvas = createCanvas(300, 150);
  canvas.style = {};
  const h = harness({
    canvas,
    fetch: async () => new Response(scanPdf(32, 32)),
    pdfjs: { GlobalWorkerOptions: {}, getDocument: (options) => pdfjs.getDocument({ ...options, verbosity: 0 }) },
  });
  const closeDocument = h.effects[1]();
  try {
    await h.waitForState(5, (value) => value === false);
    assert.equal(h.states[7], null);
    h.render();
    const closePage = h.effects[2]();
    try {
      await h.waitForState(6, (value) => value === true);
      await h.waitForState(6, (value) => value === false);
      assert.equal(h.states[8], false);
      const pixel = canvas.getContext('2d').getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1).data;
      assert.deepEqual([...pixel], [0, 0, 0, 255]);
    } finally {
      closePage();
    }
  } finally {
    closeDocument();
  }
});

test('without OffscreenCanvas the component explicitly falls back before fetching or parsing', async () => {
  let requests = 0;
  const h = harness({ resizeSupported: false, fetch: async () => { requests += 1; } });
  const close = h.effects[1]();
  await flush();
  assert.equal(requests, 0);
  assert.equal(h.states[0], null);
  assert.match(h.states[7], /недоступен.*Скачайте оригинал/);
  assert.ok(nodes(h.render()).some((node) => node.type === 'a' && node.props.href === '/original'));
  close();
});

test('oversized input without a content-length stops streaming and exposes the original fallback', async () => {
  let signal;
  let parses = 0;
  const chunk = new Uint8Array(1024 * 1024);
  const h = harness({
    fetch: async (_url, options) => {
      signal = options.signal;
      let reads = 0;
      return new Response(new ReadableStream({ pull(controller) {
        if (reads++ < 26) controller.enqueue(chunk);
        else controller.close();
      } }));
    },
    pdfjs: { getDocument() { parses += 1; } },
  });
  const close = h.effects[1]();
  await h.waitForState(5, (value) => value === false);
  assert.equal(parses, 0);
  assert.equal(signal.aborted, true);
  assert.match(h.states[7], /слишком большой/);
  assert.ok(nodes(h.render()).some((node) => node.type === 'a' && node.props.href === '/original'));
  close();
});
