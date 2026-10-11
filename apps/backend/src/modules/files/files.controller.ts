import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

import { SafeFileResponseDto } from './dto/safe-file-response.dto';
import { FileViewResponseDto } from './dto/file-view-response.dto';
import { UploadFileBodyDto } from './dto/upload-file-body.dto';
import { FilesService } from './files.service';

interface CurrentAuthUser {
  id: string;
  login: string;
  fullName: string;
  roleCode: string;
  roleCodes?: string[];
  permissionCodes?: string[];
  isActive: boolean;
}

interface UploadedFilePayload {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

function buildContentDispositionFilename(originalName: string): string {
  const safeName = originalName.replace(/["\\\r\n]/g, '_');
  const asciiFallback = safeName
    .replace(/[^\x20-\x7e]/g, '_')
    .replace(/[;\\]/g, '_');
  const utf8Name = encodeURIComponent(safeName).replace(
    /[!'()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );

  return `filename="${asciiFallback}"; filename*=UTF-8''${utf8Name}`;
}

@UseGuards(JwtAuthGuard)
@Controller('files')
export class FilesController {
  constructor(private readonly filesService: FilesService) {}

  @Get('entity/:entityType/:entityId')
  listByEntity(
    @CurrentUser() user: CurrentAuthUser,
    @Param('entityType') entityType: string,
    @Param('entityId') entityId: string,
  ): Promise<SafeFileResponseDto[]> {
    return this.filesService.listByEntity({
      currentUser: user,
      entityType,
      entityId,
    });
  }

  @Get(':id/content')
  async getContent(
    @CurrentUser() user: CurrentAuthUser,
    @Param('id') id: string,
    @Query('download') download: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    const file = await this.filesService.getContentById(user, id);
    this.setPrivateContentHeaders(response);
    response.setHeader('Content-Type', file.mimeType);
    response.setHeader('Content-Length', String(file.sizeBytes));
    response.setHeader(
      'Content-Disposition',
      `${download === '1' ? 'attachment' : file.mimeType.startsWith('image/') ? 'inline' : 'attachment'}; ${buildContentDispositionFilename(file.originalName)}`,
    );
    response.send(file.body);
  }

  @Get(':id/view')
  getView(
    @CurrentUser() user: CurrentAuthUser,
    @Param('id') id: string,
  ): Promise<FileViewResponseDto> {
    return this.filesService.getViewById(user, id);
  }

  @Get(':id/thumbnail')
  async getThumbnail(
    @CurrentUser() user: CurrentAuthUser,
    @Param('id') id: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    const file = await this.filesService.getThumbnailById(user, id);
    this.sendInlineContent(response, file, false);
  }

  @Get(':id/preview/content')
  async getPreviewContent(
    @CurrentUser() user: CurrentAuthUser,
    @Param('id') id: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    const file = await this.filesService.getPreviewContentById(user, id);
    response.setHeader('X-Content-Truncated', file.isTruncated ? '1' : '0');
    this.sendInlineContent(response, file, true);
  }

  @Post(':id/preview/retry')
  retryPreview(
    @CurrentUser() user: CurrentAuthUser,
    @Param('id') id: string,
  ): Promise<FileViewResponseDto> {
    return this.filesService.retryPreview(user, id);
  }

  @Get(':id')
  getById(
    @CurrentUser() user: CurrentAuthUser,
    @Param('id') id: string,
  ): Promise<SafeFileResponseDto> {
    return this.filesService.getById(user, id);
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
  ): Promise<SafeFileResponseDto> {
    if (!file) {
      throw new BadRequestException('File is required');
    }

    return this.filesService.upload(user, body, file);
  }

  private sendInlineContent(
    response: Response,
    file: {
      body: Buffer;
      mimeType: string;
      sizeBytes: number;
      originalName: string;
    },
    sandbox: boolean,
  ): void {
    this.setPrivateContentHeaders(response);
    response.setHeader('Content-Type', file.mimeType);
    response.setHeader('Content-Length', String(file.sizeBytes));
    response.setHeader(
      'Content-Disposition',
      `inline; ${buildContentDispositionFilename(file.originalName)}`,
    );
    response.setHeader(
      'Content-Security-Policy',
      sandbox ? "default-src 'none'; sandbox" : "default-src 'none'",
    );
    response.send(file.body);
  }

  private setPrivateContentHeaders(response: Response): void {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Cache-Control', 'private, max-age=300');
  }
}
