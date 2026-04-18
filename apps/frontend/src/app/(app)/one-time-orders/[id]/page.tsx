'use client';

import React, { useEffect, useMemo, useState } from 'react';

import {
  assignOneTimeOrderManager,
  changeOneTimeOrderStatus,
  createOneTimeOrderComment,
  getOneTimeOrderById,
  listOneTimeOrderComments,
  listOneTimeOrderHistory,
  removeOneTimeOrderManager,
  updateOneTimeOrder,
} from '@/entities/one-time-order/api/one-time-order-client';
import type {
  OneTimeOrderCommentItem,
  OneTimeOrderHistoryItem,
  OneTimeOrderItem,
} from '@/entities/one-time-order/model/one-time-order.types';
import {
  listTasksByOneTimeOrder,
  createTask,
} from '@/entities/task/api/task-client';
import type { TaskItem } from '@/entities/task/model/task.types';
import {
  listFilesByEntity,
  uploadFileToEntity,
} from '@/entities/file/api/file-client';
import type { AttachedFile } from '@/entities/file/model/file.types';
import { listObjects } from '@/entities/object/api/object-client';
import type { ServiceObject } from '@/entities/object/model/object.types';
import {
  listOneTimeOrderManagerCandidates,
  listOneTimeOrderTaskAssigneeCandidates,
} from '@/entities/user/api/user-client';
import type { SystemUserOption } from '@/entities/user/model/user.types';
import { OneTimeOrderSummaryCard } from '@/features/one-time-order-card/ui/one-time-order-summary-card';
import { OneTimeOrderForm } from '@/features/one-time-order-form/ui/one-time-order-form';
import { OneTimeOrderManagersPanel } from '@/features/one-time-order-managers/ui/one-time-order-managers-panel';
import { OneTimeOrderCommentsPanel } from '@/features/one-time-order-comments/ui/one-time-order-comments-panel';
import { OneTimeOrderHistoryList } from '@/features/one-time-order-history/ui/one-time-order-history-list';
import { OneTimeOrderFilesPanel } from '@/features/one-time-order-files/ui/one-time-order-files-panel';
import { OneTimeOrderTasksPanel } from '@/features/one-time-order-tasks/ui/one-time-order-tasks-panel';
import { useAuth } from '@/shared/auth/use-auth';
import {
  ONE_TIME_ORDER_STATUS_OPTIONS,
  getOneTimeOrderStatusLabel,
} from '@/shared/lib/one-time-order-presentation';
import { PageTitle } from '@/shared/ui/page-title/page-title';

function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  return fallback;
}

