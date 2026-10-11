import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module';
import { ChatsModule } from '../chats/chats.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PrismaModule } from '../prisma/prisma.module';

import { ObjectRegistrySignalsService } from './object-registry-signals.service';
import { ObjectsController } from './objects.controller';
import { ObjectsService } from './objects.service';

@Module({
  imports: [PrismaModule, AuditModule, ChatsModule, NotificationsModule],
  controllers: [ObjectsController],
  providers: [ObjectsService, ObjectRegistrySignalsService],
  exports: [ObjectsService],
})
export class ObjectsModule {}
