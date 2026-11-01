import assert from 'node:assert/strict';
import test from 'node:test';

import { toCreateUserAbsencePayload } from './create-user-absence-payload.ts';

const values = {
  userId: 'user-2', absenceType: 'vacation', startDate: '2026-11-02', endDate: '2026-11-05', comment: 'private note',
};

test('absence payload keeps User, type, date range, and nullable comment', () => {
  assert.deepEqual(toCreateUserAbsencePayload({ ...values, comment: '' }, {
    canManageAll: true, canViewPrivateReasons: true, currentUserId: 'user-1',
  }), {
    userId: 'user-2', absenceType: 'vacation', startDate: '2026-11-02', endDate: '2026-11-05', comment: null,
  });
});

test('non-manager-all creation is pinned to the current User and cannot leak another User comment', () => {
  assert.deepEqual(toCreateUserAbsencePayload(values, {
    canManageAll: false, canViewPrivateReasons: false, currentUserId: 'user-1',
  }), {
    userId: 'user-1', absenceType: 'vacation', startDate: '2026-11-02', endDate: '2026-11-05', comment: null,
  });
});
