import { Module } from '@nestjs/common';

import { PrismaModule } from '../prisma/prisma.module';

import { EmployeeAssignmentHistoryService } from './employee-assignment-history.service';
import { EmployeesController } from './employees.controller';
import { EmployeesService } from './employees.service';

@Module({
  imports: [PrismaModule],
  controllers: [EmployeesController],
  providers: [EmployeesService, EmployeeAssignmentHistoryService],
  exports: [EmployeesService, EmployeeAssignmentHistoryService],
})
export class EmployeesModule {}
