import { Injectable } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';

interface UserWithRoles {
  id: string;
  login: string;
  password: string;
  fullName: string;
  isActive: boolean;
  roles: Array<{
    role: {
      code: string;
      name: string;
    };
  }>;
}

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
    return this.prisma.user.findUnique({
      where: { login },
      include: {
        roles: {
          include: {
            role: true,
          },
        },
      },
    });
  }

  async findById(id: string): Promise<UserWithRoles | null> {
    return this.prisma.user.findUnique({
      where: { id },
      include: {
        roles: {
          include: {
            role: true,
          },
        },
      },
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
