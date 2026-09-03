import { INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { ResponseTimeInterceptor } from './common/interceptors/response-time.interceptor';
import { PrismaService } from './modules/prisma/prisma.service';

const BUSINESS_TIME_ZONE = 'Europe/Moscow';

export async function configureApp(app: INestApplication): Promise<void> {
  // Operational dates in Service Ops CRM are Moscow business dates. Keep the
  // Node process timezone aligned so legacy date-only helpers and the newer
  // explicit Intl-based dashboard calculations resolve the same calendar day.
  process.env.TZ = BUSINESS_TIME_ZONE;

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
