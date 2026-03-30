import { Module } from '@nestjs/common';

import { PrismaModule } from '../../modules/prisma/prisma.module';

import { ObjectsController } from './objects.controller';
import { ObjectsService } from './objects.service';

@Module({
  imports: [PrismaModule],
  controllers: [ObjectsController],
  providers: [ObjectsService],
  exports: [ObjectsService],
})
export class ObjectsModule {}
