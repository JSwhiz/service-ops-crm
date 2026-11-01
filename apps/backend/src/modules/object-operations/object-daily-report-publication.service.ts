import { ConflictException, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';

import { ChatsService } from '../chats/chats.service';
import type { CurrentAuthUser } from '../chats/types/chat.types';
import { FilesService } from '../files/files.service';
import { PrismaService } from '../prisma/prisma.service';
import { moscowDateKey, moscowDayWindow } from '../objects/utils/object-season.util';
import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { CorrectDailyReportAttachmentsDto } from './dto/correct-daily-report-attachments.dto';

interface DailyReportDeliveryPayload {
  roomCode: 'objects';
  text: string;
  metadata: Record<string, unknown>;
  actorUserId: string;
  systemEventKey: string;
}

/** Durable immutable publications; saving a draft never enters this queue. */
@Injectable()
export class ObjectDailyReportPublicationService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ObjectDailyReportPublicationService.name);
  private timer?: ReturnType<typeof setInterval>;
  private running = false;

  constructor(private readonly prisma: PrismaService, private readonly chats: ChatsService, private readonly files: FilesService) {}

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
      const attachments = await tx.fileAttachment.findMany({ where: { entityType: 'object_daily_report', entityId: current.id }, include: { file: { select: { id: true, originalName: true } } }, orderBy: { createdAt: 'asc' } });
      await tx.objectDailyReportPublication.create({ data: { reportId: current.id, revision: current.revision, actorUserId, content: current.content, attachmentSnapshot: attachments.map((entry) => ({ fileId: entry.file.id, originalName: entry.file.originalName })) } });
      const saved = await tx.objectDailyReport.update({ where: { id: current.id }, data: { submittedRevision: current.revision }, include: { updatedBy: true } });
      await tx.objectAuditLog.create({ data: { objectId, actorUserId, actionCode: 'daily_report.submitted', payload: { reportId: saved.id, revision: saved.revision, isUpdate: current.submittedRevision > 0 } } });
      return saved;
    });
    // Queue commit is the submission result. Temporary delivery errors are retried.
    await this.flush().catch((error: unknown) => this.logger.error('Report delivery queued for retry', error instanceof Error ? error.stack : undefined));
    return report;
  }

  async correctAttachments(objectId: string, reportId: string, actor: CurrentAuthUser, payload: CorrectDailyReportAttachmentsDto) {
    const removeIds = [...payload.removeAttachmentIds].sort();
    const addIds = [...payload.addFileIds].sort();
    if (new Set(removeIds).size !== removeIds.length || new Set(addIds).size !== addIds.length) throw new ConflictException('Duplicate attachment IDs are not allowed');
    const reason = payload.reason?.trim() || null;
    const normalized = { expectedRevision: payload.expectedRevision, removeAttachmentIds: removeIds, addFileIds: addIds, reason };
    const payloadHash = createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
    const saved = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "objects" WHERE "id" = ${objectId} FOR UPDATE`;
      await tx.$queryRaw`SELECT "id" FROM "object_daily_reports" WHERE "id" = ${reportId} FOR UPDATE`;
      await tx.$queryRaw`SELECT "id" FROM "object_assignments" WHERE "objectId" = ${objectId} FOR SHARE`;
      await this.files.assertDailyReportWritable(actor, reportId);
      const report = await tx.objectDailyReport.findFirst({ where: { id: reportId, objectId }, include: { object: { select: { status: true, deletedAt: true } } } });
      if (!report) throw new NotFoundException('Daily report not found');
      if (report.object.deletedAt || ['frozen', 'archived'].includes(report.object.status)) throw new ConflictException('Frozen or archived objects cannot be edited');
      const prior = await tx.objectDailyReportAttachmentRequest.findUnique({ where: { reportId_actorUserId_requestId: { reportId, actorUserId: actor.id, requestId: payload.requestId } } });
      if (prior) {
        if (prior.payloadHash !== payloadHash) throw new ConflictException('requestId already used with a different payload');
        return prior.response as object;
      }
      if (report.revision !== payload.expectedRevision) throw new ConflictException('Отчёт изменён. Обновите его перед исправлением.');
      const submitted = report.submittedRevision > 0;
      if (submitted && report.revision !== report.submittedRevision) throw new ConflictException('Сначала отправьте текстовый черновик отчёта.');
      if (submitted && !reason) throw new ConflictException('Для исправления отправленного отчёта укажите причину');
      if (removeIds.length === 0 && addIds.length === 0) throw new ConflictException('Укажите вложения для изменения');
      const oldAttachments = await tx.fileAttachment.findMany({ where: { entityType: 'object_daily_report', entityId: reportId }, include: { file: { select: { id: true, originalName: true } } } });
      const remove = oldAttachments.filter((entry) => removeIds.includes(entry.id));
      if (remove.length !== removeIds.length) throw new ConflictException('Attachment does not belong to this report');
      const staged = addIds.length ? await tx.objectDailyReportAttachmentStage.findMany({
        where: { fileId: { in: addIds }, reportId, objectId, actorUserId: actor.id }, include: { file: { select: { id: true, originalName: true, mimeType: true, deletedAt: true } } },
      }) : [];
      if (staged.length !== addIds.length || staged.some((entry) => entry.consumedAt || entry.file.deletedAt)) throw new ConflictException('File is not a ready staged attachment for this report');
      const currentIds = new Set(oldAttachments.filter((entry) => !removeIds.includes(entry.id)).map((entry) => entry.fileId));
      for (const fileId of addIds) { if (currentIds.has(fileId)) throw new ConflictException('File is already attached to this report'); currentIds.add(fileId); }
      for (const entry of remove) await tx.fileAttachment.delete({ where: { id: entry.id } });
      const newAttachments = [];
      for (const entry of staged) {
        const attachment = await tx.fileAttachment.create({ data: { fileId: entry.fileId, entityType: 'object_daily_report', entityId: reportId, uploadedByUserId: actor.id } });
        newAttachments.push({ id: attachment.id, fileId: entry.file.id, originalName: entry.file.originalName });
        await tx.objectDailyReportAttachmentStage.update({ where: { id: entry.id }, data: { consumedAt: new Date() } });
      }
      const resulting = await tx.fileAttachment.findMany({ where: { entityType: 'object_daily_report', entityId: reportId }, include: { file: { select: { id: true, originalName: true } } }, orderBy: { createdAt: 'asc' } });
      const revision = report.revision + 1;
      const updated = await tx.objectDailyReport.update({ where: { id: reportId }, data: { revision, ...(submitted ? { submittedRevision: revision } : {}), updatedByUserId: actor.id } });
      const diff = { removed: remove.map((entry) => ({ attachmentId: entry.id, fileId: entry.file.id, originalName: entry.file.originalName })), added: newAttachments };
      await tx.objectAuditLog.create({ data: { objectId, actorUserId: actor.id, actionCode: 'daily_report.attachments_corrected', payload: { reportId, requestId: payload.requestId, revision, reason, diff } } });
      if (submitted) await tx.objectDailyReportPublication.create({ data: { reportId, revision, actorUserId: actor.id, content: report.content, correctionReason: reason, attachmentDiff: diff, attachmentSnapshot: resulting.map((entry) => ({ fileId: entry.file.id, originalName: entry.file.originalName })) } });
      const response = { reportId, revision: updated.revision, submittedRevision: submitted ? revision : report.submittedRevision, attachments: resulting.map((entry) => ({ attachmentId: entry.id, id: entry.file.id, originalName: entry.file.originalName })), correction: { reason, actor: { id: actor.id, fullName: actor.fullName }, createdAt: new Date().toISOString() }, publication: { status: submitted ? 'queued' : 'not_required' } };
      await tx.objectDailyReportAttachmentRequest.create({ data: { reportId, actorUserId: actor.id, requestId: payload.requestId, payloadHash, response } });
      return response;
    });
    if ((saved as { publication?: { status?: string } }).publication?.status === 'queued') {
      await this.flush().catch((error: unknown) => this.logger.error('Report correction queued for retry', error instanceof Error ? error.stack : undefined));
    }
    return saved;
  }

  async flush(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const publications = await this.prisma.objectDailyReportPublication.findMany({ where: { publishedAt: null }, orderBy: [{ createdAt: 'asc' }, { revision: 'asc' }], take: 100 });
      for (const publication of publications) {
        const delivery = await this.freezeDeliveryPayload(publication.id);
        if (!delivery) continue;
        await this.chats.createSystemMessage(delivery.roomCode, delivery.text, delivery.metadata, delivery.actorUserId, delivery.systemEventKey);
        await this.prisma.objectDailyReportPublication.update({ where: { id: publication.id }, data: { publishedAt: new Date() } });
      }
    } finally { this.running = false; }
  }

  private async freezeDeliveryPayload(publicationId: string): Promise<DailyReportDeliveryPayload | null> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "object_daily_report_publications" WHERE "id" = ${publicationId} FOR UPDATE`;
      const publication = await tx.objectDailyReportPublication.findUnique({ where: { id: publicationId } });
      if (!publication || publication.publishedAt) return null;
      if (publication.deliveryPayload) return publication.deliveryPayload as unknown as DailyReportDeliveryPayload;

      const systemEventKey = `object-daily-report:${publication.reportId}:${publication.revision}`;
      const alreadyInserted = await tx.chatMessage.findUnique({ where: { systemEventKey } });
      let delivery: DailyReportDeliveryPayload;
      if (alreadyInserted) {
        // Legacy outbox rows may have inserted their message before deliveryPayload existed.
        // Their own event-key message is the authoritative source; never rebuild from mutable names.
        delivery = {
          roomCode: 'objects',
          text: alreadyInserted.text ?? '',
          metadata: (alreadyInserted.metadata && typeof alreadyInserted.metadata === 'object' && !Array.isArray(alreadyInserted.metadata)
            ? alreadyInserted.metadata
            : {}) as Record<string, unknown>,
          actorUserId: publication.actorUserId,
          systemEventKey,
        };
      } else {
        const report = await tx.objectDailyReport.findUnique({ where: { id: publication.reportId }, include: { object: true } });
        if (!report) return null;
        const original = await tx.objectDailyReportPublication.findFirst({ where: { reportId: report.id }, orderBy: { revision: 'asc' } });
        const actor = await tx.user.findUnique({ where: { id: publication.actorUserId }, select: { fullName: true } });
        const reportDate = moscowDateKey(report.reportDate);
        const targetUrl = `/objects/${encodeURIComponent(report.objectId)}?reportDate=${encodeURIComponent(reportDate)}&reportId=${encodeURIComponent(report.id)}#reports`;
        const correction = publication.correctionReason ? `\nИсправление вложений: ${publication.correctionReason}` : '';
        const attachmentSnapshot = publication.attachmentSnapshot as Array<{ fileId: string; originalName: string }> | null;
        const attachmentDiff = publication.attachmentDiff as { removed: Array<{ attachmentId: string; fileId: string; originalName: string }>; added: Array<{ id: string; fileId: string; originalName: string }> } | null;
        const isUpdate = original?.revision !== publication.revision;
        delivery = {
          roomCode: 'objects',
          text: `${publication.correctionReason ? 'Исправление фото ежедневного отчёта' : isUpdate ? 'Обновление ежедневного отчёта' : 'Ежедневный отчёт'} · ${report.object.name} · ${reportDate}\n${actor?.fullName ?? 'Менеджер'}${correction}\n${publication.content}`,
          metadata: { objectId: report.objectId, reportId: report.id, reportDate, revision: publication.revision, isUpdate, targetUrl, originalSystemEventKey: `object-daily-report:${report.id}:${original?.revision ?? publication.revision}`, submittedAt: publication.createdAt.toISOString(), correctionReason: publication.correctionReason, attachmentSnapshot, attachmentDiff },
          actorUserId: publication.actorUserId,
          systemEventKey,
        };
      }
      await tx.objectDailyReportPublication.update({
        where: { id: publication.id },
        data: { deliveryPayload: delivery as unknown as Prisma.InputJsonValue },
      });
      return delivery;
    });
  }
}
