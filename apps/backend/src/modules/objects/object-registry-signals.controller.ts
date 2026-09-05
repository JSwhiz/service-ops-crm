import { Controller, Get, Query, UseGuards } from '@nestjs/common';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

import {
  ObjectRegistrySignalsService,
  type ObjectRegistrySignal,
} from './object-registry-signals.service';

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
@Controller('objects')
export class ObjectRegistrySignalsController {
  constructor(private readonly signalsService: ObjectRegistrySignalsService) {}

  @Get('registry-signals')
  listSignals(
    @CurrentUser() user: CurrentAuthUser,
    @Query('ids') ids = '',
  ): Promise<ObjectRegistrySignal[]> {
    return this.signalsService.list(user, ids.split(',').map((value) => value.trim()));
  }
}
