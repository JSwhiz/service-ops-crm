'use client';

import React, { useEffect, useRef, useState } from 'react';

import type { CorrectDailyReportAttachmentsPayload, ObjectDailyReport } from '@/entities/object/model/object-operations.types';
import { correctDailyReportAttachments, stageDailyReportAttachment, submitTodayDailyReport } from '@/entities/object/api/object-operations-client';
import { ApiError } from '@/shared/api/fetcher';
import styles from '@/features/object-shared-ui/object-surfaces.module.css';
import { Alert, Button, Surface } from '@/shared/ui/foundation';
import { MediaActionPicker } from '@/shared/ui/media-entry/media-action-picker';
import { PendingMediaList } from '@/shared/ui/media-entry/pending-media-list';
import { ObjectReportAttachmentsEditor } from './object-report-attachments-editor';
import { createAttachmentCorrectionDraft } from '../model/attachment-correction-draft';

interface InitialAttachmentMutation {
  payload: CorrectDailyReportAttachmentsPayload;
}

interface ObjectDailyReportPanelProps {
  item: ObjectDailyReport | null;
  onSave: (payload: { content: string }) => Promise<ObjectDailyReport>;
  onAttachmentsUpdated: () => Promise<ObjectDailyReport | null>;
  onEditStateChange?: (state: { dirty: boolean; busy: boolean }) => void;
}

export function ObjectDailyReportPanel({ item, onSave, onAttachmentsUpdated, onEditStateChange }: ObjectDailyReportPanelProps): React.JSX.Element {
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

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (isSubmitting || attachmentEditState.busy || attachmentEditState.dirty) return;
    setIsSubmitting(true);
    setError(null);
    setAttachmentError(null);
    try {
      let saved = report;
      if (!saved || content !== saved.content) {
        saved = await onSave({ content });
        setReport(saved);
      }
      if (pendingFiles.length) {
        if (attachmentNeedsReview) return;
        let mutation = attachmentRetry ?? attachmentDraft.current.getMutation();
        if (!mutation) {
          const addFileIds = await Promise.all(pendingFiles.map((file) => attachmentDraft.current.stageFile(
            file,
            async (requestId) => (await stageDailyReportAttachment(saved!.objectId, saved!.id, file, requestId)).file.id,
          )));
          mutation = { payload: {
            expectedRevision: saved.revision,
            requestId: crypto.randomUUID(),
            removeAttachmentIds: [],
            addFileIds,
          } };
          attachmentDraft.current.setMutation(mutation);
          setAttachmentRetry(mutation);
        }
        await correctDailyReportAttachments(saved.objectId, saved.id, mutation.payload);
        const refreshed = await onAttachmentsUpdated();
        if (!refreshed) throw new Error('Изменения сохранены, но отчёт не удалось перечитать. Обновите данные.');
        setReport(refreshed);
        setPendingFiles([]);
        setAttachmentRetry(null);
        attachmentDraft.current.reset();
      }
    } catch (caughtError) {
      if (caughtError instanceof ApiError && caughtError.statusCode === 409 && pendingFiles.length) {
        attachmentDraft.current.markConflict();
        setAttachmentRetry(null);
        setAttachmentNeedsReview(attachmentDraft.current.needsReview());
        setAttachmentError('Отчёт изменился. Проверьте обновлённые данные перед повторным сохранением вложений.');
        const refreshed = await onAttachmentsUpdated().catch(() => null);
        if (refreshed) setReport(refreshed);
      } else {
        setError(caughtError instanceof Error ? caughtError.message : 'Не удалось сохранить ежедневный отчёт.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const submitFinal = async (): Promise<void> => {
    if (!report || !report.revision || isSubmitting || attachmentEditState.busy || attachmentEditState.dirty) return;
    setIsSubmitting(true);
    setError(null);
    try {
      setReport(await submitTodayDailyReport(report.objectId, report.revision));
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Не удалось отправить отчёт.');
    } finally { setIsSubmitting(false); }
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
      <form className={styles.panelForm} onSubmit={handleSubmit}>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Что сделано за день</span>
          <textarea
            disabled={isSubmitting || attachmentEditState.busy || attachmentEditState.dirty}
            value={content}
            onChange={(event) => { contentRef.current = event.target.value; setContent(event.target.value); }}
            rows={6}
            placeholder="Коротко зафиксируйте результат дня"
          />
        </label>

        {pendingFiles.length > 0 || !report ? <div className={styles.mediaSection}>
          <div className="ui-inline ui-inline--sm">
            <MediaActionPicker compactMenu compactLabel="Добавить вложение к новому отчёту" disabled={isSubmitting || !!attachmentRetry} onPick={async (file) => setPendingFiles((files) => [...files, file])} />
            <span className="ui-text-muted">Фото сохранятся в отчёте только после нажатия «Сохранить черновик».</span>
          </div>
          {pendingFiles.length ? <PendingMediaList files={pendingFiles} onRemove={isSubmitting || attachmentRetry ? undefined : (index) => setPendingFiles((files) => files.filter((_, itemIndex) => itemIndex !== index))} /> : null}
        </div> : report ? <ObjectReportAttachmentsEditor report={report} hasUnsavedText={hasDraftChanges || isSubmitting} onEditStateChange={setAttachmentEditState} onUpdated={async () => { const refreshed = await onAttachmentsUpdated(); if (refreshed) setReport(refreshed); return; }} /> : null}

        {attachmentError ? <Alert tone="danger" role="alert">{attachmentError}</Alert> : null}
        {attachmentNeedsReview ? <div className="ui-inline ui-inline--sm"><Button disabled={isSubmitting} onClick={() => { attachmentDraft.current.acknowledgeReview(); setAttachmentNeedsReview(attachmentDraft.current.needsReview()); }}>Я проверил отчёт — продолжить</Button><Button variant="ghost" disabled={isSubmitting} onClick={() => { setPendingFiles([]); setAttachmentNeedsReview(false); setAttachmentError(null); attachmentDraft.current.reset(); }}>Сбросить выбранные фото</Button></div> : null}
        {attachmentRetry ? <Button type="submit" variant="primary" disabled={isSubmitting || attachmentNeedsReview} pending={isSubmitting}>Повторить сохранение вложений</Button> : null}
        {error ? <div className={styles.error}>{error}</div> : null}

        {!report || hasDraftChanges || needsSubmission || pendingFiles.length > 0 ? <div className={styles.formActions}>
          <Button variant="primary"
            type="submit"
            disabled={isSubmitting || attachmentEditState.busy || attachmentEditState.dirty || attachmentNeedsReview || (!!attachmentRetry && pendingFiles.length === 0) || (!content.trim() && !report && pendingFiles.length === 0)}
          >
            {isSubmitting ? 'Сохраняем…' : 'Сохранить черновик'}
          </Button>
          {needsSubmission ? <Button type="button" disabled={isSubmitting || hasDraftChanges || attachmentEditState.busy || attachmentEditState.dirty} onClick={() => void submitFinal()}>
            {submitted ? 'Отправить обновление отчёта' : 'Окончательно отправить отчёт'}
          </Button> : null}
        </div> : null}
        {hasDraftChanges && report ? <div className="ui-text-muted">Сохраните текст перед окончательной отправкой.</div> : null}
      </form>
    </Surface>
  );
}
