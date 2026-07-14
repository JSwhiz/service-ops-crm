'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';

import {
  assignOneTimeOrderManager,
  changeOneTimeOrderStatus,
  clearOneTimeOrderReview,
  createOneTimeOrderPhoto,
  createOneTimeOrderComment,
  getOneTimeOrderById,
  getTodayOneTimeOrderDailyReport,
  listOneTimeOrderComments,
  listOneTimeOrderHistory,
  listOneTimeOrderPhotos,
  removeOneTimeOrderManager,
  upsertTodayOneTimeOrderDailyReport,
  updateOneTimeOrder,
  updateOneTimeOrderReview,
} from '@/entities/one-time-order/api/one-time-order-client';
import type {
  OneTimeOrderCommentItem,
  OneTimeOrderDailyReportItem,
  OneTimeOrderHistoryItem,
  OneTimeOrderItem,
  OneTimeOrderPhotoItem,
} from '@/entities/one-time-order/model/one-time-order.types';
import { getOneTimeOrderEquipment } from '@/entities/equipment/api/equipment-client';
import type { EquipmentScope } from '@/entities/equipment/model/equipment.types';
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
import { OneTimeOrderDailyReportPanel } from '@/features/one-time-order-report/ui/one-time-order-daily-report-panel';
import { OneTimeOrderPhotosPanel } from '@/features/one-time-order-photos/ui/one-time-order-photos-panel';
import { OneTimeOrderTasksPanel } from '@/features/one-time-order-tasks/ui/one-time-order-tasks-panel';
import { OneTimeOrderReviewPanel } from '@/features/one-time-order-review/ui/one-time-order-review-panel';
import { EquipmentScopePanel } from '@/features/equipment-scope/ui/equipment-scope-panel';
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
  const [item, setItem] = useState<OneTimeOrderItem | null>(null);
  const [comments, setComments] = useState<OneTimeOrderCommentItem[]>([]);
  const [dailyReport, setDailyReport] = useState<OneTimeOrderDailyReportItem | null>(null);
  const [history, setHistory] = useState<OneTimeOrderHistoryItem[]>([]);
  const [files, setFiles] = useState<AttachedFile[]>([]);
  const [photos, setPhotos] = useState<OneTimeOrderPhotoItem[]>([]);
  const [equipment, setEquipment] = useState<EquipmentScope | null>(null);
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [managerCandidates, setManagerCandidates] = useState<SystemUserOption[]>([]);
  const [taskAssignees, setTaskAssignees] = useState<SystemUserOption[]>([]);
  const [objectOptions, setObjectOptions] = useState<ServiceObject[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const canSelectLinkedObject = Boolean(item?.capabilities.canChangeLinkedObject);

  const editableInitialValue = useMemo(
    () =>
      item
        ? {
            title: item.title,
            executionAddress: item.executionAddress,
            linkedObjectId: item.linkedObject?.id,
            status: item.status,
            description: item.description ?? undefined,
            executionStartDate: item.executionStartDate,
            executionEndDate: item.executionEndDate,
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
  }, [params]);

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
      getTodayOneTimeOrderDailyReport(id).then((response) => {
        if (!cancelled) {
          setDailyReport(response);
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
      listOneTimeOrderPhotos(id).then((response) => {
        if (!cancelled) {
          setPhotos(response);
        }
      }),
      getOneTimeOrderEquipment(id).then((response) => {
        if (!cancelled) {
          setEquipment(response);
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

    if (order.capabilities.canChangeLinkedObject) {
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
        <div className="page-stack">
          <OneTimeOrderSummaryCard item={item} />

          <OneTimeOrderReviewPanel
            item={item}
            onSave={async (payload) => {
              const updated = await updateOneTimeOrderReview(item.id, payload);
              setItem(updated);
              await loadAll(item.id);
            }}
            onClear={async () => {
              const updated = await clearOneTimeOrderReview(item.id);
              setItem(updated);
              await loadAll(item.id);
            }}
          />

          <div className="page-card">
            <div className="section-header" style={{ paddingBottom: 0 }}>
              <div>
                <div className="section-title">Рабочий чат разовых заказов</div>
                <div className="section-subtitle">
                  Полный мессенджер живет отдельно от комментариев заказа.
                </div>
              </div>
              <Link href="/chats?room=one_time_orders">Открыть чат</Link>
            </div>
          </div>

          {item.capabilities.canChangeStatus ? (
            <div className="page-card">
              <div className="section-header" style={{ marginBottom: 12 }}>
                <div>
                  <div className="section-title">Статус заказа</div>
                  <div className="section-subtitle">
                    Переходы доступны только если их разрешил backend.
                  </div>
                </div>
                <span className="status-pill" data-status={item.status}>
                  {getOneTimeOrderStatusLabel(item.status)}
                </span>
              </div>
              <div className="action-row">
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
            </div>
          ) : null}

          {item.capabilities.canEditOperationalFields && editableInitialValue ? (
            <OneTimeOrderForm
              objects={objectOptions}
              managerOptions={[]}
              initialValue={editableInitialValue}
              canSelectLinkedObject={canSelectLinkedObject}
              canEditFinancialFields={
                item.capabilities.canEditFinancialFields
              }
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
              const created = await createOneTimeOrderComment(item.id, {
                content: payload.content,
                commentType: payload.commentType,
              });

              await Promise.all(
                payload.files.map((file) =>
                  uploadFileToEntity({
                    entityType: 'one_time_order_comment',
                    entityId: created.id,
                    file,
                  }),
                ),
              );
              await loadAll(item.id);
            }}
          />

          <OneTimeOrderDailyReportPanel
            item={dailyReport}
            onSave={async (payload) => {
              const saved = await upsertTodayOneTimeOrderDailyReport(item.id, {
                content: payload.content,
              });

              await Promise.all(
                payload.files.map((file) =>
                  uploadFileToEntity({
                    entityType: 'one_time_order_daily_report',
                    entityId: saved.id,
                    file,
                  }),
                ),
              );

              await loadAll(item.id);
            }}
          />

          <OneTimeOrderPhotosPanel
            items={photos}
            canCreate={item.capabilities.canAttachFiles}
            onCreate={async (payload) => {
              const created = await createOneTimeOrderPhoto(item.id, {
                category: payload.category,
                comment: payload.comment,
              });

              await Promise.all(
                payload.files.map((file) =>
                  uploadFileToEntity({
                    entityType: 'one_time_order_photo',
                    entityId: created.id,
                    file,
                  }),
                ),
              );

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

          {equipment ? (
            <EquipmentScopePanel title="Оборудование заказа" units={equipment.units} />
          ) : null}

          <OneTimeOrderTasksPanel
            items={tasks}
            assigneeOptions={taskAssignees}
            canCreateTask={item.capabilities.canCreateTask}
            onCreate={async (payload) => {
              await createTask({
                ...payload,
                oneTimeOrderId: item.id,
                visibilityMode: 'scope',
                requiresConfirmation: true,
                completionRequirement: 'comment_or_file',
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
