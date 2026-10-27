import { Module } from '@nestjs/common';

import { PrismaModule } from '../prisma/prisma.module';

import { RubberMatsController } from './rubber-mats.controller';
import { RubberMatsRegistryController } from './rubber-mats-registry.controller';
import { RubberMatsService } from './rubber-mats.service';
import { RubberMatAggregateService } from './rubber-mat-aggregate.service';
import { ObjectRubberMatAggregateController, RubberMatAggregateRegistryController, RubberMatCatalogController } from './rubber-mat-aggregate.controller';

@Module({
  imports: [PrismaModule],
  controllers: [ObjectRubberMatAggregateController, RubberMatAggregateRegistryController, RubberMatCatalogController, RubberMatsController, RubberMatsRegistryController],
  providers: [RubberMatsService, RubberMatAggregateService],
  exports: [RubberMatsService],
})
export class RubberMatsModule {}
