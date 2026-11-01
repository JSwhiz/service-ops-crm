'use client';

import React, { useEffect, useRef, useState } from 'react';

import { correctDailyReportAttachments, stageDailyReportAttachment } from '@/entities/object/api/object-operations-client';
import type { CorrectDailyReportAttachmentsPayload, ObjectDailyReport } from '@/entities/object/model/object-operations.types';
import { ApiError } from '@/shared/api/fetcher';
import { Alert, Button } from '@/shared/ui/foundation';
import { useConfirm, useReasonPrompt } from '@/shared/ui/overlays/use-dialogs';
import { AttachmentPreviewList } from '@/shared/ui/media-entry/attachment-preview-list';
import { MediaActionPicker } from '@/shared/ui/media-entry/media-action-picker';
import { PendingMediaList } from '@/shared/ui/media-entry/pending-media-list';
import styles from '@/features/object-shared-ui/object-surfaces.module.css';
import { createAttachmentCorrectionDraft, reconcileRemovedAttachmentIds } from '../model/attachment-correction-draft';

interface AttachmentMutation {
  payload: CorrectDailyReportAttachmentsPayload;
}

export function ObjectReportAttachmentsEditor({
  report,
  hasUnsavedText = false,
  onUpdated,
  onEditStateChange,
}: {
  report: ObjectDailyReport;
  hasUnsavedText?: boolean;
  onUpdated: () => Promise<void>;
  onEditStateChange?: (state: { dirty: boolean; busy: boolean }) => void;
}): React.JSX.Element {
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [removedIds, setRemovedIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [retryMutation, setRetryMutation] = useState<AttachmentMutation | null>(null);
  const [needsReview, setNeedsReview] = useState(false);
  const correctionDraft = useRef(createAttachmentCorrectionDraft<AttachmentMutation>());
  const [confirm, confirmDialog] = useConfirm();
  const [askReason, reasonDialog] = useReasonPrompt();
  const sent = report.publicationState === 'submitted';
  const canCorrect = report.capabilities.editAttachments;
  const hasUnsentDraft = report.publicationState === 'draft_after_submission';
  const hasChanges = pendingFiles.length > 0 || removedIds.length > 0;
  const blockedByDraft = hasUnsavedText || hasUnsentDraft || !canCorrect;

  useEffect(() => {
    onEditStateChange?.({ dirty: hasChanges || !!retryMutation || needsReview, busy });
  }, [hasChanges, retryMutation, needsReview, busy, onEditStateChange]);

  useEffect(() => {
    const currentIds = report.attachments.map((attachment) => attachment.attachmentId);
    setRemovedIds((selected) => reconcileRemovedAttachmentIds(selected, currentIds));
  }, [report.attachments]);

  const apply = async (mutation?: AttachmentMutation): Promise<void> => {
    if (busy || blockedByDraft || (needsReview && !mutation)) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      let selectedMutation = mutation;
      if (!selectedMutation) {
        let reason = correctionDraft.current.getReason();
        if (sent && !reason) {
          reason = await askReason({
            title: 'Причина исправления отчёта',
            description: 'Причина сохранится в истории исправлений.',
            reasonLabel: 'Причина',
            confirmLabel: 'Продолжить',
            minLength: 1,
          }) ?? undefined;
          if (!reason) return;
          correctionDraft.current.setReason(reason);
        }
        if (sent) {
          const accepted = await confirm({
            title: 'Исправить отправленный отчёт?',
            consequence: 'Изменение будет записано в историю и опубликовано как обновление отчёта.',
            confirmLabel: 'Исправить отчёт',
            tone: 'danger',
          });
          if (!accepted) return;
        }

        const stagedFileIds = await Promise.all(pendingFiles.map((file) => correctionDraft.current.stageFile(
          file,
          async (requestId) => (await stageDailyReportAttachment(report.objectId, report.id, file, requestId)).file.id,
        )));
        selectedMutation = {
          payload: {
            expectedRevision: report.revision,
            requestId: crypto.randomUUID(),
            removeAttachmentIds: [...removedIds],
            addFileIds: stagedFileIds,
            ...(reason ? { reason } : {}),
          },
        };
        correctionDraft.current.setMutation(selectedMutation);
        setRetryMutation(selectedMutation);
      }

      const response = await correctDailyReportAttachments(report.objectId, report.id, selectedMutation.payload);
      setRetryMutation(null);
      correctionDraft.current.clearMutation();
      correctionDraft.current.reset();
      setPendingFiles([]);
      setRemovedIds([]);
      setResult(response.publication.status === 'queued' ? 'Исправление сохранено. Публикация обновления поставлена в очередь.' : 'Изменения вложений сохранены в черновике.');
      await onUpdated().catch(() => {
        setError('Изменения применены, но отчёт не удалось перечитать. Повторите обновление данных.');
      });
    } catch (caught) {
      if (caught instanceof ApiError && caught.statusCode === 409) {
        setRetryMutation(null);
        correctionDraft.current.markConflict();
        setNeedsReview(correctionDraft.current.needsReview());
        setError('Отчёт изменился или содержит неотправленный текстовый черновик. Обновите отчёт и проверьте вложения перед повторным исправлением.');
        await onUpdated().catch(() => undefined);
      } else {
        setError(caught instanceof Error ? caught.message : 'Не удалось применить изменения вложений.');
      }
    } finally {
      setBusy(false);
    }
  };

  return <div className={styles.mediaSection}>
    {confirmDialog}{reasonDialog}
    <div className="ui-inline ui-inline--sm">
      <MediaActionPicker
        compactMenu
        compactLabel="Добавить вложение к отчёту"
        disabled={busy || !!retryMutation || blockedByDraft}
        onPick={async (file) => setPendingFiles((current) => [...current, file])}
      />
      <span className="ui-text-muted">Выбранные вложения попадут в отчёт после применения изменений.</span>
    </div>
    {pendingFiles.length ? <PendingMediaList files={pendingFiles} onRemove={busy || retryMutation || blockedByDraft ? undefined : (index) => setPendingFiles((files) => files.filter((_, itemIndex) => itemIndex !== index))} /> : null}
    {report.attachments.length ? <AttachmentPreviewList files={report.attachments} emptyText="" compact iconDownload getFileState={(file) => removedIds.includes(report.attachments.find((entry) => entry.id === file.id)?.attachmentId ?? '') ? 'pending-removal' : undefined} getFileActions={(file) => {
        const attachment = report.attachments.find((entry) => entry.id === file.id);
        if (!attachment || !canCorrect) return [];
        const isMarkedForRemoval = removedIds.includes(attachment.attachmentId);
        return [{ key: 'remove', label: isMarkedForRemoval ? 'Отменить удаление' : 'Убрать из отчёта', tone: isMarkedForRemoval ? 'default' : 'danger', disabled: busy || !!retryMutation || blockedByDraft, onSelect: () => setRemovedIds((current) => isMarkedForRemoval ? current.filter((id) => id !== attachment.attachmentId) : [...current, attachment.attachmentId]) }];
      }} /> : null}
    {hasChanges ? <div role="status" className="ui-text-muted">К удалению: {removedIds.length}. К добавлению: {pendingFiles.length}. Изменения ещё не применены.</div> : null}
    {needsReview ? <Alert tone="warning" role="alert">Изменения не применены из-за конфликта. Просмотрите обновлённый отчёт и выберите продолжение вручную.</Alert> : null}
    {!canCorrect ? <Alert tone="warning">Исправление вложений для этого отчёта недоступно.</Alert> : hasUnsavedText ? <Alert tone="warning">Сначала сохраните изменения текста отчёта, затем исправляйте вложения.</Alert> : hasUnsentDraft ? <Alert tone="warning">Сначала окончательно отправьте текстовый черновик, затем исправляйте вложения.</Alert> : null}
    {error ? <Alert tone="danger" role="alert">{error}</Alert> : null}
    {result ? <Alert tone="success" role="status">{result}</Alert> : null}
    {retryMutation ? <Button variant="primary" disabled={busy || blockedByDraft} pending={busy} onClick={() => { const mutation = correctionDraft.current.getMutation(); if (mutation) void apply(mutation); }}>Повторить применение</Button> : hasChanges || needsReview ? <div className="ui-inline ui-inline--sm">
      {hasChanges ? <Button variant="primary" disabled={busy || blockedByDraft || needsReview} pending={busy} onClick={() => void apply()}>{sent ? 'Исправить вложения' : 'Сохранить вложения'}</Button> : null}
      {needsReview ? <Button disabled={busy} onClick={() => { correctionDraft.current.acknowledgeReview(); setNeedsReview(correctionDraft.current.needsReview()); }}>Я проверил отчёт — продолжить</Button> : null}
      <Button variant="ghost" disabled={busy} onClick={() => { setPendingFiles([]); setRemovedIds([]); setNeedsReview(false); setError(null); setResult(null); correctionDraft.current.reset(); }}>Сбросить несохранённые изменения</Button>
    </div> : null}
  </div>;
}
