import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ObjectSchedulingService } from './object-scheduling.service';
import { ArchivePositionDto, CancelShiftDto, ConfirmShiftDto, CreateContourDto, CreatePositionDto, DateRangeDto, EmployeeOptionsDto, PreviewDto, SavePositionDto, UpdateContourDto } from './scheduling.dto';
import type { SchedulingUser } from './scheduling.types';

@UseGuards(JwtAuthGuard)
@Controller('objects/:objectId/scheduling')
export class ObjectSchedulingController {
  constructor(private readonly scheduling: ObjectSchedulingService) {}
  @Get('positions') list(@CurrentUser() user: SchedulingUser, @Param('objectId') objectId: string) { return this.scheduling.list(user, objectId); }
  @Get('positions/:id') get(@CurrentUser() user: SchedulingUser, @Param('objectId') objectId: string, @Param('id') id: string) { return this.scheduling.get(user, objectId, id); }
  @Post('positions') create(@CurrentUser() user: SchedulingUser, @Param('objectId') objectId: string, @Body() input: CreatePositionDto) { return this.scheduling.create(user, objectId, input); }
  @Put('positions/:id') save(@CurrentUser() user: SchedulingUser, @Param('objectId') objectId: string, @Param('id') id: string, @Body() input: SavePositionDto) { return this.scheduling.save(user, objectId, id, input); }
  @Delete('positions/:id') archive(@CurrentUser() user: SchedulingUser, @Param('objectId') objectId: string, @Param('id') id: string, @Body() input: ArchivePositionDto) { return this.scheduling.save(user, objectId, id, input); }
  @Post('preview') preview(@CurrentUser() user: SchedulingUser, @Param('objectId') objectId: string, @Body() input: PreviewDto) { return this.scheduling.preview(user, objectId, input); }
  @Get('employees') employees(@CurrentUser() user: SchedulingUser, @Param('objectId') objectId: string, @Query() input: EmployeeOptionsDto) { return this.scheduling.employees(user, objectId, input); }
  @Get('contours') contours(@CurrentUser() user: SchedulingUser, @Param('objectId') objectId: string) { return this.scheduling.contours(user, objectId); }
  @Post('contours') createContour(@CurrentUser() user: SchedulingUser, @Param('objectId') objectId: string, @Body() input: CreateContourDto) { return this.scheduling.createContour(user, objectId, input); }
  @Patch('contours/:id') updateContour(@CurrentUser() user: SchedulingUser, @Param('objectId') objectId: string, @Param('id') id: string, @Body() input: UpdateContourDto) { return this.scheduling.updateContour(user, objectId, id, input); }
  @Get('attendance') attendance(@CurrentUser() user: SchedulingUser, @Param('objectId') objectId: string, @Query() input: DateRangeDto) { return this.scheduling.attendance(user, objectId, input); }
  @Post('attendance/confirm') confirm(@CurrentUser() user: SchedulingUser, @Param('objectId') objectId: string, @Body() input: ConfirmShiftDto) { return this.scheduling.confirm(user, objectId, input); }
  @Post('attendance/:id/cancel') cancel(@CurrentUser() user: SchedulingUser, @Param('objectId') objectId: string, @Param('id') id: string, @Body() input: CancelShiftDto) { return this.scheduling.cancel(user, objectId, id, input); }
}

@UseGuards(JwtAuthGuard)
@Controller('object-scheduling')
export class ObjectSchedulingDraftController {
  constructor(private readonly scheduling: ObjectSchedulingService) {}
  @Post('preview') preview(@CurrentUser() user: SchedulingUser, @Body() input: PreviewDto) { return this.scheduling.previewBeforeCreate(user, input); }
}
