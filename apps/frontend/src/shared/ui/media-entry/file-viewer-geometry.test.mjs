import assert from 'node:assert/strict';
import test from 'node:test';

import { getLensGeometry } from './file-viewer-geometry.ts';

const viewport = { left: 0, top: 0, width: 800, height: 600 };

test('keeps the complete lens inside viewport edges', () => {
  const image = { left: 40, top: 30, width: 400, height: 300 };
  const geometry = getLensGeometry({ x: 40, y: 30 }, image, viewport, 4, 3);
  assert.ok(geometry);
  assert.equal(geometry.left, 0);
  assert.equal(geometry.top, 0);
  assert.equal(geometry.left + geometry.diameter <= viewport.width, true);
  assert.equal(geometry.top + geometry.diameter <= viewport.height, true);
});

test('does not magnify letterboxing and maps the contained image area', () => {
  const image = { left: 100, top: 100, width: 400, height: 300 };
  assert.equal(getLensGeometry({ x: 200, y: 110 }, image, viewport, 2, 1), null);
  const geometry = getLensGeometry({ x: 200, y: 150 }, image, viewport, 2, 1);
  assert.ok(geometry);
  assert.equal(geometry.backgroundWidth, 800);
  assert.equal(geometry.backgroundHeight, 400);
});

test('small sources scale enough to fill the lens without an empty background', () => {
  const image = { left: 250, top: 200, width: 80, height: 60 };
  const geometry = getLensGeometry({ x: 290, y: 230 }, image, viewport, 4, 3);
  assert.ok(geometry);
  assert.equal(geometry.backgroundWidth >= geometry.diameter, true);
  assert.equal(geometry.backgroundHeight >= geometry.diameter, true);
});
