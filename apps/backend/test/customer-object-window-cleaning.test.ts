import 'reflect-metadata';
import assert from 'node:assert/strict';
import test from 'node:test';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { CreateObjectDto } from '../src/modules/objects/dto/create-object.dto';
import { UpdateObjectDto } from '../src/modules/objects/dto/update-object.dto';
import { resolveWindowCleaningChange } from '../src/modules/objects/utils/object-window-cleaning.util';

test('legacy mode stays unknown and an unrelated patch does not infer visits', () => {
  assert.equal(resolveWindowCleaningChange({}, { windowCleaningMode: null, windowCleaningSeasons: [] }), undefined);
  assert.deepEqual(resolveWindowCleaningChange({ windowCleaningMode: null }), { windowCleaningMode: null, windowCleaningSeasons: [] });
});

test('scheduled duplicate seasons are independent ordered visits', () => {
  assert.deepEqual(resolveWindowCleaningChange({ windowCleaningMode: 'scheduled', windowCleaningSeasons: ['spring', 'spring', 'autumn'] }), { windowCleaningMode: 'scheduled', windowCleaningSeasons: ['spring', 'spring', 'autumn'] });
  assert.throws(() => resolveWindowCleaningChange({ windowCleaningMode: 'scheduled', windowCleaningSeasons: [] }));
});

test('mode-only patch clears the former schedule; contradictory submitted rows are rejected', () => {
  const current = { windowCleaningMode: 'scheduled' as const, windowCleaningSeasons: ['summer', 'summer'] };
  assert.deepEqual(resolveWindowCleaningChange({ windowCleaningMode: 'on_request' }, current), { windowCleaningMode: 'on_request', windowCleaningSeasons: [] });
  assert.throws(() => resolveWindowCleaningChange({ windowCleaningMode: 'notprovided', windowCleaningSeasons: ['summer'] }, current));
});

test('create/update DTOs accept repetitions but reject winter, malformed mode and null arrays', () => {
  const dtoTypes: Array<new () => object> = [CreateObjectDto, UpdateObjectDto];
  for (const Dto of dtoTypes) {
    const base = { name: 'Тестовый объект', address: 'Тестовый адрес', status: 'active' };
    assert.equal(validateSync(plainToInstance(Dto, { ...base, windowCleaningMode: 'scheduled', windowCleaningSeasons: ['summer', 'summer'] })).length, 0);
    for (const fields of [{ windowCleaningSeasons: ['winter'] }, { windowCleaningMode: 'invented' }, { windowCleaningSeasons: null }]) {
      assert.ok(validateSync(plainToInstance(Dto, { ...base, ...fields })).length);
    }
  }
});
