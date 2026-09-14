export const COUNTERPARTY_PERMISSION_CODES = {
  view: 'counterparties.view',
  manage: 'counterparties.manage',
  linkObjects: 'counterparties.link_objects',
} as const;

function hasPermission(
  permissionCodes: readonly string[],
  permissionCode: string,
): boolean {
  return permissionCodes.includes(permissionCode);
}

export function canViewCounterparties(
  permissionCodes: readonly string[],
): boolean {
  return hasPermission(permissionCodes, COUNTERPARTY_PERMISSION_CODES.view);
}

export function canManageCounterparties(
  permissionCodes: readonly string[],
): boolean {
  return hasPermission(permissionCodes, COUNTERPARTY_PERMISSION_CODES.manage);
}

export function canLinkCounterpartyObjects(
  permissionCodes: readonly string[],
): boolean {
  return hasPermission(
    permissionCodes,
    COUNTERPARTY_PERMISSION_CODES.linkObjects,
  );
}

export function buildCounterpartyGlobalCapabilities(
  permissionCodes: readonly string[],
) {
  return {
    canAccessCounterparties: canViewCounterparties(permissionCodes),
    canManageCounterparties: canManageCounterparties(permissionCodes),
    canLinkCounterpartyObjects: canLinkCounterpartyObjects(permissionCodes),
  };
}
