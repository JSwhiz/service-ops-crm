import assert from 'node:assert/strict';
import test from 'node:test';
import { isNativeValidationIssueResolved } from './stale-native-validation.ts';

test('negative amount keeps its native error until corrected', () => {
  const control = { isConnected: true, willValidate: true, validity: { valid: false } };
  assert.equal(isNativeValidationIssueResolved(control), false);
  control.validity.valid = true;
  assert.equal(isNativeValidationIssueResolved(control), true);
});
test('removing the unsaved article resolves its tracked field error', () => {
  assert.equal(isNativeValidationIssueResolved({ isConnected: false, willValidate: true, validity: { valid: false } }), true);
});
test('disabled controls are exempt; an invalid control hidden by a section is not', () => {
  assert.equal(isNativeValidationIssueResolved({ isConnected: true, willValidate: false, validity: { valid: false } }), true);
  assert.equal(isNativeValidationIssueResolved({ isConnected: true, willValidate: true, validity: { valid: false } }), false);
});
