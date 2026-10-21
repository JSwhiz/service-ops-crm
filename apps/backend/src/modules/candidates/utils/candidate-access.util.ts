import type { Prisma } from '@prisma/client';

export const CANDIDATE_PERMISSION_CODES = {
  view: 'candidates.view',
  manage: 'candidates.manage',
  respond: 'candidates.respond',
} as const;

function hasPermission(permissionCodes: string[], permissionCode: string): boolean {
  return permissionCodes.includes(permissionCode);
}
export function canViewCandidates(permissionCodes: string[]): boolean {
  return hasPermission(permissionCodes, CANDIDATE_PERMISSION_CODES.view);
}

export function canManageCandidates(permissionCodes: string[]): boolean {
  return hasPermission(permissionCodes, CANDIDATE_PERMISSION_CODES.manage);
}

export function canRespondToCandidates(permissionCodes: string[]): boolean {
  return hasPermission(permissionCodes, CANDIDATE_PERMISSION_CODES.respond) || canManageCandidates(permissionCodes);
}

// Keep registry, direct links, global search and recent-search resolution on one scope.
export function buildCandidateAccessWhere(user: { id: string; permissionCodes?: string[] }): Prisma.CandidateWhereInput {
  if (canManageCandidates(user.permissionCodes ?? [])) return {};
  return { assignments: { some: { managerUserId: user.id, endedAt: null } } };
}

export function buildCandidateGlobalCapabilities(permissionCodes: string[]) {
  return {
    canAccessCandidates: canViewCandidates(permissionCodes),
    canManageCandidates: canManageCandidates(permissionCodes),
    canRespondToCandidates: canRespondToCandidates(permissionCodes),
  };
}
