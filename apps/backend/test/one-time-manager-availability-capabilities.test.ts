import assert from 'node:assert/strict';
import test from 'node:test';
import type { PrismaService } from '../src/modules/prisma/prisma.service';
import { OneTimeOrderCalendarService } from '../src/modules/one-time-orders/one-time-order-calendar.service';

import type { AccessRule, AccessSubject } from '../src/modules/users-access/types/access-policy.type';
import {
  availabilityActionAllowed, canManageManagerAvailability, managerAvailabilityCapabilities,
} from '../src/modules/one-time-orders/utils/one-time-manager-availability-capabilities.util';
import { ONE_TIME_ORDER_CALENDAR_APPROVE_PERMISSION, ONE_TIME_ORDER_CALENDAR_MANAGE_PERMISSION } from '../src/modules/one-time-orders/utils/one-time-order-access.util';

const prefix = 'one_time_order_calendar';
const actor: AccessSubject = { id: 'actor', isActive: true, roleCodes: ['operation_manager'], permissionCodes: [] };
const rule = (code: string, effect: 'allow' | 'deny', ids: string[] = [], scope: AccessRule['scope'] = 'selected'): AccessRule => ({
  actionCode: `${prefix}.${code}`, effect, scope, selectedIds: ids,
});
const caps = (subject: AccessSubject, userId: string, status: string) => managerAvailabilityCapabilities(subject, { userId, status });

test('default authority is own pending only, not foreign management or approval', () => {
  assert.deepEqual(caps(actor, actor.id, 'pending'), { canEdit: false, canCancel: true, canApprove: false, canReject: false });
  assert.deepEqual(caps(actor, 'A', 'approved'), { canEdit: false, canCancel: false, canApprove: false, canReject: false });
  assert.equal(canManageManagerAvailability(actor, 'A'), false);
});

test('selected manage A enables approved A edit/cancel, never B, foreign pending or own requests', () => {
  const subject = { ...actor, accessRules: [rule('availability.manage', 'allow', ['A'])] };
  assert.equal(canManageManagerAvailability(subject, 'A'), true);
  assert.equal(canManageManagerAvailability(subject, 'B'), false);
  assert.equal(canManageManagerAvailability(subject, actor.id), false);
  assert.equal(caps(subject, 'A', 'approved').canEdit, true);
  assert.equal(caps(subject, 'A', 'approved').canCancel, true);
  assert.equal(caps(subject, 'B', 'approved').canCancel, false);
  assert.equal(caps(subject, 'A', 'pending').canCancel, false);
  assert.equal(caps(subject, 'A', 'pending').canApprove, false);
  assert.equal(canManageManagerAvailability(actor, 'A'), false, 'Revocation reverts to baseline');
});

test('legacy manage plus selected deny A preserves control B and self-approved cancellation prohibition', () => {
  const subject = { ...actor, permissionCodes: [ONE_TIME_ORDER_CALENDAR_MANAGE_PERMISSION], accessRules: [rule('availability.manage', 'deny', ['A'])] };
  assert.equal(caps(subject, 'A', 'approved').canEdit, false);
  assert.equal(caps(subject, 'A', 'approved').canCancel, false);
  assert.equal(caps(subject, 'B', 'approved').canCancel, true);
  assert.equal(caps(subject, actor.id, 'approved').canEdit, true);
  assert.equal(caps(subject, actor.id, 'approved').canCancel, false);
  assert.equal(caps(subject, actor.id, 'pending').canCancel, true);
  for (const state of ['rejected', 'cancelled']) {
    assert.equal(caps(subject, 'B', state).canCancel, false);
    assert.equal(caps(subject, 'B', state).canEdit, false);
  }
});

test('own deny cannot be bypassed by manage all; own remains target-specific', () => {
  const subject = { ...actor, accessRules: [rule('availability.manage', 'allow', [], 'all'), rule('availability.own', 'deny', [], 'all')] };
  assert.equal(caps(subject, actor.id, 'pending').canCancel, false);
  assert.equal(caps(subject, actor.id, 'approved').canCancel, false);
  assert.equal(caps(subject, 'A', 'approved').canCancel, true);
});

test('module deny and inactive subject suppress every mutation flag', () => {
  for (const subject of [
    { ...actor, accessRules: [rule('availability.manage', 'allow', [], 'all'), rule('access', 'deny', [], 'all')] },
    { ...actor, isActive: false, permissionCodes: [ONE_TIME_ORDER_CALENDAR_MANAGE_PERMISSION, ONE_TIME_ORDER_CALENDAR_APPROVE_PERMISSION] },
  ]) for (const userId of [actor.id, 'A']) for (const status of ['pending', 'approved']) {
    assert.deepEqual(caps(subject, userId, status), { canEdit: false, canCancel: false, canApprove: false, canReject: false });
  }
});

test('injected policy-locked approve allow never replaces legacy approval permission', () => {
  const subject = { ...actor, accessRules: [rule('availability.approve', 'allow', [], 'all')] };
  assert.equal(caps(subject, 'A', 'pending').canApprove, false);
  assert.equal(caps(subject, 'A', 'pending').canReject, false);
});

