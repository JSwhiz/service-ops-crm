import { Controller, Get, UseGuards } from '@nestjs/common';

import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

import { UsersAccessService } from './users-access.service';
import { SystemUserOptionDto } from './dto/system-user-option.dto';

@UseGuards(JwtAuthGuard)
@Controller('users-access')
export class UsersAccessController {
  constructor(private readonly usersAccessService: UsersAccessService) {}

  @Get('users')
  async listUsers(): Promise<SystemUserOptionDto[]> {
    return this.usersAccessService.listUsers();
  }
}
