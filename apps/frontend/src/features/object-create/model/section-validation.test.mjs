import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { findSectionValidationIssue, revealSectionValidationIssue } from './section-validation.ts';

function control(sectionId, valid, events, message = 'Значение должно быть не меньше 0.') {
  return {
    willValidate: true, validity: { valid }, validationMessage: message,
    closest: () => ({ getAttribute: () => sectionId }),
    focus: () => events.push('focus'),
    reportValidity: () => { events.push('report'); return valid; },
  };
}

for (const [scenario, sectionId, currentView] of [
  ['order agreedSum=-1 after leaving Conditions', 'conditions', 'basic'],
  ['object budget amount=-1 while viewing Contract', 'articles', 'contract'],
]) {
  test(scenario + ' blocks submission, reveals the static owner, then focuses', () => {
    const events = [];
    const negativeAmount = control(sectionId, false, events);
    const issue = findSectionValidationIssue([control(currentView, true, events), negativeAmount]);
    assert.equal(issue.control, negativeAmount);
    assert.equal(issue.sectionId, sectionId);
    const scheduled = [];
    revealSectionValidationIssue(issue, (id) => events.push(`reveal:${id}`), (callback) => scheduled.push(callback));
    assert.deepEqual(events, [`reveal:${sectionId}`]);
    scheduled[0]();
    assert.deepEqual(events, [`reveal:${sectionId}`, 'focus', 'report']);
  });
}

test('all native constraint failures are considered; genuinely disabled ACL controls are exempt', () => {
  for (const constraint of ['rangeUnderflow', 'rangeOverflow', 'stepMismatch', 'patternMismatch', 'valueMissing', 'badInput']) {
    const invalid = control('conditions', false, [], constraint);
    const disabled = { ...control('contract', false, []), willValidate: false };
    assert.equal(findSectionValidationIssue([disabled, invalid]).message, constraint);
  }
  assert.equal(findSectionValidationIssue([control('basic', true, [])]), null);
});

test('form wiring retains validation in hidden sections and static budget anchors', () => {
  const orderForm = readFileSync(new URL('../../one-time-order-form/ui/one-time-order-form.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(orderForm, /disabled=\{Boolean\(activeSection/);
  assert.match(orderForm, /data-create-section="conditions"/);
  assert.match(orderForm, /noValidate/);
  const objectForm = readFileSync(new URL('../ui/object-create-dialog.tsx', import.meta.url), 'utf8');
  assert.match(objectForm, /data-create-section="setup"/);
  assert.doesNotMatch(objectForm, /data-create-section=\{activeSection/);
  const setup = readFileSync(new URL('../../object-setup/ui/object-setup-editor.tsx', import.meta.url), 'utf8');
  assert.match(setup, /data-create-section="contract"/);
  assert.match(setup, /data-create-section="articles"/);
});