export default function OneTimeOrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): React.JSX.Element {
  const { user } = useAuth();

  const [item, setItem] = useState<OneTimeOrderItem | null>(null);
  const [comments, setComments] = useState<OneTimeOrderCommentItem[]>([]);
  const [history, setHistory] = useState<OneTimeOrderHistoryItem[]>([]);
  const [files, setFiles] = useState<AttachedFile[]>([]);
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [managerCandidates, setManagerCandidates] = useState<SystemUserOption[]>([]);
  const [taskAssignees, setTaskAssignees] = useState<SystemUserOption[]>([]);
  const [objectOptions, setObjectOptions] = useState<ServiceObject[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const canSelectLinkedObject =
    Boolean(item?.capabilities.canEdit) &&
    (user?.capabilities?.canCreateObject ?? false);

  const editableInitialValue = useMemo(
    () =>
      item
        ? {
            title: item.title,
            executionAddress: item.executionAddress,
            linkedObjectId: item.linkedObject?.id,
            status: item.status,
            description: item.description ?? undefined,
            executionDate: item.executionDate ?? undefined,
            contactName: item.contactName,
            contactPhone: item.contactPhone ?? undefined,
            agreedSum: item.agreedSum ?? undefined,
            financialNotes: item.financialNotes ?? undefined,
            expenseNotes: item.expenseNotes ?? undefined,
          }
        : undefined,
    [item],
  );

  useEffect(() => {
    let cancelled = false;

    const load = async (): Promise<void> => {
      setIsLoading(true);
      setError(null);

      try {
        const resolved = await params;

        if (cancelled) {
          return;
        }

        await loadAll(resolved.id, cancelled);
      } catch (loadError) {
        if (!cancelled) {
          setError(
            getErrorMessage(loadError, 'Не удалось загрузить карточку заказа.'),
          );
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [params, user?.capabilities?.canCreateObject]);

  const loadAll = async (id: string, cancelled = false): Promise<void> => {
    const order = await getOneTimeOrderById(id);

    if (cancelled) {
      return;
    }

    setItem(order);

    const requests: Array<Promise<void>> = [
      listOneTimeOrderComments(id).then((response) => {
        if (!cancelled) {
          setComments(response);
        }
      }),
      listOneTimeOrderHistory(id).then((response) => {
        if (!cancelled) {
          setHistory(response);
        }
      }),
      listFilesByEntity('one_time_order', id).then((response) => {
        if (!cancelled) {
          setFiles(response);
        }
      }),
      listTasksByOneTimeOrder(id).then((response) => {
        if (!cancelled) {
          setTasks(response);
        }
      }),
    ];

    if (order.capabilities.canManageManagers) {
      requests.push(
        listOneTimeOrderManagerCandidates(id).then((response) => {
          if (!cancelled) {
            setManagerCandidates(response);
          }
        }),
      );
    } else if (!cancelled) {
      setManagerCandidates([]);
    }

    if (order.capabilities.canCreateTask) {
      requests.push(
        listOneTimeOrderTaskAssigneeCandidates(id).then((response) => {
          if (!cancelled) {
            setTaskAssignees(response);
          }
        }),
      );
    } else if (!cancelled) {
      setTaskAssignees([]);
    }

    if (
      order.capabilities.canEdit &&
      (user?.capabilities?.canCreateObject ?? false)
    ) {
      requests.push(
        listObjects().then((response) => {
          if (!cancelled) {
            setObjectOptions(response);
          }
        }),
      );
    } else if (!cancelled) {
      setObjectOptions([]);
    }

    await Promise.all(requests);
  };

  return (
    <>
      <PageTitle title={item ? item.title : 'Разовый заказ'} />

      {isLoading ? (
        <div className="page-card">Загрузка...</div>
      ) : error ? (
        <div className="page-card" style={{ color: '#b91c1c' }}>
          {error}
        </div>
      ) : item ? (
        <div style={{ display: 'grid', gap: 16 }}>
          <OneTimeOrderSummaryCard item={item} />

          {item.capabilities.canChangeStatus ? (
            <div className="page-card">
              <div style={{ fontWeight: 600, marginBottom: 12 }}>
                Статус заказа
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {ONE_TIME_ORDER_STATUS_OPTIONS.filter(
                  (option) => option.value !== item.status,
                ).map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={async () => {
                      const updated = await changeOneTimeOrderStatus(
                        item.id,
                        option.value,
                      );
                      setItem(updated);
                      await loadAll(item.id);
                    }}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              <div className="page-muted" style={{ marginTop: 12 }}>
                Текущий статус: {getOneTimeOrderStatusLabel(item.status)}
              </div>
            </div>
          ) : null}

          {item.capabilities.canEdit && editableInitialValue ? (
            <OneTimeOrderForm
              objects={objectOptions}
              managerOptions={[]}
              initialValue={editableInitialValue}
              canSelectLinkedObject={canSelectLinkedObject}
              includeManagers={false}
              allowStatusEdit={false}
              submitLabel="Сохранить изменения"
              onSubmit={async (payload) => {
                const updated = await updateOneTimeOrder(item.id, payload);
                setItem(updated);
                await loadAll(item.id);
              }}
            />
          ) : null}

          <OneTimeOrderManagersPanel
            item={item}
            candidates={managerCandidates}
            onAssign={async (userId) => {
              const updated = await assignOneTimeOrderManager(item.id, userId);
              setItem(updated);
              await loadAll(item.id);
            }}
            onRemove={async (userId) => {
              const updated = await removeOneTimeOrderManager(item.id, userId);
              setItem(updated);
              await loadAll(item.id);
            }}
          />

          <OneTimeOrderCommentsPanel
            items={comments}
            canCreate={item.capabilities.canComment}
            onCreate={async (payload) => {
              await createOneTimeOrderComment(item.id, payload);
              await loadAll(item.id);
            }}
          />

          <OneTimeOrderFilesPanel
            files={files}
            canUpload={item.capabilities.canAttachFiles}
            onUpload={async (file) => {
              await uploadFileToEntity({
                entityType: 'one_time_order',
                entityId: item.id,
                file,
              });
              await loadAll(item.id);
            }}
          />

          <OneTimeOrderTasksPanel
            items={tasks}
            assigneeOptions={taskAssignees}
            canCreateTask={item.capabilities.canCreateTask}
            onCreate={async (payload) => {
              await createTask({
                ...payload,
                oneTimeOrderId: item.id,
              });
              await loadAll(item.id);
            }}
          />

          <OneTimeOrderHistoryList items={history} />
        </div>
      ) : (
        <div className="page-card">Разовый заказ не найден.</div>
      )}
    </>
  );
}
