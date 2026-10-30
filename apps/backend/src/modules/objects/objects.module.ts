import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module';
import { ChatsModule } from '../chats/chats.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PrismaModule } from '../prisma/prisma.module';

import { ObjectRegistrySignalsService } from './object-registry-signals.service';
import { ObjectsController } from './objects.controller';
import { ObjectsService } from './objects.service';
import { ObjectPlanningService } from './object-planning.service';
import { ObjectPlanningController } from './object-planning.controller';
import { ObjectSetupController } from './object-setup.controller';
import { ObjectSetupService } from './object-setup.service';
import { ObjectSchedulingModule } from '../object-scheduling/object-scheduling.module';

@Module({
  imports: [PrismaModule, AuditModule, ChatsModule, NotificationsModule, ObjectSchedulingModule],
  controllers: [ObjectsController, ObjectPlanningController, ObjectSetupController],
  providers: [ObjectsService, ObjectSetupService, ObjectRegistrySignalsService, ObjectPlanningService, { provide: 'ObjectPlanningService', useExisting: ObjectPlanningService }],
  exports: [ObjectsService, ObjectPlanningService, ObjectSetupService],
})
export class ObjectsModule {}
