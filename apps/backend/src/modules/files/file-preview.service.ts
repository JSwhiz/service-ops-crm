import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';

import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { StorageService } from '../storage/storage.service';

import {
  FILE_PREVIEW_QUEUE,
  IMAGE_THUMBNAIL_DERIVATIVE,
  OFFICE_FILE_EXTENSIONS,
  PDF_PREVIEW_DERIVATIVE,
  type FileDerivativeType,
  getDerivativeType,
} from './constants/file-preview.constants';

type PreviewFile = {
  id: string;
  objectKey: string;
  originalName: string;
  mimeType: string;
};

type PreviewJob = {
  fileId: string;
  derivativeType: FileDerivativeType;
};

@Injectable()
export class FilePreviewService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(FilePreviewService.name);
  private readonly officeExecutable: string;
  private readonly tempDirectory: string;
  private readonly conversionTimeoutMs: number;
  private stopped = false;
  private workerClient: ReturnType<RedisService['getClient']> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
    private readonly storageService: StorageService,
    private readonly configService: ConfigService,
  ) {
    this.officeExecutable =
      this.configService.get<string>('filePreview.officeExecutable') ??
      'libreoffice';
    this.tempDirectory =
      this.configService.get<string>('filePreview.tempDirectory') ?? '/tmp';
    this.conversionTimeoutMs =
      this.configService.get<number>('filePreview.conversionTimeoutMs') ??
      45_000;
    sharp.cache({ memory: 32, files: 0, items: 64 });
    sharp.concurrency(2);
  }

  async onModuleInit(): Promise<void> {
    this.workerClient = this.redisService.getClient().duplicate();
    await this.workerClient.connect();
    void this.runWorkerLoop();
  }

  async onModuleDestroy(): Promise<void> {
    this.stopped = true;

    if (this.workerClient?.isOpen) {
      await this.workerClient.quit();
    }
  }

  async ensurePreview(file: PreviewFile): Promise<{
    derivativeType: string;
    status: string;
    objectKey: string | null;
    mimeType: string | null;
    sizeBytes: number | null;
    width: number | null;
    height: number | null;
    errorMessage: string | null;
  } | null> {
    const derivativeType = getDerivativeType(file.mimeType);

    if (!derivativeType) {
      return null;
    }

    const derivative = await this.prisma.fileDerivative.upsert({
      where: {
        fileId_derivativeType: {
          fileId: file.id,
          derivativeType,
        },
      },
      update: {},
      create: {
        fileId: file.id,
        derivativeType,
        status: 'pending',
      },
    });

    if (derivative.status === 'pending') {
      await this.enqueue({ fileId: file.id, derivativeType });
    }

    return derivative;
  }

  async retryPreview(file: PreviewFile): Promise<void> {
    const derivativeType = getDerivativeType(file.mimeType);

    if (!derivativeType) {
      return;
    }

    const derivative = await this.prisma.fileDerivative.upsert({
      where: {
        fileId_derivativeType: {
          fileId: file.id,
          derivativeType,
        },
      },
      update: {},
      create: {
        fileId: file.id,
        derivativeType,
        status: 'pending',
      },
    });

    if (derivative.status === 'ready' || derivative.status === 'processing') {
      return;
    }

    await this.prisma.fileDerivative.update({
      where: { id: derivative.id },
      data: {
        status: 'pending',
        errorMessage: null,
      },
    });
    await this.enqueue({ fileId: file.id, derivativeType }, true);
  }

  private async enqueue(job: PreviewJob, force = false): Promise<void> {
    const lockKey = `service-ops:file-preview:queued:${job.fileId}:${job.derivativeType}`;

    if (force) {
      await this.redisService.getClient().del(lockKey);
    }

    const locked = await this.redisService
      .getClient()
      .set(lockKey, '1', { NX: true, EX: 600 });

    if (locked !== 'OK') {
      return;
    }

    await this.redisService
      .getClient()
      .rPush(FILE_PREVIEW_QUEUE, JSON.stringify(job));
  }

  private async runWorkerLoop(): Promise<void> {
    while (!this.stopped && this.workerClient?.isOpen) {
      try {
        const queued = await this.workerClient.blPop(FILE_PREVIEW_QUEUE, 1);

        if (!queued) {
          continue;
        }

        const job = JSON.parse(queued.element) as PreviewJob;
        await this.processJob(job);
      } catch (error) {
        if (!this.stopped) {
          this.logger.error(
            `File preview worker failed: ${this.getErrorMessage(error)}`,
          );
        }
      }
    }
  }

  private async processJob(job: PreviewJob): Promise<void> {
    const lockKey = `service-ops:file-preview:queued:${job.fileId}:${job.derivativeType}`;
    await this.redisService.getClient().del(lockKey);

    const claim = await this.prisma.fileDerivative.updateMany({
      where: {
        fileId: job.fileId,
        derivativeType: job.derivativeType,
        status: 'pending',
      },
      data: {
        status: 'processing',
        errorMessage: null,
      },
    });

    if (claim.count === 0) {
      return;
    }

    try {
      const file = await this.prisma.file.findFirst({
        where: { id: job.fileId, deletedAt: null },
        select: {
          id: true,
          objectKey: true,
          originalName: true,
          mimeType: true,
        },
      });

      if (!file) {
        throw new Error('Source file is unavailable');
      }

      if (job.derivativeType === IMAGE_THUMBNAIL_DERIVATIVE) {
        await this.createImageThumbnail(file);
      } else if (job.derivativeType === PDF_PREVIEW_DERIVATIVE) {
        await this.createOfficePdf(file);
      }
    } catch (error) {
      await this.prisma.fileDerivative.update({
        where: {
          fileId_derivativeType: {
            fileId: job.fileId,
            derivativeType: job.derivativeType,
          },
        },
        data: {
          status: 'failed',
          errorMessage: this.getErrorMessage(error).slice(0, 1000),
        },
      });
    }
  }

  private async createImageThumbnail(file: PreviewFile): Promise<void> {
    const source = await this.storageService.downloadObject(file.objectKey);
    const thumbnailPromise = sharp(source.body, {
      failOn: 'error',
      limitInputPixels: 40_000_000,
    })
      .rotate()
      .resize({
        width: 800,
        height: 800,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .webp({ quality: 82 })
      .toBuffer({ resolveWithObject: true });
    const result = await this.withTimeout(
      thumbnailPromise,
      20_000,
      'Image thumbnail generation timed out',
    );
    const objectKey = `derivatives/${file.id}/thumbnail.webp`;
    await this.storageService.uploadObject({
      objectKey,
      body: result.data,
      contentType: 'image/webp',
      contentLength: result.data.length,
    });
    await this.prisma.fileDerivative.update({
      where: {
        fileId_derivativeType: {
          fileId: file.id,
          derivativeType: IMAGE_THUMBNAIL_DERIVATIVE,
        },
      },
      data: {
        status: 'ready',
        objectKey,
        mimeType: 'image/webp',
        sizeBytes: result.data.length,
        width: result.info.width,
        height: result.info.height,
        errorMessage: null,
      },
    });
  }

  private async createOfficePdf(file: PreviewFile): Promise<void> {
    const extension = OFFICE_FILE_EXTENSIONS[file.mimeType];

    if (!extension) {
      throw new Error('Unsupported office document type');
    }

    const source = await this.storageService.downloadObject(file.objectKey);
    const directory = await mkdtemp(
      join(this.tempDirectory, 'service-ops-preview-'),
    );
    const inputPath = join(directory, `source${extension}`);

    try {
      await writeFile(inputPath, source.body, { mode: 0o600 });
      await this.runLibreOffice(inputPath, directory);
      const outputName = (await readdir(directory)).find((name) =>
        name.toLowerCase().endsWith('.pdf'),
      );

      if (!outputName) {
        throw new Error('LibreOffice did not create a PDF preview');
      }

      const pdf = await readFile(join(directory, outputName));
      const objectKey = `derivatives/${file.id}/preview.pdf`;
      await this.storageService.uploadObject({
        objectKey,
        body: pdf,
        contentType: 'application/pdf',
        contentLength: pdf.length,
      });
      await this.prisma.fileDerivative.update({
        where: {
          fileId_derivativeType: {
            fileId: file.id,
            derivativeType: PDF_PREVIEW_DERIVATIVE,
          },
        },
        data: {
          status: 'ready',
          objectKey,
          mimeType: 'application/pdf',
          sizeBytes: pdf.length,
          width: null,
          height: null,
          errorMessage: null,
        },
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }

  private runLibreOffice(inputPath: string, outputDirectory: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn(
        this.officeExecutable,
        [
          '--headless',
          '--nologo',
          '--nodefault',
          '--nolockcheck',
          '--nofirststartwizard',
          '--convert-to',
          'pdf',
          '--outdir',
          outputDirectory,
          inputPath,
        ],
        {
          env: {
            PATH: process.env.PATH,
            HOME: outputDirectory,
            TMPDIR: outputDirectory,
            SAL_USE_VCLPLUGIN: 'svp',
          },
          stdio: ['ignore', 'ignore', 'pipe'],
        },
      );
      let stderr = '';
      const timeout = setTimeout(() => {
        child.kill('SIGKILL');
        reject(new Error('Office preview conversion timed out'));
      }, this.conversionTimeoutMs);

      child.stderr.on('data', (chunk: Buffer) => {
        stderr = `${stderr}${chunk.toString()}`.slice(-2000);
      });
      child.once('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      child.once('exit', (code) => {
        clearTimeout(timeout);

        if (code === 0) {
          resolve();
          return;
        }

        reject(
          new Error(
            `LibreOffice exited with code ${String(code)}${stderr ? `: ${stderr}` : ''}`,
          ),
        );
      });
    });
  }

  private async withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    message: string,
  ): Promise<T> {
    let timeout: NodeJS.Timeout | null = null;

    try {
      return await Promise.race([
        promise,
        new Promise<never>((_, reject) => {
          timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
        }),
      ]);
    } finally {
      if (timeout) {
        clearTimeout(timeout);
      }
    }
  }

  private getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : 'Unknown preview error';
  }
}
