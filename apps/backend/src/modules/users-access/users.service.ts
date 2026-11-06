import { Injectable } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';

import { resolveEffectivePermissionCodes } from './utils/effective-permissions.util';
import { AccessRule } from './types/access-policy.type';

interface UserWithRoles {
  accessVersion?: number;
  accessRules?: Array<{ actionCode: string; effect: string; scope: string; selectedIds: string[] }>;
  id: string;
  login: string;
  passwordHash: string | null;
  fullName: string;
  isActive: boolean;
  roles: Array<{
    role: {
      code: string;
      name: string;
      permissions: Array<{
        permission: {
          code: string;
        };
      }>;
    };
  }>;
  permissions: Array<{
    permission: {
      code: string;
      name: string;
    };
  }>;
}

const authUserSelect = {
  accessVersion: true,
  accessRules: { select: { actionCode: true, effect: true, scope: true, selectedIds: true } },
  id: true,
  login: true,
  passwordHash: true,
  fullName: true,
  isActive: true,
  roles: {
    select: {
      role: {
        select: {
          code: true,
          name: true,
          permissions: {
            select: {
              permission: {
                select: {
                  code: true,
                },
              },
            },
          },
        },
      },
    },
  },
  permissions: {
    select: {
      permission: {
        select: {
          code: true,
          name: true,
        },
      },
    },
  },
} as const;

export interface SanitizedAuthUser {
  accessVersion: number;
  accessRules: AccessRule[];
  id: string;
  login: string;
  fullName: string;
  isActive: boolean;
  roleCodes: string[];
  permissionCodes: string[];
}

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async findByLogin(login: string): Promise<UserWithRoles | null> {
    return this.prisma.user.findFirst({
      where: {
        login,
        deletedAt: null,
      },
      select: authUserSelect,
    });
  }

  async findById(id: string): Promise<UserWithRoles | null> {
    return this.prisma.user.findFirst({
      where: {
        id,
        deletedAt: null,
      },
      select: authUserSelect,
    });
  }

  async listUsers(): Promise<
    Array<{
      id: string;
      login: string;
      fullName: string;
      isActive: boolean;
    }>
  > {
    return this.prisma.user.findMany({
      where: {
        deletedAt: null,
      },
      select: {
        id: true,
        login: true,
        fullName: true,
        isActive: true,
      },
      orderBy: {
        fullName: 'asc',
      },
    });
  }

  sanitizeUser(user: UserWithRoles): SanitizedAuthUser {
    return {
      accessVersion: user.accessVersion ?? 0,
      accessRules: (user.accessRules ?? []).map(rule => ({ ...rule, effect: rule.effect as AccessRule['effect'], scope: rule.scope as AccessRule['scope'] })),
      id: user.id,
      login: user.login,
      fullName: user.fullName,
      isActive: user.isActive,
      roleCodes: user.roles.map((item) => item.role.code),
      permissionCodes: resolveEffectivePermissionCodes(user),
    };
  }
}
