import type { Prisma } from '@prisma/client';
import type { AccessSubject } from '../../users-access/types/access-policy.type';
import { buildAccessWhere, decideAccess } from '../../users-access/utils/access-policy.util';
import type { AccessContext } from '../../users-access/types/access-policy.type';

export const CANDIDATE_PERMISSION_CODES = {
  view: 'candidates.view',
  manage: 'candidates.manage',
  respond: 'candidates.respond',
  denied: 'candidates.denied',
} as const;

function hasPermission(permissionCodes: string[], permissionCode: string): boolean {
  return permissionCodes.includes(permissionCode);
}
export function canViewCandidates(permissionCodes: string[]): boolean {
  return !hasPermission(permissionCodes, CANDIDATE_PERMISSION_CODES.denied) && hasPermission(permissionCodes, CANDIDATE_PERMISSION_CODES.view);
}

export function canManageCandidates(permissionCodes: string[]): boolean {
  return canViewCandidates(permissionCodes) && hasPermission(permissionCodes, CANDIDATE_PERMISSION_CODES.manage);
}

export function canRespondToCandidates(permissionCodes: string[]): boolean {
  return canViewCandidates(permissionCodes) && (hasPermission(permissionCodes, CANDIDATE_PERMISSION_CODES.respond) || canManageCandidates(permissionCodes));
}

const managementLeaves = [
  'candidates.create', 'candidates.update', 'candidates.status',
  'candidates.archive', 'candidates.restore', 'candidates.assignments.manage',
  'candidates.convert_employee',
] as const;

function isManagementLeaf(code: string): boolean {
  return (managementLeaves as readonly string[]).includes(code);
}

/** Keep direct feedback authority independent of the management bundle. A
 * manage deny removes HR feedback, not the actor's own direct responder right. */
function legacyResponseAllowed(user: AccessSubject): boolean {
  const permissions = [...(user.permissionCodes ?? [])];
  return canViewCandidates(permissions) && permissions.includes(CANDIDATE_PERMISSION_CODES.respond);
}

// Keep registry, direct links, global search and recent-search resolution on one scope.
export function buildCandidateAccessWhere(user: AccessSubject, actionCode = 'candidates.view', legacyAllowed?: boolean): Prisma.CandidateWhereInput {
  const permissions = [...(user.permissionCodes ?? [])];
  const managementLeaf = isManagementLeaf(actionCode);
  const baseline = legacyAllowed ?? (actionCode === 'candidates.view' ? canViewCandidates(permissions)
    : actionCode === 'candidates.respond' ? legacyResponseAllowed(user) : canManageCandidates(permissions));
  const legacyWhere: Prisma.CandidateWhereInput = managementLeaf ? buildCandidateAccessWhere(user, 'candidates.manage', baseline)
    : actionCode === 'candidates.respond' ? { OR: [baseline ? {} : { id: { in: [] } }, buildCandidateAccessWhere(user, 'candidates.manage')] }
      : baseline ? {} : { id: { in: [] } };
  return buildAccessWhere<Prisma.CandidateWhereInput>({
    subject: user, actionCode, legacyWhere,
    invariantWhere: actionCode === 'candidates.view' ? {} : buildCandidateAccessWhere(user),
    parentActionCodes: managementLeaf ? ['candidates.manage'] : [],
    scopeWhere: rule => rule.scope === 'all' ? {} : rule.scope === 'selected' ? { id: { in: [...rule.selectedIds] } }
      : rule.scope === 'own' ? { createdByUserId: user.id } : { assignments: { some: { managerUserId: user.id, endedAt: null } } },
  }) as Prisma.CandidateWhereInput;
}

export function candidateManagementAllowed(user: AccessSubject, context: AccessContext): boolean {
  return candidateActionAllowed(user, 'candidates.manage', context);
}

/** Same entitlement composition as the query adapter. State, assignment/SLA,
 * optimistic version and atomic Employee creation remain service invariants. */
export function candidateActionAllowed(user: AccessSubject, actionCode: string, context: AccessContext): boolean {
  const permissions = [...(user.permissionCodes ?? [])];
  const readable = decideAccess(user, 'candidates.view', canViewCandidates(permissions), context);
  if (actionCode === 'candidates.view') return readable;
  const management = decideAccess(user, 'candidates.manage', canManageCandidates(permissions), { ...context, parentAllowed: readable });
  if (actionCode === 'candidates.manage') return management;
  return decideAccess(user, actionCode, actionCode === 'candidates.respond' ? legacyResponseAllowed(user) || management : management, {
    ...context, parentAllowed: readable,
    parents: [...(context.parents ?? []), ...(isManagementLeaf(actionCode) ? [{ actionCode: 'candidates.manage', context }] : [])],
  });
}

export function buildCandidateGlobalCapabilities(permissionCodes: string[]) {
  return {
    canAccessCandidates: canViewCandidates(permissionCodes),
    canManageCandidates: canManageCandidates(permissionCodes),
    canRespondToCandidates: canRespondToCandidates(permissionCodes),
  };
}
