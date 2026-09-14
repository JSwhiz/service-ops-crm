import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

import { CreateObjectInventoryIssueDto } from './dto/create-object-inventory-issue.dto';
import { InventoryMovementListResponseDto } from './dto/inventory-movement-list-response.dto';
import {
  ScopedOneTimeInventoryIssueResponse,
  ScopedOneTimeInventoryService,
} from './scoped-one-time-inventory.service';

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
@Controller('one-time-orders/:orderId/inventory')
export class ScopedOneTimeInventoryController {
  constructor(
    private readonly scopedOneTimeInventoryService: ScopedOneTimeInventoryService,
  ) {}

  @Get()
  listOrderMovements(
    @CurrentUser() user: CurrentAuthUser,
    @Param('orderId') orderId: string,
  ): Promise<InventoryMovementListResponseDto> {
    return this.scopedOneTimeInventoryService.listOrderMovements(user, orderId);
  }

  @Post('issue')
  issueToOrder(
    @CurrentUser() user: CurrentAuthUser,
    @Param('orderId') orderId: string,
    @Body() payload: CreateObjectInventoryIssueDto,
  ): Promise<ScopedOneTimeInventoryIssueResponse> {
    return this.scopedOneTimeInventoryService.issueToOrder(
      user,
      orderId,
      payload,
    );
  }
}
