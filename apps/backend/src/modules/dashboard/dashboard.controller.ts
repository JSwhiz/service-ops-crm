import { Controller, Get, Query, UseGuards } from '@nestjs/common';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { UserAbsencesService } from '../user-absences/user-absences.service';
import { PrismaService } from '../prisma/prisma.service';
import { dashboardAbsenceCount } from './dashboard-access.util';
import type { AccessSubject } from '../users-access/types/access-policy.type';
import { decideAccess } from '../users-access/utils/access-policy.util';

import { HrDashboardResponse, HrDashboardService } from './hr-dashboard.service';
import {
  LeadershipDashboardResponse,
  LeadershipDashboardService,
} from './leadership-dashboard.service';
import {
  ManagerDashboardResponse,
  ManagerDashboardService,
} from './manager-dashboard.service';
import {
  OperationManagerDashboardResponse,
  OperationManagerDashboardService,
} from './operation-manager-dashboard.service';

interface CurrentAuthUser extends AccessSubject {
  id: string;
  login: string;
  fullName: string;
  roleCode: string;
  roleCodes?: string[];
  permissionCodes?: string[];
  isActive: boolean;
}

function moscowDate(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Moscow',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const get = (type: string): string =>
    parts.find((item) => item.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

@UseGuards(JwtAuthGuard)
@Controller('dashboard')
export class DashboardController {
  constructor(
    private readonly leadershipDashboardService: LeadershipDashboardService,
    private readonly managerDashboardService: ManagerDashboardService,
    private readonly hrDashboardService: HrDashboardService,
    private readonly operationManagerDashboardService: OperationManagerDashboardService,
    private readonly userAbsencesService: UserAbsencesService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('leadership')
  async getLeadership(
    @CurrentUser() user: CurrentAuthUser,
    @Query('expanded') expanded?: string,
  ): Promise<LeadershipDashboardResponse> {
    const result = await this.leadershipDashboardService.getDashboard(
      user,
      expanded === 'true',
    );
    const userAbsencesToday = await dashboardAbsenceCount(this.userAbsencesService,this.prisma,user,moscowDate());
    return {
      ...result,
      people: {
        ...result.people,
        userAbsencesAvailable: decideAccess(user,'user_absences.read',true),
        userAbsencesToday,
      },
    };
  }

  @Get('manager')
  getManager(
    @CurrentUser() user: CurrentAuthUser,
  ): Promise<ManagerDashboardResponse> {
    return this.managerDashboardService.getDashboard(user);
  }

  @Get('hr')
  getHr(@CurrentUser() user: CurrentAuthUser): Promise<HrDashboardResponse> {
    return this.hrDashboardService.getDashboard(user);
  }

  // Transitional alias kept while old clients move to the assignment-driven manager dashboard.
  @Get('operation-manager')
  getOperationManager(
    @CurrentUser() user: CurrentAuthUser,
  ): Promise<OperationManagerDashboardResponse> {
    return this.operationManagerDashboardService.getDashboard(user);
  }
}
