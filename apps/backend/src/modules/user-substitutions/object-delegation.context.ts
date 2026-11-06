import { AsyncLocalStorage } from 'node:async_hooks';
import type { AccessContext, AccessSubject } from '../users-access/types/access-policy.type';
import { getAccessAction } from '../users-access/access-action-catalog';
import { hasModuleDeny } from '../users-access/utils/access-policy.util';

export type ObjectDelegatedAction =
  | 'view' | 'operate' | 'edit' | 'assign' | 'status'
  | 'inventory_issue' | 'equipment_move';

export interface ObjectDelegationGrant {
  substitutionId: string;
  principalUserId: string;
  objectId: string;
  actions: ObjectDelegatedAction[];
  endsAt: number;
  taskWideAccess: boolean;
  /** Fresh request snapshot. Never a role/identity substituted for the actor. */
  principalSubject?: AccessSubject;
  replacementSubject?: AccessSubject;
  objectPolicyContext?: AccessContext;
}

interface DelegationContext {
  actorUserId: string;
  grants: ObjectDelegationGrant[];
  used: Map<string, ObjectDelegationGrant>;
}

export const objectDelegationContext = new AsyncLocalStorage<DelegationContext>();

/** Query adapters must subtract per-resource leaf denies before pagination. */
export function delegatedObjectScopes(actorUserId: string, action: ObjectDelegatedAction = 'view'): ObjectDelegationGrant[] {
  const context = objectDelegationContext.getStore();
  if (!context || context.actorUserId !== actorUserId) return [];
  return context.grants.filter(grant => grant.endsAt > Date.now() && grant.actions.includes(action) && delegationAllowsPolicyAction(grant));
}

export function delegatedObjectIds(actorUserId: string, action: ObjectDelegatedAction = 'view', policyActionCode?: string, policyContext?: AccessContext): string[] {
  const context = objectDelegationContext.getStore();
  if (!context || context.actorUserId !== actorUserId) return [];
  return [...new Set(context.grants.filter((grant) => grant.endsAt > Date.now() && grant.actions.includes(action) && delegationAllowsPolicyAction(grant, policyActionCode, policyContext)).map((grant) => grant.objectId))];
}

/** Subtract explicit denies only; this function never creates an entitlement. */
export function delegationAllowsPolicyAction(grant: ObjectDelegationGrant, policyActionCode?: string, policyContext?: AccessContext): boolean {
  const subjects = [grant.principalSubject, grant.replacementSubject].filter((subject): subject is AccessSubject => subject !== undefined);
  if (subjects.some(subject => subject.isActive === false)) return false;
  const objectContext = grant.objectPolicyContext;
  if (objectContext && subjects.some(subject => hasModuleDeny(subject, 'objects.read', objectContext))) return false;
  if (!policyActionCode) return true;
  const action = getAccessAction(policyActionCode);
  if (!action) return false;
  const context = policyContext ?? (action.resourceType === 'object' ? objectContext : undefined);
  // A task/unit selected deny cannot be evaluated against an object ID. Callers
  // without a resource context must either supply one or apply query scopes.
  const hasScopedDeny = subjects.some(subject => subject.accessRules?.some(rule => rule.effect === 'deny' &&
    [policyActionCode, action.parentAction].includes(rule.actionCode) && rule.scope !== 'all'));
  if (hasScopedDeny && (!context || context.resourceType !== action.resourceType || !context.resourceId)) return false;
  return !subjects.some(subject => hasModuleDeny(subject, policyActionCode, context ?? {}));
}

export function hasDelegatedObjectAction(actorUserId: string, objectId: string | undefined, action: ObjectDelegatedAction, recordUsage = true, policyActionCode?: string, policyContext?: AccessContext): boolean {
  const context = objectDelegationContext.getStore();
  if (!context || context.actorUserId !== actorUserId || !objectId) return false;
  const grant = context.grants.find((item) => item.endsAt > Date.now() && item.objectId === objectId && item.actions.includes(action) && delegationAllowsPolicyAction(item, policyActionCode, policyContext));
  if (!grant) return false;
  if (recordUsage) context.used.set(`${grant.substitutionId}:${grant.objectId}`, grant);
  return true;
}

export function delegatedTaskScopes(actorUserId: string, policyActionCode?: string) {
  const context = objectDelegationContext.getStore();
  if (!context || context.actorUserId !== actorUserId) return [];
  // Actual task-scoped rules are translated by the task query consumer. Only
  // global leaf denies and object ancestors are decidable at this stage.
  return context.grants.filter(grant => grant.endsAt > Date.now() && delegationAllowsPolicyAction(grant) &&
    (!policyActionCode || ![grant.principalSubject, grant.replacementSubject].some(subject => subject && hasModuleDeny(subject, policyActionCode))));
}

export function hasDelegatedTaskAction(actorUserId: string, task: { id?: string; objectId: string | null; oneTimeOrderId: string | null; createdByUserId: string; assignees?: readonly { userId?: string; user?: { id: string }; isActive?: boolean }[] }, kind: 'creator' | 'lifecycle', recordUsage = true, policyActionCode?: string, policyContext?: AccessContext): boolean {
  if (!task.objectId || task.oneTimeOrderId) return false;
  const grants = delegatedTaskScopes(actorUserId, policyActionCode);
  const taskContext: AccessContext = policyContext ?? { resourceType: 'task', resourceId: task.id, ownerUserId: task.createdByUserId,
    assignedUserIds: task.assignees?.filter(a => a.isActive !== false).flatMap(a => a.userId ? [a.userId] : a.user ? [a.user.id] : []) };
  const grant = grants.find((item) => item.objectId === task.objectId && (item.principalUserId === task.createdByUserId || (kind === 'lifecycle' && item.taskWideAccess)) && delegationAllowsPolicyAction(item, policyActionCode, taskContext));
  if (!grant) return false;
  if (recordUsage) objectDelegationContext.getStore()?.used.set(`${grant.substitutionId}:${grant.objectId}`, grant);
  return true;
}

export function usedObjectDelegations() {
  return [...(objectDelegationContext.getStore()?.used.values() ?? [])].map((grant) => ({
    substitutionId: grant.substitutionId,
    principalUserId: grant.principalUserId,
    objectId: grant.objectId,
  }));
}
