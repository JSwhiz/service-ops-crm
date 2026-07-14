'use client';

import React, { useEffect, useState } from 'react';

import { listFilesByEntity } from '@/entities/file/api/file-client';
import type { AttachedFile } from '@/entities/file/model/file.types';
import { listObjects } from '@/entities/object/api/object-client';
import type { ServiceObject } from '@/entities/object/model/object.types';
import { listOneTimeOrders } from '@/entities/one-time-order/api/one-time-order-client';
import type { OneTimeOrderItem } from '@/entities/one-time-order/model/one-time-order.types';
import {
  addTaskAssignees,
  cancelTask,
  completeTaskNow,
  confirmTask,
  getTaskById,
  listTaskHistory,
  removeTaskAssignee,
  reopenTask,
  returnTaskToWork,
  updateTask,
} from '@/entities/task/api/task-client';
import type {
  CreateTaskPayload,
  TaskHistoryEvent,
  TaskItem,
  UpdateTaskPayload,
} from '@/entities/task/model/task.types';
import { listSystemUsers } from '@/entities/user/api/user-client';
import type { SystemUserOption } from '@/entities/user/model/user.types';
import { TaskSummaryCard } from '@/features/task-card/ui/task-summary-card';
import {
  TaskForm,
  type TaskFormInitialValue,
} from '@/features/task-form/ui/task-form';
import { TaskResultPanel } from '@/features/task-result/ui/task-result-panel';
import { getUserDisplayName } from '@/shared/lib/display-name';
import { formatTaskHistoryEvent } from '@/shared/lib/task-presentation';
import { AttachmentPreviewList } from '@/shared/ui/media-entry/attachment-preview-list';
import { PageTitle } from '@/shared/ui/page-title/page-title';

