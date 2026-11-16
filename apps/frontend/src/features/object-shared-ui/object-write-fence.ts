import { getAccessGeneration, getAccessSessionGeneration, isAccessGenerationCurrent } from '@/shared/auth/access-generation';
import type { SavedWithoutAccess } from '@/shared/api/saved-without-access';

export const objectSavedWithoutAccess: SavedWithoutAccess = { outcome: 'saved_without_access' };

/** Fence a single recipient/target operation; never use a late DTO as a receipt. */
export function captureObjectWriteFence(targetCurrent: () => boolean) {
  const generation = getAccessGeneration();
  const session = getAccessSessionGeneration();
  const sameTarget = (): boolean => getAccessSessionGeneration() === session && targetCurrent();
  return { sameTarget, current: (): boolean => sameTarget() && isAccessGenerationCurrent(generation) };
}

/** Internal control flow for a staged-file ACK whose protected file ID is unavailable. */
export class ObjectWriteAcknowledgedWithoutAccess extends Error {
  constructor() { super('Запись подтверждена без доступных подробностей.'); this.name = 'ObjectWriteAcknowledgedWithoutAccess'; }
}
