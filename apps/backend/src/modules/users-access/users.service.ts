import { Injectable } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';

import { SystemUser } from './types/system-user.type';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async findByLogin(login: string): Promise<SystemUser | null> {
    const user = await this.prisma.user.findFirst({
      where: {
        login,
        deletedAt: null,
      },
      include: {
        roles: {
          include: {
            role: true,
          },
        },
      },
    });

    if (!user) {
      return null;
    }

    return {
      id: user.id,
      login: user.login,
      password: user.password,
      fullName: user.fullName,
      isActive: user.isActive,
      roleCodes: user.roles.map((item) => item.role.code),
    };
  }

  async findById(id: string): Promise<SystemUser | null> {
    const user = await this.prisma.user.findFirst({
      where: {
        id,
        deletedAt: null,
      },
      include: {
        roles: {
          include: {
            role: true,
          },
        },
      },
    });

    if (!user) {
      return null;
    }

    return {
      id: user.id,
      login: user.login,
      password: user.password,
      fullName: user.fullName,
      isActive: user.isActive,
      roleCodes: user.roles.map((item) => item.role.code),
    };
  }

  sanitizeUser(user: SystemUser): Omit<SystemUser, 'password'> {
    const { password: _password, ...safeUser } = user;
    return safeUser;
  }
}
