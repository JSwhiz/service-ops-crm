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
import { EmployeesModule } from './modules/employees/employees.module';
import { EquipmentModule } from './modules/equipment/equipment.module';
import { FilesModule } from './modules/files/files.module';
import { HealthModule } from './modules/health/health.module';
import { InventoryModule } from './modules/inventory/inventory.module';
import { ObjectOperationsModule } from './modules/object-operations/object-operations.module';
import { ObjectsModule } from './modules/objects/objects.module';
import { OneTimeOrdersModule } from './modules/one-time-orders/one-time-orders.module';
import { PrismaModule } from './modules/prisma/prisma.module';
import { RedisModule } from './modules/redis/redis.module';
import { StorageModule } from './modules/storage/storage.module';
import { TasksModule } from './modules/tasks/tasks.module';
import { TimesheetsModule } from './modules/timesheets/timesheets.module';
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
    RedisModule,
    StorageModule,
    UsersAccessModule,
    AuthModule,
    EmployeesModule,
    EquipmentModule,
    HealthModule,
    InventoryModule,
    FilesModule,
    ObjectsModule,
    OneTimeOrdersModule,
    ObjectOperationsModule,
    TasksModule,
    TimesheetsModule,
  ],
})
export class AppModule {}
