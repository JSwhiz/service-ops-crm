'use client';

import React, { useContext, useEffect, useRef, useState } from 'react';
import { useAuth } from '@/shared/auth/use-auth';
import { useOpenAccessRefresh } from '@/shared/auth/use-open-access-refresh';

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
  TaskMutationResult,
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
import { AccessSnapshotBlockedContext, AccessSnapshotBoundary } from '@/shared/auth/access-snapshot-boundary';
import { getAccessGeneration, isAccessGenerationCurrent } from '@/shared/auth/access-generation';
import { getUserDisplayName } from '@/shared/lib/display-name';
import { formatTaskHistoryEvent } from '@/shared/lib/task-presentation';
import { AttachmentPreviewList } from '@/shared/ui/media-entry/attachment-preview-list';
import { TablePagination } from '@/shared/ui/table-pagination/table-pagination';
import { Select } from '@/shared/ui/searchable-select/select';
import { useConfirm, useReasonPrompt } from '@/shared/ui/overlays';
import { Alert, BackLink, Button, EmptyState, Field, IconButton, LoadingState, Stack, StatusBadge, Surface } from '@/shared/ui/foundation';
import { CloseIcon } from '@/shared/ui/icons/icons';
import taskStyles from '@/entities/task/ui/task-ui.module.css';

type TaskActionCapability = 'canConfirm' | 'canCompleteNow' | 'canReturnToWork' | 'canReopen' | 'canCancel' | 'canManageAssignees' | 'canEdit';
type TaskReasonCapability = 'canReturnToWork' | 'canReopen' | 'canCancel';

export default function TaskDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): React.JSX.Element {
  const [route, setRoute] = useState<{ source: typeof params; id: string } | null>(null);
  const [routeError, setRouteError] = useState(false);
  useEffect(() => {
    let active = true;
    setRouteError(false);
    void params.then(({ id }) => {
      if (active) setRoute({ source: params, id });
    }).catch(() => { if (active) setRouteError(true); });
    return () => { active = false; };
  }, [params]);
  const routePending = route?.source !== params;
  return <>
    {routeError ? <Alert tone="danger">Не удалось загрузить карточку задачи.</Alert>
      : routePending ? <LoadingState label="Загружаем задачу…" /> : null}
    <AccessSnapshotBoundary blocked={routePending || routeError}>
      {route ? <TaskDetailContent key={route.id} taskId={route.id} /> : null}
    </AccessSnapshotBoundary>
  </>;
}

