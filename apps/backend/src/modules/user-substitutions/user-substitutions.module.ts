import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { AuditModule } from '../audit/audit.module';
import { PrismaModule } from '../prisma/prisma.module';
import { ObjectDelegationInterceptor } from './object-delegation.interceptor';
import { UserSubstitutionsController } from './user-substitutions.controller';
import { UserSubstitutionsService } from './user-substitutions.service';

@Module({
  imports: [PrismaModule, AuditModule],
  providers: [UserSubstitutionsService, { provide: APP_INTERCEPTOR, useClass: ObjectDelegationInterceptor }],
  controllers: [UserSubstitutionsController],
  exports: [UserSubstitutionsService],
})
export class UserSubstitutionsModule {}
