import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';
import { canEditOneTimeOrderByScope } from './utils/one-time-order-access.util';

interface CurrentAuthUser {
  id: string;
  login: string;
  fullName: string;
  roleCode: string;
  roleCodes?: string[];
  permissionCodes?: string[];
  isActive: boolean;
}

@Injectable()
export class OneTimeOrderWorkforceDirectoryService {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    currentUser: CurrentAuthUser,
    orderId: string,
    search?: string,
  ): Promise<Array<{ id: string; fullName: string; position: string | null; baseDailyRate: number | null }>> {
    const order = await this.prisma.oneTimeOrder.findFirst({
      where: { id: orderId },
      select: {
        id: true,
        createdByUserId: true,
        assignments: {
          where: { isActive: true },
          select: { userId: true, assignmentRoleCode: true, isActive: true },
        },
      },
    });
    if (!order) throw new NotFoundException('One-time order not found');
    if (!canEditOneTimeOrderByScope({
      currentUserId: currentUser.id,
      roleCodes: currentUser.roleCodes ?? [currentUser.roleCode],
      permissionCodes: currentUser.permissionCodes,
      order,
    })) {
      throw new ForbiddenException('One-time workforce directory access denied');
    }

    const query = search?.trim();
    return this.prisma.employee.findMany({
      where: {
        deletedAt: null,
        employmentStatus: 'active',
        ...(query ? {
          OR: [
            { fullName: { contains: query, mode: 'insensitive' } },
            { position: { contains: query, mode: 'insensitive' } },
          ],
        } : {}),
      },
      select: { id: true, fullName: true, position: true, baseDailyRate: true },
      orderBy: { fullName: 'asc' },
      take: 50,
    });
  }
}
