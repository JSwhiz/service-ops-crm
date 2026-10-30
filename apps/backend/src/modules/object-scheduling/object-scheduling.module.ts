import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { TimesheetsModule } from '../timesheets/timesheets.module';
import { ObjectSchedulingService } from './object-scheduling.service';
import { ObjectSchedulingController, ObjectSchedulingDraftController } from './object-scheduling.controller';

@Module({imports: [PrismaModule, TimesheetsModule], controllers: [ObjectSchedulingController, ObjectSchedulingDraftController], providers: [ObjectSchedulingService], exports: [ObjectSchedulingService]})
export class ObjectSchedulingModule {}
