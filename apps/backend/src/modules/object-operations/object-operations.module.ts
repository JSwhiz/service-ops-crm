import { Module } from '@nestjs/common';

import { EmployeesModule } from '../employees/employees.module';
import { PrismaModule } from '../prisma/prisma.module';

import { ObjectOperationsController } from './object-operations.controller';
import { ObjectOperationsService } from './object-operations.service';

@Module({
  imports: [PrismaModule, EmployeesModule],
  controllers: [ObjectOperationsController],
  providers: [ObjectOperationsService],
  exports: [ObjectOperationsService],
})
export class ObjectOperationsModule {}
