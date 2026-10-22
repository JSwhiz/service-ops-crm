import { getApprovalTypeLabel } from '@/shared/lib/approval-presentation';
import { getInventoryMovementTypeLabel } from '@/shared/lib/inventory-presentation';

import type { ApprovalRequestItem } from './approval.types';

/** Human-readable title and subtitle for an approval request (queue, drawer, dashboard). */
export const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function getApprovalTitle(item: ApprovalRequestItem): string {
  const title = item.summary.title.trim();

  if (
    !title ||
    title === item.approvalType ||
    title === 'Inventory exception' ||
    UUID_PATTERN.test(title)
  ) {
    return getApprovalTypeLabel(item.approvalType);
  }

  return title;
}

function getObjectStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    active: 'Активный',
    frozen: 'Приостановлен',
    archived: 'Архив',
  };

  return labels[status] ?? 'Неизвестное состояние';
}

export function getApprovalSubtitle(item: ApprovalRequestItem): string | null {
  const subtitle = item.summary.subtitle?.trim();

  if (!subtitle || UUID_PATTERN.test(subtitle)) {
    return null;
  }

  if (item.approvalType === 'inventory_exception_confirmation') {
    const [movementType, ...rest] = subtitle.split(' · ');
    const movementLabel = movementType
      ? getInventoryMovementTypeLabel(movementType)
      : null;

    return movementType
      ? [
          movementLabel === movementType
            ? 'Движение расходников'
            : movementLabel,
          ...rest,
        ]
          .filter(Boolean)
          .join(' · ')
      : subtitle;
  }

  if (item.approvalType === 'object_change_confirmation') {
    const objectName = getStringValue(item.payloadSnapshot, 'objectName');
    const currentStatus = getStringValue(
      item.payloadSnapshot,
      'currentStatus',
    );
    const requestedStatus = getStringValue(
      item.payloadSnapshot,
      'requestedStatus',
    );

    if (objectName && currentStatus && requestedStatus) {
      return (
        objectName +
        ' · ' +
        getObjectStatusLabel(currentStatus) +
        ' → ' +
        getObjectStatusLabel(requestedStatus)
      );
    }
  }

  return subtitle;
}

export function getStringValue(
  payload: Record<string, unknown>,
  key: string,
): string | null {
  const value = payload[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
