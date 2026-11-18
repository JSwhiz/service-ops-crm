import assert from 'node:assert/strict';
import test from 'node:test';

import { changeUserAbsenceCreateTarget, toCreateUserAbsencePayload, toUpdateUserAbsencePayload } from './create-user-absence-payload.ts';

const values = {
  userId: 'foreign-a', absenceType: 'vacation', startDate: '2026-11-02', endDate: '2026-11-05', comment: 'private note',
};

function target(id, canCreate, canViewPrivateReasons) {
  return { id, login: id, fullName: id, capabilities: { canCreate, canViewPrivateReasons } };
}

function item(userId, canUpdate, canDelete, canViewPrivateReasons) {
  return { id: 'absence-a', userId, capabilities: { canUpdate, canDelete, canViewPrivateReasons } };
}

test('selected foreign create grant works when own creation is denied', () => {
  const options = [target('self', false, false), target('foreign-a', true, true), target('foreign-b', false, false)];
  assert.deepEqual(toCreateUserAbsencePayload(values, options.find((entry) => entry.id === values.userId)), values);
  assert.throws(() => toCreateUserAbsencePayload({ ...values, userId: 'self' }, options[0]), /недоступно/);
  assert.throws(() => toCreateUserAbsencePayload({ ...values, userId: 'foreign-b' }, options[2]), /недоступно/);
});

test('creation keeps type, dates and the chosen target, with nullable readable comment', () => {
  assert.deepEqual(toCreateUserAbsencePayload({ ...values, comment: '' }, target('foreign-a', true, true)), {
    ...values, comment: null,
  });
});

test('missing, mismatched and revoked options reject without rewriting the draft', () => {
  const draft = { ...values };
  for (const option of [undefined, target('self', true, true), target('foreign-a', false, true), { id: 'foreign-a' }]) {
    assert.throws(() => toCreateUserAbsencePayload(draft, option), /недоступно/);
    assert.deepEqual(draft, values);
  }
});

test('private reason deny omits the create field for self and foreign targets', () => {
  for (const userId of ['self', 'foreign-a']) {
    const result = toCreateUserAbsencePayload({ ...values, userId }, target(userId, true, false));
    assert.equal(result.userId, userId);
    assert.equal(Object.hasOwn(result, 'comment'), false);
    assert.equal(JSON.stringify(result).includes('private note'), false);
  }
});

test('private revocation preserves the draft comment but omits it from the next payload', () => {
  const draft = { ...values };
  const option = target('foreign-a', true, true);
  assert.equal(toCreateUserAbsencePayload(draft, option).comment, 'private note');
  option.capabilities.canViewPrivateReasons = false;
  assert.equal(Object.hasOwn(toCreateUserAbsencePayload(draft, option), 'comment'), false);
  assert.deepEqual(draft, values);
});

test('actual create target changes clear private comments; same-target revoke/regrant preserves them', () => {
  const draft = { ...values };
  const changed = changeUserAbsenceCreateTarget(draft, 'foreign-b');
  assert.deepEqual(changed, { ...values, userId: 'foreign-b', comment: '' });
  const payload = toCreateUserAbsencePayload(changed, target('foreign-b', true, true));
  assert.equal(payload.comment, null);
  assert.equal(JSON.stringify(payload).includes('private note'), false);
  assert.equal(changeUserAbsenceCreateTarget(changed, 'foreign-a').comment, '');
  assert.deepEqual(draft, values);

  const retained = changeUserAbsenceCreateTarget(draft, 'foreign-a');
  assert.equal(retained, draft);
  assert.equal(Object.hasOwn(toCreateUserAbsencePayload(retained, target('foreign-a', true, false)), 'comment'), false);
  assert.equal(toCreateUserAbsencePayload(retained, target('foreign-a', true, true)).comment, 'private note');
});

test('update uses the item grant without requiring create or delete', () => {
  const result = toUpdateUserAbsencePayload(values, item('foreign-a', true, false, true), true);
  assert.deepEqual(result, {
    absenceType: values.absenceType, startDate: values.startDate, endDate: values.endDate, comment: values.comment,
  });
  assert.equal(Object.hasOwn(result, 'userId'), false);
});

test('untouched metadata updates omit readable reasons, including after a private grant', () => {
  const entry = { ...item('foreign-a', true, false, true), comment: 'concurrently updated reason' };
  for (const comment of ['', 'stale reason from openEdit']) {
    const draft = { ...values, comment };
    for (const result of [toUpdateUserAbsencePayload(draft, entry), toUpdateUserAbsencePayload(draft, entry, false)]) {
      assert.equal(Object.hasOwn(result, 'comment'), false);
      assert.equal(JSON.stringify(result).includes('comment'), false);
      assert.equal(result.startDate, values.startDate);
    }
    assert.equal(draft.comment, comment);
    assert.equal(entry.comment, 'concurrently updated reason');
  }
});

test('delete-only, missing or revoked update rights cannot produce a PATCH', () => {
  for (const entry of [undefined, item('foreign-a', false, true, true), item('self', true, true, true)]) {
    assert.throws(() => toUpdateUserAbsencePayload(values, entry), /недоступно/);
  }
});

test('private deny omits PATCH comment entirely, including for own empty draft', () => {
  for (const userId of ['self', 'foreign-a']) {
    for (const comment of ['', 'private note']) {
      const result = toUpdateUserAbsencePayload({ ...values, userId, comment }, item(userId, true, true, false), true);
      assert.equal(Object.hasOwn(result, 'comment'), false);
      assert.equal(JSON.stringify(result).includes('comment'), false);
    }
  }
});

test('readable empty comment can still explicitly clear a reason', () => {
  assert.equal(toUpdateUserAbsencePayload({ ...values, comment: '' }, item('foreign-a', true, false, true), true).comment, null);
});
