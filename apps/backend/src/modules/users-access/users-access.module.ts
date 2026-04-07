import { Module } from '@nestjs/common';

import { PrismaModule } from '../prisma/prisma.module';

import { UsersAccessController } from './users-access.controller';
import { UsersAccessService } from './users-access.service';
import { UsersService } from './users.service';

@Module({
  imports: [PrismaModule],
  controllers: [UsersAccessController],
  providers: [UsersService, UsersAccessService],
  exports: [UsersService, UsersAccessService],
})
export class UsersAccessModule {}
