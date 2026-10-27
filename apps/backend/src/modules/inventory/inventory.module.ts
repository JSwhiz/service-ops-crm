import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module';
import { PrismaModule } from '../prisma/prisma.module';
import { ObjectsModule } from '../objects/objects.module';

import { InventoryController } from './inventory.controller';
import { InventoryService } from './inventory.service';
import { ScopedOneTimeInventoryController } from './scoped-one-time-inventory.controller';
import { ScopedOneTimeInventoryService } from './scoped-one-time-inventory.service';

@Module({
  imports: [PrismaModule, AuditModule, ObjectsModule],
  controllers: [InventoryController, ScopedOneTimeInventoryController],
  providers: [InventoryService, ScopedOneTimeInventoryService],
  exports: [InventoryService, ScopedOneTimeInventoryService],
})
export class InventoryModule {}
