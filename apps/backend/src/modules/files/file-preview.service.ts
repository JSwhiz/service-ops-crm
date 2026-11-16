import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { FileDerivative, Prisma } from '@prisma/client';
import type { AccessSubject } from '../users-access/types/access-policy.type';
import { lockActorAccessRevision } from '../../common/access/lock-actor-access-revision';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
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
  private readonly queueName: string;
  private readonly officeExecutable: string;
  private readonly tempDirectory: string;
  private readonly conversionTimeoutMs: number;
  private readonly staleThresholdMs: number;
  private readonly maxAttempts: number;
  private stopped = false;
  private workerClient: ReturnType<RedisService['getClient']> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
    private readonly storageService: StorageService,
    private readonly configService: ConfigService,
  ) {
    this.queueName =
      this.configService.get<string>('filePreview.queueName') ??
      FILE_PREVIEW_QUEUE;
    this.officeExecutable =
      this.configService.get<string>('filePreview.officeExecutable') ??
      'libreoffice';
    this.tempDirectory =
      this.configService.get<string>('filePreview.tempDirectory') ?? '/tmp';
    this.conversionTimeoutMs =
      this.configService.get<number>('filePreview.conversionTimeoutMs') ??
      45_000;
    this.staleThresholdMs =
      this.configService.get<number>('filePreview.staleThresholdMs') ?? 180_000;
    this.maxAttempts = Math.max(
      1,
      this.configService.get<number>('filePreview.maxAttempts') ?? 3,
    );
    sharp.cache({ memory: 32, files: 0, items: 64 });
    sharp.concurrency(2);
  }

  async onModuleInit(): Promise<void> {
    this.workerClient = this.redisService.getClient().duplicate();
    await this.workerClient.connect();
    await this.recoverPreviewJobs();
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

    const derivative = await this.recoverStaleDerivative(
      await this.getOrCreateDerivative(file.id, derivativeType),
    );

    if (
      derivative.status === 'pending' &&
      derivative.attemptCount < this.maxAttempts
    ) {
      await this.enqueue({ fileId: file.id, derivativeType });
    }

    return derivative;
  }

  async retryPreview(
    file: PreviewFile,
    actor: AccessSubject,
    authorize: (tx: Prisma.TransactionClient) => Promise<void>,
  ): Promise<void> {
    const derivativeType = getDerivativeType(file.mimeType);
    if (!derivativeType) return;

    const shouldEnqueue = await this.prisma.$transaction(async (tx) => {
      await lockActorAccessRevision(tx, actor);
      // Membership, assignments and delegation can change without an actor
      // revision. Authorize under source locks before even creating a derivative.
      await authorize(tx);
      const derivative = await this.getOrCreateDerivative(file.id, derivativeType, tx);
      await tx.$queryRaw`SELECT "id" FROM "file_derivatives" WHERE "id" = ${derivative.id} FOR UPDATE`;
      // A worker may have held the derivative row across delegation expiry.
      // Keep source locks and recheck time-dependent authority before resetting.
      await authorize(tx);
      // A pending job is already an accepted retry; fresh processing/ready is
      // not another retry intent. Compare the captured state before resetting.
      if (derivative.status !== 'failed' &&
          !(derivative.status === 'processing' && this.isStale(derivative))) return false;
      const reset = await tx.fileDerivative.updateMany({
        where: { id: derivative.id, status: derivative.status, updatedAt: derivative.updatedAt },
        data: {
          status: 'pending', errorMessage: null, processingStartedAt: null,
          attemptCount: 0, lastAttemptAt: null,
        },
      });
      return reset.count === 1;
    });
    if (shouldEnqueue) await this.enqueue({ fileId: file.id, derivativeType });
  }

  private async getOrCreateDerivative(fileId: string, derivativeType: FileDerivativeType, database: Prisma.TransactionClient = this.prisma): Promise<FileDerivative> {
    const where = { fileId_derivativeType: { fileId, derivativeType } };
    const existing = await database.fileDerivative.findUnique({ where });
    if (existing) return existing;

    // Concurrent first opens share a single pending row.
    await database.fileDerivative.createMany({
      data: { fileId, derivativeType, status: 'pending' },
      skipDuplicates: true,
    });
    return database.fileDerivative.findUniqueOrThrow({ where });
  }

  private async recoverPreviewJobs(): Promise<void> {
    const staleBefore = this.getStaleBefore();
    const exhausted = await this.prisma.fileDerivative.updateMany({
      where: {
        attemptCount: { gte: this.maxAttempts },
        OR: [
          { status: 'pending' },
          {
            status: 'processing',
            processingStartedAt: { lte: staleBefore },
          },
        ],
      },
      data: {
        status: 'failed',
        processingStartedAt: null,
        errorMessage: 'Preview retry limit reached',
      },
    });

    if (exhausted.count > 0) {
      this.logger.warn(
        `Marked ${exhausted.count} exhausted preview jobs as failed`,
      );
    }

    const recoverable = await this.prisma.fileDerivative.findMany({
      where: {
        attemptCount: { lt: this.maxAttempts },
        OR: [
          { status: 'pending' },
          {
            status: 'processing',
            processingStartedAt: { lte: staleBefore },
          },
        ],
      },
      select: {
        id: true,
        fileId: true,
        derivativeType: true,
        status: true,
      },
    });

    for (const derivative of recoverable) {
      if (derivative.status === 'processing') {
        const released = await this.prisma.fileDerivative.updateMany({
          where: {
            id: derivative.id,
            status: 'processing',
            processingStartedAt: { lte: staleBefore },
            attemptCount: { lt: this.maxAttempts },
          },
          data: {
            status: 'pending',
            processingStartedAt: null,
            errorMessage: 'Recovered after interrupted processing',
          },
        });

        if (released.count === 0) {
          continue;
        }
      }

      await this.enqueue(
        {
          fileId: derivative.fileId,
          derivativeType: derivative.derivativeType as FileDerivativeType,
        },
      );
    }
  }

  private async recoverStaleDerivative(
    derivative: FileDerivative,
  ): Promise<FileDerivative> {
    if (derivative.status !== 'processing' || !this.isStale(derivative)) {
      return derivative;
    }

    if (derivative.attemptCount >= this.maxAttempts) {
      return this.prisma.fileDerivative.update({
        where: { id: derivative.id },
        data: {
          status: 'failed',
          processingStartedAt: null,
          errorMessage: 'Preview retry limit reached',
        },
      });
    }

    return this.prisma.fileDerivative.update({
      where: { id: derivative.id },
      data: {
        status: 'pending',
        processingStartedAt: null,
        errorMessage: 'Recovered after interrupted processing',
      },
    });
  }

  private isStale(derivative: {
    processingStartedAt: Date | null;
  }): boolean {
    return (
      derivative.processingStartedAt !== null &&
      derivative.processingStartedAt.getTime() <= this.getStaleBefore().getTime()
    );
  }

  private getStaleBefore(): Date {
    return new Date(Date.now() - this.staleThresholdMs);
  }

  private async enqueue(job: PreviewJob): Promise<void> {
    const lockKey = `service-ops:file-preview:queued:${job.fileId}:${job.derivativeType}`;
    // Preserve an existing queued winner. Key reservation and list append are
    // one Redis operation, so a missing reply cannot create an orphan key or
    // invite a second caller to delete a job that was actually accepted.
    await this.redisService.getClient().eval(`
      local queueType = redis.call('TYPE', KEYS[2]).ok
      if queueType ~= 'none' and queueType ~= 'list' then
        return redis.error_reply('File preview queue is not a list')
      end
      if redis.call('SET', KEYS[1], '1', 'NX', 'EX', 600) then
        redis.call('RPUSH', KEYS[2], ARGV[1])
        return 1
      end
      return 0
    `, { keys: [lockKey, this.queueName], arguments: [JSON.stringify(job)] });
  }

  private async runWorkerLoop(): Promise<void> {
    while (!this.stopped && this.workerClient?.isOpen) {
      try {
        const queued = await this.workerClient.blPop(this.queueName, 1);

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

    const processingStartedAt = new Date();
    const claim = await this.prisma.fileDerivative.updateMany({
      where: {
        fileId: job.fileId,
        derivativeType: job.derivativeType,
        status: 'pending',
      },
      data: {
        status: 'processing',
        errorMessage: null,
        processingStartedAt,
        lastAttemptAt: processingStartedAt,
        attemptCount: { increment: 1 },
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
        await this.createImageThumbnail(file, processingStartedAt);
      } else if (job.derivativeType === PDF_PREVIEW_DERIVATIVE) {
        await this.createOfficePdf(file, processingStartedAt);
      }
    } catch (error) {
      await this.prisma.fileDerivative.updateMany({
        where: {
          fileId: job.fileId,
          derivativeType: job.derivativeType,
          status: 'processing',
          processingStartedAt,
        },
        data: {
          status: 'failed',
          processingStartedAt: null,
          errorMessage: this.getErrorMessage(error).slice(0, 1000),
        },
      });
    }
  }

  private async createImageThumbnail(file: PreviewFile, processingStartedAt: Date): Promise<void> {
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
    const objectKey = `derivatives/${file.id}/${randomUUID()}/thumbnail.webp`;
    await this.publishDerivative(file.id, IMAGE_THUMBNAIL_DERIVATIVE, processingStartedAt, objectKey, {
        status: 'ready',
        processingStartedAt: null,
        objectKey,
        mimeType: 'image/webp',
        sizeBytes: result.data.length,
        width: result.info.width,
        height: result.info.height,
        errorMessage: null,
    }, result.data);
  }

  private async createOfficePdf(file: PreviewFile, processingStartedAt: Date): Promise<void> {
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
      const objectKey = `derivatives/${file.id}/${randomUUID()}/preview.pdf`;
      await this.publishDerivative(file.id, PDF_PREVIEW_DERIVATIVE, processingStartedAt, objectKey, {
          status: 'ready',
          processingStartedAt: null,
          objectKey,
          mimeType: 'application/pdf',
          sizeBytes: pdf.length,
          width: null,
          height: null,
          errorMessage: null,
      }, pdf);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }

  private async publishDerivative(
    fileId: string,
    derivativeType: FileDerivativeType,
    processingStartedAt: Date,
    objectKey: string,
    data: Pick<FileDerivative, 'status' | 'processingStartedAt' | 'objectKey' | 'mimeType' | 'sizeBytes' | 'width' | 'height' | 'errorMessage'> & { mimeType: string },
    body: Buffer,
  ): Promise<void> {
    const lockKey = `file-preview-publication:${fileId}:${derivativeType}`;
    try {
      await this.storageService.uploadObject({ objectKey, body, contentType: data.mimeType, contentLength: body.length });
      const published = await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))::text`;
        const update = await tx.fileDerivative.updateMany({
          where: { fileId, derivativeType, status: 'processing', processingStartedAt },
          data,
        });
        return update.count === 1;
      });
      if (published) return;
    } catch (error) {
      await this.discardUnreferencedDerivative(lockKey, objectKey);
      throw error;
    }
    await this.discardUnreferencedDerivative(lockKey, objectKey);
  }

  private async discardUnreferencedDerivative(lockKey: string, objectKey: string): Promise<void> {
    // A unique attempt key cannot overwrite another generation. Reacquire the
    // publication lock before deciding whether an uncertain commit owns it.
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))::text`;
      const referenced = await tx.fileDerivative.findFirst({ where: { objectKey }, select: { id: true } });
      if (!referenced) await this.storageService.deleteObject(objectKey);
    });
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
