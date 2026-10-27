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

@Module({
  imports: [PrismaModule, AuditModule, ChatsModule, NotificationsModule],
  controllers: [ObjectsController, ObjectPlanningController],
  providers: [ObjectsService, ObjectRegistrySignalsService, ObjectPlanningService, { provide: 'ObjectPlanningService', useExisting: ObjectPlanningService }],
  exports: [ObjectsService, ObjectPlanningService],
})
export class ObjectsModule {}
