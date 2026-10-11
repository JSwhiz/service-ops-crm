import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module';
import { PrismaModule } from '../prisma/prisma.module';

import { UserAbsencesController } from './user-absences.controller';
import { UserAbsencesService } from './user-absences.service';

@Module({
  imports: [PrismaModule, AuditModule],
  controllers: [UserAbsencesController],
  providers: [UserAbsencesService],
  exports: [UserAbsencesService],
})
export class UserAbsencesModule {}
