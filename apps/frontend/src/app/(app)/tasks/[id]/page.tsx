'use client';

import React, { useEffect, useState } from 'react';

import { listObjects } from '@/entities/object/api/object-client';
import type { ServiceObject } from '@/entities/object/model/object.types';
import { listOneTimeOrders } from '@/entities/one-time-order/api/one-time-order-client';
import type { OneTimeOrderListItem } from '@/entities/one-time-order/model/one-time-order.types';
import {
  addTaskAssignees,
  cancelTask,
  completeTaskNow,
  confirmTask,
  getTaskById,
  listTaskCompletions,
  listTaskHistory,
  removeTaskAssignee,
  reopenTask,
  returnTaskToWork,
  updateTask,
} from '@/entities/task/api/task-client';
import type {
  CreateTaskPayload,
  TaskCompletionListResponse,
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
import { listFilesByEntity, uploadFileToEntity } from '@/entities/file/api/file-client';
import type { AttachedFile } from '@/entities/file/model/file.types';
import { MediaActionPicker } from '@/shared/ui/media-entry/media-action-picker';
import { getUserDisplayName } from '@/shared/lib/display-name';
import { formatTaskHistoryEvent } from '@/shared/lib/task-presentation';
import { AttachmentPreviewList } from '@/shared/ui/media-entry/attachment-preview-list';
import { TablePagination } from '@/shared/ui/table-pagination/table-pagination';
import { Select } from '@/shared/ui/searchable-select/select';
import { useConfirm, useReasonPrompt } from '@/shared/ui/overlays';
import { Alert, BackLink, Button, EmptyState, Field, LoadingState, Stack, StatusBadge, Surface } from '@/shared/ui/foundation';
import taskStyles from '@/entities/task/ui/task-ui.module.css';

export default function TaskDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): React.JSX.Element {
  const [taskId, setTaskId] = useState('');
  const [item, setItem] = useState<TaskItem | null>(null);
  const [attachments, setAttachments] = useState<AttachedFile[]>([]);
  const [history, setHistory] = useState<TaskHistoryEvent[]>([]);
  const [completions, setCompletions] = useState<TaskCompletionListResponse>({
    items: [],
    page: 1,
    limit: 10,
    total: 0,
    totalPages: 0,
  });
  const [objects, setObjects] = useState<ServiceObject[]>([]);
  const [orders, setOrders] = useState<OneTimeOrderListItem[]>([]);
  const [candidateUsers, setCandidateUsers] = useState<SystemUserOption[]>([]);
  const [visibilityUsers, setVisibilityUsers] = useState<SystemUserOption[]>(
    [],
  );
  const [isEditing, setIsEditing] = useState(false);
  const [newAssigneeId, setNewAssigneeId] = useState('');
  const [autoCloseSeconds, setAutoCloseSeconds] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isActionBusy, setIsActionBusy] = useState(false);
  const [confirm, confirmDialog] = useConfirm();
  const [askReason, reasonDialog] = useReasonPrompt();
  const [error, setError] = useState<string | null>(null);

  const loadTask = async (id: string): Promise<void> => {
    const next = await getTaskById(id);
    setItem(next);
    setAttachments(await listFilesByEntity('task', id));
    setAutoCloseSeconds(next.autoCloseRemainingSeconds);

    if (next.capabilities.canViewHistory) {
      const [nextHistory, nextCompletions] = await Promise.all([
        listTaskHistory(id).catch(() => []),
        listTaskCompletions(id, { page: 1, limit: 10 }).catch(() => ({
          items: [],
          page: 1,
          limit: 10,
          total: 0,
          totalPages: 0,
        })),
      ]);
      setHistory(nextHistory);
      setCompletions(nextCompletions);
    }
  };

  const loadCompletionPage = async (page: number): Promise<void> => {
    setIsActionBusy(true);
    setError(null);
    try {
      setCompletions(
        await listTaskCompletions(taskId, { page, limit: completions.limit }),
      );
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Не удалось загрузить историю результатов.',
      );
    } finally {
      setIsActionBusy(false);
    }
  };

  useEffect(() => {
    void params
      .then(({ id }) => {
        setTaskId(id);
        return loadTask(id);
      })
      .catch(() => setError('Не удалось загрузить карточку задачи.'))
      .finally(() => setIsLoading(false));
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

  const loadCandidates = async (
    objectId: string,
    oneTimeOrderId: string,
  ): Promise<void> => {
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
      const [nextObjects, nextOrders] = await Promise.all([
        listObjects(),
        listOneTimeOrders({
          limit: 100,
          sortBy: 'title',
          sortDirection: 'asc',
        }),
      ]);
      setObjects(nextObjects);
      setOrders(nextOrders.items);
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
      setError(
        caught instanceof Error
          ? caught.message
          : 'Не удалось выполнить действие.',
      );
    } finally {
      setIsActionBusy(false);
    }
  };

  if (isLoading) return <LoadingState label="Загружаем задачу…" />;
  if (!item)
    return (
      <Surface padding="md" className={taskStyles.taskError}>
        {error ?? 'Задача не найдена.'}
      </Surface>
    );

  const activeAssignees = item.assignees.filter(
    (assignee) => assignee.isActive,
  );
  const currentCompletionIds = new Set(
    item.assignees.flatMap((assignee) => assignee.currentCompletion ? [assignee.currentCompletion.id] : []),
  );
  const previousCompletions = completions.items.filter((completion) => !currentCompletionIds.has(completion.id));

  return (
    <Stack gap="xl" className={`ui-page ${taskStyles.taskDetailPage}`}>
      {confirmDialog}
      {reasonDialog}
      <div className={taskStyles.taskPageHeading}>
        <BackLink href="/tasks">Задачи</BackLink>
        <div className="ui-inline">
          {item.capabilities.canEdit ? (
            <Button
              disabled={isActionBusy}
              onClick={() => void openEditor()}
            >
              Редактировать
            </Button>
          ) : null}
          {item.capabilities.canConfirm ? (
            <Button
              variant="primary"
              disabled={isActionBusy}
              onClick={() => void runAction(() => confirmTask(taskId))}
            >
              Подтвердить и завершить
            </Button>
          ) : null}
          {item.capabilities.canCompleteNow ? (
            <Button
              variant={item.capabilities.canConfirm ? 'default' : 'primary'}
              disabled={isActionBusy}
              onClick={() => void runAction(() => completeTaskNow(taskId))}
            >
              Завершить сейчас
            </Button>
          ) : null}
          {item.capabilities.canReturnToWork ? (
            <Button
              disabled={isActionBusy}
              onClick={async () => {
                const reason = await askReason({ title: 'Вернуть задачу в работу?', reasonLabel: 'Причина', confirmLabel: 'Вернуть в работу', minLength: 3 });
                if (reason) void runAction(() => returnTaskToWork(taskId, reason));
              }}
            >
              Вернуть в работу
            </Button>
          ) : null}
          {item.capabilities.canReopen ? (
            <Button
              disabled={isActionBusy}
              onClick={async () => {
                const reason = await askReason({ title: 'Переоткрыть задачу?', reasonLabel: 'Причина', confirmLabel: 'Переоткрыть', minLength: 3 });
                if (reason) void runAction(() => reopenTask(taskId, reason));
              }}
            >
              Переоткрыть
            </Button>
          ) : null}
          {item.capabilities.canCancel ? (
            <Button
              variant="danger"
              disabled={isActionBusy}
              onClick={async () => {
                const reason = await askReason({
                  title: 'Отменить задачу?',
                  description: 'Исполнители больше не увидят её в работе. Отмену можно будет переоткрыть.',
                  reasonLabel: 'Причина отмены',
                  confirmLabel: 'Отменить задачу',
                  minLength: 3,
                });
                if (reason) void runAction(() => cancelTask(taskId, reason));
              }}
            >
              Отменить задачу
            </Button>
          ) : null}
        </div>
      </div>

      {error ? (
        <Alert tone="danger">{error}</Alert>
      ) : null}
      <TaskSummaryCard item={item} autoCloseSeconds={autoCloseSeconds} />
      <Surface padding="md">
        <h2 className="ui-section-title">Вложения к задаче</h2>
        <AttachmentPreviewList files={attachments} emptyText="Вложений пока нет." />
        {item.capabilities.canEdit ? <MediaActionPicker disabled={isActionBusy} onPick={async (file) => {
          await uploadFileToEntity({ entityType: 'task', entityId: taskId, file });
          setAttachments(await listFilesByEntity('task', taskId));
        }} /> : null}
      </Surface>

      <div className={taskStyles.taskDetailGrid}>
        <Surface as="section" padding="md">
          <div className="ui-section-header">
            <div>
              <h2 className="ui-section-title">Исполнители и результаты</h2>
              <div className="ui-section-subtitle">
                Результат фиксируется отдельно для каждого пользователя.
              </div>
            </div>
            <strong>
              {item.completionProgress.completed} /{' '}
              {item.completionProgress.total}
            </strong>
          </div>
          <div className={taskStyles.taskAssigneeList}>
            {item.assignees.length === 0 ? <EmptyState title="Исполнителей пока нет" /> : null}
            {item.assignees.map((assignee) => (
              <article
                className={`${taskStyles.taskAssigneeRow} ${!assignee.isActive ? taskStyles.taskAssigneeInactive : ''}`}
                key={assignee.id}
              >
                <div className="ui-section-header">
                  <div>
                    <strong>{getUserDisplayName(assignee)}</strong>
                    <StatusBadge tone={!assignee.isActive ? 'neutral' : assignee.isCompleted ? 'success' : 'info'}>
                      {!assignee.isActive ? 'Не в составе' : assignee.isCompleted ? 'Выполнено' : 'В работе'}
                    </StatusBadge>
                    <div className="ui-section-subtitle">
                      {!assignee.isActive
                        ? 'Удалён из текущего состава'
                        : assignee.isCompleted && assignee.completedAt
                          ? `Выполнено ${formatDateTime(assignee.completedAt)}`
                          : 'В работе'}
                    </div>
                  </div>
                  {item.capabilities.canManageAssignees &&
                  assignee.isActive &&
                  activeAssignees.length > 1 ? (
                    <Button
                      disabled={isActionBusy}
                      onClick={() => {
                        void confirm({
                          title: 'Удалить исполнителя?',
                          consequence: `${getUserDisplayName(assignee)} больше не будет исполнителем этой задачи.`,
                          confirmLabel: 'Удалить',
                          tone: 'danger',
                        }).then((confirmed) => {
                          if (!confirmed) return;
                          void runAction(() =>
                            removeTaskAssignee(taskId, assignee.id),
                          );
                        });
                      }}
                    >
                      Удалить
                    </Button>
                  ) : null}
                </div>
                {assignee.currentCompletion ? (
                  <div className={taskStyles.taskAssigneeResult}>
                    <div>
                      {assignee.currentCompletion.completionText ||
                        'Комментарий не указан.'}
                    </div>
                    <AttachmentPreviewList
                      files={assignee.currentCompletion.attachments}
                      emptyText="Файлы не приложены."
                    />
                  </div>
                ) : null}
              </article>
            ))}
          </div>

          {item.capabilities.canManageAssignees ? (
            <div className={taskStyles.taskAddAssignee}>
              <Field label="Добавить исполнителя">
                <Select
                  value={newAssigneeId}
                  onFocus={() => {
                    if (candidateUsers.length === 0)
                      void loadCandidates(
                        item.objectId ?? '',
                        item.oneTimeOrderId ?? '',
                      );
                  }}
                  onChange={(event) => setNewAssigneeId(event.target.value)}
                >
                  <option value="">Добавить исполнителя…</option>
                  {candidateUsers
                    .filter(
                      (user) =>
                        !activeAssignees.some(
                          (assignee) => assignee.id === user.id,
                        ),
                    )
                    .map((user) => (
                      <option key={user.id} value={user.id}>
                        {getUserDisplayName(user)}
                      </option>
                    ))}
                </Select>
              </Field>
              <Button
                disabled={!newAssigneeId || isActionBusy}
                onClick={() => {
                  void runAction(() =>
                    addTaskAssignees(taskId, [newAssigneeId]),
                  ).then(() => setNewAssigneeId(''));
                }}
              >
                Добавить
              </Button>
            </div>
          ) : null}
        </Surface>

        <TaskResultPanel
          taskId={taskId}
          requirement={item.completionRequirement}
          canComplete={item.capabilities.canCompleteMyAssignment}
          canUndo={item.capabilities.canUndoMyCompletion}
          onChanged={() => loadTask(taskId)}
        />
      </div>

      {item.capabilities.canViewHistory ? (
        <details className={`ui-surface ui-surface--padded ${taskStyles.taskPreviousAttempts}`}>
          <summary>Предыдущие попытки выполнения</summary>
          <p className="ui-section-subtitle">Результаты прошлых попыток и циклов. Текущие результаты показаны у исполнителей выше.</p>
          <Stack gap="lg">
            {previousCompletions.length === 0 ? (
              <EmptyState title={completions.total === 0 ? 'Результатов пока нет' : 'На этой странице нет предыдущих попыток'} description={completions.total > 0 ? 'Текущие результаты показаны выше. Другие попытки могут быть на следующих страницах.' : undefined} />
            ) : (
              previousCompletions.map((completion) => (
                <article className={taskStyles.taskAttempt} key={completion.id}>
                  <div className="ui-section-header">
                    <div>
                      <strong>{getUserDisplayName(completion.assignee)}</strong>
                      <div className="ui-section-subtitle">
                        Цикл {completion.workCycle} · попытка{' '}
                        {completion.attemptNumber} ·{' '}
                        {getCompletionStatusLabel(completion.status)}
                      </div>
                    </div>
                    <time dateTime={completion.cancelledAt ?? completion.submittedAt}>
                      {formatDateTime(
                        completion.cancelledAt ?? completion.submittedAt,
                      )}
                    </time>
                  </div>
                  <div className={taskStyles.taskResultText}>
                    {completion.completionText || 'Комментарий не указан.'}
                  </div>
                  {completion.cancellationReason ? (
                    <div className="ui-section-subtitle">
                      Причина: {completion.cancellationReason}
                    </div>
                  ) : null}
                  <AttachmentPreviewList
                    files={completion.attachments}
                    emptyText="Файлы не приложены."
                  />
                </article>
              ))
            )}
          </Stack>
          {completions.totalPages > 0 ? <TablePagination page={completions.page} totalPages={completions.totalPages} pending={isActionBusy}
            label="Страницы отчётов о выполнении" summary={`Страница ${completions.page} из ${completions.totalPages} · всего отчётов, включая текущие: ${completions.total}`}
            onPageChange={(page) => void loadCompletionPage(page)} /> : null}
        </details>
      ) : null}

      {item.capabilities.canViewHistory ? (
        <Surface as="section" padding="md">
          <h2 className="ui-section-title">История задачи</h2>
          <div className={`${taskStyles.taskHistory} local-scroll local-scroll--lg`}>
            {history.length === 0 ? (
              <EmptyState title="История пока пуста" />
            ) : (
              history.map((event) => (
                <article key={event.id} className={taskStyles.taskHistoryItem}>
                  <time>{formatDateTime(event.createdAt)}</time>
                  <strong>{formatTaskHistoryEvent(event)}</strong>
                  {typeof event.payload?.reason === 'string' ? (
                    <span>Причина: {event.payload.reason}</span>
                  ) : null}
                </article>
              ))
            )}
          </div>
        </Surface>
      ) : null}

      {isEditing ? (
        <div className={taskStyles.taskModalBackdrop} role="presentation">
          <div
            className={taskStyles.taskModal}
            role="dialog"
            aria-modal="true"
            aria-label="Редактировать задачу"
          >
            <div className="ui-section-header">
              <div className="ui-section-title">Редактировать задачу</div>
              <Button onClick={() => setIsEditing(false)}>
                Закрыть
              </Button>
            </div>
            <TaskForm
              key={`${item.id}:${item.updatedAt}`}
              isEdit
              objects={objects}
              orders={orders}
              users={candidateUsers}
              visibilityUsers={visibilityUsers}
              initialValue={buildEditValue(item)}
              onTargetsChange={(objectId, oneTimeOrderId) =>
                void loadCandidates(objectId, oneTimeOrderId)
              }
              onCancel={() => setIsEditing(false)}
              onSubmit={async (formPayload) => {
                const payload = mapEditPayload(formPayload);
                try {
                  await updateTask(taskId, payload);
                } catch (caught) {
                  const requiresReset =
                    caught instanceof Error &&
                    caught.message.includes('resetCompletions');
                  if (
                    !requiresReset ||
                    !(await confirm({
                      title: 'Вернуть задачу в работу?',
                      consequence: 'Изменение содержания вернёт задачу в работу и снимет отметки выполнения. Старые результаты сохранятся в истории.',
                      confirmLabel: 'Сохранить и вернуть в работу',
                    }))
                  )
                    throw caught;
                  await updateTask(taskId, {
                    ...payload,
                    resetCompletions: true,
                  });
                }
                setIsEditing(false);
                await loadTask(taskId);
              }}
            />
          </div>
        </div>
      ) : null}
    </Stack>
  );
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat('ru-RU', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Europe/Moscow',
  }).format(new Date(value));
}

function getCompletionStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    submitted: 'отправлен',
    cancelled: 'отменён',
    invalidated: 'аннулирован',
  };

  return labels[status] ?? status;
}

function getMoscowDateParts(value: string | null): {
  date: string;
  time: string;
} {
  if (!value) return { date: '', time: '' };
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Moscow',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(value));
  const get = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? '';
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    time: `${get('hour')}:${get('minute')}`,
  };
}

function buildEditValue(item: TaskItem): Partial<TaskFormInitialValue> {
  const deadline = getMoscowDateParts(item.dueAt);
  return {
    title: item.title,
    description: item.description ?? '',
    priority: item.priority,
    objectId: item.objectId ?? '',
    oneTimeOrderId: item.oneTimeOrderId ?? '',
    assigneeUserIds: item.assignees
      .filter((assignee) => assignee.isActive)
      .map((assignee) => assignee.id),
    visibilityType: item.visibilityType,
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
    visibilityType: payload.visibilityType,
    visibleUserIds: payload.visibleUserIds ?? [],
    requiresConfirmation: payload.requiresConfirmation,
    completionRequirement: payload.completionRequirement,
    dueDate: payload.dueDate,
    dueTime: payload.dueTime ?? null,
  };
}
