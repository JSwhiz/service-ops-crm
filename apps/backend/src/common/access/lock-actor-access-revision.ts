import { ForbiddenException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import type { AccessSubject } from '../../modules/users-access/types/access-policy.type';

export async function lockActorAccessRevision(tx: Prisma.TransactionClient, actor: AccessSubject): Promise<void> {
  // JwtStrategy loads the version. Founder saves update this same row
  // before writing rules, so the shared lock orders the save and mutation.
  if (actor.accessVersion === undefined) return;
  const [current] = await tx.$queryRaw<Array<{ accessVersion: number }>>`
    SELECT "accessVersion" FROM "users"
    WHERE "id" = ${actor.id} AND "deletedAt" IS NULL AND "isActive" = true
    FOR SHARE
  `;
  if (current?.accessVersion !== actor.accessVersion) {
    throw new ForbiddenException('Права изменились. Проверьте доступ и повторите действие.');
  }
}
