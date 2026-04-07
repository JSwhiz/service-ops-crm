import { Injectable } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';

import { SystemUserOptionDto } from './dto/system-user-option.dto';

@Injectable()
export class UsersAccessService {
  constructor(private readonly prisma: PrismaService) {}

  async listUsers(): Promise<SystemUserOptionDto[]> {
    const users = await this.prisma.user.findMany({
      where: {
        deletedAt: null,
        isActive: true,
      },
      include: {
        roles: {
          include: {
            role: true,
          },
        },
      },
      orderBy: {
        fullName: 'asc',
      },
    });

    return users.map((user) => {
      const roleCodes = user.roles.map((item) => item.role.code);

      return {
        id: user.id,
        login: user.login,
        fullName: user.fullName,
        isActive: user.isActive,
        roleCode: roleCodes[0] ?? 'unknown',
        roleCodes,
      };
    });
  }
}
