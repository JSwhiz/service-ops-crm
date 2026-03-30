import { Module } from '@nestjs/common';

import { PrismaModule } from '../prisma/prisma.module';

import { UsersAccessController } from './users-access.controller';
import { UsersService } from './users.service';

@Module({
  imports: [PrismaModule],
  controllers: [UsersAccessController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersAccessModule {}
