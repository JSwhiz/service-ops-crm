import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PrismaModule } from '../prisma/prisma.module';

import { EmployeeBirthdayNotificationService } from './employee-birthday-notification.service';
import { EmployeeAssignmentHistoryService } from './employee-assignment-history.service';
import { EmployeeScheduleService } from './employee-schedule.service';
import { EmployeesController } from './employees.controller';
import { EmployeesService } from './employees.service';
import { EmployeeSubstitutionReadController } from './employee-substitution-read.controller';
import { EmployeeSubstitutionReadService } from './employee-substitution-read.service';

@Module({
  imports: [PrismaModule, AuditModule, NotificationsModule],
  controllers: [EmployeesController, EmployeeSubstitutionReadController],
  providers: [EmployeeSubstitutionReadService, EmployeesService, EmployeeScheduleService, EmployeeAssignmentHistoryService, EmployeeBirthdayNotificationService],
  exports: [EmployeesService, EmployeeAssignmentHistoryService],
})
export class EmployeesModule {}
