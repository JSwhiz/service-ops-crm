import { Module } from '@nestjs/common';

import { AccountabilityModule } from '../accountability/accountability.module';
import { ApprovalsModule } from '../approvals/approvals.module';
import { CandidatesModule } from '../candidates/candidates.module';
import { EmployeesModule } from '../employees/employees.module';
import { ObjectsModule } from '../objects/objects.module';
import { OneTimeOrdersModule } from '../one-time-orders/one-time-orders.module';
import { PrismaModule } from '../prisma/prisma.module';
import { TasksModule } from '../tasks/tasks.module';
import { UserAbsencesModule } from '../user-absences/user-absences.module';

import { DashboardController } from './dashboard.controller';
import { LeadershipDashboardService } from './leadership-dashboard.service';

@Module({
  imports: [
    PrismaModule,
    ObjectsModule,
    TasksModule,
    OneTimeOrdersModule,
    ApprovalsModule,
    AccountabilityModule,
    EmployeesModule,
    CandidatesModule,
    UserAbsencesModule,
  ],
  controllers: [DashboardController],
  providers: [LeadershipDashboardService],
})
export class DashboardModule {}
