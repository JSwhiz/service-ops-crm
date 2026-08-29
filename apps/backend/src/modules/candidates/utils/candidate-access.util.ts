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
  return hasPermission(permissionCodes, CANDIDATE_PERMISSION_CODES.respond);
}

export function buildCandidateGlobalCapabilities(permissionCodes: string[]) {
  return {
    canAccessCandidates: canViewCandidates(permissionCodes),
    canManageCandidates: canManageCandidates(permissionCodes),
    canRespondToCandidates: canRespondToCandidates(permissionCodes),
  };
}
