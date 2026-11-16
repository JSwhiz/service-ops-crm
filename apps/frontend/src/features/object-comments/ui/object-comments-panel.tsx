'use client';

import React, { useContext, useEffect, useRef, useState } from 'react';

import type { AttachedFile } from '@/entities/file/model/file.types';
import { createCommentAttachmentDraft, type CommentAttachmentDraft } from '../model/comment-attachment-draft';
import type { ObjectComment } from '@/entities/object/model/object-operations.types';
import styles from '@/features/object-shared-ui/object-surfaces.module.css';
import { getUserDisplayName } from '@/shared/lib/display-name';
import { AttachmentPreviewList } from '@/shared/ui/media-entry/attachment-preview-list';
import { MediaActionPicker } from '@/shared/ui/media-entry/media-action-picker';
import { PendingMediaList } from '@/shared/ui/media-entry/pending-media-list';
import { Button, Surface } from '@/shared/ui/foundation';
import { AccessSnapshotBlockedContext } from '@/shared/auth/access-snapshot-boundary';
import { isSavedWithoutAccess, type SavedWithoutAccess } from '@/shared/api/saved-without-access';
import { captureObjectWriteFence } from '@/features/object-shared-ui/object-write-fence';


interface ObjectCommentsPanelProps {
  objectId: string;
  items: ObjectComment[];
  canCreate: boolean;
  onCreate: (payload: { content: string; commentType?: string }) => Promise<ObjectComment | SavedWithoutAccess>;
  onUpload: (commentId: string, file: File) => Promise<AttachedFile | SavedWithoutAccess>;
  onRefresh: () => Promise<boolean>;
}

