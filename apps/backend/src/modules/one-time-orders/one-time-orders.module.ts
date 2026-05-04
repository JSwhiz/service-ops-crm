import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module';
import { ChatsModule } from '../chats/chats.module';
import { EquipmentModule } from '../equipment/equipment.module';
import { PrismaModule } from '../prisma/prisma.module';
import { TasksModule } from '../tasks/tasks.module';

import { OneTimeOrdersController } from './one-time-orders.controller';
import { OneTimeOrdersService } from './one-time-orders.service';

@Module({
  imports: [PrismaModule, AuditModule, TasksModule, EquipmentModule, ChatsModule],
  controllers: [OneTimeOrdersController],
  providers: [OneTimeOrdersService],
  exports: [OneTimeOrdersService],
})
export class OneTimeOrdersModule {}
