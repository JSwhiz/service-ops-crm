import { Module } from '@nestjs/common';

import { PrismaModule } from '../prisma/prisma.module';

import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { WebPushOriginGuard } from './push/web-push-origin.guard';
import { WebPushService } from './push/web-push.service';
import { WebPushWorker } from './push/web-push.worker';
import { WebPushController } from './push/web-push.controller';
import { WEB_PUSH_TRANSPORT, WebPushTransport } from './push/web-push.transport';

@Module({
  imports: [PrismaModule],
  controllers: [NotificationsController, WebPushController],
  providers: [WebPushOriginGuard, NotificationsService, WebPushService, WebPushWorker, { provide: WEB_PUSH_TRANSPORT, useClass: WebPushTransport }],
  exports: [NotificationsService],
})
export class NotificationsModule {}
