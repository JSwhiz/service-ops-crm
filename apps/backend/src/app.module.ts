// import { join } from 'node:path';

// import { Module } from '@nestjs/common';
// import { ConfigModule } from '@nestjs/config';

// import configuration from './config/configuration';
// import { validateEnv } from './config/env.validation';
// import { HealthModule } from './modules/health/health.module';

// @Module({
//   imports: [
//     ConfigModule.forRoot({
//       isGlobal: true,
//       cache: true,
//       envFilePath: [
//         join(__dirname, '../../../.env.backend.local'),
//         join(__dirname, '../../../.env.local'),
//       ],
//       load: [configuration],
//       validate: validateEnv,
//     }),
//     HealthModule,
//   ],
// })
// export class AppModule {}

import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import configuration from './config/configuration';
import { validateEnv } from './config/env.validation';
import { AuthModule } from './modules/auth/auth.module';
import { HealthModule } from './modules/health/health.module';
import { ObjectOperationsModule } from './modules/object-operations/object-operations.module';
import { ObjectsModule } from './modules/objects/objects.module';
import { PrismaModule } from './modules/prisma/prisma.module';
import { TasksModule } from './modules/tasks/tasks.module';
import { UsersAccessModule } from './modules/users-access/users-access.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      envFilePath: ['.env.backend.local', '.env.local'],
      load: [configuration],
      validate: validateEnv,
    }),
    PrismaModule,
    UsersAccessModule,
    AuthModule,
    HealthModule,
    ObjectsModule,
    ObjectOperationsModule,
    TasksModule,
  ],
})
export class AppModule {}
