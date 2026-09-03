import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

import {
  CreateUserAbsenceDto,
  ListUserAbsencesQueryDto,
  UpdateUserAbsenceDto,
  UserAbsenceListResponseDto,
  UserAbsenceResponseDto,
} from './dto/user-absence.dto';
import { UserAbsencesService } from './user-absences.service';

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
@Controller('user-absences')
export class UserAbsencesController {
  constructor(private readonly service: UserAbsencesService) {}

  @Get()
  list(
    @CurrentUser() user: CurrentAuthUser,
    @Query() query: ListUserAbsencesQueryDto,
  ): Promise<UserAbsenceListResponseDto> {
    return this.service.list(user, query);
  }

  @Get('users')
  listManageableUsers(
    @CurrentUser() user: CurrentAuthUser,
  ): Promise<Array<{ id: string; login: string; fullName: string }>> {
    return this.service.listManageableUsers(user);
  }

  @Post()
  create(
    @CurrentUser() user: CurrentAuthUser,
    @Body() payload: CreateUserAbsenceDto,
  ): Promise<UserAbsenceResponseDto> {
    return this.service.create(user, payload);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: CurrentAuthUser,
    @Param('id') id: string,
    @Body() payload: UpdateUserAbsenceDto,
  ): Promise<UserAbsenceResponseDto> {
    return this.service.update(user, id, payload);
  }

  @Delete(':id')
  remove(
    @CurrentUser() user: CurrentAuthUser,
    @Param('id') id: string,
  ): Promise<{ id: string; deleted: true }> {
    return this.service.remove(user, id);
  }
}
