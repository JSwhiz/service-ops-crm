import type { PrismaService } from '../../prisma/prisma.service';
import { Prisma } from '@prisma/client';
import { AccessSubject, buildAccessWhere } from '../../users-access/utils/access-policy.util';

export interface OneTimeOrderCalendarRosterUser {
  id: string;
  login: string;
  fullName: string;
  isActive: boolean;
  deletedAt: Date | null;
}

export async function listOneTimeOrderCalendarRoster(
  prisma: PrismaService,
  options: { managerUserId?: string; search?: string; subject?: AccessSubject; actionCode?: string } = {},
): Promise<OneTimeOrderCalendarRosterUser[]> {
  const search = options.search?.trim();
  const profiles = await prisma.oneTimeOrderCalendarManager.findMany({
    where: {
      isVisible: true,
      ...(options.managerUserId ? { userId: options.managerUserId } : {}),
      user: {
        ...(options.subject ? buildAccessWhere<Prisma.UserWhereInput>({ subject: options.subject, actionCode: options.actionCode ?? 'one_time_order_calendar.read',
          legacyWhere: {}, invariantWhere: {}, scopeWhere: rule => rule.scope === 'all' ? {} : rule.scope === 'selected' ? { id: { in: [...rule.selectedIds] } } : rule.scope === 'own' ? { id: options.subject!.id } : null,
        }) as Prisma.UserWhereInput : {}),
        isActive: true,
        deletedAt: null,
        ...(search
          ? {
              OR: [
                { fullName: { contains: search, mode: 'insensitive' } },
                { login: { contains: search, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
    },
    select: {
      user: {
        select: {
          id: true,
          login: true,
          fullName: true,
          isActive: true,
          deletedAt: true,
        },
      },
    },
    orderBy: [{ sortOrder: 'asc' }, { userId: 'asc' }],
  });

  return profiles.map((profile) => profile.user);
}

export async function isOneTimeOrderCalendarManager(
  prisma: PrismaService,
  userId: string,
): Promise<boolean> {
  const profile = await prisma.oneTimeOrderCalendarManager.findFirst({
    where: {
      userId,
      isVisible: true,
      user: { isActive: true, deletedAt: null },
    },
    select: { id: true },
  });

  return Boolean(profile);
}