export default function TaskDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): React.JSX.Element {
  const [taskId, setTaskId] = useState('');
  const [item, setItem] = useState<TaskItem | null>(null);
  const [history, setHistory] = useState<TaskHistoryEvent[]>([]);
  const [filesByCompletion, setFilesByCompletion] = useState<Record<string, AttachedFile[]>>({});
  const [objects, setObjects] = useState<ServiceObject[]>([]);
  const [orders, setOrders] = useState<OneTimeOrderItem[]>([]);
  const [candidateUsers, setCandidateUsers] = useState<SystemUserOption[]>([]);
  const [visibilityUsers, setVisibilityUsers] = useState<SystemUserOption[]>([]);
  const [isEditing, setIsEditing] = useState(false);
  const [newAssigneeId, setNewAssigneeId] = useState('');
  const [autoCloseSeconds, setAutoCloseSeconds] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isActionBusy, setIsActionBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadTask = async (id: string): Promise<void> => {
    const next = await getTaskById(id);
    setItem(next);
    setAutoCloseSeconds(next.autoCloseRemainingSeconds);

    const [nextHistory, completionFiles] = await Promise.all([
      next.capabilities.canViewHistory ? listTaskHistory(id).catch(() => []) : Promise.resolve([]),
      Promise.all(
        next.assignees
          .filter((assignee) => assignee.currentCompletion)
          .map(async (assignee) => {
            const completionId = assignee.currentCompletion!.id;
            const files = await listFilesByEntity('task_assignee_completion', completionId).catch(() => []);
            return [completionId, files] as const;
          }),
      ),
    ]);
    setHistory(nextHistory);
    setFilesByCompletion(Object.fromEntries(completionFiles));
  };

  useEffect(() => {
    void params.then(({ id }) => {
      setTaskId(id);
      return loadTask(id);
    }).catch(() => setError('Не удалось загрузить карточку задачи.')).finally(() => setIsLoading(false));
  }, [params]);

  useEffect(() => {
    if (!item?.autoCloseAt || item.status !== 'pending_auto_close') return;
    const timer = window.setInterval(() => {
      setAutoCloseSeconds((current) => {
        if (current === null) return null;
        const next = Math.max(0, current - 1);
        if (next === 0) {
          window.clearInterval(timer);
          window.setTimeout(() => void loadTask(item.id), 800);
        }
        return next;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [item?.autoCloseAt, item?.id, item?.status]);

  const loadCandidates = async (objectId: string, oneTimeOrderId: string): Promise<void> => {
    const target = {
      ...(objectId ? { objectId } : {}),
      ...(oneTimeOrderId ? { oneTimeOrderId } : {}),
    };
    const [nextUsers, nextVisibilityUsers] = await Promise.all([
      listSystemUsers({ purpose: 'task_assignee', ...target }),
      listSystemUsers({ purpose: 'task_visibility', ...target }),
    ]);
    setCandidateUsers(nextUsers);
    setVisibilityUsers(nextVisibilityUsers);
  };

  const openEditor = async (): Promise<void> => {
    if (!item) return;
    setIsActionBusy(true);
    setError(null);
    try {
      const [nextObjects, nextOrders] = await Promise.all([listObjects(), listOneTimeOrders()]);
      setObjects(nextObjects);
      setOrders(nextOrders);
      await loadCandidates(item.objectId ?? '', item.oneTimeOrderId ?? '');
      setIsEditing(true);
    } catch {
      setError('Не удалось подготовить форму редактирования.');
    } finally {
      setIsActionBusy(false);
    }
  };

  const runAction = async (action: () => Promise<TaskItem>): Promise<void> => {
    setIsActionBusy(true);
    setError(null);
    try {
      await action();
      await loadTask(taskId);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось выполнить действие.');
    } finally {
      setIsActionBusy(false);
    }
  };

  const askReason = (label: string): string | null => {
    const reason = window.prompt(label)?.trim() ?? '';
    return reason.length >= 3 ? reason : null;
  };

  if (isLoading) return <div className="page-card">Загрузка…</div>;
  if (!item) return <div className="page-card task-error">{error ?? 'Задача не найдена.'}</div>;

  const activeAssignees = item.assignees.filter((assignee) => assignee.isActive);

  return (
    <div className="page-stack">
      <div className="task-page-heading">
        <PageTitle title="Карточка задачи" />
        <div className="action-row">
          {item.capabilities.canEdit ? <button type="button" disabled={isActionBusy} onClick={() => void openEditor()}>Редактировать</button> : null}
          {item.capabilities.canConfirm ? <button type="button" disabled={isActionBusy} onClick={() => void runAction(() => confirmTask(taskId))}>Подтвердить и завершить</button> : null}
          {item.capabilities.canCompleteNow ? <button type="button" disabled={isActionBusy} onClick={() => void runAction(() => completeTaskNow(taskId))}>Завершить сейчас</button> : null}
          {item.capabilities.canReturnToWork ? <ReasonAction label="Вернуть в работу" disabled={isActionBusy} askReason={askReason} onRun={(reason) => runAction(() => returnTaskToWork(taskId, reason))} /> : null}
          {item.capabilities.canReopen ? <ReasonAction label="Переоткрыть" disabled={isActionBusy} askReason={askReason} onRun={(reason) => runAction(() => reopenTask(taskId, reason))} /> : null}
          {item.capabilities.canCancel ? <ReasonAction label="Отменить задачу" dangerous disabled={isActionBusy} askReason={askReason} onRun={(reason) => runAction(() => cancelTask(taskId, reason))} /> : null}
        </div>
      </div>

      {error ? <div className="task-alert task-alert--danger" role="alert">{error}</div> : null}
      <TaskSummaryCard item={item} autoCloseSeconds={autoCloseSeconds} />

      <div className="task-detail-grid">
        <section className="page-card">
          <div className="section-header">
            <div><div className="section-title">Исполнители</div><div className="section-subtitle">Результат фиксируется отдельно для каждого пользователя.</div></div>
            <strong>{item.completionProgress.completed} / {item.completionProgress.total}</strong>
          </div>
          <div className="record-list task-assignee-list">
            {item.assignees.map((assignee) => (
              <article className={`record-card ${!assignee.isActive ? 'task-assignee--inactive' : ''}`} key={assignee.id}>
                <div className="section-header">
                  <div>
                    <strong>{getUserDisplayName(assignee)}</strong>
                    <div className="section-subtitle">
                      {!assignee.isActive ? 'Удалён из текущего состава' : assignee.isCompleted && assignee.completedAt
                        ? `Выполнено ${formatDateTime(assignee.completedAt)}` : 'В работе'}
                    </div>
                  </div>
                  {item.capabilities.canManageAssignees && assignee.isActive && activeAssignees.length > 1 ? (
                    <button
                      type="button"
                      disabled={isActionBusy}
                      onClick={() => {
                        if (window.confirm(`Удалить исполнителя ${getUserDisplayName(assignee)}?`)) {
                          void runAction(() => removeTaskAssignee(taskId, assignee.id));
                        }
                      }}
                    >Удалить</button>
                  ) : null}
                </div>
                {assignee.currentCompletion ? (
                  <div className="task-assignee__result">
                    <div>{assignee.currentCompletion.completionText || 'Комментарий не указан.'}</div>
                    <AttachmentPreviewList
                      files={filesByCompletion[assignee.currentCompletion.id] ?? []}
                      emptyText="Файлы не приложены."
                    />
                  </div>
                ) : null}
              </article>
            ))}
          </div>

          {item.capabilities.canManageAssignees ? (
            <div className="task-add-assignee">
              <select value={newAssigneeId} onFocus={() => {
                if (candidateUsers.length === 0) void loadCandidates(item.objectId ?? '', item.oneTimeOrderId ?? '');
              }} onChange={(event) => setNewAssigneeId(event.target.value)}>
                <option value="">Добавить исполнителя…</option>
                {candidateUsers.filter((user) => !activeAssignees.some((assignee) => assignee.id === user.id)).map((user) => (
                  <option key={user.id} value={user.id}>{getUserDisplayName(user)}</option>
                ))}
              </select>
              <button type="button" disabled={!newAssigneeId || isActionBusy} onClick={() => {
                void runAction(() => addTaskAssignees(taskId, [newAssigneeId])).then(() => setNewAssigneeId(''));
              }}>Добавить</button>
            </div>
          ) : null}
        </section>

        <TaskResultPanel
          taskId={taskId}
          requirement={item.completionRequirement}
          canComplete={item.capabilities.canCompleteMyAssignment}
          canUndo={item.capabilities.canUndoMyCompletion}
          onChanged={() => loadTask(taskId)}
        />
      </div>

      {item.capabilities.canViewHistory ? (
        <section className="page-card">
          <div className="section-title">История</div>
          <div className="task-history local-scroll local-scroll--lg">
            {history.length === 0 ? <div className="page-muted">История пока пуста.</div> : history.map((event) => (
              <article key={event.id} className="task-history__item">
                <time>{formatDateTime(event.createdAt)}</time>
                <strong>{formatTaskHistoryEvent(event)}</strong>
                {typeof event.payload?.reason === 'string' ? <span>Причина: {event.payload.reason}</span> : null}
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {isEditing ? (
        <div className="task-modal-backdrop" role="presentation">
          <div className="task-modal" role="dialog" aria-modal="true" aria-label="Редактировать задачу">
            <div className="section-header"><div className="section-title">Редактировать задачу</div><button type="button" onClick={() => setIsEditing(false)}>Закрыть</button></div>
            <TaskForm
              key={`${item.id}:${item.updatedAt}`}
              isEdit
              objects={objects}
              orders={orders}
              users={candidateUsers}
              visibilityUsers={visibilityUsers}
              initialValue={buildEditValue(item)}
              onTargetsChange={(objectId, oneTimeOrderId) => void loadCandidates(objectId, oneTimeOrderId)}
              onCancel={() => setIsEditing(false)}
              onSubmit={async (formPayload) => {
                const payload = mapEditPayload(formPayload);
                try {
                  await updateTask(taskId, payload);
                } catch (caught) {
                  const requiresReset = caught instanceof Error && caught.message.includes('resetCompletions');
                  if (!requiresReset || !window.confirm('Изменение содержания вернёт задачу в работу и снимет отметки выполнения. Старые результаты сохранятся в истории. Продолжить?')) throw caught;
                  await updateTask(taskId, { ...payload, resetCompletions: true });
                }
                setIsEditing(false);
                await loadTask(taskId);
              }}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ReasonAction({ label, dangerous = false, disabled, askReason, onRun }: {
  label: string;
  dangerous?: boolean;
  disabled: boolean;
  askReason: (label: string) => string | null;
  onRun: (reason: string) => Promise<void>;
}): React.JSX.Element {
  return <button type="button" className={dangerous ? 'task-danger-button' : undefined} disabled={disabled} onClick={() => {
    if (dangerous && !window.confirm('Отменить задачу?')) return;
    const reason = askReason('Укажите причину (минимум 3 символа)');
    if (reason) void onRun(reason);
  }}>{label}</button>;
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat('ru-RU', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Moscow' }).format(new Date(value));
}

function getMoscowDateParts(value: string | null): { date: string; time: string } {
  if (!value) return { date: '', time: '' };
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(value));
  const get = (type: Intl.DateTimeFormatPartTypes): string => parts.find((part) => part.type === type)?.value ?? '';
  return { date: `${get('year')}-${get('month')}-${get('day')}`, time: `${get('hour')}:${get('minute')}` };
}

function buildEditValue(item: TaskItem): Partial<TaskFormInitialValue> {
  const deadline = getMoscowDateParts(item.dueAt);
  return {
    title: item.title,
    description: item.description ?? '',
    priority: item.priority,
    objectId: item.objectId ?? '',
    oneTimeOrderId: item.oneTimeOrderId ?? '',
    assigneeUserIds: item.assignees.filter((assignee) => assignee.isActive).map((assignee) => assignee.id),
    visibilityMode: item.visibilityMode,
    visibleUserIds: item.visibleUsers.map((user) => user.id),
    requiresConfirmation: item.requiresConfirmation,
    completionRequirement: item.completionRequirement,
    dueDate: deadline.date,
    dueTime: item.dueTimeSpecified ? deadline.time : '',
  };
}

function mapEditPayload(payload: CreateTaskPayload): UpdateTaskPayload {
  return {
    title: payload.title,
    description: payload.description ?? null,
    priority: payload.priority,
    objectId: payload.objectId ?? null,
    oneTimeOrderId: payload.oneTimeOrderId ?? null,
    visibilityMode: payload.visibilityMode,
    visibleUserIds: payload.visibleUserIds ?? [],
    requiresConfirmation: payload.requiresConfirmation,
    completionRequirement: payload.completionRequirement,
    dueDate: payload.dueDate ?? null,
    dueTime: payload.dueTime ?? null,
  };
}
