'use client';

import React, { useContext, useEffect, useRef, useState } from 'react';

import type { CorrectDailyReportAttachmentsPayload, ObjectDailyReport } from '@/entities/object/model/object-operations.types';
import { correctDailyReportAttachments, stageDailyReportAttachment, submitTodayDailyReport } from '@/entities/object/api/object-operations-client';
import { isSavedWithoutAccess, type SavedWithoutAccess } from '@/shared/api/saved-without-access';
import { captureObjectWriteFence, ObjectWriteAcknowledgedWithoutAccess } from '@/features/object-shared-ui/object-write-fence';
import { ApiError } from '@/shared/api/fetcher';
import styles from '@/features/object-shared-ui/object-surfaces.module.css';
import { Alert, Button, Surface } from '@/shared/ui/foundation';
import { AccessSnapshotBlockedContext } from '@/shared/auth/access-snapshot-boundary';

import { MediaActionPicker } from '@/shared/ui/media-entry/media-action-picker';
import { PendingMediaList } from '@/shared/ui/media-entry/pending-media-list';
import { ObjectReportAttachmentsEditor } from './object-report-attachments-editor';
import { createAttachmentCorrectionDraft } from '../model/attachment-correction-draft';

interface InitialAttachmentMutation {
  payload: CorrectDailyReportAttachmentsPayload;
}

interface ObjectDailyReportPanelProps {
  objectId: string;
  item: ObjectDailyReport | null;
  canSave: boolean;
  canSubmit: boolean;
  onSave: (payload: { content: string }) => Promise<ObjectDailyReport | SavedWithoutAccess>;
  onSavedWithoutAccess: () => void;
  onAttachmentsUpdated: () => Promise<ObjectDailyReport | null>;
  onEditStateChange?: (state: { dirty: boolean; busy: boolean }) => void;
}

