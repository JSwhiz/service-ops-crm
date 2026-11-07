import { getAccessAction } from "../access-action-catalog";
import type { AccessScope, AccessSubject } from "../types/access-policy.type";
import { decideAccess, hasModuleDeny } from "./access-policy.util";

export interface AccessSummaryBaseline {
  allowed: boolean;
  scopes: readonly AccessScope[];
  selectedIds?: readonly string[];
}

interface ScopeResult {
  scope: AccessScope;
  allowed: boolean | null;
  selectedIds: string[];
}

// These are deny-only ancestors in the actual timesheet SQL adapter. Registering
// them here neither aliases positive grants nor replaces that adapter's read scope.
function summaryDenyParents(actionCode: string): readonly string[] {
  if (!actionCode.startsWith("timesheet.") || actionCode === "timesheet.access")
    return [];
  return [
    "objects.access",
    "objects.read",
    ...(actionCode === "timesheet.read" ? [] : ["timesheet.read"]),
    ...(actionCode === "timesheet.amount.edit"
      ? ["timesheet.manual_correction"]
      : []),
  ];
}

/** Summary of authorization scopes, not an invented concrete resource decision.
 * Unknown owner/assignment intersections remain conditional. Real resource
 * endpoints must still use decideAccess / the domain's SQL adapter. */
export function summarizeAccess(
  subject: AccessSubject,
  actionCode: string,
  baseline?: AccessSummaryBaseline | null,
) {
  const action = getAccessAction(actionCode);
  const denied = () => ({
    allowed: false as boolean | null,
    scope: null as AccessScope | null,
    selectedIds: [] as string[],
    blocked: true,
    personalAllowFullyDenied: false,
  });
  if (!action) return denied();
  if (action.constraint === "logout_always_available")
    return {
      ...denied(),
      allowed: true,
      scope: "all" as AccessScope,
      blocked: false,
    };
  // This invokes the actual role/negative-permission constraints without letting
  // a scoped allow overwrite their result in an administration projection.
  const parents = summaryDenyParents(actionCode);
  if (
    !decideAccess({ ...subject, accessRules: [] }, actionCode, true) ||
    hasModuleDeny(subject, actionCode) ||
    parents.some((code) => hasModuleDeny(subject, code))
  )
    return denied();
  const codes = [
    actionCode,
    ...(action.parentAction ? [action.parentAction] : []),
    ...parents,
  ];
  const denies = (subject.accessRules ?? []).filter(
    (rule) => rule.effect === "deny" && codes.includes(rule.actionCode),
  );
  if (
    denies.some(
      (rule) =>
        !getAccessAction(rule.actionCode)?.allowedScopes.includes(rule.scope) ||
        (rule.scope === "selected" && !rule.selectedIds.length),
    )
  )
    return denied();
  const assess = (
    scope: AccessScope,
    ids: readonly string[] = [],
  ): ScopeResult => {
    const related = denies.filter(
      (rule) =>
        getAccessAction(rule.actionCode)?.resourceType === action.resourceType,
    );
    if (
      related.some(
        (rule) =>
          rule.scope === "all" ||
          (scope !== "selected" && rule.scope === scope),
      )
    )
      return { scope, allowed: false, selectedIds: [] };
    const contextual = denies.some(
      (rule) =>
        getAccessAction(rule.actionCode)?.resourceType !==
          action.resourceType ||
        (scope === "selected" ? rule.scope !== "selected" : true),
    );
    if (scope === "selected") {
      const selectedIds = [...new Set(ids)].filter((resourceId) =>
        decideAccess(subject, actionCode, true, {
          resourceType: action.resourceType,
          resourceId,
          parents: parents.map((code) => ({ actionCode: code })),
        }),
      );
      return {
        scope,
        selectedIds,
        allowed: selectedIds.length === 0 ? false : contextual ? null : true,
      };
    }
    return { scope, selectedIds: [], allowed: denies.length > 0 ? null : true };
  };
  const inherited = baseline?.allowed
    ? baseline.scopes.map((scope) => assess(scope, baseline.selectedIds))
    : [];
  const allowRules = action.manageable
    ? (subject.accessRules ?? []).filter(
        (rule) =>
          rule.actionCode === actionCode &&
          rule.effect === "allow" &&
          action.allowedScopes.includes(rule.scope),
      )
    : [];
  const personal = allowRules.map((rule) =>
    assess(rule.scope, rule.selectedIds),
  );
  const results = [...inherited, ...personal];
  const allowed: boolean | null = results.some(
    (result) => result.allowed === true,
  )
    ? true
    : results.some((result) => result.allowed === null) || !baseline
      ? null
      : false;
  // Do not label a conditional all-scope as universally allowed just because a
  // separate selected scope has one known surviving resource.
  const active = results.filter((result) =>
    allowed === true ? result.allowed === true : result.allowed !== false,
  );
  return {
    allowed,
    scope: active.some((result) => result.scope === "all")
      ? ("all" as AccessScope)
      : (active[0]?.scope ?? null),
    selectedIds: [
      ...new Set(active.flatMap((result) => result.selectedIds)),
    ].sort(),
    blocked: false,
    personalAllowFullyDenied:
      personal.length > 0 &&
      personal.every((result) => result.allowed === false),
  };
}

/** Navigation is existential, never a grant to all resources. Scoped rules may
 * open a registry whose query still enforces their exact resource scope. */
export function canEnterAccessModule(
  subject: AccessSubject,
  moduleAction: string,
  readActions: readonly string[],
  legacyAllowed: boolean,
  legacyScopes: readonly AccessScope[] = ["all"],
): boolean {
  if (
    !decideAccess({ ...subject, accessRules: [] }, moduleAction, true) ||
    hasModuleDeny(subject, moduleAction)
  )
    return false;
  const baseline = { allowed: legacyAllowed, scopes: legacyScopes };
  return (readActions.length ? readActions : [moduleAction]).some(
    (code) => summarizeAccess(subject, code, baseline).allowed !== false,
  );
}
