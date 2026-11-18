import type { AccessAction, AccessChange, AccessRule, AccessScope } from '../../../entities/user-access/model/user-access.types';

export function managementScopes(action: AccessAction): AccessScope[] {
  return action.managementScopes ?? action.allowedScopes;
}

export function initialAccessDraft(action: AccessAction, original?: AccessRule): AccessChange | null {
  const scope = original?.scope ?? managementScopes(action)[0];
  if (!scope) return null;
  return { actionCode: action.code, effect: original?.effect ?? 'default', scope, selectedIds: original?.selectedIds ?? [] };
}

export function isValidManagementChange(action: AccessAction, change: AccessChange): boolean {
  const scopes = change.effect === 'default' ? action.allowedScopes : managementScopes(action);
  return (change.effect === 'default' || action.manageable) && scopes.includes(change.scope)
    && (change.scope === 'selected' ? change.selectedIds.length > 0 : change.selectedIds.length === 0);
}

export function changeAccessMode(action: AccessAction, draft: AccessChange, effect: AccessChange['effect'], original?: AccessRule): AccessChange {
  if (effect !== 'default') return { ...draft, effect };
  if (original && !managementScopes(action).includes(original.scope)) {
    return { ...draft, effect, scope: original.scope, selectedIds: original.selectedIds };
  }
  return { ...draft, effect, ...(action.allowedScopes.includes('all') ? { scope: 'all' as const, selectedIds: [] } : {}) };
}

/** Only explicit edits enter the payload; rendering an old rule never rewrites it. */
export function updateAccessChanges(current: Record<string, AccessChange>, next: AccessChange, original?: AccessRule): Record<string, AccessChange> {
  const updated = { ...current };
  const same = original
    ? next.effect === original.effect && next.scope === original.scope && [...next.selectedIds].sort().join(',') === [...original.selectedIds].sort().join(',')
    : next.effect === 'default';
  if (same) delete updated[next.actionCode]; else updated[next.actionCode] = next;
  return updated;
}
