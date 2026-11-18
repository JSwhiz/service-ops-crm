import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';
import { decideAccess } from '../users-access/utils/access-policy.util';
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
    if (!canEditOneTimeOrderByScope({ subject: currentUser,
      currentUserId: currentUser.id,
      roleCodes: currentUser.roleCodes ?? [currentUser.roleCode],
      permissionCodes: currentUser.permissionCodes,
      order,
    })) {
      throw new ForbiddenException('One-time workforce directory access denied');
    }

    const query = search?.trim();
    const employees = await this.prisma.employee.findMany({
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
    const financeVisible = decideAccess(currentUser, 'one_time_orders.finance.read', true, { resourceType: 'one_time_order', resourceId: order.id,
      ownerUserId: order.createdByUserId, assignedUserIds: order.assignments.filter(a => a.isActive && a.assignmentRoleCode === 'one_time_manager').map(a => a.userId) });
    return employees.map(employee => ({ ...employee, baseDailyRate: financeVisible ? employee.baseDailyRate : null }));
  }
}
