import { join } from 'node:path';

import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import configuration from './config/configuration';
import { validateEnv } from './config/env.validation';
import { HealthModule } from './modules/health/health.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      envFilePath: [
        join(__dirname, '../../../.env.backend.local'),
        join(__dirname, '../../../.env.local'),
      ],
      load: [configuration],
      validate: validateEnv,
    }),
    HealthModule,
  ],
})
export class AppModule {}
