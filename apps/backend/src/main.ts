import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module';
import { configureApp } from './bootstrap';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, {
    cors: false,
  });
  await configureApp(app);

  const port = process.env.BACKEND_PORT ?? '4000';
  await app.listen(Number(port));

  console.log(`Backend is running on http://localhost:${port}/api/v1/health`);
}

void bootstrap();
