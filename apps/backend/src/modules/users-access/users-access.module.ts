import { Module } from '@nestjs/common';

import { PrismaModule } from '../prisma/prisma.module';

import { UsersAccessController } from './users-access.controller';
import { UsersAccessService } from './users-access.service';
import { UsersService } from './users.service';
import { AccessAdminController } from './access-admin.controller';
import { AccessAdminService } from './access-admin.service';

@Module({
  imports: [PrismaModule],
  controllers: [UsersAccessController, AccessAdminController],
  providers: [UsersService, UsersAccessService, AccessAdminService],
  exports: [UsersService, UsersAccessService],
})
export class UsersAccessModule {}
