import type { Prisma } from '@prisma/client';
import type { ListObjectsQueryDto } from '../dto/list-objects-query.dto';

export function objectRegistryArchiveState(query?: ListObjectsQueryDto): 'active' | 'archived' | 'all' {
  return query?.archiveState ?? (query?.status === 'archived' ? 'archived' : 'active');
}

/** Counts and rows share the same authorized search; only the archive selector differs. */
export function objectRegistryArchiveWhere(
  base: Prisma.ObjectWhereInput,
  state: 'active' | 'archived' | 'all',
): Prisma.ObjectWhereInput {
  return state === 'all' ? base : { AND: [base, { status: state === 'archived' ? 'archived' : { not: 'archived' } }] };
}
