import { Module } from '@nestjs/common';

import { AccountabilityModule } from '../accountability/accountability.module';
import { AuditModule } from '../audit/audit.module';
import { EquipmentModule } from '../equipment/equipment.module';
import { InventoryModule } from '../inventory/inventory.module';
import { ObjectsModule } from '../objects/objects.module';
import { PrismaModule } from '../prisma/prisma.module';
import { TasksModule } from '../tasks/tasks.module';
import { TimesheetsModule } from '../timesheets/timesheets.module';

import { ApprovalsController } from './approvals.controller';
import { ApprovalsService } from './approvals.service';

@Module({
  imports: [
    PrismaModule,
    AuditModule,
    TasksModule,
    InventoryModule,
    EquipmentModule,
    ObjectsModule,
    TimesheetsModule,
    AccountabilityModule,
  ],
  controllers: [ApprovalsController],
  providers: [ApprovalsService],
  exports: [ApprovalsService],
})
export class ApprovalsModule {}
