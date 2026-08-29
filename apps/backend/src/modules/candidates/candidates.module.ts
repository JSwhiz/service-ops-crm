import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PrismaModule } from '../prisma/prisma.module';

import { CandidateReminderService } from './candidate-reminder.service';
import { CandidatesController } from './candidates.controller';
import { CandidatesService } from './candidates.service';

@Module({
  imports: [PrismaModule, AuditModule, NotificationsModule],
  controllers: [CandidatesController],
  providers: [CandidatesService, CandidateReminderService],
  exports: [CandidatesService, CandidateReminderService],
})
export class CandidatesModule {}
