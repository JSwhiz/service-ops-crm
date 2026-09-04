import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

import { ScopedEquipmentActionDto } from './dto/scoped-equipment-action.dto';
import { EquipmentUnitResponseDto } from './dto/equipment-response.dto';
import { ScopedEquipmentService } from './scoped-equipment.service';

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
@Controller('equipment/scoped')
export class ScopedEquipmentController {
  constructor(private readonly scopedEquipmentService: ScopedEquipmentService) {}

  @Post('units/:unitId/objects/:objectId/assign')
  assignToObject(
    @CurrentUser() user: CurrentAuthUser,
    @Param('unitId') unitId: string,
    @Param('objectId') objectId: string,
    @Body() payload: ScopedEquipmentActionDto,
  ): Promise<EquipmentUnitResponseDto> {
    return this.scopedEquipmentService.assignToObject(
      user,
      unitId,
      objectId,
      payload,
    );
  }

  @Post('units/:unitId/one-time-orders/:orderId/assign')
  assignToOneTimeOrder(
    @CurrentUser() user: CurrentAuthUser,
    @Param('unitId') unitId: string,
    @Param('orderId') orderId: string,
    @Body() payload: ScopedEquipmentActionDto,
  ): Promise<EquipmentUnitResponseDto> {
    return this.scopedEquipmentService.assignToOneTimeOrder(
      user,
      unitId,
      orderId,
      payload,
    );
  }

  @Post('units/:unitId/return')
  returnToStorage(
    @CurrentUser() user: CurrentAuthUser,
    @Param('unitId') unitId: string,
    @Body() payload: ScopedEquipmentActionDto,
  ): Promise<EquipmentUnitResponseDto> {
    return this.scopedEquipmentService.returnToStorage(user, unitId, payload);
  }
}
