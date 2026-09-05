import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module';
import { ChatsModule } from '../chats/chats.module';
import { PrismaModule } from '../prisma/prisma.module';

import { ObjectRegistrySignalsController } from './object-registry-signals.controller';
import { ObjectRegistrySignalsService } from './object-registry-signals.service';
import { ObjectsController } from './objects.controller';
import { ObjectsService } from './objects.service';

@Module({
  imports: [PrismaModule, AuditModule, ChatsModule],
  controllers: [ObjectRegistrySignalsController, ObjectsController],
  providers: [ObjectsService, ObjectRegistrySignalsService],
  exports: [ObjectsService],
})
export class ObjectsModule {}
