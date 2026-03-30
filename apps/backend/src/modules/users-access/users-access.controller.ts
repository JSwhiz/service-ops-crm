import { Controller, Get, UseGuards } from '@nestjs/common';

import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

import { UsersService } from './users.service';

@UseGuards(JwtAuthGuard)
@Controller('users-access')
export class UsersAccessController {
  constructor(private readonly usersService: UsersService) {}

  @Get('users')
  async listUsers(): Promise<
    Array<{
      id: string;
      login: string;
      fullName: string;
      isActive: boolean;
    }>
  > {
    return this.usersService.listUsers();
  }
}
