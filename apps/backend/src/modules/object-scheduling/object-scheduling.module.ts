import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { TimesheetsModule } from '../timesheets/timesheets.module';
import { ObjectSchedulingService } from './object-scheduling.service';
import { ObjectSchedulingController, ObjectSchedulingDraftController } from './object-scheduling.controller';
import { ObjectCompensationService } from './object-compensation.service';
import { ObjectCompensationController } from './object-compensation.controller';

@Module({imports: [PrismaModule, TimesheetsModule], controllers: [ObjectSchedulingController, ObjectSchedulingDraftController, ObjectCompensationController], providers: [ObjectSchedulingService, ObjectCompensationService], exports: [ObjectSchedulingService, ObjectCompensationService]})
export class ObjectSchedulingModule {}
