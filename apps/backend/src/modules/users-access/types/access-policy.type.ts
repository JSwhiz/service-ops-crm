export type AccessScope = "own" | "assigned" | "selected" | "all";
export type AccessEffect = "allow" | "deny";
export interface AccessRule {
  actionCode: string;
  effect: AccessEffect;
  scope: AccessScope;
  selectedIds: readonly string[];
}
export interface AccessSubject {
  id: string;
  isActive?: boolean;
  roleCode?: string;
  roleCodes?: readonly string[];
  permissionCodes?: readonly string[];
  accessVersion?: number;
  accessRules?: readonly AccessRule[];
}
export interface AccessContext {
  resourceType?: string;
  resourceId?: string;
  ownerUserId?: string;
  assignedUserIds?: readonly string[];
  invariantAllowed?: boolean;
  parentAllowed?: boolean;
  /** Explicit domain ancestors, e.g. objects.access for an object attachment. */
  parents?: readonly { actionCode: string; context?: AccessContext }[];
}
export interface AccessActionDefinition {
  code: string;
  name: string;
  description: string;
  module: string;
  resourceType: string;
  allowedScopes: readonly AccessScope[];
  parentAction?: string;
  manageable: boolean;
  constraint?: string;
  legacyPermissionCodes: readonly string[];
  dependencies?: readonly string[];
  invariants?: readonly string[];
  delegation?: "object_only" | "none";
  /** Catalog registration alone is not evidence that every delivery channel is wired. */
  integrationStatus: "policy_contract";
}
export interface AccessChange {
  actionCode: string;
  effect: AccessEffect | "default";
  scope: AccessScope;
  selectedIds?: string[];
}
