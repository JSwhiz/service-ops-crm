import test from 'node:test';
import assert from 'node:assert/strict';
import { EMPLOYEE_PHONE_ERROR, EMPLOYEE_INVALID_PHONE_SELECTOR, focusEmployeePhoneIssue } from './phone-validation-focus.ts';

test('does not focus a hidden Contacts section; focuses the first invalid phone after it is open', () => {
  let queries = 0;
  let focused = 0;
  const find = (selector) => {
    queries++;
    assert.equal(selector, EMPLOYEE_INVALID_PHONE_SELECTOR);
    return { focus: () => { focused++; } };
  };
  assert.equal(focusEmployeePhoneIssue('work', find), false);
  assert.equal(queries, 0);
  assert.equal(focusEmployeePhoneIssue('contacts', find), true);
  assert.equal(focused, 1);
  assert.match(EMPLOYEE_PHONE_ERROR, /3 цифр/);
  assert.equal(focusEmployeePhoneIssue('contacts', () => null), false);
});
