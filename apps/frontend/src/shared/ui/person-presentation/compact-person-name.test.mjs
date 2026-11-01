import assert from 'node:assert/strict';
import test from 'node:test';
import { compactPersonName } from './compact-person-name.ts';

test('compact presentation preserves surname and all initials', () => {
  assert.equal(compactPersonName('Иванова Анна Мария Сергеевна'), 'Иванова А.М.С.');
  assert.equal(compactPersonName('  Иванов   Иван Иванович  '), 'Иванов И.И.');
});
test('one-word names are not abbreviated or merged', () => {
  assert.equal(compactPersonName('Александра'), 'Александра');
  assert.equal(compactPersonName(''), '');
});
test('Unicode initials remain whole code points', () => {
  assert.equal(compactPersonName('Surname 𐐀name'), 'Surname 𐐀.');
});
