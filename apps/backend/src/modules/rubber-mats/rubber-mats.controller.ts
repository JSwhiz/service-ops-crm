import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

import {
  AssignRubberMatDto,
  MoveRubberMatDto,
  ReturnRubberMatDto,
  ServiceRubberMatDto,
  UpdateRubberMatDto,
} from './dto/rubber-mat.dto';
import { RubberMatsService } from './rubber-mats.service';

interface RubberMatUser {
  id: string;
  roleCode: string;
  roleCodes?: string[];
  isActive: boolean;
}

@UseGuards(JwtAuthGuard)
@Controller('objects/:objectId/rubber-mats')
export class RubberMatsController {
  constructor(private readonly rubberMatsService: RubberMatsService) {}

  @Get()
  list(@CurrentUser() user: RubberMatUser, @Param('objectId') objectId: string) {
    return this.rubberMatsService.list(user, objectId);
  }

  @Post(':matId/assign')
  assign(@CurrentUser() user: RubberMatUser, @Param('objectId') objectId: string, @Param('matId') matId: string, @Body() payload: AssignRubberMatDto) {
    return this.rubberMatsService.assign(user, objectId, matId, payload.zone, payload.note);
  }

  @Post(':matId/return-to-stock')
  returnToStock(@CurrentUser() user: RubberMatUser, @Param('objectId') objectId: string, @Param('matId') matId: string, @Body() payload: ReturnRubberMatDto) {
    return this.rubberMatsService.returnToStock(user, objectId, matId, payload.note);
  }

  @Patch(':matId')
  update(
    @CurrentUser() user: RubberMatUser,
    @Param('objectId') objectId: string,
    @Param('matId') matId: string,
    @Body() payload: UpdateRubberMatDto,
  ) {
    return this.rubberMatsService.update(user, objectId, matId, payload);
  }

  @Post(':matId/move')
  move(
    @CurrentUser() user: RubberMatUser,
    @Param('objectId') objectId: string,
    @Param('matId') matId: string,
    @Body() payload: MoveRubberMatDto,
  ) {
    return this.rubberMatsService.move(
      user,
      objectId,
      matId,
      payload.targetObjectId,
      payload.zone,
      payload.note,
    );
  }

  @Post(':matId/service')
  service(
    @CurrentUser() user: RubberMatUser,
    @Param('objectId') objectId: string,
    @Param('matId') matId: string,
    @Body() payload: ServiceRubberMatDto,
  ) {
    return this.rubberMatsService.service(user, objectId, matId, payload.note);
  }

  @Get(':matId/history')
  history(
    @CurrentUser() user: RubberMatUser,
    @Param('objectId') objectId: string,
    @Param('matId') matId: string,
  ) {
    return this.rubberMatsService.getHistory(user, objectId, matId);
  }
}
