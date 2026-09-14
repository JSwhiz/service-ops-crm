'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';

import {
  createAccountabilityExpense,
  getOneTimeOrderAccountability,
  submitAccountabilityExpense,
} from '@/entities/accountability/api/accountability-client';
import type {
  OneTimeOrderAccountabilityView,
} from '@/entities/accountability/model/accountability.types';

import {
  assignOneTimeOrderManager,
  checkOneTimeOrderConflicts,
  changeOneTimeOrderStatus,
  clearOneTimeOrderReview,
  completeOneTimeOrder,
  correctOneTimeOrderPayment,
  createOneTimeOrderPhoto,
  createOneTimeOrderComment,
  deleteOneTimeOrderPhoto,
  getOneTimeOrderById,
  getTodayOneTimeOrderDailyReport,
  listOneTimeOrderComments,
  listOneTimeOrderCompletions,
  listOneTimeOrderHistory,
  listOneTimeOrderPhotos,
  removeOneTimeOrderManager,
  reopenOneTimeOrder,
  restoreOneTimeOrderPhoto,
  upsertTodayOneTimeOrderDailyReport,
  updateOneTimeOrder,
  updateOneTimeOrderReview,
} from '@/entities/one-time-order/api/one-time-order-client';
import type {
  OneTimeOrderCommentItem,
  OneTimeOrderCompletion,
  OneTimeOrderDailyReportItem,
  OneTimeOrderHistoryItem,
  OneTimeOrderItem,
  OneTimeOrderPhotoItem,
} from '@/entities/one-time-order/model/one-time-order.types';
import { getOneTimeOrderEquipment } from '@/entities/equipment/api/equipment-client';
import type { EquipmentScope } from '@/entities/equipment/model/equipment.types';
import { getOneTimeOrderInventory } from '@/entities/inventory/api/inventory-client';
import type { InventoryMovement } from '@/entities/inventory/model/inventory.types';
import {
  listOneTimeWorkforce,
  type OneTimeWorkforceEmployee,
} from '@/entities/one-time-order/api/one-time-order-workforce-client';
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
import { listObjectsPage } from '@/entities/object/api/object-client';
import type { ServiceObject } from '@/entities/object/model/object.types';
import {
  listOneTimeOrderManagerCandidates,
  listOneTimeOrderTaskAssigneeCandidates,
} from '@/entities/user/api/user-client';
import type { SystemUserOption } from '@/entities/user/model/user.types';
import { OneTimeOrderSummaryCard } from '@/features/one-time-order-card/ui/one-time-order-summary-card';
import { OneTimeOrderForm } from '@/features/one-time-order-form/ui/one-time-order-form';
import { OneTimeOrderManagersPanel } from '@/features/one-time-order-managers/ui/one-time-order-managers-panel';
import { OneTimeOrderInventoryPanel } from '@/features/one-time-order-inventory/ui/one-time-order-inventory-panel';
import { OneTimeOrderCommentsPanel } from '@/features/one-time-order-comments/ui/one-time-order-comments-panel';
import { OneTimeOrderHistoryList } from '@/features/one-time-order-history/ui/one-time-order-history-list';
import { OneTimeOrderFilesPanel } from '@/features/one-time-order-files/ui/one-time-order-files-panel';
import { OneTimeOrderDailyReportPanel } from '@/features/one-time-order-report/ui/one-time-order-daily-report-panel';
import { OneTimeOrderPhotosPanel } from '@/features/one-time-order-photos/ui/one-time-order-photos-panel';
import { OneTimeOrderTasksPanel } from '@/features/one-time-order-tasks/ui/one-time-order-tasks-panel';
import { OneTimeOrderReviewPanel } from '@/features/one-time-order-review/ui/one-time-order-review-panel';
import { OneTimeOrderSpecificationPanel } from '@/features/one-time-order-specification/ui/one-time-order-specification-panel';
import {
  OneTimeOrderAccountabilityPanel,
} from '@/features/one-time-order-accountability/ui/one-time-order-accountability-panel';
import { OneTimeOrderCompletionPanel } from '@/features/one-time-order-completion/ui/one-time-order-completion-panel';
import { EquipmentScopePanel } from '@/features/equipment-scope/ui/equipment-scope-panel';
import {
  ONE_TIME_ORDER_STATUS_OPTIONS,
  getOneTimeOrderConflictTypeLabel,
  getOneTimeOrderStatusLabel,
} from '@/shared/lib/one-time-order-presentation';
import { PageTitle } from '@/shared/ui/page-title/page-title';
import type { SearchableSelectOption } from '@/shared/ui/searchable-select/searchable-select';

