import { Module } from '@nestjs/common';

import { PrismaModule } from '../prisma/prisma.module';

import { ObjectOperationsController } from './object-operations.controller';
import { ObjectOperationsService } from './object-operations.service';

@Module({
  imports: [PrismaModule],
  controllers: [ObjectOperationsController],
  providers: [ObjectOperationsService],
  exports: [ObjectOperationsService],
})
export class ObjectOperationsModule {}