test('legacy approval requires both actor and target policy checks, without inventing a self-approval rule', () => {
  const reviewer = { ...actor, permissionCodes: [ONE_TIME_ORDER_CALENDAR_APPROVE_PERMISSION] };
  assert.equal(caps(reviewer, 'A', 'pending').canApprove, true);
  assert.equal(caps(reviewer, actor.id, 'pending').canApprove, true, 'Existing availability policy is unchanged');
  assert.equal(caps(reviewer, 'A', 'approved').canApprove, false);
  const targetDenied = { ...reviewer, accessRules: [rule('availability.approve', 'deny', ['A'])] };
  assert.equal(caps(targetDenied, 'A', 'pending').canApprove, false);
  assert.equal(caps(targetDenied, 'B', 'pending').canReject, true);
  const actorDenied = { ...reviewer, accessRules: [rule('availability.approve', 'deny', [actor.id])] };
  assert.equal(caps(actorDenied, 'B', 'pending').canApprove, false);
});

test('export is independent of manage and subtracts selected manager denies', () => {
  const subject = { ...actor, accessRules: [rule('availability.manage', 'deny', [], 'all'), rule('export', 'deny', ['A'])] };
  assert.equal(availabilityActionAllowed(subject, `${prefix}.export`, true, 'A'), false);
  assert.equal(availabilityActionAllowed(subject, `${prefix}.export`, true, 'B'), true);
  assert.equal(canManageManagerAvailability(subject, 'B'), false);
});

// In-memory read adapter only: no Prisma client, app, socket, storage or DB.
function calendarFixture() {
  const subject = {
    id: actor.id, login: 'actor', fullName: 'Actor', roleCode: 'operation_manager', roleCodes: ['operation_manager'], isActive: true,
    permissionCodes: [ONE_TIME_ORDER_CALENDAR_APPROVE_PERMISSION],
    accessRules: [rule('availability.manage', 'allow', ['A']), rule('export', 'deny', ['A'])],
  };
  const users = [actor.id, 'A', 'B'].map(id => ({ id, login: `login-${id}`, fullName: `Calendar-${id}`, isActive: true, deletedAt: null }));
  const entries = users.map(user => ({
    id: `absence-${user.id}`, userId: user.id, entryType: 'day_off', status: 'approved', requestComment: `private-${user.id}`,
    startDate: new Date('2047-04-10T00:00:00Z'), endDate: new Date('2047-04-10T00:00:00Z'),
  }));
  const database = {
    oneTimeOrderAssignment: { findFirst: async () => null },
    oneTimeOrderCalendarManager: {
      findFirst: async () => ({ id: 'profile' }),
      findMany: async (args: { where: { userId?: string } }) => users.filter(user => !args.where.userId || user.id === args.where.userId).map(user => ({ user })),
    },
    user: { findMany: async () => users.map(user => ({ ...user, roles: [{ role: { code: 'manager' } }], oneTimeOrderAssignments: [], oneTimeOrderCalendarProfile: { isVisible: true } })) },
    oneTimeOrder: { findMany: async () => [] },
    oneTimeManagerAvailability: { findMany: async (args: { where: { userId: { in: string[] } } }) => entries.filter(entry => args.where.userId.in.includes(entry.userId)) },
  };
  return { subject, service: new OneTimeOrderCalendarService(database as unknown as PrismaService) };
}

test('calendar DTO exposes per-target direct/edit/cancel and independent export flags without a /me grant', async () => {
  const { subject, service } = calendarFixture();
  assert.equal(canManageManagerAvailability(subject, subject.id), false);
  const view = await service.getCalendar(subject, { month: '2047-04' });
  assert.equal(view.capabilities.canRequestOwnAvailability, true);
  assert.equal(view.capabilities.canExport, true);
  const a = view.managers.find(manager => manager.user.id === 'A')!;
  const b = view.managers.find(manager => manager.user.id === 'B')!;
  assert.deepEqual(a.capabilities, { canCreateAvailability: true, canRequestOwnAvailability: false, canExport: false });
  assert.deepEqual(b.capabilities, { canCreateAvailability: false, canRequestOwnAvailability: false, canExport: true });
  assert.equal(a.days[9].availability?.capabilities.canCancel, true);
  assert.equal(a.days[9].availability?.capabilities.canEdit, true);
  assert.equal(b.days[9].availability?.capabilities.canCancel, false);
  assert.deepEqual(view.availabilityTargets.filter(target => target.capabilities.canCreateAvailability).map(target => target.user.id), ['A']);
});

test('unfiltered workbook excludes denied manager rows; explicit denied export rejects', async () => {
  const { subject, service } = calendarFixture();
  const result = await service.exportCalendar(subject, { month: '2047-04' });
  const workbook = result.buffer.toString('utf8'); // Existing XLSX writer stores XML without compression.
  assert.equal(workbook.includes('Calendar-A'), false);
  assert.equal(workbook.includes('Calendar-B'), true);
  await assert.rejects(service.exportCalendar(subject, { month: '2047-04', managerUserId: 'A' }), /Calendar export denied/);
});
