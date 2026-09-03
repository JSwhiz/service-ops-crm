import { Controller, Get, Query, UseGuards } from '@nestjs/common';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

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

@UseGuards(JwtAuthGuard)
@Controller('dashboard')
export class DashboardController {
  constructor(
    private readonly leadershipDashboardService: LeadershipDashboardService,
  ) {}

  @Get('leadership')
  getLeadership(
    @CurrentUser() user: CurrentAuthUser,
    @Query('expanded') expanded?: string,
  ): Promise<LeadershipDashboardResponse> {
    return this.leadershipDashboardService.getDashboard(
      user,
      expanded === 'true',
    );
  }
}
