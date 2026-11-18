import { ForbiddenException, Logger, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import type { AccessSubject } from '../../modules/users-access/types/access-policy.type';

export type SavedWithoutAccess = { outcome: 'saved_without_access' };
const logger = new Logger('CommittedWrite');

/** A committed write stays successful even when its response cannot disclose the record. */
export async function projectCommittedWrite<T>(
  db: Pick<Prisma.TransactionClient, 'user'>,
  actor: AccessSubject,
  project: () => T | Promise<T>,
): Promise<T | SavedWithoutAccess> {
  const acknowledgement: SavedWithoutAccess = { outcome: 'saved_without_access' };
  const isCurrent = async (): Promise<boolean> => {
    if (actor.accessVersion === undefined) return true;
    const current = await db.user.findFirst({
      where: { id: actor.id, isActive: true, deletedAt: null },
      select: { accessVersion: true },
    }).catch(() => null);
    return current?.accessVersion === actor.accessVersion;
  };

  if (!await isCurrent()) return acknowledgement;

  try {
    const result = await project();
    return await isCurrent() ? result : acknowledgement;
  } catch (error) {
    // The transaction is already committed. A projection failure must never
    // turn its acknowledgement into an instruction to repeat the mutation.
    if (!(error instanceof ForbiddenException || error instanceof NotFoundException)) {
      logger.error('Committed write response projection failed', error instanceof Error ? error.stack : undefined);
    }
    return acknowledgement;
  }
}
