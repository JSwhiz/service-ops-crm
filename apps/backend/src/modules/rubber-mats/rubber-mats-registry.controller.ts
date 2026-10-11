import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

import { ListRubberMatsQueryDto } from './dto/list-rubber-mats-query.dto';
import { RegisterRubberMatDto } from './dto/rubber-mat.dto';
import { RubberMatsService } from './rubber-mats.service';

interface RubberMatRegistryUser {
  id: string;
  roleCode: string;
  roleCodes?: string[];
  isActive: boolean;
}

@UseGuards(JwtAuthGuard)
@Controller('rubber-mats')
export class RubberMatsRegistryController {
  constructor(private readonly rubberMatsService: RubberMatsService) {}

  @Get()
  list(@CurrentUser() user: RubberMatRegistryUser, @Query() query: ListRubberMatsQueryDto) {
    return this.rubberMatsService.listRegistry(user, query);
  }

  @Get('available/:objectId')
  available(@CurrentUser() user: RubberMatRegistryUser, @Param('objectId') objectId: string) {
    return this.rubberMatsService.listAvailableForObject(user, objectId);
  }

  @Post()
  register(@CurrentUser() user: RubberMatRegistryUser, @Body() payload: RegisterRubberMatDto) {
    return this.rubberMatsService.register(user, payload);
  }
}
