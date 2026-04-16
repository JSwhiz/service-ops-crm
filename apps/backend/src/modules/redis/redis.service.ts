import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, type RedisClientType } from 'redis';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client: RedisClientType | null = null;

  constructor(private readonly configService: ConfigService) {}

  async onModuleInit(): Promise<void> {
    const url = this.configService.get<string>('redis.url');

    if (!url) {
      throw new Error('Redis URL is not configured');
    }

    this.client = createClient({ url });
    this.client.on('error', (error: unknown) => {
      const message =
        error instanceof Error ? error.message : 'Unknown Redis error';

      this.logger.error(`Redis client error: ${message}`);
    });

    await this.client.connect();
    await this.client.ping();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.client?.isOpen) {
      await this.client.quit();
    }
  }

  getClient(): RedisClientType {
    if (!this.client) {
      throw new Error('Redis client is not initialized');
    }

    return this.client;
  }

  async ping(): Promise<string> {
    return this.getClient().ping();
  }
}
