'use client';

import React, { useContext, useEffect, useRef, useState } from 'react';
import { AccessSnapshotBoundary, AccessSnapshotBlockedContext } from '@/shared/auth/access-snapshot-boundary';
import { getAccessGeneration, isAccessGenerationCurrent } from '@/shared/auth/access-generation';

import { correctDailyReportAttachments, stageDailyReportAttachment } from '@/entities/object/api/object-operations-client';
import type { CorrectDailyReportAttachmentsPayload, ObjectDailyReport } from '@/entities/object/model/object-operations.types';
import { isSavedWithoutAccess } from '@/shared/api/saved-without-access';
import { ObjectWriteAcknowledgedWithoutAccess } from '@/features/object-shared-ui/object-write-fence';
import { getAccessSessionGeneration } from '@/shared/auth/access-generation';
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
  accessCurrent = true,
  onUpdated,
  onSavedWithoutAccess,
  onEditStateChange,
}: {
  report: ObjectDailyReport;
  hasUnsavedText?: boolean;
  accessCurrent?: boolean;
  onUpdated: () => Promise<boolean | void>;
  onSavedWithoutAccess?: () => void;
  onEditStateChange?: (state: { dirty: boolean; busy: boolean }) => void;
}): React.JSX.Element {
  const [acknowledged, setAcknowledged] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [removedIds, setRemovedIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [retryMutation, setRetryMutation] = useState<AttachmentMutation | null>(null);
  const [needsReview, setNeedsReview] = useState(false);
  const [abandonedDialog, setAbandonedDialog] = useState(false);
  const [applyContext, setApplyContext] = useState<{ generation: number; objectId: string; id: string; revision: number } | null>(null);
  const correctionDraft = useRef(createAttachmentCorrectionDraft<AttachmentMutation>());
  const [confirm, confirmDialog] = useConfirm();
  const [askReason, reasonDialog] = useReasonPrompt();
  const sent = report.publicationState === 'submitted';
  const ancestorBlocked = useContext(AccessSnapshotBlockedContext);
  const canCorrect = accessCurrent && report.capabilities.editAttachments && !ancestorBlocked;
  const hasUnsentDraft = report.publicationState === 'draft_after_submission';
  const hasChanges = pendingFiles.length > 0 || removedIds.length > 0;
  const blockedByDraft = acknowledged || hasUnsavedText || hasUnsentDraft || !canCorrect;
  const current = useRef({ report, blockedByDraft, onUpdated });
  current.current = { report, blockedByDraft, onUpdated };
  const mounted = useRef(true);
  const applying = useRef(false);
  const activeApply = useRef<{ allowed: () => boolean; cancel: () => void } | null>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; activeApply.current?.cancel(); }; }, []);
  // Suspension intentionally leaves the shared overlay promise unresolved.
  // End only our logical operation; keep that overlay and the private queue.
  useEffect(() => { if (activeApply.current && !activeApply.current.allowed()) activeApply.current.cancel(); });

  useEffect(() => {
    onEditStateChange?.({ dirty: hasChanges || !!retryMutation || needsReview, busy });
  }, [hasChanges, retryMutation, needsReview, busy, onEditStateChange]);

  useEffect(() => {
    const currentIds = report.attachments.map((attachment) => attachment.attachmentId);
    setRemovedIds((selected) => reconcileRemovedAttachmentIds(selected, currentIds));
  }, [report.attachments]);

  const apply = async (mutation?: AttachmentMutation): Promise<void> => {
    const generation = getAccessGeneration();
    const session = getAccessSessionGeneration();
    const target = { objectId: report.objectId, id: report.id, revision: report.revision };
    const sameTarget = () => mounted.current && getAccessSessionGeneration() === session && current.current.report.objectId === target.objectId && current.current.report.id === target.id;
    const acknowledge = () => { if (sameTarget()) { setAcknowledged(true); setResult('Запись подтверждена без доступных подробностей. Очередь сохранена; повтор не отправлялся.'); onSavedWithoutAccess?.(); } };
    let invalidated = false;
    let cancelWait!: () => void;
    const cancelled = new Promise<null>(resolve => { cancelWait = () => {
      if (invalidated) return;
      invalidated = true;
      setAbandonedDialog(true);
      resolve(null);
    }; });
    const allowed = () => !invalidated && mounted.current && isAccessGenerationCurrent(generation) && !current.current.blockedByDraft &&
      current.current.report.objectId === target.objectId && current.current.report.id === target.id && current.current.report.revision === target.revision;
    if (applying.current || busy || !allowed() || (needsReview && !mutation)) return;
    applying.current = true;
    const operation = { allowed, cancel: cancelWait };
    activeApply.current = operation;
    setAbandonedDialog(false);
    setApplyContext({ generation, ...target });
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      let selectedMutation = mutation;
      if (!selectedMutation) {
        let reason = correctionDraft.current.getReason();
        if (sent && !reason) {
          // A new ask replaces the suspended hook request. Seed it from the
          // still-mounted ReasonDialog's private field, not an approved reason:
          // the user must explicitly confirm/validate this text again.
          const privateReason = React.isValidElement<{ reason?: string }>(reasonDialog) ? reasonDialog.props.reason : undefined;
          reason = await Promise.race([askReason({
            title: 'Причина исправления отчёта',
            description: 'Причина сохранится в истории исправлений.',
            reasonLabel: 'Причина',
            confirmLabel: 'Продолжить',
            minLength: 1,
            initialValue: privateReason,
          }), cancelled]) ?? undefined;
          if (!reason) return;
          correctionDraft.current.setReason(reason);
          if (!allowed()) return;
        }
        if (sent) {
          const accepted = await Promise.race([confirm({
            title: 'Исправить отправленный отчёт?',
            consequence: 'Изменение будет записано в историю и опубликовано как обновление отчёта.',
            confirmLabel: 'Исправить отчёт',
            tone: 'danger',
          }), cancelled]);
          if (!accepted || !allowed()) return;
        }

        const stagedFileIds: string[] = [];
        for (const file of pendingFiles) {
          if (!allowed()) return;
          const fileId = await correctionDraft.current.stageFile(file, async (requestId) => {
            if (!allowed()) throw new Error('Исправление вложений сейчас недоступно. Выбранные файлы сохранены.');
            const staged = await stageDailyReportAttachment(target.objectId, target.id, file, requestId);
            if (isSavedWithoutAccess(staged) || !allowed()) throw new ObjectWriteAcknowledgedWithoutAccess();
            return staged.file.id;
          });
          // stageFile retains an acknowledged ID even if access changed during
          // upload. Stop here; only an explicit later action may continue.
          if (!allowed()) return;
          stagedFileIds.push(fileId);
        }
        selectedMutation = {
          payload: {
            expectedRevision: target.revision,
            requestId: crypto.randomUUID(),
            removeAttachmentIds: [...removedIds],
            addFileIds: stagedFileIds,
            ...(reason ? { reason } : {}),
          },
        };
        correctionDraft.current.setMutation(selectedMutation);
        setRetryMutation(selectedMutation);
      }

      if (!allowed()) return;
      const response = await correctDailyReportAttachments(target.objectId, target.id, selectedMutation.payload);
      if (isSavedWithoutAccess(response) || !allowed()) { acknowledge(); return; }
      // Keep the private queue until the authorized reread has completed.
      const refreshed = await current.current.onUpdated().catch(() => false);
      if (!sameTarget()) return;
      if (!isAccessGenerationCurrent(generation) || refreshed === false) { acknowledge(); return; }
      setRetryMutation(null);
      correctionDraft.current.clearMutation();
      correctionDraft.current.reset();
      setPendingFiles([]);
      setRemovedIds([]);
      setResult(response.publication.status === 'queued' ? 'Исправление сохранено. Публикация обновления поставлена в очередь.' : 'Изменения вложений сохранены в черновике.');
    } catch (caught) {
      if (caught instanceof ObjectWriteAcknowledgedWithoutAccess) { acknowledge(); return; }
      if (!allowed()) return;
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
      if (activeApply.current === operation) {
        activeApply.current = null;
        applying.current = false;
        if (sameTarget()) setBusy(false);
      }
    }
  };

  return <div className={styles.mediaSection}>
    {acknowledged ? <Alert tone="warning" role="status">Запись подтверждена. Выбранные файлы и изменения сохранены для проверки.
      <Button onClick={async () => {
        const generation = getAccessGeneration();
        const session = getAccessSessionGeneration();
        const target = current.current.report;
        const refreshed = await current.current.onUpdated().catch(() => false);
        if (refreshed && mounted.current && getAccessSessionGeneration() === session && isAccessGenerationCurrent(generation) && current.current.report.objectId === target.objectId && current.current.report.id === target.id) setAcknowledged(false);
      }}>Проверить отчёт — продолжить вручную</Button>
    </Alert> : null}
    <AccessSnapshotBoundary blocked={abandonedDialog || blockedByDraft || (!!applyContext && (!isAccessGenerationCurrent(applyContext.generation) || report.objectId !== applyContext.objectId || report.id !== applyContext.id || report.revision !== applyContext.revision))}>{confirmDialog}{reasonDialog}</AccessSnapshotBoundary>
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
