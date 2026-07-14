'use client';

import React, { useState } from 'react';

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

export function TaskResultPanel({
  taskId,
  requirement,
  canComplete,
  canUndo,
  onChanged,
}: {
  taskId: string;
  requirement: TaskCompletionRequirement;
  canComplete: boolean;
  canUndo: boolean;
  onChanged: () => Promise<void>;
}): React.JSX.Element | null {
  const [text, setText] = useState('');
  const [draftId, setDraftId] = useState<string | null>(null);
  const [files, setFiles] = useState<AttachedFile[]>([]);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lacksRequiredResult =
    (requirement === 'comment_or_file' && !text.trim() && files.length === 0) ||
    (requirement === 'comment_required' && !text.trim()) ||
    (requirement === 'file_required' && files.length === 0);

  if (!canComplete && !canUndo) return null;

  const ensureDraft = async (): Promise<string> => {
    if (draftId) return draftId;
    const draft = await createTaskCompletionDraft(taskId);
    setDraftId(draft.id);
    return draft.id;
  };

  const submit = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setIsBusy(true);
    setError(null);
    try {
      await completeTaskAssignment(taskId, {
        ...(draftId ? { completionId: draftId } : {}),
        ...(text.trim() ? { completionText: text.trim() } : {}),
      });
      setText('');
      setDraftId(null);
      setFiles([]);
      await onChanged();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось отправить результат.');
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <div className="page-card task-completion-panel">
      <div className="section-header">
        <div>
          <div className="section-title">Моё выполнение</div>
          <div className="section-subtitle">{getCompletionRequirementLabel(requirement)}</div>
        </div>
        {canUndo ? (
          <button
            type="button"
            disabled={isBusy}
            onClick={() => {
              if (!window.confirm('Отменить отметку выполнения? Задача вернётся в работу, если ожидала подтверждения или автозавершения.')) return;
              setIsBusy(true);
              void undoTaskCompletion(taskId).then(onChanged).catch(() => setError('Не удалось отменить выполнение.')).finally(() => setIsBusy(false));
            }}
          >
            Отменить выполнение
          </button>
        ) : null}
      </div>
      {canComplete ? (
        <form onSubmit={(event) => void submit(event)}>
          <label className="task-field">
            <span>Комментарий</span>
            <textarea
              rows={4}
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder="Кратко опишите результат"
              required={requirement === 'comment_required'}
            />
          </label>
          <MediaActionPicker
            disabled={isBusy}
            onPick={async (file) => {
              setError(null);
              try {
                const completionId = await ensureDraft();
                const uploaded = await uploadFileToEntity({
                  entityType: 'task_assignee_completion',
                  entityId: completionId,
                  file,
                });
                setFiles((current) => [...current, uploaded]);
              } catch {
                setError('Не удалось прикрепить файл.');
              }
            }}
          />
          {files.length > 0 ? <AttachmentPreviewList files={files} /> : null}
          {error ? <div className="task-form__error" role="alert">{error}</div> : null}
          <button type="submit" disabled={isBusy || lacksRequiredResult}>
            {isBusy ? 'Отправляем…' : 'Отметить выполненной'}
          </button>
        </form>
      ) : error ? <div className="task-form__error" role="alert">{error}</div> : null}
    </div>
  );
}