function TaskDetailContent({ taskId }: { taskId: string }): React.JSX.Element {
  const { user, capabilitiesRefreshError } = useAuth();
  const ancestorBlocked = useContext(AccessSnapshotBlockedContext);
  const canUploadFile = user?.capabilities?.canUploadFile === true;
  const accessRevision = user ? `${user.id}:${user.accessVersion ?? 'legacy'}` : 'signed-out';
  const [item, setItem] = useState<TaskItem | null>(null);
  const [closedAfterSaveFor, setClosedAfterSaveFor] = useState<string | null>(null);
  const isClosedAfterSave = closedAfterSaveFor === `${user?.id}:${taskId}`;
  useOpenAccessRefresh(item !== null && !isClosedAfterSave);
  const actorIdRef = useRef(user?.id);
  actorIdRef.current = user?.id;
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
  const [reasonAction, setReasonAction] = useState<TaskReasonCapability | null>(null);
  const reasonDrafts = useRef<Partial<Record<TaskReasonCapability, { target: string; reason: string }>>>({});
  const [error, setError] = useState<string | null>(null);
  const [loadedAccessRevision, setLoadedAccessRevision] = useState<string | null>(null);
  const accessRevisionRef = useRef(accessRevision);
  accessRevisionRef.current = accessRevision;
  const loadSequence = useRef(0);
  const candidateTargetRef = useRef<{ objectId: string; oneTimeOrderId: string } | null>(null);
  const taskCapabilitiesCurrent = !capabilitiesRefreshError && loadedAccessRevision === accessRevision && item?.id === taskId;
  const canUploadTaskFiles = taskCapabilitiesCurrent && canUploadFile && item?.capabilities.canEdit === true;
  const uploadPermissionRef = useRef(canUploadTaskFiles);
  uploadPermissionRef.current = canUploadTaskFiles;
  const attachmentTarget = `${taskId}:${item?.objectId ?? ''}:${item?.oneTimeOrderId ?? ''}`;
  const attachmentTargetRef = useRef(attachmentTarget);
  attachmentTargetRef.current = attachmentTarget;
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const actionContextRef = useRef({ taskId, target: attachmentTarget, revision: accessRevision, readable: false, capabilities: item?.capabilities });
  actionContextRef.current = {
    taskId, target: attachmentTarget, revision: accessRevision,
    readable: !ancestorBlocked && taskCapabilitiesCurrent && !isLoading,
    capabilities: item?.capabilities,
  };
  const captureTaskAction = (capability: TaskActionCapability): (() => boolean) => {
    const generation = getAccessGeneration();
    const context = actionContextRef.current;
    return () => {
      const current = actionContextRef.current;
      return mounted.current && isAccessGenerationCurrent(generation) && current.readable
        && current.taskId === context.taskId && current.target === context.target
        && current.revision === context.revision && current.capabilities?.[capability] === true;
    };
  };
  const requestReason = async (
    capability: TaskReasonCapability,
    options: Parameters<typeof askReason>[0],
    action: (reason: string) => Promise<TaskMutationResult>,
  ): Promise<void> => {
    const isCurrent = captureTaskAction(capability);
    if (!isCurrent()) return;
    const target = attachmentTarget;
    const retained = reasonDrafts.current[capability];
    setReasonAction(capability);
    const reason = await askReason({ ...options, initialValue: retained?.target === target ? retained.reason : '' });
    if (!mounted.current) return;
    setReasonAction(null);
    if (!reason) return;
    reasonDrafts.current[capability] = { target, reason };
    if (!isCurrent()) {
      if (attachmentTargetRef.current === target) setError('Доступ или задача изменились. Причина сохранена; откройте действие заново для нового подтверждения.');
      return;
    }
    if (await runAction(capability, () => action(reason), isCurrent)
      && mounted.current && user?.id === actorIdRef.current && attachmentTargetRef.current === target) {
      delete reasonDrafts.current[capability];
    }
  };

  const loadTask = async (id: string): Promise<void> => {
    const sequence = ++loadSequence.current;
    const revision = accessRevision;
    const isCurrent = (): boolean => sequence === loadSequence.current && revision === accessRevisionRef.current;
    setLoadedAccessRevision(null);
    setIsLoading(true);
    setError(null);
    try {
      const next = await getTaskById(id);
      if (!isCurrent()) return;
      const nextAttachments = await listFilesByEntity('task', id);
      if (!isCurrent()) return;
      const emptyCompletions = { items: [], page: 1, limit: 10, total: 0, totalPages: 0 };
      const [nextHistory, nextCompletions]: [TaskHistoryEvent[], TaskCompletionListResponse] = next.capabilities.canViewHistory
        ? await Promise.all([
          listTaskHistory(id).catch(() => []),
          listTaskCompletions(id, { page: 1, limit: 10 }).catch(() => emptyCompletions),
        ]) : [[], emptyCompletions];
      if (!isCurrent()) return;
      // An open editor keeps its private draft, but directory rows must be fresh too.
      if (isEditing) {
        const target = candidateTargetRef.current ?? { objectId: next.objectId ?? '', oneTimeOrderId: next.oneTimeOrderId ?? '' };
        const scope = { ...(target.objectId ? { objectId: target.objectId } : {}), ...(target.oneTimeOrderId ? { oneTimeOrderId: target.oneTimeOrderId } : {}) };
        const [nextObjects, nextOrders, nextUsers, nextVisibilityUsers] = await Promise.all([
          listObjects().catch(() => []),
          listOneTimeOrders({ limit: 100, sortBy: 'title', sortDirection: 'asc' }).catch(() => ({ items: [] })),
          listSystemUsers({ purpose: 'task_assignee', ...scope }).catch(() => []),
          listSystemUsers({ purpose: 'task_visibility', ...scope }).catch(() => []),
        ]);
        if (!isCurrent()) return;
        setObjects(nextObjects);
        setOrders(nextOrders.items);
        setCandidateUsers(nextUsers);
        setVisibilityUsers(nextVisibilityUsers);
      } else {
        setCandidateUsers([]);
        setVisibilityUsers([]);
      }
      setItem(next);
      setAttachments(nextAttachments);
      setAutoCloseSeconds(next.autoCloseRemainingSeconds);
      setHistory(nextHistory);
      setCompletions(nextCompletions);
      setLoadedAccessRevision(revision);
    } catch (caught) {
      if (!isCurrent()) return;
      const status = caught && typeof caught === 'object' && 'statusCode' in caught ? caught.statusCode : null;
      setError(status === 403 || status === 404
        ? 'Карточка задачи недоступна.'
        : 'Не удалось загрузить карточку задачи.');
    } finally {
      if (isCurrent()) setIsLoading(false);
    }
  };

  const loadCompletionPage = async (page: number): Promise<void> => {
    const sequence = loadSequence.current;
    const revision = accessRevision;
    const isCurrent = (): boolean => sequence === loadSequence.current && revision === accessRevisionRef.current;
    setIsActionBusy(true);
    setError(null);
    try {
      const nextCompletions = await listTaskCompletions(taskId, { page, limit: completions.limit });
      if (!isCurrent()) return;
      setCompletions(nextCompletions);
    } catch (caught) {
      if (!isCurrent()) return;
      setError(
        caught instanceof Error
          ? caught.message
          : 'Не удалось загрузить историю результатов.',
      );
    } finally {
      if (isCurrent()) setIsActionBusy(false);
    }
  };

  useEffect(() => {
    void loadTask(taskId);
    return () => { loadSequence.current += 1; };
  }, [taskId, accessRevision]);

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
    const sequence = loadSequence.current;
    const revision = accessRevision;
    const candidateTarget = { objectId, oneTimeOrderId };
    candidateTargetRef.current = candidateTarget;
    const target = {
      ...(objectId ? { objectId } : {}),
      ...(oneTimeOrderId ? { oneTimeOrderId } : {}),
    };
    const [nextUsers, nextVisibilityUsers] = await Promise.all([
      listSystemUsers({ purpose: 'task_assignee', ...target }),
      listSystemUsers({ purpose: 'task_visibility', ...target }),
    ]);
    if (sequence !== loadSequence.current || revision !== accessRevisionRef.current || candidateTargetRef.current !== candidateTarget) return;
    setCandidateUsers(nextUsers);
    setVisibilityUsers(nextVisibilityUsers);
  };

  const openEditor = async (): Promise<void> => {
    if (!item) return;
    const sequence = loadSequence.current;
    const revision = accessRevision;
    const isCurrent = (): boolean => sequence === loadSequence.current && revision === accessRevisionRef.current;
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
      if (!isCurrent()) return;
      setObjects(nextObjects);
      setOrders(nextOrders.items);
      await loadCandidates(item.objectId ?? '', item.oneTimeOrderId ?? '');
      if (!isCurrent()) return;
      setIsEditing(true);
    } catch {
      if (!isCurrent()) return;
      setError('Не удалось подготовить форму редактирования.');
    } finally {
      if (isCurrent()) setIsActionBusy(false);
    }
  };

  const closeOnSavedReceipt = (result: TaskMutationResult, actorId: string | undefined): boolean => {
    if (!result || !('outcome' in result) || result.outcome !== 'saved_without_access') return false;
    if (mounted.current && actorId && actorId === actorIdRef.current && actionContextRef.current.taskId === taskId) {
      loadSequence.current += 1;
      setClosedAfterSaveFor(`${actorId}:${taskId}`);
      setIsEditing(false);
      setIsLoading(false);
      setItem(null);
      setAttachments([]);
      setHistory([]);
      setCompletions({ items: [], page: 1, limit: 10, total: 0, totalPages: 0 });
      setCandidateUsers([]);
      setVisibilityUsers([]);
      setObjects([]);
      setOrders([]);
      setNewAssigneeId('');
      reasonDrafts.current = {};
      setReasonAction(null);
      setError(null);
    }
    return true;
  };

  const runAction = async (
    capability: TaskActionCapability,
    action: () => Promise<TaskMutationResult>,
    isCurrent = captureTaskAction(capability),
  ): Promise<boolean> => {
    if (!isCurrent()) {
      if (mounted.current && user?.id && user.id === actorIdRef.current && attachmentTargetRef.current === attachmentTarget) {
        setError('Доступ или задача изменились. Откройте действие заново для нового подтверждения.');
      }
      return false;
    }
    setIsActionBusy(true);
    setError(null);
    try {
      const result = await action();
      if (closeOnSavedReceipt(result, user?.id)) return true;
      if (!isCurrent()) return false;
      await loadTask(taskId);
      return true;
    } catch (caught) {
      if (!isCurrent()) {
        if (mounted.current && user?.id && user.id === actorIdRef.current && attachmentTargetRef.current === attachmentTarget) {
          setError('Доступ или задача изменились. Откройте действие заново для нового подтверждения.');
        }
        return false;
      }
      setError(
        caught instanceof Error
          ? caught.message
          : 'Не удалось выполнить действие.',
      );
      return false;
    } finally {
      if (mounted.current && attachmentTargetRef.current === attachmentTarget) setIsActionBusy(false);
    }
  };

  if (isClosedAfterSave) return (
    <Stack gap="md">
      <BackLink href="/tasks">К списку задач</BackLink>
      <Alert role="status" title="Изменение сохранено">Карточка задачи больше недоступна.</Alert>
    </Stack>
  );
  if (isLoading && !item) return <LoadingState label="Загружаем задачу…" />;
  if (!item)
    return (
      <Stack gap="md">
        <BackLink href="/tasks">К списку задач</BackLink>
        <Surface padding="md" className={taskStyles.taskError}>
          {error ?? 'Задача не найдена.'}
        </Surface>
      </Stack>
    );

  const activeAssignees = item.assignees.filter(
    (assignee) => assignee.isActive,
  );
  const currentCompletionIds = new Set(
    item.assignees.flatMap((assignee) => assignee.currentCompletion ? [assignee.currentCompletion.id] : []),
  );
  const previousCompletions = completions.items.filter((completion) => !currentCompletionIds.has(completion.id));

  return (
    <>
    {!taskCapabilitiesCurrent || isLoading ? <>
      <BackLink href="/tasks">Задачи</BackLink>
      {error ? <Alert tone="danger">{error}</Alert> : <LoadingState label="Обновляем доступ к задаче…" />}
    </> : null}
    <AccessSnapshotBoundary blocked={!taskCapabilitiesCurrent || isLoading}>
    <Stack gap="xl" className={`ui-page ${taskStyles.taskDetailPage}`}>
      {confirmDialog}
      <AccessSnapshotBoundary blocked={reasonAction !== null && item.capabilities[reasonAction] !== true}>
        {reasonDialog}
      </AccessSnapshotBoundary>
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
              onClick={() => void runAction('canConfirm', () => confirmTask(taskId))}
            >
              Подтвердить и завершить
            </Button>
          ) : null}
          {item.capabilities.canCompleteNow ? (
            <Button
              variant={item.capabilities.canConfirm ? 'default' : 'primary'}
              disabled={isActionBusy}
              onClick={() => void runAction('canCompleteNow', () => completeTaskNow(taskId))}
            >
              Завершить сейчас
            </Button>
          ) : null}
          {item.capabilities.canReturnToWork ? (
            <Button
              disabled={isActionBusy}
              onClick={() => requestReason('canReturnToWork', { title: 'Вернуть задачу в работу?', reasonLabel: 'Причина', confirmLabel: 'Вернуть в работу', minLength: 3 }, (reason) => returnTaskToWork(taskId, reason))}
            >
              Вернуть в работу
            </Button>
          ) : null}
          {item.capabilities.canReopen ? (
            <Button
              disabled={isActionBusy}
              onClick={() => requestReason('canReopen', { title: 'Переоткрыть задачу?', reasonLabel: 'Причина', confirmLabel: 'Переоткрыть', minLength: 3 }, (reason) => reopenTask(taskId, reason))}
            >
              Переоткрыть
            </Button>
          ) : null}
          {item.capabilities.canCancel ? (
            <Button
              variant="danger"
              disabled={isActionBusy}
              onClick={() => requestReason('canCancel', {
                  title: 'Отменить задачу?',
                  description: 'Исполнители больше не увидят её в работе. Отмену можно будет переоткрыть.',
                  reasonLabel: 'Причина отмены',
                  confirmLabel: 'Отменить задачу',
                  minLength: 3,
                }, (reason) => cancelTask(taskId, reason))}
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
        <AccessSnapshotBoundary key={attachmentTarget} blocked={!canUploadTaskFiles}>
        <MediaActionPicker disabled={isActionBusy || !canUploadTaskFiles} onPick={async (file) => {
          if (!uploadPermissionRef.current) throw new Error('Прикрепление файлов сейчас недоступно.');
          if (attachmentTargetRef.current !== attachmentTarget) throw new Error('Цель задачи изменилась. Выберите файлы для новой цели заново.');
          await uploadFileToEntity({ entityType: 'task', entityId: taskId, file });
          if (attachmentTargetRef.current !== attachmentTarget) return;
          try {
            const nextAttachments = await listFilesByEntity('task', taskId);
            if (attachmentTargetRef.current !== attachmentTarget) return;
            setAttachments(nextAttachments);
            setError(null);
          } catch {
            setError('Файл сохранён, но не удалось обновить вложения задачи. Обновите страницу; повторная загрузка файла не нужна.');
          }
        }} />
        </AccessSnapshotBoundary>
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
                        const isCurrent = captureTaskAction('canManageAssignees');
                        if (!isCurrent()) return;
                        void confirm({
                          title: 'Удалить исполнителя?',
                          consequence: `${getUserDisplayName(assignee)} больше не будет исполнителем этой задачи.`,
                          confirmLabel: 'Удалить',
                          tone: 'danger',
                        }).then((confirmed) => {
                          if (!confirmed) return;
                          void runAction('canManageAssignees', () =>
                            removeTaskAssignee(taskId, assignee.id), isCurrent,
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
                  void runAction('canManageAssignees', () =>
                    addTaskAssignees(taskId, [newAssigneeId]),
                  ).then((completed) => { if (completed) setNewAssigneeId(''); });
                }}
              >
                Добавить
              </Button>
            </div>
          ) : null}
        </Surface>

        <TaskResultPanel
          key={`${attachmentTarget}:${item.workCycle}`}
          taskId={taskId}
          actorId={user?.id}
          onSavedWithoutAccess={() => { closeOnSavedReceipt({ outcome: 'saved_without_access' }, user?.id); }}
          requirement={item.completionRequirement}
          canComplete={taskCapabilitiesCurrent && item.capabilities.canCompleteMyAssignment}
          canCreateCompletionDraft={taskCapabilitiesCurrent && item.capabilities.canCreateCompletionDraft === true}
          canUploadFiles={canUploadFile}
          canUndo={taskCapabilitiesCurrent && item.capabilities.canUndoMyCompletion}
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
        <>
        {!item.capabilities.canEdit ? (
          <Alert tone="warning" role="status">Редактирование задачи недоступно. Черновик сохранён до восстановления доступа.</Alert>
        ) : null}
        <AccessSnapshotBoundary blocked={!item.capabilities.canEdit}>
        <div className={taskStyles.taskModalBackdrop} role="presentation">
          <div
            className={taskStyles.taskModal}
            role="dialog"
            aria-modal="true"
            aria-label="Редактировать задачу"
          >
            <div className="ui-section-header">
              <div className="ui-section-title">Редактировать задачу</div>
              <IconButton aria-label="Закрыть редактор задачи" title="Закрыть редактор задачи" onClick={() => setIsEditing(false)}>
                <CloseIcon size={18} />
              </IconButton>
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
                const isCurrent = captureTaskAction('canEdit');
                if (!isCurrent()) return;
                const payload = mapEditPayload(formPayload);
                try {
                  if (closeOnSavedReceipt(await updateTask(taskId, payload), user?.id)) return;
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
                  if (!isCurrent()) return;
                  if (closeOnSavedReceipt(await updateTask(taskId, {
                    ...payload,
                    resetCompletions: true,
                  }), user?.id)) return;
                }
                if (!isCurrent()) return;
                setIsEditing(false);
                await loadTask(taskId);
              }}
            />
          </div>
        </div>
        </AccessSnapshotBoundary>
        </>
      ) : null}
    </Stack>
    </AccessSnapshotBoundary>
    </>
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
