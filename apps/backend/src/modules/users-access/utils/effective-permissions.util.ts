interface EffectivePermissionSource {
  permissions: Array<{
    permission: {
      code: string;
    };
  }>;
  roles: Array<{
    role: {
      permissions: Array<{
        permission: {
          code: string;
        };
      }>;
    };
  }>;
}

export function resolveEffectivePermissionCodes(
  source: EffectivePermissionSource,
): string[] {
  const permissionCodes = new Set(
    source.permissions.map((item) => item.permission.code),
  );

  for (const userRole of source.roles) {
    for (const rolePermission of userRole.role.permissions) {
      permissionCodes.add(rolePermission.permission.code);
    }
  }

  return [...permissionCodes].sort();
}
