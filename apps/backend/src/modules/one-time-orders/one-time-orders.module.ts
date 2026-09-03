import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module';
import { ChatsModule } from '../chats/chats.module';
import { EquipmentModule } from '../equipment/equipment.module';
import { PrismaModule } from '../prisma/prisma.module';
import { TasksModule } from '../tasks/tasks.module';

import { OneTimeOrderAttentionController } from './one-time-order-attention.controller';
import { OneTimeOrderAttentionService } from './one-time-order-attention.service';
import { OneTimeOrdersController } from './one-time-orders.controller';
import { OneTimeOrderCalendarService } from './one-time-order-calendar.service';
import { OneTimeOrderConflictService } from './one-time-order-conflict.service';
import { OneTimeOrdersService } from './one-time-orders.service';
import { OneTimeManagerAvailabilityService } from './one-time-manager-availability.service';

@Module({
  imports: [PrismaModule, AuditModule, TasksModule, EquipmentModule, ChatsModule],
  controllers: [OneTimeOrderAttentionController, OneTimeOrdersController],
  providers: [
    OneTimeOrdersService,
    OneTimeOrderAttentionService,
    OneTimeManagerAvailabilityService,
    OneTimeOrderCalendarService,
    OneTimeOrderConflictService,
  ],
  exports: [OneTimeOrdersService, OneTimeOrderAttentionService, OneTimeManagerAvailabilityService],
})
export class OneTimeOrdersModule {}
