import { AsyncLocalStorage } from 'node:async_hooks';

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
}

interface DelegationContext {
  actorUserId: string;
  grants: ObjectDelegationGrant[];
  used: Map<string, ObjectDelegationGrant>;
}

export const objectDelegationContext = new AsyncLocalStorage<DelegationContext>();

export function delegatedObjectIds(actorUserId: string, action: ObjectDelegatedAction = 'view'): string[] {
  const context = objectDelegationContext.getStore();
  if (!context || context.actorUserId !== actorUserId) return [];
  return [...new Set(context.grants.filter((grant) => grant.endsAt > Date.now() && grant.actions.includes(action)).map((grant) => grant.objectId))];
}

export function hasDelegatedObjectAction(actorUserId: string, objectId: string | undefined, action: ObjectDelegatedAction, recordUsage = true): boolean {
  const context = objectDelegationContext.getStore();
  if (!context || context.actorUserId !== actorUserId || !objectId) return false;
  const grant = context.grants.find((item) => item.endsAt > Date.now() && item.objectId === objectId && item.actions.includes(action));
  if (!grant) return false;
  if (recordUsage) context.used.set(`${grant.substitutionId}:${grant.objectId}`, grant);
  return true;
}

export function delegatedTaskScopes(actorUserId: string) {
  const context = objectDelegationContext.getStore();
  if (!context || context.actorUserId !== actorUserId) return [];
  return context.grants.filter((grant) => grant.endsAt > Date.now());
}

export function hasDelegatedTaskAction(actorUserId: string, task: { objectId: string | null; oneTimeOrderId: string | null; createdByUserId: string }, kind: 'creator' | 'lifecycle', recordUsage = true): boolean {
  if (!task.objectId || task.oneTimeOrderId) return false;
  const grants = delegatedTaskScopes(actorUserId);
  const grant = grants.find((item) => item.objectId === task.objectId && (item.principalUserId === task.createdByUserId || (kind === 'lifecycle' && item.taskWideAccess)));
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
