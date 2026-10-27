import { Module } from '@nestjs/common';

import { EmployeesModule } from '../employees/employees.module';
import { ChatsModule } from '../chats/chats.module';
import { ObjectsModule } from '../objects/objects.module';
import { EquipmentModule } from '../equipment/equipment.module';
import { InventoryModule } from '../inventory/inventory.module';
import { PrismaModule } from '../prisma/prisma.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { TimesheetsModule } from '../timesheets/timesheets.module';

import { ObjectAttendanceSubmissionService } from './object-attendance-submission.service';
import { ObjectOperationsController } from './object-operations.controller';
import { ObjectOperationsService } from './object-operations.service';
import { ObjectDailyReportPublicationService } from './object-daily-report-publication.service';

@Module({
  imports: [PrismaModule, EmployeesModule, InventoryModule, EquipmentModule, TimesheetsModule, NotificationsModule, ObjectsModule, ChatsModule],
  controllers: [ObjectOperationsController],
  providers: [ObjectOperationsService, ObjectAttendanceSubmissionService, ObjectDailyReportPublicationService],
  exports: [ObjectOperationsService],
})
export class ObjectOperationsModule {}
