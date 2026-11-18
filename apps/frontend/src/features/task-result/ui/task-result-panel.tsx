'use client';

import React, { useEffect, useRef, useState } from 'react';

import {
  createTaskCompletionDraft,
  completeTaskAssignment,
  undoTaskCompletion,
} from '@/entities/task/api/task-client';
import type { AttachedFile } from '@/entities/file/model/file.types';
import { uploadFileToEntity } from '@/entities/file/api/file-client';
import type { TaskCompletionRequirement } from '@/entities/task/model/task.types';
import { getCompletionRequirementLabel } from '@/shared/lib/task-presentation';
import { AttachmentPreviewList } from '@/shared/ui/media-entry/attachment-preview-list';
import { MediaActionPicker } from '@/shared/ui/media-entry/media-action-picker';
import { Alert, Button, Field, Surface } from '@/shared/ui/foundation';
import { useConfirm } from '@/shared/ui/overlays';
import { AccessSnapshotBoundary } from '@/shared/auth/access-snapshot-boundary';
import { getAccessGeneration, isAccessGenerationCurrent } from '@/shared/auth/access-generation';
import taskStyles from '@/entities/task/ui/task-ui.module.css';

export function TaskResultPanel({
  taskId,
  actorId,
  onSavedWithoutAccess,
  requirement,
  canComplete,
  canCreateCompletionDraft = false,
  canUploadFiles = false,
  canUndo,
  onChanged,
}: {
  taskId: string;
  actorId?: string;
  onSavedWithoutAccess?: () => void;
  requirement: TaskCompletionRequirement;
  canComplete: boolean;
  canCreateCompletionDraft?: boolean;
  canUploadFiles?: boolean;
  canUndo: boolean;
  onChanged: () => Promise<void>;
}): React.JSX.Element | null {
  const [text, setText] = useState('');
  const [savedWithoutAccess, setSavedWithoutAccess] = useState<string | null>(null);
  const currentContext = useRef({ taskId, actorId, canComplete });
  currentContext.current = { taskId, actorId, canComplete };
  const pendingRef = useRef(false);
  const [confirm, confirmDialog] = useConfirm();
  const [draftId, setDraftId] = useState<string | null>(null);
  const draftRef = useRef<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [files, setFiles] = useState<AttachedFile[]>([]);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canAttachFiles = canComplete && canCreateCompletionDraft && canUploadFiles;
  const attachmentPermissionRef = useRef(canAttachFiles);
  attachmentPermissionRef.current = canAttachFiles;
  const undoContextRef = useRef({ canUndo, taskId });
  undoContextRef.current = { canUndo, taskId };
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const lacksRequiredResult =
    (requirement === 'comment_or_file' && !text.trim() && files.length === 0) ||
    (requirement === 'comment_required' && !text.trim()) ||
    (requirement === 'file_required' && files.length === 0);

  const concealPanel = !canComplete && !canUndo && !draftId && files.length === 0 && !text && !isUploading && !error;

  const closeOnSaved = (): void => {
    if (!mounted.current || currentContext.current.taskId !== taskId || currentContext.current.actorId !== actorId) return;
    setText(''); setDraftId(null); draftRef.current = null; setFiles([]); setError(null);
    setSavedWithoutAccess(`${actorId ?? ''}:${taskId}`);
    onSavedWithoutAccess?.();
  };
  const isMinimalReceipt = (result: object | undefined): boolean => Boolean(result && 'outcome' in result && result.outcome === 'saved_without_access');
  const ensureDraft = async (): Promise<string | null> => {
    if (!mounted.current || !attachmentPermissionRef.current) throw new Error('Прикрепление файлов к результату сейчас недоступно.');
    if (draftRef.current) return draftRef.current;
    const generation = getAccessGeneration();
    const draft = await createTaskCompletionDraft(taskId);
    if (isMinimalReceipt(draft) || !isAccessGenerationCurrent(generation) || !attachmentPermissionRef.current) { closeOnSaved(); return null; }
    if ('outcome' in draft) return null;
    if (!mounted.current || currentContext.current.taskId !== taskId || currentContext.current.actorId !== actorId) return null;
    draftRef.current = draft.id;
    setDraftId(draft.id);
    return draft.id;
  };

  const submit = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (!canComplete || pendingRef.current || isBusy || isUploading || lacksRequiredResult) return;
    pendingRef.current = true;
    const generation = getAccessGeneration();
    setIsBusy(true);
    setError(null);
    try {
      const result = await completeTaskAssignment(taskId, {
        ...(draftId ? { completionId: draftId } : {}),
        ...(text.trim() ? { completionText: text.trim() } : {}),
      });
      if (isMinimalReceipt(result) || !isAccessGenerationCurrent(generation) || !currentContext.current.canComplete) { closeOnSaved(); return; }
      if (!mounted.current || currentContext.current.taskId !== taskId || currentContext.current.actorId !== actorId) return;
      setText('');
      setDraftId(null);
      draftRef.current = null;
      setFiles([]);
      await onChanged();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось отправить результат.');
    } finally {
      pendingRef.current = false;
      if (mounted.current && currentContext.current.taskId === taskId && currentContext.current.actorId === actorId) setIsBusy(false);
    }
  };

  if (savedWithoutAccess === `${actorId ?? ''}:${taskId}`) return <Alert tone="success">Выполнение сохранено. Доступ к карточке изменился. Повторная отправка не запускается.</Alert>;

  return (
    <AccessSnapshotBoundary blocked={concealPanel}>
    <Surface as="section" padding="md" className={taskStyles.taskCompletionPanel}>
      {confirmDialog}
      <div className="ui-section-header">
        <div>
          <h2 className="ui-section-title">Моё выполнение</h2>
          <div className="ui-section-subtitle">{getCompletionRequirementLabel(requirement)}</div>
        </div>
        {canUndo ? (
          <Button
            disabled={isBusy}
            onClick={async () => {
              const generation = getAccessGeneration();
              if (!mounted.current || !undoContextRef.current.canUndo || undoContextRef.current.taskId !== taskId) return;
              if (!(await confirm({
                title: 'Отменить отметку выполнения?',
                consequence: 'Задача вернётся в работу, если ожидала подтверждения или автозавершения.',
                confirmLabel: 'Отменить выполнение',
              }))) return;
              if (!mounted.current || !undoContextRef.current.canUndo || undoContextRef.current.taskId !== taskId || !isAccessGenerationCurrent(generation)) {
                if (mounted.current && currentContext.current.taskId === taskId && currentContext.current.actorId === actorId) {
                  setError('Право отмены выполнения изменилось. Результат сохранён; откройте действие заново.');
                }
                return;
              }
              if (pendingRef.current) return;
              pendingRef.current = true;
              setIsBusy(true);
              try {
                const result = await undoTaskCompletion(taskId);
                if (isMinimalReceipt(result) || !isAccessGenerationCurrent(generation)) { closeOnSaved(); return; }
                if (mounted.current && currentContext.current.taskId === taskId && currentContext.current.actorId === actorId) await onChanged();
              } catch {
                if (mounted.current && currentContext.current.taskId === taskId && currentContext.current.actorId === actorId) setError('Не удалось отменить выполнение.');
              } finally {
                pendingRef.current = false;
                if (mounted.current && currentContext.current.taskId === taskId && currentContext.current.actorId === actorId) setIsBusy(false);
              }
            }}
          >
            Отменить выполнение
          </Button>
        ) : null}
      </div>
        <AccessSnapshotBoundary blocked={!canComplete}>
        <form onSubmit={(event) => void submit(event)}>
          <Field label="Комментарий к результату" required={requirement === 'comment_required'}>
            <textarea
              rows={4}
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder="Кратко опишите результат"
              required={requirement === 'comment_required'}
            />
          </Field>
          <AccessSnapshotBoundary blocked={!canAttachFiles}>
          <MediaActionPicker
            disabled={isBusy || !canAttachFiles}
            onBusyChange={setIsUploading}
            onPick={async (file) => {
              setError(null);
              try {
                const generation = getAccessGeneration();
                const completionId = await ensureDraft();
                if (!completionId) return;
                if (!mounted.current || !attachmentPermissionRef.current) throw new Error('Право прикрепления файлов изменилось. Черновик сохранён.');
                const uploaded = await uploadFileToEntity({
                  entityType: 'task_assignee_completion',
                  entityId: completionId,
                  file,
                });
                if (!mounted.current || !isAccessGenerationCurrent(generation) || currentContext.current.taskId !== taskId || currentContext.current.actorId !== actorId) return;
                setFiles((current) => current.some((entry) => entry.id === uploaded.id) ? current : [...current, uploaded]);
              } catch (caught) {
                setError('Не удалось прикрепить файл.');
                throw caught;
              }
            }}
          />
          </AccessSnapshotBoundary>
          {!canAttachFiles ? <Alert tone="info">Прикрепление новых файлов недоступно. Отправить результат можно без новых вложений, если выполнены требования задачи.</Alert> : null}
          {error ? <Alert tone="danger">{error}</Alert> : null}
          <Button variant="primary" type="submit" disabled={isBusy || isUploading || lacksRequiredResult}>
            {isBusy ? 'Отправляем…' : 'Отметить выполненной'}
          </Button>
        </form>
        </AccessSnapshotBoundary>
      {!canComplete && error ? <Alert tone="danger">{error}</Alert> : null}
      {files.length > 0 ? <AttachmentPreviewList files={files} /> : null}
      {!canAttachFiles && (draftId || files.length > 0 || text) ? <Alert tone="info">Личный черновик и прикреплённые файлы сохранены. Новая загрузка не запускается автоматически.</Alert> : null}
    </Surface>
    </AccessSnapshotBoundary>
  );
}
