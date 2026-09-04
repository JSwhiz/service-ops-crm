import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module';
import { ChatsModule } from '../chats/chats.module';
import { EquipmentModule } from '../equipment/equipment.module';
import { PrismaModule } from '../prisma/prisma.module';
import { TasksModule } from '../tasks/tasks.module';

import { OneTimeOrderAttentionController } from './one-time-order-attention.controller';
import { OneTimeOrderAttentionService } from './one-time-order-attention.service';
import { OneTimeOrderWorkforceController } from './one-time-order-workforce.controller';
import { OneTimeOrderWorkforceService } from './one-time-order-workforce.service';
import { OneTimeOrdersController } from './one-time-orders.controller';
import { OneTimeOrderCalendarService } from './one-time-order-calendar.service';
import { OneTimeOrderConflictService } from './one-time-order-conflict.service';
import { OneTimeOrdersService } from './one-time-orders.service';
import { OneTimeManagerAvailabilityService } from './one-time-manager-availability.service';

@Module({
  imports: [PrismaModule, AuditModule, TasksModule, EquipmentModule, ChatsModule],
  controllers: [
    OneTimeOrderAttentionController,
    OneTimeOrderWorkforceController,
    OneTimeOrdersController,
  ],
  providers: [
    OneTimeOrdersService,
    OneTimeOrderAttentionService,
    OneTimeOrderWorkforceService,
    OneTimeManagerAvailabilityService,
    OneTimeOrderCalendarService,
    OneTimeOrderConflictService,
  ],
  exports: [
    OneTimeOrdersService,
    OneTimeOrderAttentionService,
    OneTimeOrderWorkforceService,
    OneTimeManagerAvailabilityService,
  ],
})
export class OneTimeOrdersModule {}
