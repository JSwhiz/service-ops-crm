import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { PrismaModule } from "../prisma/prisma.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { OperationalOverdueService } from "./operational-overdue.service";
import { VisitPlansController } from "./visit-plans.controller";
import { VisitPlansService } from "./visit-plans.service";

@Module({
  imports: [PrismaModule, AuditModule, NotificationsModule],
  controllers: [VisitPlansController],
  providers: [VisitPlansService, OperationalOverdueService],
})
export class VisitPlansModule {}
