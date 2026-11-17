import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

import { ScopedEquipmentActionDto, ScopedEquipmentMovementReceiptDto } from './dto/scoped-equipment-action.dto';
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

  @Get('one-time-orders/:orderId/options')
  orderOptions(@CurrentUser() user: CurrentAuthUser, @Param('orderId') orderId: string) {
    return this.scopedEquipmentService.listOrderOptions(user, orderId);
  }

  @Post('units/:unitId/objects/:objectId/assign')
  assignToObject(
    @CurrentUser() user: CurrentAuthUser,
    @Param('unitId') unitId: string,
    @Param('objectId') objectId: string,
    @Body() payload: ScopedEquipmentActionDto,
  ): Promise<ScopedEquipmentMovementReceiptDto> {
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
  ): Promise<ScopedEquipmentMovementReceiptDto> {
    return this.scopedEquipmentService.assignToOneTimeOrder(
      user,
      unitId,
      orderId,
      payload,
    );
  }

  @Post('units/:unitId/one-time-orders/:orderId/return')
  returnFromOrder(
    @CurrentUser() user: CurrentAuthUser,
    @Param('unitId') unitId: string,
    @Param('orderId') orderId: string,
    @Body() payload: ScopedEquipmentActionDto,
  ): Promise<ScopedEquipmentMovementReceiptDto> {
    return this.scopedEquipmentService.returnFromOrder(user, unitId, orderId, payload);
  }

  @Post('units/:unitId/return')
  returnToStorage(
    @CurrentUser() user: CurrentAuthUser,
    @Param('unitId') unitId: string,
    @Body() payload: ScopedEquipmentActionDto,
  ): Promise<ScopedEquipmentMovementReceiptDto> {
    return this.scopedEquipmentService.returnToStorage(user, unitId, payload);
  }
}
