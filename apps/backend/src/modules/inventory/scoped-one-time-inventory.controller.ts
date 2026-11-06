import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

import { CreateOrderInventoryIssueDto } from './dto/create-order-inventory-issue.dto';
import { OrderInventoryResponseDto } from './dto/order-inventory-response.dto';
import { OrderInventoryIssueResponseDto } from './dto/order-inventory-issue-response.dto';
import { ScopedOneTimeInventoryService } from './scoped-one-time-inventory.service';

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
  ): Promise<OrderInventoryResponseDto> {
    return this.scopedOneTimeInventoryService.listOrderMovements(user, orderId);
  }

  @Post('issue')
  issueToOrder(
    @CurrentUser() user: CurrentAuthUser,
    @Param('orderId') orderId: string,
    @Body() payload: CreateOrderInventoryIssueDto,
  ): Promise<OrderInventoryIssueResponseDto> {
    return this.scopedOneTimeInventoryService.issueToOrder(
      user,
      orderId,
      payload,
    );
  }
}
