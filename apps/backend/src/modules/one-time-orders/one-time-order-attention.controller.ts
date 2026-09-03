import { Controller, Get, Query, UseGuards } from '@nestjs/common';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

import { ListOneTimeOrdersQueryDto } from './dto/list-one-time-orders-query.dto';
import { OneTimeOrderAttentionResponseDto } from './dto/one-time-order-attention-response.dto';
import { OneTimeOrderAttentionService } from './one-time-order-attention.service';

interface CurrentAuthUser {
  id: string;
  roleCode: string;
  roleCodes?: string[];
  permissionCodes?: string[];
}

@UseGuards(JwtAuthGuard)
@Controller('one-time-orders/attention')
export class OneTimeOrderAttentionController {
  constructor(private readonly service: OneTimeOrderAttentionService) {}

  @Get()
  list(
    @CurrentUser() user: CurrentAuthUser,
    @Query() query: ListOneTimeOrdersQueryDto,
  ): Promise<OneTimeOrderAttentionResponseDto> {
    return this.service.list(user, query);
  }
}
