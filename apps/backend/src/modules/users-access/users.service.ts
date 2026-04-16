import { Injectable } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';

interface UserWithRoles {
  id: string;
  login: string;
  passwordHash: string | null;
  fullName: string;
  isActive: boolean;
  roles: Array<{
    role: {
      code: string;
      name: string;
    };
  }>;
}

const authUserSelect = {
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
        },
      },
    },
  },
} as const;

export interface SanitizedAuthUser {
  id: string;
  login: string;
  fullName: string;
  isActive: boolean;
  roleCodes: string[];
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
      id: user.id,
      login: user.login,
      fullName: user.fullName,
      isActive: user.isActive,
      roleCodes: user.roles.map((item) => item.role.code),
    };
  }
}
