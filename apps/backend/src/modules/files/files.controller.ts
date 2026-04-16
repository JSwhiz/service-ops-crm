import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

import { FileResponseDto } from './dto/file-response.dto';
import { UploadFileBodyDto } from './dto/upload-file-body.dto';
import { FilesService } from './files.service';

interface CurrentAuthUser {
  id: string;
  login: string;
  fullName: string;
  roleCode: string;
  roleCodes?: string[];
  isActive: boolean;
}

interface UploadedFilePayload {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

@UseGuards(JwtAuthGuard)
@Controller('files')
export class FilesController {
  constructor(private readonly filesService: FilesService) {}

  @Get('entity/:entityType/:entityId')
  listByEntity(
    @Param('entityType') entityType: string,
    @Param('entityId') entityId: string,
  ): Promise<FileResponseDto[]> {
    return this.filesService.listByEntity({
      entityType,
      entityId,
    });
  }

  @Get(':id')
  getById(@Param('id') id: string): Promise<FileResponseDto> {
    return this.filesService.getById(id);
  }

  @Post('upload')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: {
        fileSize: 25 * 1024 * 1024,
      },
    }),
  )
  upload(
    @CurrentUser() user: CurrentAuthUser,
    @Body() body: UploadFileBodyDto,
    @UploadedFile() file: UploadedFilePayload | undefined,
  ): Promise<FileResponseDto> {
    if (!file) {
      throw new BadRequestException('File is required');
    }

    return this.filesService.upload(user, body, file);
  }
}
