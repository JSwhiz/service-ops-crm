import { ConflictException, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';

import { ChatsService } from '../chats/chats.service';
import { PrismaService } from '../prisma/prisma.service';
import { moscowDateKey, moscowDayWindow } from '../objects/utils/object-season.util';

/** Durable immutable publications; saving a draft never enters this queue. */
@Injectable()
export class ObjectDailyReportPublicationService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ObjectDailyReportPublicationService.name);
  private timer?: ReturnType<typeof setInterval>;
  private running = false;

  constructor(private readonly prisma: PrismaService, private readonly chats: ChatsService) {}

  onModuleInit() {
    this.timer = setInterval(() => void this.flush().catch((error: unknown) => this.logger.error('Report publication failed', error instanceof Error ? error.stack : undefined)), 15000);
    this.timer.unref();
    void this.flush().catch((error: unknown) => this.logger.error('Report publication startup failed', error instanceof Error ? error.stack : undefined));
  }

  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  async saveDraft(objectId: string, actorUserId: string, content: string, expectedRevision?: number) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "objects" WHERE "id" = ${objectId} FOR UPDATE`;
      const window = moscowDayWindow();
      const current = await tx.objectDailyReport.findFirst({ where: { objectId, reportDate: window }, orderBy: { updatedAt: 'desc' } });
      if (expectedRevision !== undefined && expectedRevision !== (current?.revision ?? 0)) {
        throw new ConflictException('Отчёт изменён. Обновите его перед сохранением.');
      }
      const report = current
        ? await tx.objectDailyReport.update({ where: { id: current.id }, data: { content, updatedByUserId: actorUserId, revision: { increment: 1 } }, include: { updatedBy: true } })
        : await tx.objectDailyReport.create({ data: { objectId, reportDate: window.gte, content, updatedByUserId: actorUserId, revision: 1 }, include: { updatedBy: true } });
      await tx.objectAuditLog.create({ data: { objectId, actorUserId, actionCode: 'daily_report.draft_saved', payload: { reportId: report.id, revision: report.revision } } });
      return report;
    });
  }

  async submit(objectId: string, actorUserId: string, expectedRevision: number) {
    const report = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "objects" WHERE "id" = ${objectId} FOR UPDATE`;
      const current = await tx.objectDailyReport.findFirst({
        where: { objectId, reportDate: moscowDayWindow() }, orderBy: { updatedAt: 'desc' }, include: { updatedBy: true },
      });
      if (!current) throw new NotFoundException('Сначала сохраните черновик отчёта');
      // A retried submission can never publish a newer, unconfirmed draft.
      if (current.submittedRevision >= expectedRevision) return current;
      if (current.revision !== expectedRevision) throw new ConflictException('Отчёт изменён. Проверьте актуальную версию перед отправкой.');
      await tx.objectDailyReportPublication.create({ data: { reportId: current.id, revision: current.revision, actorUserId, content: current.content } });
      const saved = await tx.objectDailyReport.update({ where: { id: current.id }, data: { submittedRevision: current.revision }, include: { updatedBy: true } });
      await tx.objectAuditLog.create({ data: { objectId, actorUserId, actionCode: 'daily_report.submitted', payload: { reportId: saved.id, revision: saved.revision, isUpdate: current.submittedRevision > 0 } } });
      return saved;
    });
    // Queue commit is the submission result. Temporary delivery errors are retried.
    await this.flush().catch((error: unknown) => this.logger.error('Report delivery queued for retry', error instanceof Error ? error.stack : undefined));
    return report;
  }

  async flush(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const publications = await this.prisma.objectDailyReportPublication.findMany({ where: { publishedAt: null }, orderBy: [{ createdAt: 'asc' }, { revision: 'asc' }], take: 100 });
      for (const publication of publications) {
        const report = await this.prisma.objectDailyReport.findUnique({ where: { id: publication.reportId }, include: { object: true } });
        if (!report) continue;
        const original = await this.prisma.objectDailyReportPublication.findFirst({ where: { reportId: report.id }, orderBy: { revision: 'asc' } });
        const isUpdate = original?.revision !== publication.revision;
        const actor = await this.prisma.user.findUnique({ where: { id: publication.actorUserId }, select: { fullName: true } });
        const targetUrl = `/objects/${encodeURIComponent(report.objectId)}#reports`;
        await this.chats.createSystemMessage('objects',
          `${isUpdate ? 'Обновление ежедневного отчёта' : 'Ежедневный отчёт'} · ${report.object.name} · ${moscowDateKey(report.reportDate)}\n${actor?.fullName ?? 'Менеджер'}\n${publication.content}\n${targetUrl}`,
          { objectId: report.objectId, reportId: report.id, revision: publication.revision, isUpdate, targetUrl, originalSystemEventKey: `object-daily-report:${report.id}:${original?.revision ?? publication.revision}`, submittedAt: publication.createdAt.toISOString() },
          publication.actorUserId, `object-daily-report:${report.id}:${publication.revision}`,
        );
        await this.prisma.objectDailyReportPublication.update({ where: { id: publication.id }, data: { publishedAt: new Date() } });
      }
    } finally { this.running = false; }
  }
}
