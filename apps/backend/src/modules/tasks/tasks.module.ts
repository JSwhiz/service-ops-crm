import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module';
import { PrismaModule } from '../prisma/prisma.module';

import { TaskAutoCloseService } from './task-auto-close.service';
import { TasksController } from './tasks.controller';
import { TasksService } from './tasks.service';

@Module({
  imports: [PrismaModule, AuditModule],
  controllers: [TasksController],
  providers: [TasksService, TaskAutoCloseService],
  exports: [TasksService, TaskAutoCloseService],
})
export class TasksModule {}
