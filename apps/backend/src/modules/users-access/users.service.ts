import { Injectable } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';

interface UserWithRoles {
  id: string;
  login: string;
  password: string | null;
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
  password: true,
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

  async setPasswordHash(userId: string, passwordHash: string): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        passwordHash,
        password: null,
      } as never,
    });
  }
}
