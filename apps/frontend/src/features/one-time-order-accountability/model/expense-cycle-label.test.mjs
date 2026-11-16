import assert from 'node:assert/strict';
import test from 'node:test';
import { getExpenseCycleLabel } from './expense-cycle-label.ts';

test('employee payout with a work cycle does not falsely claim to have no cycle', () => {
  assert.equal(getExpenseCycleLabel({ oneTimeOrderWorkCycle: 1, oneTimeOrderCompletionId: null }, []), 'Цикл 1');
});
test('completion-backed expense shows its cycle only once', () => {
  assert.equal(getExpenseCycleLabel({ oneTimeOrderWorkCycle: 2, oneTimeOrderCompletionId: 'c' }, [{ id: 'c', workCycle: 2 }]), 'Цикл 2');
});
test('legacy completion reference resolves its cycle', () => {
  assert.equal(getExpenseCycleLabel({ oneTimeOrderCompletionId: 'c' }, [{ id: 'c', workCycle: 3 }]), 'Цикл 3');
});
test('unavailable completion is distinguished from absent association', () => {
  assert.equal(getExpenseCycleLabel({ oneTimeOrderCompletionId: 'missing' }, []), 'Запись завершения недоступна');
  assert.equal(getExpenseCycleLabel({}, []), 'Без привязки к циклу');
});
