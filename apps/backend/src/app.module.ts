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
import { AccountabilityModule } from './modules/accountability/accountability.module';
import { ApprovalsModule } from './modules/approvals/approvals.module';
import { AuthModule } from './modules/auth/auth.module';
import { ChatsModule } from './modules/chats/chats.module';
import { CandidatesModule } from './modules/candidates/candidates.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { EmployeesModule } from './modules/employees/employees.module';
import { EquipmentModule } from './modules/equipment/equipment.module';
import { FilesModule } from './modules/files/files.module';
import { HealthModule } from './modules/health/health.module';
import { InventoryModule } from './modules/inventory/inventory.module';
import { ObjectOperationsModule } from './modules/object-operations/object-operations.module';
import { ObjectsModule } from './modules/objects/objects.module';
import { OneTimeOrdersModule } from './modules/one-time-orders/one-time-orders.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { PrismaModule } from './modules/prisma/prisma.module';
import { RedisModule } from './modules/redis/redis.module';
import { StorageModule } from './modules/storage/storage.module';
import { TasksModule } from './modules/tasks/tasks.module';
import { TimesheetsModule } from './modules/timesheets/timesheets.module';
import { UserAbsencesModule } from './modules/user-absences/user-absences.module';
import { UsersAccessModule } from './modules/users-access/users-access.module';

const backendEnvFilePath = process.env.APP_ENV_FILE ?? '.env.backend.local';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      envFilePath: [backendEnvFilePath, '.env.local'],
      load: [configuration],
      validate: validateEnv,
    }),
    PrismaModule,
    RedisModule,
    StorageModule,
    UsersAccessModule,
    UserAbsencesModule,
    AccountabilityModule,
    ApprovalsModule,
    AuthModule,
    ChatsModule,
    CandidatesModule,
    DashboardModule,
    EmployeesModule,
    EquipmentModule,
    HealthModule,
    InventoryModule,
    FilesModule,
    ObjectsModule,
    OneTimeOrdersModule,
    NotificationsModule,
    ObjectOperationsModule,
    TasksModule,
    TimesheetsModule,
  ],
})
export class AppModule {}
