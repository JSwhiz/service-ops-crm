import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

import { OneTimeOrderWorkforceDirectoryService } from './one-time-order-workforce-directory.service';

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
@Controller('one-time-orders/:orderId/workforce')
export class OneTimeOrderWorkforceDirectoryController {
  constructor(
    private readonly directoryService: OneTimeOrderWorkforceDirectoryService,
  ) {}

  @Get('employee-directory')
  list(
    @CurrentUser() user: CurrentAuthUser,
    @Param('orderId') orderId: string,
    @Query('search') search?: string,
  ) {
    return this.directoryService.list(user, orderId, search);
  }
}
