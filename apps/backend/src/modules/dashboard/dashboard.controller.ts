import { Controller, Get, Query, UseGuards } from '@nestjs/common';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { UserAbsencesService } from '../user-absences/user-absences.service';

import {
  LeadershipDashboardResponse,
  LeadershipDashboardService,
} from './leadership-dashboard.service';

interface CurrentAuthUser {
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
    private readonly userAbsencesService: UserAbsencesService,
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
    const userAbsencesToday = await this.userAbsencesService.countTodayForLeadership(
      moscowDate(),
    );
    return {
      ...result,
      people: {
        ...result.people,
        userAbsencesAvailable: true,
        userAbsencesToday,
      },
    };
  }
}
