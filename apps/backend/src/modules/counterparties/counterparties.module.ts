import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module';
import { InventoryModule } from '../inventory/inventory.module';
import { PrismaModule } from '../prisma/prisma.module';

import { CounterpartiesController } from './counterparties.controller';
import { CounterpartiesService } from './counterparties.service';

@Module({
  imports: [PrismaModule, AuditModule, InventoryModule],
  controllers: [CounterpartiesController],
  providers: [CounterpartiesService],
  exports: [CounterpartiesService],
})
export class CounterpartiesModule {}
