import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module';
import { PrismaModule } from '../prisma/prisma.module';

import { EquipmentController } from './equipment.controller';
import { EquipmentService } from './equipment.service';
import { ScopedEquipmentController } from './scoped-equipment.controller';
import { ScopedEquipmentService } from './scoped-equipment.service';

@Module({
  imports: [PrismaModule, AuditModule],
  controllers: [EquipmentController, ScopedEquipmentController],
  providers: [EquipmentService, ScopedEquipmentService],
  exports: [EquipmentService, ScopedEquipmentService],
})
export class EquipmentModule {}
