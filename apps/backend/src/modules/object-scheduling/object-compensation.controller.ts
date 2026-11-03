import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ObjectCompensationService } from './object-compensation.service';
import { ObjectSchedulingService } from './object-scheduling.service';
import { CancelCompensationVersionDto, CompensationMonthDto, CorrectExtraWorkDto, CreateCompensationAdjustmentDto, CreateCompensationVersionDto, CreateTeamFundDto } from './compensation.dto';
import type { SchedulingUser } from './scheduling.types';

@UseGuards(JwtAuthGuard)
@Controller('objects/:objectId/scheduling/compensation')
export class ObjectCompensationController {
  constructor(private readonly compensation: ObjectCompensationService, private readonly scheduling: ObjectSchedulingService) {}
  @Get() list(@CurrentUser() user: SchedulingUser, @Param('objectId') id: string) { return this.compensation.list(user, id); }
  @Post('versions') version(@CurrentUser() user: SchedulingUser, @Param('objectId') id: string, @Body() input: CreateCompensationVersionDto) { return this.compensation.version(user, id, input); }
  @Post('versions/:id/cancel') cancel(@CurrentUser() user: SchedulingUser, @Param('objectId') objectId: string, @Param('id') id: string, @Body() input: CancelCompensationVersionDto) { return this.compensation.cancelVersion(user, objectId, id, input); }
  @Post('team-funds') fund(@CurrentUser() user: SchedulingUser, @Param('objectId') id: string, @Body() input: CreateTeamFundDto) { return this.compensation.teamFund(user, id, input); }
  @Post('adjustments') adjustment(@CurrentUser() user: SchedulingUser, @Param('objectId') id: string, @Body() input: CreateCompensationAdjustmentDto) { return this.scheduling.adjustCompensation(user, id, input); }
  @Post('adjustments/:id/correct') correctExtra(@CurrentUser() user: SchedulingUser, @Param('objectId') objectId: string, @Param('id') id: string, @Body() input: CorrectExtraWorkDto) { return this.compensation.correctExtraWork(user, objectId, id, input); }
  @Get('explanation') explanation(@CurrentUser() user: SchedulingUser, @Param('objectId') id: string, @Query() query: CompensationMonthDto) { return this.compensation.explanation(user, id, query.year, query.month); }
}