export function ObjectCommentsPanel({ objectId, items, canCreate, onCreate, onUpload, onRefresh }: ObjectCommentsPanelProps): React.JSX.Element {
  const surfaceMounted = useRef(true);
  const currentObjectId = useRef(objectId);
  currentObjectId.current = objectId;
  useEffect(() => { surfaceMounted.current = true; return () => { surfaceMounted.current = false; }; }, []);
  const [acknowledged, setAcknowledged] = useState(false);
  const draft = useRef<CommentAttachmentDraft | null>(null);
  const [progress, setProgress] = useState<{ completed: number; remaining: number; knownId: boolean } | null>(null);
  const currentItems = useRef(items); currentItems.current = items;
  const blocked = useContext(AccessSnapshotBlockedContext);
  const writable = canCreate && !blocked;
  const currentWritable = useRef(writable);
  currentWritable.current = writable;
  const [content, setContent] = useState('');
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fenceForTarget = () => {
    const targetId = objectId;
    return captureObjectWriteFence(() => surfaceMounted.current && currentObjectId.current === targetId);
  };
  const publishProgress = (currentDraft: CommentAttachmentDraft): void => {
    setProgress({ completed: currentDraft.completedCount(), remaining: currentDraft.remaining().length, knownId: !!currentDraft.getCommentId() });
  };
  const finishAttachments = async (currentDraft: CommentAttachmentDraft, fence: ReturnType<typeof fenceForTarget>): Promise<void> => {
    const id = currentDraft.getCommentId();
    if (!id) return;
    for (const file of currentDraft.remaining()) {
      if (!fence.current() || !currentWritable.current) { if (fence.sameTarget()) setAcknowledged(true); return; }
      const uploaded = await onUpload(id, file);
      if (!fence.sameTarget()) return;
      if (isSavedWithoutAccess(uploaded)) { setAcknowledged(true); return; }
      // Retain a positively acknowledged file even when the render generation changed.
      currentDraft.complete(file, uploaded.id);
      publishProgress(currentDraft);
      if (!fence.current() || !currentWritable.current) { setAcknowledged(true); return; }
    }
    const refreshed = await onRefresh();
    if (!fence.sameTarget()) return;
    if (!fence.current() || !currentWritable.current || !refreshed) { setAcknowledged(true); return; }
    // Only the complete authorized success path clears this draft.
    draft.current = null; setProgress(null); setAcknowledged(false); setContent(''); setPendingFiles([]);
  };
  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (draft.current || acknowledged || isSubmitting || !currentWritable.current) return;
    const fence = fenceForTarget();
    const currentDraft = createCommentAttachmentDraft(pendingFiles);
    draft.current = currentDraft;
    setIsSubmitting(true); setError(null);
    try {
      const created = await onCreate({ content });
      if (!fence.sameTarget()) return;
      if (isSavedWithoutAccess(created)) { publishProgress(currentDraft); setAcknowledged(true); return; }
      if (created.objectId !== objectId) throw new Error('Ответ относится к другому объекту.');
      currentDraft.bindComment(created.id); publishProgress(currentDraft);
      if (!fence.current() || !currentWritable.current) { setAcknowledged(true); return; }
      await finishAttachments(currentDraft, fence);
    } catch {
      if (!fence.sameTarget()) return;
      publishProgress(currentDraft);
      setError(currentDraft.getCommentId()
        ? 'Комментарий сохранён. Остались незавершённые вложения; повторите только их отдельной командой.'
        : 'Результат создания не подтверждён. Проверьте список и явно выберите сохранённый комментарий; повторное создание не отправляется.');
    } finally { if (fence.sameTarget()) setIsSubmitting(false); }
  };
  const retryRemaining = async (): Promise<void> => {
    const currentDraft = draft.current;
    if (!currentDraft?.getCommentId() || isSubmitting || !currentWritable.current) return;
    const fence = fenceForTarget(); setIsSubmitting(true); setError(null);
    try { await finishAttachments(currentDraft, fence); }
    catch { if (fence.sameTarget()) setError('Оставшиеся вложения не завершены. Сохранённый комментарий и прогресс оставлены для ручного повтора.'); }
    finally { if (fence.sameTarget()) { if (draft.current === currentDraft) publishProgress(currentDraft); setIsSubmitting(false); } }
  };

  return (
    <Surface padding="md" className={`${styles.workPanel}`}>
      <div className={styles.panelHeader}>
        <div className="ui-section-title">Комментарии</div>
        <span className={styles.panelMeta}>{items.length}</span>
      </div>

      {!writable ? <div className={styles.emptyState} role="status">Добавление комментария недоступно. Введённый текст и выбранные файлы сохранены.</div> : null}
      {acknowledged || progress ? <div className={styles.emptyState} role="status">
        {progress?.knownId ? `Комментарий сохранён. Вложений подтверждено: ${progress.completed}; осталось: ${progress.remaining}.` : 'ID записи неизвестен. Проверьте список и явно выберите сохранённый комментарий для вложений.'}
        {progress?.knownId ? <Button type="button" disabled={isSubmitting || !writable} onClick={() => void retryRemaining()}>{progress.remaining ? 'Повторить оставшиеся вложения' : 'Проверить сохранённый комментарий'}</Button> : null}
      </div> : null}
      <form className={styles.panelForm} onSubmit={handleSubmit}>
        <div className={styles.field}>
          <textarea
            aria-label="Комментарий к объекту"
            disabled={!!progress || acknowledged || isSubmitting || !writable}
            value={content}
            onChange={(event) => setContent(event.target.value)}
            rows={3}
            placeholder="Что важно зафиксировать по объекту"
          />
        </div>

        <div className={styles.mediaSection}>
          <MediaActionPicker
            iconOnly
            disabled={!!progress || acknowledged || isSubmitting || !writable}
            onPick={async (file) => { if (currentWritable.current && !draft.current) setPendingFiles((prev) => [...prev, file]); }}
          />
          {pendingFiles.length > 0 ? (
            <div className={styles.pendingFilesViewport}>
              <PendingMediaList
                files={pendingFiles}
                onRemove={progress || isSubmitting ? undefined : (index) => setPendingFiles((prev) => prev.filter((_, itemIndex) => itemIndex !== index))}
                emptyText=""
              />
            </div>
          ) : null}
        </div>

        {error ? <div className={styles.error}>{error}</div> : null}

        <div className={styles.formActions}>
          <Button variant="primary"
            type="submit"
            disabled={!!progress || acknowledged || isSubmitting || !writable || (!content.trim() && pendingFiles.length === 0)}
          >
            {isSubmitting ? 'Сохраняем…' : 'Добавить'}
          </Button>
        </div>
      </form>

      {items.length === 0 ? (
        <div className={styles.emptyState}>Комментариев пока нет.</div>
      ) : (
        <div className="record-list local-scroll">
          {items.map((item) => (
            <Surface padding="sm" key={item.id}>
              <div className={styles.panelMeta}>{getUserDisplayName(item.createdBy)}</div>
              {item.content ? <div>{item.content}</div> : null}
              {progress && !progress.knownId ? <Button type="button" disabled={isSubmitting || !writable} onClick={() => {
                const currentDraft = draft.current;
                if (!currentDraft || !currentWritable.current || !currentItems.current.some(row => row.id === item.id && row.objectId === objectId)) return;
                currentDraft.bindComment(item.id); publishProgress(currentDraft); setAcknowledged(false);
              }}>Прикрепить оставшиеся к этому комментарию</Button> : null}
              {item.attachments.length > 0 ? (
                <AttachmentPreviewList files={item.attachments} />
              ) : null}
            </Surface>
          ))}
        </div>
      )}
    </Surface>
  );
}
