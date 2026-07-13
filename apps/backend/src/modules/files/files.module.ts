import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module';
import { PrismaModule } from '../prisma/prisma.module';
import { StorageModule } from '../storage/storage.module';

import { FilePreviewService } from './file-preview.service';
import { FilesController } from './files.controller';
import { FilesService } from './files.service';

@Module({
  imports: [PrismaModule, StorageModule, AuditModule],
  controllers: [FilesController],
  providers: [FilesService, FilePreviewService],
  exports: [FilesService, FilePreviewService],
})
export class FilesModule {}
