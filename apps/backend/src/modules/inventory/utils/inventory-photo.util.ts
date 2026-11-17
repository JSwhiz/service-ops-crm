import { decideAccess, type AccessSubject } from '../../users-access/utils/access-policy.util';

export function canUseLegacyStandaloneInventoryAttachments(subject: AccessSubject, movement: {
  inventoryItemId: string; createdByUserId: string; movementType: string;
}, legacy: boolean): boolean {
  return legacy && decideAccess(subject,
    movement.movementType === 'receipt' ? 'inventory.receipt' : 'inventory.adjustment', legacy, {
      resourceType: 'inventory_item', resourceId: movement.inventoryItemId, ownerUserId: movement.createdByUserId,
    });
}

export function canAttachStandaloneInventoryPhoto(subject: AccessSubject, movement: {
  inventoryItemId: string; createdByUserId: string; createdAt: Date; status: string; movementType: string;
  relatedObject?: unknown; relatedOneTimeOrder?: unknown;
}, legacy: boolean): boolean {
  if (movement.relatedObject || movement.relatedOneTimeOrder || !['receipt', 'adjustment'].includes(movement.movementType) ||
      ['cancelled', 'rejected'].includes(movement.status) || !isInventoryPhotoDay(movement.createdAt)) return false;
  const context = {
    resourceType: 'inventory_item', resourceId: movement.inventoryItemId, ownerUserId: movement.createdByUserId,
  };
  // The new personal photo grant is author-only. Preserve the existing
  // warehouse-role path for other authors, bounded by its movement action.
  const broaderAuthority = canUseLegacyStandaloneInventoryAttachments(subject, movement, legacy);
  if (movement.createdByUserId !== subject.id) return broaderAuthority;
  return decideAccess(subject, 'inventory.movement.photos.create', broaderAuthority, context);
}

/** A manager's creation day ends at midnight in Moscow (UTC+3, no DST). */
export function isInventoryPhotoDay(createdAt: Date, now = new Date()): boolean {
  const moscowDay = (date: Date): string =>
    new Date(date.getTime() + 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
  return now >= createdAt && moscowDay(createdAt) === moscowDay(now);
}
