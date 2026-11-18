import { getAccessAction } from "../access-action-catalog";
import {
  AccessContext,
  AccessRule,
  AccessSubject,
} from "../types/access-policy.type";

export type {
  AccessContext,
  AccessRule,
  AccessScope,
  AccessSubject,
} from "../types/access-policy.type";

export function matchesAccessScope(
  subject: AccessSubject,
  rule: AccessRule,
  context: AccessContext,
): boolean {
  const action = getAccessAction(rule.actionCode);
  if (!action || !action.allowedScopes.includes(rule.scope)) return false;
  if (rule.scope === "all") return true;
  if (context.resourceType !== action.resourceType) return false;
  if (rule.scope === "own") return context.ownerUserId === subject.id;
  if (rule.scope === "assigned")
    return context.assignedUserIds?.includes(subject.id) === true;
  return Array.isArray(rule.selectedIds) && !!context.resourceId && rule.selectedIds.includes(context.resourceId);
}

export function hasModuleDeny(
  subject: AccessSubject,
  actionCode: string,
  context: AccessContext = {},
): boolean {
  const action = getAccessAction(actionCode);
  if (!action) return true;
  if (
    action.module === "candidates" &&
    subject.permissionCodes?.includes("candidates.denied")
  )
    return true;
  const codes = [
    actionCode,
    ...(action.parentAction ? [action.parentAction] : []),
  ];
  if (
    subject.accessRules?.some(
      (rule) =>
        codes.includes(rule.actionCode) &&
        rule.effect === "deny" &&
        ((rule.scope === "selected" && (!Array.isArray(rule.selectedIds) || rule.selectedIds.length === 0)) || getAccessAction(rule.actionCode)?.allowedScopes.includes(
          rule.scope,
        ) !== true ||
          matchesAccessScope(subject, rule, context)),
    )
  )
    return true;
  return (
    context.parents?.some((parent) =>
      hasModuleDeny(
        subject,
        parent.actionCode,
        parent.context ?? { ...context, parents: undefined },
      ),
    ) === true
  );
}

/** Authorization only. Callers retain lifecycle, independent approval, money and parent visibility checks. */
export function decideAccess(
  subject: AccessSubject,
  actionCode: string,
  legacyAllowed: boolean,
  context: AccessContext = {},
): boolean {
  const action = getAccessAction(actionCode);
  if (action?.constraint === "logout_always_available") return legacyAllowed;
  if (
    !action ||
    subject.isActive === false ||
    context.invariantAllowed === false ||
    context.parentAllowed === false
  )
    return false;
  if (hasModuleDeny(subject, actionCode, context)) return false;
  const roles =
    subject.roleCodes ?? (subject.roleCode ? [subject.roleCode] : []);
  if (action.constraint === "founder_only" && !roles.includes("founder"))
    return false;
  if (
    action.constraint === "leadership_only" &&
    !roles.some((role) =>
      ["founder", "deputy_founder", "director", "corporate_director"].includes(
        role,
      ),
    )
  )
    return false;
  if (action.constraint === "director_only" && !roles.includes("director"))
    return false;
  if (!action.manageable) return legacyAllowed;
  // A scoped grant adds only its matching resources; it never widens a role or another action.
  return (
    legacyAllowed ||
    subject.accessRules?.some(
      (rule) =>
        rule.actionCode === actionCode &&
        rule.effect === "allow" &&
        matchesAccessScope(subject, rule, context),
    ) === true
  );
}

export interface AccessWhereOptions<Where> {
  subject: AccessSubject;
  actionCode: string;
  legacyWhere: Where;
  /** Mandatory domain invariant / parent visibility filter, intersected after grants. */
  invariantWhere: Where;
  /** Translate a rule to a domain filter. Return null when scope cannot be represented. */
  scopeWhere: (rule: AccessRule, actionCode: string) => Where | null;
  /** Domain ancestors use the same scope translator; include object access for object files, etc. */
  parentActionCodes?: readonly string[];
}

