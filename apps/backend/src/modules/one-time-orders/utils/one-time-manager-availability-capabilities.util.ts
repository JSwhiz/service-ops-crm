import type { AccessSubject } from '../../users-access/types/access-policy.type';
import { decideAccess } from '../../users-access/utils/access-policy.util';
import {
  ONE_TIME_ORDER_CALENDAR_APPROVE_PERMISSION,
  ONE_TIME_ORDER_CALENDAR_MANAGE_PERMISSION,
} from './one-time-order-access.util';

export function availabilityActionAllowed(subject: AccessSubject, code: string, legacy: boolean, userId?: string): boolean {
  return decideAccess(subject, code, legacy, { resourceType: 'user', resourceId: userId, ownerUserId: userId });
}

export function canManageManagerAvailability(subject: AccessSubject, userId?: string): boolean {
  return availabilityActionAllowed(subject, 'one_time_order_calendar.availability.manage',
    subject.permissionCodes?.includes(ONE_TIME_ORDER_CALENDAR_MANAGE_PERMISSION) === true, userId);
}

export interface ManagerAvailabilityCapabilities {
  canEdit: boolean;
  canCancel: boolean;
  canApprove: boolean;
  canReject: boolean;
}

/** Mirrors endpoint authority/state, not overlap/date validation or approval
 * existence. In particular, manage never cancels a foreign pending request or
 * the actor's own approved absence. Approve retains its legacy permission gate. */
export function managerAvailabilityCapabilities(
  subject: AccessSubject,
  entry: { userId: string; status: string },
): ManagerAvailabilityCapabilities {
  const own = entry.userId === subject.id;
  const manage = canManageManagerAvailability(subject, entry.userId);
  const canCancel = own
    ? entry.status === 'pending' && availabilityActionAllowed(subject, 'one_time_order_calendar.availability.own', true, entry.userId)
    : entry.status === 'approved' && manage;
  const canApprove = entry.status === 'pending' &&
    subject.permissionCodes?.includes(ONE_TIME_ORDER_CALENDAR_APPROVE_PERMISSION) === true &&
    availabilityActionAllowed(subject, 'one_time_order_calendar.availability.approve', true, subject.id) &&
    availabilityActionAllowed(subject, 'one_time_order_calendar.availability.approve', true, entry.userId);
  return { canEdit: entry.status === 'approved' && manage, canCancel, canApprove, canReject: canApprove };
}