function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  return fallback;
}

function toObjectOption(object: ServiceObject): SearchableSelectOption {
  return {
    value: object.id,
    label: object.name,
    description: [object.internalName, object.address].filter(Boolean).join(' · '),
    searchText: [object.name, object.internalName, object.address]
      .filter(Boolean)
      .join(' '),
  };
}

function confirmScheduleConflicts(
  conflicts: Array<{ date: string; type: string; user: { fullName: string } }>,
): boolean {
  const details = conflicts
    .filter((conflict) => conflict.type !== 'pending_availability_request')
    .slice(0, 8)
    .map(
      (conflict) =>
        `${conflict.date} · ${conflict.user.fullName} · ${getOneTimeOrderConflictTypeLabel(conflict.type)}`,
    )
    .join('\n');
  return window.confirm(
    `Найдены конфликты расписания:\n${details}\n\nПродолжить?`,
  );
}

export default function OneTimeOrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): React.JSX.Element {
  const [item, setItem] = useState<OneTimeOrderItem | null>(null);
  const [comments, setComments] = useState<OneTimeOrderCommentItem[]>([]);
  const [completions, setCompletions] = useState<OneTimeOrderCompletion[]>([]);
  const [dailyReport, setDailyReport] = useState<OneTimeOrderDailyReportItem | null>(null);
  const [history, setHistory] = useState<OneTimeOrderHistoryItem[]>([]);
  const [files, setFiles] = useState<AttachedFile[]>([]);
  const [photos, setPhotos] = useState<OneTimeOrderPhotoItem[]>([]);
  const [equipment, setEquipment] = useState<EquipmentScope | null>(null);
  const [inventoryMovements, setInventoryMovements] = useState<InventoryMovement[]>([]);
  const [workforce, setWorkforce] = useState<OneTimeWorkforceEmployee[]>([]);
  const [accountability, setAccountability] =
    useState<OneTimeOrderAccountabilityView | null>(null);
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [taskAssignees, setTaskAssignees] = useState<SystemUserOption[]>([]);
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
            plannedPaymentMethod: item.plannedPaymentMethod ?? undefined,
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
      listOneTimeOrderCompletions(id).then((response) => {
        if (!cancelled) {
          setCompletions(response);
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
      listOneTimeOrderPhotos(id, {
        includeDeleted: order.capabilities.canRestorePhotos,
      }).then((response) => {
        if (!cancelled) {
          setPhotos(response);
        }
      }),
      getOneTimeOrderEquipment(id).then((response) => {
        if (!cancelled) {
          setEquipment(response);
        }
      }),
      getOneTimeOrderInventory(id).then((response) => {
        if (!cancelled) {
          setInventoryMovements(response.items);
        }
      }),
      listOneTimeWorkforce(id).then((response) => {
        if (!cancelled) {
          setWorkforce(response);
        }
      }),
      listTasksByOneTimeOrder(id).then((response) => {
        if (!cancelled) {
          setTasks(response);
        }
      }),
      getOneTimeOrderAccountability(id).then((response) => {
        if (!cancelled) {
          setAccountability(response);
        }
      }),
    ];

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

    await Promise.all(requests);
  };

  return (
    <div className="workspace-page order-detail-page">
      <PageTitle title={item ? item.title : 'Разовый заказ'} />

      {isLoading ? (
        <div className="page-card workspace-empty">Загрузка...</div>
      ) : error ? (
        <div className="page-card inline-notice inline-notice--warning" role="alert">
          {error}
        </div>
      ) : item ? (
        <div className="page-stack order-detail-workspace">
          <OneTimeOrderSummaryCard item={item} />

          <section className="page-card workspace-surface">
            <div className="section-header">
              <div>
                <div className="section-title">Сотрудники и оплата за заказ</div>
                <div className="section-subtitle">
                  Разовый состав и согласованная оплата каждого сотрудника за текущий цикл.
                </div>
              </div>
              <Link className="button-link" href={`/one-time-orders/${item.id}/workforce`}>
                Открыть команду
              </Link>
            </div>

            {workforce.filter((employee) => employee.isActive).length === 0 ? (
              <div className="workspace-empty">
                Состав заказа пока не сформирован.
              </div>
            ) : (
              <div className="record-list">
                {workforce
                  .filter((employee) => employee.isActive)
                  .map((employee) => (
                    <div className="record-card" key={employee.employeeId}>
                      <div className="section-header">
                        <div>
                          <strong>{employee.fullName}</strong>
                          <div className="page-muted">
                            {employee.position ?? 'Должность не указана'}
                          </div>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          <div className="page-muted">Оплата за заказ</div>
                          <strong>
                            {employee.orderPayment === null
                              ? 'Не указана'
                              : `${employee.orderPayment.toLocaleString('ru-RU', {
                                  maximumFractionDigits: 2,
                                })} ₽`}
                          </strong>
                        </div>
                      </div>
                    </div>
                  ))}
              </div>
            )}
          </section>

          {item.capabilities.canCopy ? (
            <div className="action-row">
              <Link
                className="button-link"
                href={`/one-time-orders/new?copyFrom=${item.id}`}
              >
                Скопировать заказ
              </Link>
            </div>
          ) : null}

          <OneTimeOrderCompletionPanel
            item={item}
            completions={completions}
            onComplete={async (payload) => {
              await completeOneTimeOrder(item.id, payload);
              await loadAll(item.id);
            }}
            onReopen={async () => {
              await reopenOneTimeOrder(item.id);
              await loadAll(item.id);
            }}
            onCorrectPayment={async (paymentId, payload) => {
              await correctOneTimeOrderPayment(item.id, paymentId, payload);
              await loadAll(item.id);
            }}
          />

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

          <OneTimeOrderSpecificationPanel
            orderId={item.id}
            canManage={item.capabilities.canManageSpecification}
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
                  (option) =>
                    option.value !== item.status && option.value !== 'completed',
                ).map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={async () => {
                      let conflictFingerprint: string | undefined;
                      if (
                        item.status === 'cancelled' &&
                        option.value !== 'cancelled' &&
                        item.executionStartDate &&
                        item.executionEndDate &&
                        item.managers.length > 0
                      ) {
                        const result = await checkOneTimeOrderConflicts({
                          executionStartDate: item.executionStartDate,
                          executionEndDate: item.executionEndDate,
                          managerUserIds: item.managers.map(
                            (manager) => manager.userId,
                          ),
                          excludeOrderId: item.id,
                        });
                        if (result.hasConflicts) {
                          const confirmed = confirmScheduleConflicts(result.conflicts);
                          if (!confirmed) return;
                          conflictFingerprint = result.conflictFingerprint;
                        }
                      }
                      const updated = await changeOneTimeOrderStatus(
                        item.id,
                        option.value,
                        conflictFingerprint,
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
              initialLinkedObjectOption={
                item.linkedObject
                  ? {
                      value: item.linkedObject.id,
                      label: item.linkedObject.name,
                    }
                  : null
              }
              searchObjects={async (query) => {
                const result = await listObjectsPage({
                  q: query,
                  page: 1,
                  limit: 20,
                  sortBy: 'name',
                  sortDirection: 'asc',
                });
                return result.items.map(toObjectOption);
              }}
              initialValue={editableInitialValue}
              canSelectLinkedObject={canSelectLinkedObject}
              canEditFinancialFields={
                item.capabilities.canEditFinancialFields
              }
              includeManagers={false}
              allowStatusEdit={false}
              submitLabel="Сохранить изменения"
              onSubmit={async (payload) => {
                let conflictFingerprint: string | undefined;
                if (
                  payload.executionStartDate &&
                  payload.executionEndDate &&
                  item.managers.length > 0
                ) {
                  const result = await checkOneTimeOrderConflicts({
                    executionStartDate: payload.executionStartDate,
                    executionEndDate: payload.executionEndDate,
                    managerUserIds: item.managers.map(
                      (manager) => manager.userId,
                    ),
                    excludeOrderId: item.id,
                  });
                  if (result.hasConflicts) {
                    const confirmed = confirmScheduleConflicts(result.conflicts);
                    if (!confirmed) return;
                    conflictFingerprint = result.conflictFingerprint;
                  }
                }
                const updated = await updateOneTimeOrder(item.id, {
                  ...payload,
                  conflictFingerprint,
                });
                setItem(updated);
                await loadAll(item.id);
              }}
            />
          ) : null}

          <OneTimeOrderManagersPanel
            item={item}
            searchCandidates={(query) =>
              listOneTimeOrderManagerCandidates(item.id, query)
            }
            onAssign={async (userId) => {
              let conflictFingerprint: string | undefined;
              if (item.executionStartDate && item.executionEndDate) {
                const result = await checkOneTimeOrderConflicts({
                  executionStartDate: item.executionStartDate,
                  executionEndDate: item.executionEndDate,
                  managerUserIds: [userId],
                  excludeOrderId: item.id,
                });
                if (result.hasConflicts) {
                  const confirmed = confirmScheduleConflicts(result.conflicts);
                  if (!confirmed) return;
                  conflictFingerprint = result.conflictFingerprint;
                }
              }
              const updated = await assignOneTimeOrderManager(
                item.id,
                userId,
                conflictFingerprint,
              );
              setItem(updated);
              await loadAll(item.id);
            }}
            onRemove={async (userId) => {
              const updated = await removeOneTimeOrderManager(item.id, userId);
              setItem(updated);
              await loadAll(item.id);
            }}
          />

          {accountability ? (
            <OneTimeOrderAccountabilityPanel
              view={accountability}
              completions={completions}
              orderStatus={item.status}
              onCreateExpense={async (payload) => {
                const expense = await createAccountabilityExpense({
                  amount: payload.amount,
                  description: payload.description,
                  oneTimeOrderId: item.id,
                  oneTimeOrderCompletionId:
                    payload.oneTimeOrderCompletionId,
                  expenseCategory: payload.expenseCategory,
                  expenseDate: payload.expenseDate,
                });

                await Promise.all(
                  payload.files.map((file) =>
                    uploadFileToEntity({
                      entityType: 'accountability_expense',
                      entityId: expense.id,
                      file,
                    }),
                  ),
                );

                if (payload.submitAfterSave) {
                  await submitAccountabilityExpense(expense.id);
                }

                await loadAll(item.id);
              }}
            />
          ) : null}

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
            canCreate={item.capabilities.canUploadPhotos}
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
            onDelete={async (photoId, reason) => {
              await deleteOneTimeOrderPhoto(item.id, photoId, reason);
              await loadAll(item.id);
            }}
            onRestore={async (photoId) => {
              await restoreOneTimeOrderPhoto(item.id, photoId);
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

          <OneTimeOrderInventoryPanel items={inventoryMovements} />

          {equipment ? (
            <EquipmentScopePanel title="Оборудование заказа" units={equipment.units} />
          ) : null}

          <OneTimeOrderTasksPanel
            items={tasks}
            assigneeOptions={taskAssignees}
            canCreateTask={item.capabilities.canCreateTask}
            linkedObject={item.linkedObject}
            onCreate={async ({ linkToObject, ...payload }) => {
              await createTask({
                ...payload,
                ...(item.linkedObject && linkToObject
                  ? { objectId: item.linkedObject.id }
                  : {}),
                oneTimeOrderId: item.id,
                visibilityMode:
                  item.linkedObject && linkToObject
                    ? 'scope'
                    : 'selected',
                requiresConfirmation: true,
                completionRequirement: 'comment_or_file',
              });
              await loadAll(item.id);
            }}
          />

          <OneTimeOrderHistoryList items={history} />
        </div>
      ) : (
        <div className="page-card workspace-empty">Разовый заказ не найден.</div>
      )}
    </div>
  );
}
