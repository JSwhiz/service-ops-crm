import assert from 'node:assert/strict';
import test from 'node:test';

import { formatFileTypeLabel } from './file-viewer-presentation.ts';

test('uses a readable extension label for Office files', () => {
  assert.equal(formatFileTypeLabel({
    originalName: 'Смета.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  }), 'XLSX');
});

test('uses known format labels when a filename has no useful extension', () => {
  assert.equal(formatFileTypeLabel({ originalName: 'document', mimeType: 'application/pdf' }), 'PDF');
});

test('does not expose raw MIME strings for unknown file types', () => {
  assert.equal(formatFileTypeLabel({ originalName: 'archive', mimeType: 'application/x-custom' }), 'Файл');
});
