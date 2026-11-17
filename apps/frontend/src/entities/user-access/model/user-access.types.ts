import type { SavedWithoutAccess } from '@/shared/api/saved-without-access';

export type AccessScope = 'own' | 'assigned' | 'selected' | 'all';
export interface AccessRule {
  actionCode: string;
  effect: 'allow' | 'deny';
  scope: AccessScope;
  selectedIds: string[];
}
export interface AccessChange extends Omit<AccessRule, 'effect'> {
  effect: 'allow' | 'deny' | 'default';
  operation?: 'remove_legacy_user_permission';
}
export interface AccessAction {
  code: string;
  name: string;
  description: string;
  module: string;
  resourceType: string;
  allowedScopes: AccessScope[];
  /** Optional for compatibility with catalogs predating management restrictions. */
  managementScopes?: AccessScope[];
  parentAction?: string;
  manageable: boolean;
  constraint?: string;
  legacyPermissionCodes: string[];
  dependencies?: string[];
  invariants?: string[];
  delegation?: 'object_only' | 'none';
  integrationStatus: 'policy_contract';
}
export interface AccessCatalog { actions: AccessAction[]; scopes: AccessScope[] }
export interface AccessUser {
  id: string;
  login: string;
  fullName: string;
  isActive: boolean;
  roleCodes: string[];
  accessVersion: number;
}
export interface LegacyAccessBaseline {
  allowed: boolean;
  scope: AccessScope;
  scopes: AccessScope[];
  source: 'legacy_capability' | 'legacy_role' | 'legacy_assignment' | 'legacy_ownership' | 'legacy_active_user';
  evaluator: string;
  conditions: string[];
}
export interface EffectiveAccess {
  actionCode: string;
  allowed: boolean | null;
  source: string;
  baseline: LegacyAccessBaseline | null;
  rule: AccessRule | null;
  scope: AccessScope | null;
  selectedIds: string[];
  warnings: string[];
}
export interface AccessAssignments {
  objects: Array<{ id: string; objectId: string; assignmentRoleCode: string; isActive: boolean; createdAt: string; object: { name: string; deletedAt: string | null } }>;
  oneTimeOrders: Array<{ id: string; oneTimeOrderId: string; assignmentRoleCode: string; isActive: boolean; createdAt: string; oneTimeOrder: { title: string; status: string } }>;
  substitutions: Array<{ id: string; principalUserId: string; replacementUserId: string; startsAt: string; endsAt: string; reason: string; revokedAt: string | null; objects: Array<{ objectId: string }> }>;
}
export interface AccessDetail {
  canRemoveLegacyCandidateDeny?: boolean;
  user: AccessUser;
  accessVersion: number;
  rules: AccessRule[];
  effective: EffectiveAccess[];
  sources: {
    roles: Array<{ code: string; name: string; permissionCodes: string[] }>;
    userPermissions: Array<{ code: string; name: string; effect: 'allow' | 'deny'; source: string }>;
    rules: AccessRule[];
  };
  assignments: AccessAssignments;
}
export interface AccessPayload { expectedVersion: number; reason: string; changes: AccessChange[] }
export interface LegacyCandidateDenyRemovalPayload { expectedVersion: number; reason: string }
export interface LegacyCandidateDenyRemovalPreview {
  operation: 'remove_legacy_candidate_deny';
  previewToken: string; previewHash: string; expiresAt: string; expectedVersion: number;
  reason: string; effective: EffectiveAccess[]; warnings: string[];
}
export interface AccessPreview {
  previewToken: string;
  previewHash: string;
  expiresAt: string;
  expectedVersion: number;
  changes: AccessChange[];
  warnings: string[];
  effective: EffectiveAccess[];
}
export interface AccessSaveResult { accessVersion: number; rules: AccessRule[]; effective: EffectiveAccess[] }
export type AccessSaveOutcome = AccessSaveResult | SavedWithoutAccess;
export interface AccessSaveNoticeContext { actorId: string; sessionGeneration: number }
export interface AccessHistoryEntry {
  id: string;
  versionBefore: number;
  versionAfter: number;
  reason: string;
  before: AccessRule[];
  after: AccessRule[];
  changes: AccessChange[];
  createdAt: string;
  actor: { id: string; fullName: string; login: string };
}
export interface AccessPage<T> { items: T[]; total: number }
export interface AccessResource { id: string; label: string; description?: string }
export interface AccessResourcePage { items: AccessResource[]; hasMore: boolean }