type WhereNode = boolean | Record<string, unknown>;
function andWhere(nodes: WhereNode[]): WhereNode {
  if (nodes.includes(false)) return false;
  const clauses = nodes.filter(
    (node): node is Record<string, unknown> => node !== true && node !== false,
  );
  return clauses.length === 0
    ? true
    : clauses.length === 1
      ? clauses[0]
      : { AND: clauses };
}
function orWhere(nodes: WhereNode[]): WhereNode {
  if (nodes.includes(true)) return true;
  const clauses = nodes.filter(
    (node): node is Record<string, unknown> => node !== true && node !== false,
  );
  return clauses.length === 0
    ? false
    : clauses.length === 1
      ? clauses[0]
      : { OR: clauses };
}
function notWhere(node: WhereNode): WhereNode {
  return node === true ? false : node === false ? true : { NOT: node };
}
/** Prisma removes empty object/boolean nodes in nested filters. Reduce them
 * before composition so a false legacy predicate cannot disappear in an OR. */
function normalizeAccessWhere(value: unknown): WhereNode {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const fields = Object.fromEntries(
    Object.entries(record).filter(
      ([key, item]) =>
        !["AND", "OR", "NOT"].includes(key) && item !== undefined,
    ),
  );
  for (const item of Object.values(fields)) {
    if (
      item &&
      typeof item === "object" &&
      !Array.isArray(item) &&
      Array.isArray((item as { in?: unknown }).in) &&
      (item as { in: unknown[] }).in.length === 0
    )
      return false;
  }
  const nodes: WhereNode[] = Object.keys(fields).length ? [fields] : [];
  for (const operator of ["AND", "OR", "NOT"] as const) {
    const input = record[operator];
    if (input === undefined) continue;
    const children = (Array.isArray(input) ? input : [input]).map(
      normalizeAccessWhere,
    );
    nodes.push(
      operator === "OR"
        ? orWhere(children)
        : operator === "NOT"
          ? andWhere(children.map(notWhere))
          : andWhere(children),
    );
  }
  return andWhere(nodes);
}

/** Apply the resulting WHERE to findMany, count and aggregate alike, before pagination. */
export function buildAccessWhere<Where>(options: AccessWhereOptions<Where>): {
  AND: unknown[];
} {
  const { subject, actionCode, legacyWhere, invariantWhere, scopeWhere } =
    options;
  const action = getAccessAction(actionCode);
  // Every persisted CRM resource has id. The empty IN is SQL-stable even when
  // Prisma drops empty boolean arrays during nested filter optimization.
  const none = { id: { in: [] }, OR: [] };
  if (
    !action ||
    subject.isActive === false ||
    (action.module === "candidates" &&
      subject.permissionCodes?.includes("candidates.denied"))
  )
    return { AND: [none] };
  const roles =
    subject.roleCodes ?? (subject.roleCode ? [subject.roleCode] : []);
  if (
    (action.constraint === "founder_only" && !roles.includes("founder")) ||
    (action.constraint === "director_only" && !roles.includes("director")) ||
    (action.constraint === "leadership_only" &&
      !roles.some((role) =>
        [
          "founder",
          "deputy_founder",
          "director",
          "corporate_director",
        ].includes(role),
      ))
  )
    return { AND: [none] };
  const relevant = new Set([
    actionCode,
    ...(action.parentAction ? [action.parentAction] : []),
    ...(options.parentActionCodes ?? []),
  ]);
  if (
    subject.permissionCodes?.includes("candidates.denied") &&
    [...relevant].some((code) => getAccessAction(code)?.module === "candidates")
  )
    return { AND: [none] };
  const allow: unknown[] = [legacyWhere];
  const deny: unknown[] = [];
  for (const rule of subject.accessRules ?? []) {
    if (!relevant.has(rule.actionCode)) continue;
    const definition = getAccessAction(rule.actionCode);
    if (
      definition?.allowedScopes.includes(rule.scope) !== true ||
      (rule.scope === "selected" &&
        (!Array.isArray(rule.selectedIds) || rule.selectedIds.length === 0))
    ) {
      if (rule.effect === "deny") deny.push({});
      continue;
    }
    if (
      rule.effect === "allow" &&
      rule.actionCode === actionCode &&
      action.manageable
    ) {
      const filter = scopeWhere(rule, rule.actionCode);
      if (filter !== null) allow.push(filter);
    }
    if (rule.effect === "deny") {
      // Missing scope adapter must fail closed, never skip a deny.
      deny.push(scopeWhere(rule, rule.actionCode) ?? {});
    }
  }
  const result = andWhere([
    normalizeAccessWhere(invariantWhere),
    orWhere(allow.map(normalizeAccessWhere)),
    ...deny.map((filter) => notWhere(normalizeAccessWhere(filter))),
  ]);
  return { AND: result === false ? [none] : result === true ? [] : [result] };
}
