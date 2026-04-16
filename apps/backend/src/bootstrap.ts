import { INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { ResponseTimeInterceptor } from './common/interceptors/response-time.interceptor';
import { PrismaService } from './modules/prisma/prisma.service';

export async function configureApp(app: INestApplication): Promise<void> {
  const configService = app.get(ConfigService);

  app.setGlobalPrefix('api');
  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: '1',
  });
  app.enableCors({
    origin: configService.get<string>('app.baseUrl'),
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  app.useGlobalFilters(new HttpExceptionFilter());
  app.useGlobalInterceptors(new ResponseTimeInterceptor());

  await app.get(PrismaService).enableShutdownHooks(app);
}
