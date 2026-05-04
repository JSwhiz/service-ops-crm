import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module';
import { configureApp } from './bootstrap';
import { ChatRealtimeService } from './modules/chats/chat-realtime.service';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, {
    cors: false,
  });
  await configureApp(app);

  const port = process.env.BACKEND_PORT ?? '4000';
  await app.listen(Number(port));
  app.get(ChatRealtimeService).attachToServer(app.getHttpServer());

  console.log(`Backend is running on http://localhost:${port}/api/v1/health`);
}

void bootstrap();
