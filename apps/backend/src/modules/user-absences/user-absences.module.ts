import { Module } from '@nestjs/common';

import { PrismaModule } from '../prisma/prisma.module';

import { UserAbsencesController } from './user-absences.controller';
import { UserAbsencesService } from './user-absences.service';

@Module({
  imports: [PrismaModule],
  controllers: [UserAbsencesController],
  providers: [UserAbsencesService],
  exports: [UserAbsencesService],
})
export class UserAbsencesModule {}
