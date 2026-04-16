import {
  Injectable,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  CreateBucketCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from '@aws-sdk/client-s3';

@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);
  private readonly bucket: string;
  private readonly publicBaseUrl: string;
  private readonly client: S3Client;

  constructor(private readonly configService: ConfigService) {
    const endpoint = this.configService.get<string>('storage.endpoint');
    const port = this.configService.get<number>('storage.port');
    const useSsl = this.configService.get<boolean>('storage.useSsl');
    const accessKey = this.configService.get<string>('storage.accessKey');
    const secretKey = this.configService.get<string>('storage.secretKey');

    this.bucket =
      this.configService.get<string>('storage.bucket') ?? 'service-ops-files';
    this.publicBaseUrl =
      this.configService.get<string>('storage.publicBaseUrl') ??
      'http://localhost:9000';

    if (!endpoint || !accessKey || !secretKey) {
      throw new Error('Storage configuration is incomplete');
    }

    this.client = new S3Client({
      region: 'us-east-1',
      endpoint: `${useSsl ? 'https' : 'http'}://${endpoint}:${port}`,
      credentials: {
        accessKeyId: accessKey,
        secretAccessKey: secretKey,
      },
      forcePathStyle: true,
    });
  }

  async onModuleInit(): Promise<void> {
    await this.ensureBucket();
  }

  async uploadObject(params: {
    objectKey: string;
    body: Buffer;
    contentType: string;
    contentLength: number;
  }): Promise<{ bucket: string; objectKey: string; url: string }> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: params.objectKey,
        Body: params.body,
        ContentType: params.contentType,
        ContentLength: params.contentLength,
      }),
    );

    return {
      bucket: this.bucket,
      objectKey: params.objectKey,
      url: this.buildObjectUrl(params.objectKey),
    };
  }

  getBucketName(): string {
    return this.bucket;
  }

  buildObjectUrl(objectKey: string): string {
    return `${this.publicBaseUrl.replace(/\/$/, '')}/${this.bucket}/${objectKey}`;
  }

  private async ensureBucket(): Promise<void> {
    try {
      await this.client.send(
        new HeadBucketCommand({
          Bucket: this.bucket,
        }),
      );
      return;
    } catch (error: unknown) {
      if (error instanceof S3ServiceException) {
        if (error.name === 'NotFound' || error.name === 'NoSuchBucket') {
          // The bucket does not exist yet, so we can create it below.
        } else {
          this.logger.warn(
            `HeadBucket failed for ${this.bucket}, trying to create it: ${error.name}`,
          );
        }
      }
    }

    try {
      await this.client.send(
        new CreateBucketCommand({
          Bucket: this.bucket,
        }),
      );
    } catch (error: unknown) {
      if (
        error instanceof S3ServiceException &&
        error.name === 'BucketAlreadyOwnedByYou'
      ) {
        return;
      }

      throw error;
    }
  }
}
