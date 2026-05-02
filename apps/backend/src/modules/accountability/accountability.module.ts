import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module';
import { PrismaModule } from '../prisma/prisma.module';

import { AccountabilityController } from './accountability.controller';
import { AccountabilityService } from './accountability.service';

@Module({
  imports: [PrismaModule, AuditModule],
  controllers: [AccountabilityController],
  providers: [AccountabilityService],
  exports: [AccountabilityService],
})
export class AccountabilityModule {}
