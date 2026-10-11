import { Module } from '@nestjs/common';

import { PrismaModule } from '../prisma/prisma.module';

import { RubberMatsController } from './rubber-mats.controller';
import { RubberMatsRegistryController } from './rubber-mats-registry.controller';
import { RubberMatsService } from './rubber-mats.service';

@Module({
  imports: [PrismaModule],
  controllers: [RubberMatsController, RubberMatsRegistryController],
  providers: [RubberMatsService],
  exports: [RubberMatsService],
})
export class RubberMatsModule {}
