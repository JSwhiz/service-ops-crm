import { Controller, Get, Query, UseGuards } from '@nestjs/common';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

import { UsersAccessService } from './users-access.service';
import { ListSystemUsersQueryDto } from './dto/list-system-users-query.dto';
import { SystemUserOptionDto } from './dto/system-user-option.dto';

interface CurrentAuthUser {
  id: string;
  login: string;
  fullName: string;
  roleCode: string;
  roleCodes?: string[];
  isActive: boolean;
}

@UseGuards(JwtAuthGuard)
@Controller('users-access')
export class UsersAccessController {
  constructor(private readonly usersAccessService: UsersAccessService) {}

  @Get('users')
  async listUsers(
    @CurrentUser() user: CurrentAuthUser,
    @Query() query: ListSystemUsersQueryDto,
  ): Promise<SystemUserOptionDto[]> {
    return this.usersAccessService.listUsers(user, query);
  }
}