export function ObjectDailyReportPanel({ objectId, item, canSave, canSubmit, onSave, onSavedWithoutAccess, onAttachmentsUpdated, onEditStateChange }: ObjectDailyReportPanelProps): React.JSX.Element {
  const surfaceMounted = useRef(true);
  const currentObjectId = useRef(objectId);
  currentObjectId.current = objectId;
  useEffect(() => { surfaceMounted.current = true; return () => { surfaceMounted.current = false; }; }, []);
  const [acknowledged, setAcknowledged] = useState(false);
  const blocked = useContext(AccessSnapshotBlockedContext);
  const currentAccess = useRef({ blocked, canSave, canSubmit });
  currentAccess.current = { blocked, canSave, canSubmit };
  const [content, setContent] = useState(item?.content ?? '');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<ObjectDailyReport | null>(item);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [attachmentRetry, setAttachmentRetry] = useState<InitialAttachmentMutation | null>(null);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [attachmentNeedsReview, setAttachmentNeedsReview] = useState(false);
  const [attachmentEditState, setAttachmentEditState] = useState({ dirty: false, busy: false });
  const attachmentDraft = useRef(createAttachmentCorrectionDraft<InitialAttachmentMutation>());
  const contentRef = useRef(content);
  const persistedContentRef = useRef(item?.content ?? '');
  const hasDraftChanges = content !== (report?.content ?? '');

  useEffect(() => {
    onEditStateChange?.({ dirty: hasDraftChanges || pendingFiles.length > 0 || attachmentEditState.dirty, busy: isSubmitting || attachmentEditState.busy });
  }, [hasDraftChanges, pendingFiles.length, attachmentEditState.dirty, attachmentEditState.busy, isSubmitting, onEditStateChange]);

  useEffect(() => {
    setReport(item);
    const hasLocalTextChanges = contentRef.current !== persistedContentRef.current;
    persistedContentRef.current = item?.content ?? '';
    if (!hasLocalTextChanges) {
      const nextContent = item?.content ?? '';
      contentRef.current = nextContent;
      setContent(nextContent);
    }
  }, [item]);

  const acknowledge = (fence: ReturnType<typeof captureObjectWriteFence>): void => {
    if (!fence.sameTarget()) return;
    setAcknowledged(true);
    onSavedWithoutAccess();
  };
  const operationFence = () => {
    const targetId = objectId;
    return captureObjectWriteFence(() => surfaceMounted.current && currentObjectId.current === targetId);
  };
  const refreshReport = async (): Promise<boolean> => {
    const fence = operationFence();
    if (!fence.current() || currentAccess.current.blocked) return false;
    const fresh = await onAttachmentsUpdated();
    if (!fence.current() || currentAccess.current.blocked || !fresh || fresh.objectId !== objectId) return false;
    setReport(fresh);
    return true;
  };
  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (acknowledged || isSubmitting || attachmentEditState.busy || attachmentEditState.dirty) return;
    const fence = operationFence();
    const current = () => fence.current() && !currentAccess.current.blocked;
    const access = currentAccess.current;
    if (!current() || (!access.canSave && !(pendingFiles.length > 0 && report?.capabilities.editAttachments && !hasDraftChanges)) || ((!report || content !== report.content) && !access.canSave)) {
      setError('Право сохранения отчёта недоступно. Черновик сохранён.'); return;
    }
    let knownCommit = false;
    setIsSubmitting(true); setError(null); setAttachmentError(null);
    try {
      let saved = report;
      if (!saved || content !== saved.content) {
        const result = await onSave({ content });
        knownCommit = true;
        if (isSavedWithoutAccess(result) || !current() || result.objectId !== objectId) { acknowledge(fence); return; }
        saved = result;
        setReport(saved);
      }
      if (!current()) { if (knownCommit) acknowledge(fence); return; }
      if (pendingFiles.length) {
        if (!saved?.capabilities.editAttachments) { setError('Текст сохранён, но изменение вложений недоступно. Выбранные файлы сохранены в черновике.'); return; }
        if (attachmentNeedsReview) return;
        const targetReport = saved;
        let mutation = attachmentRetry ?? attachmentDraft.current.getMutation();
        if (!mutation) {
          const addFileIds: string[] = [];
          for (const file of pendingFiles) {
            if (!current()) { if (knownCommit) acknowledge(fence); return; }
            const fileId = await attachmentDraft.current.stageFile(file, async (requestId) => {
              if (!current()) throw new Error('Доступ изменился. Выбранные файлы сохранены.');
              const staged = await stageDailyReportAttachment(targetReport.objectId, targetReport.id, file, requestId);
              if (isSavedWithoutAccess(staged) || !current()) throw new ObjectWriteAcknowledgedWithoutAccess();
              return staged.file.id;
            });
            knownCommit = true;
            if (!current()) { acknowledge(fence); return; }
            addFileIds.push(fileId);
          }
          mutation = { payload: { expectedRevision: saved.revision, requestId: crypto.randomUUID(), removeAttachmentIds: [], addFileIds } };
          attachmentDraft.current.setMutation(mutation); setAttachmentRetry(mutation);
        }
        if (!current()) { if (knownCommit) acknowledge(fence); return; }
        const result = await correctDailyReportAttachments(saved.objectId, saved.id, mutation.payload);
        knownCommit = true;
        if (isSavedWithoutAccess(result) || !current()) { acknowledge(fence); return; }
        const refreshed = await onAttachmentsUpdated();
        if (!current() || !refreshed || refreshed.objectId !== objectId) { acknowledge(fence); return; }
        setReport(refreshed); setPendingFiles([]); setAttachmentRetry(null); attachmentDraft.current.reset();
      }
    } catch (caughtError) {
      if (!fence.sameTarget()) return;
      if (caughtError instanceof ObjectWriteAcknowledgedWithoutAccess || (knownCommit && !current())) { acknowledge(fence); return; }
      if (!current()) return;
      if (caughtError instanceof ApiError && caughtError.statusCode === 409 && pendingFiles.length) {
        attachmentDraft.current.markConflict(); setAttachmentRetry(null); setAttachmentNeedsReview(attachmentDraft.current.needsReview());
        setAttachmentError('Отчёт изменился. Проверьте обновлённые данные перед повторным сохранением вложений.');
        const refreshed = await onAttachmentsUpdated().catch(() => null);
        if (!current()) return;
        if (refreshed && refreshed.objectId === objectId) setReport(refreshed);
      } else if (knownCommit) { acknowledge(fence); }
      else {
        setError(caughtError instanceof ApiError && [403, 404].includes(caughtError.statusCode)
          ? 'Право сохранения отчёта недоступно. Черновик и файлы сохранены.'
          : caughtError instanceof Error ? caughtError.message : 'Не удалось сохранить ежедневный отчёт.');
      }
    } finally { if (fence.sameTarget()) setIsSubmitting(false); }
  };
  const submitFinal = async (): Promise<void> => {
    if (acknowledged || currentAccess.current.blocked || !currentAccess.current.canSubmit || !report?.revision || isSubmitting || attachmentEditState.busy || attachmentEditState.dirty) return;
    const fence = operationFence();
    const targetId = report.id;
    setIsSubmitting(true); setError(null);
    try {
      const result = await submitTodayDailyReport(objectId, report.revision);
      if (isSavedWithoutAccess(result) || !fence.current() || currentAccess.current.blocked || result.objectId !== objectId || result.id !== targetId) { acknowledge(fence); return; }
      setReport(result);
    } catch (caughtError) {
      if (!fence.current()) return;
      setError(caughtError instanceof ApiError && [403, 404].includes(caughtError.statusCode)
        ? 'Отправка отчёта недоступна текущим правам. Черновик сохранён.'
        : caughtError instanceof Error ? caughtError.message : 'Не удалось отправить отчёт.');
    } finally { if (fence.sameTarget()) setIsSubmitting(false); }
  };
  const submitted = !!report && report.publicationState !== 'draft';
  const needsSubmission = !!report && report.publicationState !== 'submitted';

  return (
    <Surface padding="md" className={`${styles.workPanel}`}>
      <div className={styles.panelHeader}>
        <div className="ui-section-title">Ежедневный отчёт</div>
        <span className={styles.panelState} data-ready={report ? 'true' : 'false'}>
          {submitted ? needsSubmission ? 'Есть черновик изменений' : 'Отправлен' : report ? 'Черновик' : 'Не заполнен'}
        </span>
      </div>

      {report ? <div className="ui-text-muted">{report.updatedBy.fullName} · {new Date(report.updatedAt).toLocaleString('ru-RU')}</div> : null}
      {!canSave ? <Alert tone="warning" role="status">Изменение текста отчёта недоступно. Черновик сохранён.</Alert> : null}
      {!canSubmit ? <Alert tone="warning" role="status">Окончательная отправка отчёта недоступна текущим правам.</Alert> : null}
      {acknowledged ? <Alert tone="warning" role="status">Запись подтверждена. Текст и файлы оставлены для проверки; автоматического повтора нет.
        <Button type="button" onClick={async () => { if (await refreshReport().catch(() => false)) setAcknowledged(false); }}>Проверить отчёт — продолжить вручную</Button>
      </Alert> : null}
      <form className={styles.panelForm} onSubmit={handleSubmit}>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Что сделано за день</span>
          <textarea
            disabled={acknowledged || blocked || !canSave || isSubmitting || attachmentEditState.busy || attachmentEditState.dirty}
            value={content}
            onChange={(event) => { contentRef.current = event.target.value; setContent(event.target.value); }}
            rows={6}
            placeholder="Коротко зафиксируйте результат дня"
          />
        </label>

        {pendingFiles.length > 0 || !report ? <div className={styles.mediaSection}>
          <div className="ui-inline ui-inline--sm">
            <MediaActionPicker compactMenu compactLabel="Добавить вложение к новому отчёту" disabled={acknowledged || blocked || !canSave || isSubmitting || !!attachmentRetry} onPick={async (file) => { if (!currentAccess.current.blocked && currentAccess.current.canSave) setPendingFiles((files) => [...files, file]); }} />
            <span className="ui-text-muted">Фото сохранятся в отчёте только после нажатия «Сохранить черновик».</span>
          </div>
          {pendingFiles.length ? <PendingMediaList files={pendingFiles} onRemove={isSubmitting || attachmentRetry ? undefined : (index) => setPendingFiles((files) => files.filter((_, itemIndex) => itemIndex !== index))} /> : null}
        </div> : report ? <ObjectReportAttachmentsEditor report={report} accessCurrent={item?.id === report.id && item.objectId === report.objectId && item.revision === report.revision && item.capabilities.editAttachments} hasUnsavedText={hasDraftChanges || isSubmitting} onEditStateChange={setAttachmentEditState} onUpdated={refreshReport} onSavedWithoutAccess={() => acknowledge(operationFence())} /> : null}

        {attachmentError ? <Alert tone="danger" role="alert">{attachmentError}</Alert> : null}
        {attachmentNeedsReview ? <div className="ui-inline ui-inline--sm"><Button disabled={isSubmitting} onClick={() => { attachmentDraft.current.acknowledgeReview(); setAttachmentNeedsReview(attachmentDraft.current.needsReview()); }}>Я проверил отчёт — продолжить</Button><Button variant="ghost" disabled={isSubmitting} onClick={() => { setPendingFiles([]); setAttachmentNeedsReview(false); setAttachmentError(null); attachmentDraft.current.reset(); }}>Сбросить выбранные фото</Button></div> : null}
        {attachmentRetry ? <Button type="submit" variant="primary" disabled={acknowledged || blocked || !report?.capabilities.editAttachments || hasDraftChanges && !canSave || isSubmitting || attachmentNeedsReview} pending={isSubmitting}>Повторить сохранение вложений</Button> : null}
        {error ? <div className={styles.error}>{error}</div> : null}

        {!report || hasDraftChanges || needsSubmission || pendingFiles.length > 0 ? <div className={styles.formActions}>
          <Button variant="primary"
            type="submit"
            disabled={acknowledged || blocked || (!canSave && !(pendingFiles.length > 0 && report?.capabilities.editAttachments && !hasDraftChanges)) || isSubmitting || attachmentEditState.busy || attachmentEditState.dirty || attachmentNeedsReview || (!!attachmentRetry && pendingFiles.length === 0) || (!content.trim() && !report && pendingFiles.length === 0)}
          >
            {isSubmitting ? 'Сохраняем…' : 'Сохранить черновик'}
          </Button>
          {needsSubmission ? <Button type="button" disabled={acknowledged || blocked || !canSubmit || isSubmitting || hasDraftChanges || attachmentEditState.busy || attachmentEditState.dirty} onClick={() => void submitFinal()}>
            {submitted ? 'Отправить обновление отчёта' : 'Окончательно отправить отчёт'}
          </Button> : null}
        </div> : null}
        {hasDraftChanges && report ? <div className="ui-text-muted">Сохраните текст перед окончательной отправкой.</div> : null}
      </form>
    </Surface>
  );
}
