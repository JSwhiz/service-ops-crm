'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';

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
  listOneTimeOrderHistoryPage,
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
  OneTimeOrderHistoryPage,
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
  uploadFileBatch,
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
import { WorkspaceTabs } from '@/shared/ui/workspace-tabs/workspace-tabs';
import { hasHistoryFilters, HistoryFilterBar, type HistoryFilterValues } from '@/shared/ui/history-filters/history-filter-bar';
import { TablePagination } from '@/shared/ui/table-pagination/table-pagination';
import { ConfirmDialog, useConfirm } from '@/shared/ui/overlays';
import { usePageExitGuard } from '@/shared/lib/use-page-exit-guard';
import { OneTimeOrderForm } from '@/features/one-time-order-form/ui/one-time-order-form';
import { OneTimeOrderManagersPanel } from '@/features/one-time-order-managers/ui/one-time-order-managers-panel';
import { OneTimeOrderInventoryPanel } from '@/features/one-time-order-inventory/ui/one-time-order-inventory-panel';
import { OneTimeOrderCommentsPanel } from '@/features/one-time-order-comments/ui/one-time-order-comments-panel';
import { OneTimeOrderHistoryList, getOneTimeOrderHistoryActionLabel } from '@/features/one-time-order-history/ui/one-time-order-history-list';
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
import { OneTimeOrderEscortsPanel } from '@/features/one-time-order-operations/ui/one-time-order-escorts-panel';
import { OneTimeOrderServiceLinesPanel } from '@/features/one-time-order-operations/ui/one-time-order-service-lines-panel';
import { OneTimeOrderDeadlinePanel } from '@/features/one-time-order-operations/ui/one-time-order-deadline-panel';
import { EquipmentScopePanel } from '@/features/equipment-scope/ui/equipment-scope-panel';
import {
  ONE_TIME_ORDER_STATUS_OPTIONS,
  getOneTimeOrderConflictTypeLabel,
  getOneTimeOrderPlannedPaymentMethodLabel,
  getOneTimeOrderStatusLabel,
} from '@/shared/lib/one-time-order-presentation';
import type { SearchableSelectOption } from '@/shared/ui/searchable-select/searchable-select';
import styles from './one-time-order-detail.module.css';
import { Alert, Button, ButtonLink, EmptyState, LoadingState, StatusBadge, Surface } from '@/shared/ui/foundation';
import orderStyles from '@/entities/one-time-order/ui/one-time-order-ui.module.css';

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

type ScheduleConflict = { date: string; type: string; user: { fullName: string } };

const EMPTY_HISTORY_FILTERS: HistoryFilterValues = {
  q: '', eventType: '', actorUserId: '', dateFrom: '', dateTo: '',
};

export default function OneTimeOrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): React.JSX.Element {
  const [item, setItem] = useState<OneTimeOrderItem | null>(null);
  const [comments, setComments] = useState<OneTimeOrderCommentItem[]>([]);
  const [completions, setCompletions] = useState<OneTimeOrderCompletion[]>([]);
  const [dailyReport, setDailyReport] = useState<OneTimeOrderDailyReportItem | null>(null);
  const [historyPageData, setHistoryPageData] = useState<OneTimeOrderHistoryPage | null>(null);
  const [historyPageNumber, setHistoryPageNumber] = useState(1);
  const [historyFilters, setHistoryFilters] = useState(EMPTY_HISTORY_FILTERS);
  const [appliedHistoryFilters, setAppliedHistoryFilters] = useState(EMPTY_HISTORY_FILTERS);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historyLoadedQueryKey, setHistoryLoadedQueryKey] = useState<string | null>(null);
  const [historyRetry, setHistoryRetry] = useState(0);
  const [historyRefreshVersion, setHistoryRefreshVersion] = useState(0);
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
  const [activeSection, setActiveSection] = useState('overview');
  const [isEditing, setIsEditing] = useState(false);
  const [isEditFormDirty, setIsEditFormDirty] = useState(false);
  const [isCompletionDraftDirty, setIsCompletionDraftDirty] = useState(false);
  const [completionFormSignal, setCompletionFormSignal] = useState(0);
  const activeSectionRef = useRef('overview');
  const [confirm, editConfirmDialog] = useConfirm();
  usePageExitGuard(
    (isEditing && isEditFormDirty) || isCompletionDraftDirty,
    confirm,
  );
  const [scheduleConflictPrompt, setScheduleConflictPrompt] = useState<{
    conflicts: ScheduleConflict[];
    resolve: (confirmed: boolean) => void;
  } | null>(null);

  const confirmScheduleConflicts = (conflicts: ScheduleConflict[]): Promise<boolean> =>
    new Promise((resolve) => setScheduleConflictPrompt({ conflicts, resolve }));

  const closeScheduleConflictPrompt = (confirmed: boolean): void => {
    setScheduleConflictPrompt((current) => {
      current?.resolve(confirmed);
      return null;
    });
  };

  const canSelectLinkedObject = Boolean(item?.capabilities.canChangeLinkedObject);

  const sections = [
    { value: 'overview', label: 'Обзор' },
    { value: 'execution', label: 'Работы' },
    { value: 'team', label: 'Команда' },
    { value: 'finance', label: 'Финансы и ресурсы' },
    { value: 'materials', label: 'Медиа' },
    { value: 'discussion', label: 'Комментарии' },
    { value: 'history', label: 'История' },
  ];

  useEffect(() => {
    const syncFromUrl = async (): Promise<void> => {
      const candidate = new URL(window.location.href).searchParams.get('section');
      const next = sections.some((section) => section.value === candidate) ? candidate! : 'overview';
      if (isEditing && isEditFormDirty && next !== activeSectionRef.current) {
        const accepted = await confirm({
          title: 'Покинуть редактирование?',
          consequence: 'Несохранённые изменения заказа будут удалены.',
          confirmLabel: 'Перейти без сохранения',
          tone: 'danger',
        });
        if (!accepted) {
          const url = new URL(window.location.href);
          url.searchParams.set('section', activeSectionRef.current);
          window.history.pushState(null, '', `${url.pathname}${url.search}${url.hash}`);
          return;
        }
        setIsEditing(false);
        setIsEditFormDirty(false);
      }
      activeSectionRef.current = next;
      setActiveSection(next);
    };
    void syncFromUrl();
    window.addEventListener('popstate', syncFromUrl);
    return () => window.removeEventListener('popstate', syncFromUrl);
  }, [confirm, isEditing, isEditFormDirty]);

  useEffect(() => {
    if (isLoading || activeSection !== 'execution') return;
    let frame: number | undefined;
    const revealExecutionTarget = (): void => {
      const anchor = window.location.hash.slice(1);
      if (anchor !== 'one-time-order-specification' && anchor !== 'one-time-order-tasks') return;
      if (frame !== undefined) window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        const target = document.getElementById(anchor);
        target?.focus({ preventScroll: true });
        target?.scrollIntoView({ block: 'start' });
      });
    };
    revealExecutionTarget();
    window.addEventListener('hashchange', revealExecutionTarget);
    return () => {
      if (frame !== undefined) window.cancelAnimationFrame(frame);
      window.removeEventListener('hashchange', revealExecutionTarget);
    };
  }, [activeSection, isLoading, item?.id]);

  const selectSection = async (section: string): Promise<void> => {
    if (isEditing && isEditFormDirty && section !== activeSectionRef.current) {
      const accepted = await confirm({
        title: 'Покинуть редактирование?',
        consequence: 'Несохранённые изменения заказа будут удалены.',
        confirmLabel: 'Перейти без сохранения',
        tone: 'danger',
      });
      if (!accepted) return;
      setIsEditing(false);
      setIsEditFormDirty(false);
    }
    activeSectionRef.current = section;
    setActiveSection(section);
    const url = new URL(window.location.href);
    url.searchParams.set('section', section);
    window.history.pushState(null, '', `${url.pathname}${url.search}${url.hash}`);
  };

  const startEditing = (): void => {
    if (!isEditing) {
      setIsEditing(true);
      setIsEditFormDirty(false);
      activeSectionRef.current = 'overview';
      setActiveSection('overview');
      const url = new URL(window.location.href);
      url.searchParams.set('section', 'overview');
      window.history.pushState(null, '', `${url.pathname}${url.search}${url.hash}`);
      return;
    }
    void confirm({
      title: 'Отменить редактирование?',
      consequence: isEditFormDirty ? 'Введённые изменения заказа будут удалены.' : 'Форма редактирования закроется без сохранения.',
      confirmLabel: isEditFormDirty ? 'Отменить и удалить изменения' : 'Закрыть форму',
      tone: isEditFormDirty ? 'danger' : 'neutral',
    }).then((accepted) => {
      if (accepted) {
        setIsEditing(false);
        setIsEditFormDirty(false);
      }
    });
  };

  useEffect(() => {
    if (!item?.capabilities.canEditOperationalFields) return;
    const url = new URL(window.location.href);
    if (url.searchParams.get('edit') !== '1') return;
    setIsEditing(true);
    setIsEditFormDirty(false);
    activeSectionRef.current = 'overview';
    setActiveSection('overview');
  }, [item?.id, item?.capabilities.canEditOperationalFields]);

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
    setHistoryRefreshVersion((version) => version + 1);

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

  useEffect(() => {
    const timeout = window.setTimeout(() => setAppliedHistoryFilters(historyFilters), 250);
    return () => window.clearTimeout(timeout);
  }, [historyFilters]);

  const historyQueryKey = JSON.stringify([item?.id, historyPageNumber, appliedHistoryFilters]);

  useEffect(() => {
    const orderId = item?.id;
    if (activeSection !== 'history' || !orderId) return;
    let active = true;
    const requestKey = historyQueryKey;
    setHistoryLoading(true);
    setHistoryError(null);
    void listOneTimeOrderHistoryPage(orderId, {
      page: historyPageNumber,
      limit: 25,
      q: appliedHistoryFilters.q.trim() || undefined,
      eventType: appliedHistoryFilters.eventType || undefined,
      actorUserId: appliedHistoryFilters.actorUserId || undefined,
      dateFrom: appliedHistoryFilters.dateFrom || undefined,
      dateTo: appliedHistoryFilters.dateTo || undefined,
    })
      .then((response) => {
        if (!active) return;
        setHistoryPageData(response);
        setHistoryLoadedQueryKey(requestKey);
      })
      .catch((caughtError) => {
        if (active) setHistoryError(getErrorMessage(caughtError, 'Не удалось загрузить историю заказа.'));
      })
      .finally(() => {
        if (active) setHistoryLoading(false);
      });
    return () => { active = false; };
  }, [activeSection, appliedHistoryFilters, historyPageNumber, historyQueryKey, historyRefreshVersion, historyRetry, item?.id]);

  const history = historyPageData?.items ?? [];

  const activeWorkforce = workforce.filter((employee) => employee.isActive);
  const formerWorkforce = workforce.filter((employee) => !employee.isActive);

  return (
    <div className={`ui-page ${orderStyles.orderDetailPage}`}>
      {isLoading ? (
        <LoadingState label="Загрузка разового заказа…" />
      ) : error ? (
        <Alert tone="warning" role="alert">
          {error}
        </Alert>
      ) : item ? (
        <div className="ui-stack ui-stack--lg order-detail-workspace">
          <OneTimeOrderSummaryCard
            item={item}
            isEditing={isEditing}
            onEdit={startEditing}
            onComplete={() => { void selectSection('finance').then(() => { if (activeSectionRef.current !== 'finance') return; setCompletionFormSignal((value) => value + 1); window.setTimeout(() => document.getElementById('order-completion')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0); }); }}
            onReopen={() => { void selectSection('finance').then(() => { if (activeSectionRef.current !== 'finance') return; window.setTimeout(() => { const action = document.getElementById('order-reopen-trigger'); action?.scrollIntoView({ behavior: 'smooth', block: 'center' }); action?.click(); }, 0); }); }}
          />

          <WorkspaceTabs
            items={sections}
            value={activeSection}
            onChange={selectSection}
            label="Разделы разового заказа"
          />

          <div className={`ui-stack ${styles.content} ${orderStyles.orderDetailContent}`} id="workspace-panel-team" role="tabpanel" aria-labelledby="workspace-tab-team" hidden={activeSection !== 'team'}>
          <Surface as="section" padding="md" className={orderStyles.orderTeamOverview}>
            <div className="ui-section-header">
              <div>
                <div className="ui-section-title">Состав разового заказа</div>
                <div className="ui-section-subtitle">
                  Менеджеры — пользователи CRM; сотрудники — отдельные кадровые записи. Оплата за заказ не является отметкой о фактическом выходе.
                </div>
              </div>
              <ButtonLink href={`/one-time-orders/${item.id}/workforce`}>
                Управлять составом
              </ButtonLink>
            </div>
            <div className={orderStyles.orderTeamMetrics} aria-label="Сводка команды">
              <div className="ui-detail-field"><div className="ui-detail-label">Менеджеры CRM</div><strong>{item.managers.length}</strong></div>
              <div className="ui-detail-field"><div className="ui-detail-label">Активные сотрудники</div><strong>{activeWorkforce.length}</strong></div>
              {formerWorkforce.length ? <div className="ui-detail-field"><div className="ui-detail-label">Сняты с состава</div><strong>{formerWorkforce.length}</strong></div> : null}
            </div>
            <section className="ui-stack ui-stack--sm" aria-labelledby="order-workforce-summary-heading">
              <h3 className="ui-section-title" id="order-workforce-summary-heading">Сотрудники и согласованная оплата</h3>
              {activeWorkforce.length === 0 ? (
                <EmptyState title="Сотрудники ещё не добавлены" description="Добавьте кадровый состав в управлении командой. Фактические выходы отмечаются отдельно." />
              ) : (
                <div className={orderStyles.orderTeamEmployeeList}>
                  {activeWorkforce.map((employee) => (
                    <div className={orderStyles.orderTeamEmployee} key={employee.employeeId}>
                      <div>
                        <strong>{employee.fullName}</strong>
                        <div className="ui-text-muted">{employee.position ?? 'Должность не указана'}</div>
                      </div>
                      <div className={orderStyles.orderAmount}>
                        <div className="ui-text-muted">Оплата за заказ</div>
                        <strong>{employee.orderPayment === null ? 'Не указана' : `${employee.orderPayment.toLocaleString('ru-RU', { maximumFractionDigits: 2 })} ₽`}</strong>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
            {formerWorkforce.length ? (
              <details>
                <summary className={orderStyles.orderTeamFormerSummary}>Сотрудники, снятые с состава ({formerWorkforce.length})</summary>
                <ul className="ui-plain-list">
                  {formerWorkforce.map((employee) => <li key={employee.employeeId}>{employee.fullName}{employee.position ? ` · ${employee.position}` : ''}{employee.removedAt ? ` · снят ${new Date(employee.removedAt).toLocaleDateString('ru-RU')}` : ''}</li>)}
                </ul>
              </details>
            ) : null}
          </Surface>
          <OneTimeOrderManagersPanel
            item={item}
            searchCandidates={(query) => listOneTimeOrderManagerCandidates(item.id, query)}
            onAssign={async (userId) => {
              let conflictFingerprint: string | undefined;
              if (item.executionStartDate && item.executionEndDate) {
                const result = await checkOneTimeOrderConflicts({
                  executionStartDate: item.executionStartDate,
                  executionEndDate: item.executionEndDate,
                  managerUserIds: [userId], excludeOrderId: item.id,
                });
                if (result.hasConflicts) {
                  const confirmed = await confirmScheduleConflicts(result.conflicts);
                  if (!confirmed) return;
                  conflictFingerprint = result.conflictFingerprint;
                }
              }
              const updated = await assignOneTimeOrderManager(item.id, userId, conflictFingerprint);
              setItem(updated); await loadAll(item.id);
            }}
            onRemove={async (userId) => {
              const updated = await removeOneTimeOrderManager(item.id, userId);
              setItem(updated); await loadAll(item.id);
            }}
          />
          <OneTimeOrderEscortsPanel orderId={item.id} workforce={workforce} onChanged={() => loadAll(item.id)} />
          </div>

          <div className={`ui-stack ${styles.content} ${orderStyles.orderDetailContent}`} id="workspace-panel-overview" role="tabpanel" aria-labelledby="workspace-tab-overview" hidden={activeSection !== 'overview'}>
          <OneTimeOrderDeadlinePanel orderId={item.id} onChanged={() => loadAll(item.id)} />
          {item.capabilities.canChangeStatus ? (
            <Surface padding="md">
              <div className="ui-section-header">
                <div>
                  <div className="ui-section-title">Статус заказа</div>
                  <div className="ui-section-subtitle">
                    Выберите следующий статус заказа.
                  </div>
                </div>
                <StatusBadge status={item.status}>
                  {getOneTimeOrderStatusLabel(item.status)}
                </StatusBadge>
              </div>
              <div className="ui-inline">
                {ONE_TIME_ORDER_STATUS_OPTIONS.filter(
                  (option) =>
                    option.value !== item.status && option.value !== 'completed',
                ).map((option) => (
                  <Button
                    key={option.value}
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
                          const confirmed = await confirmScheduleConflicts(result.conflicts);
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
                  </Button>
                ))}
              </div>
            </Surface>
          ) : null}

          {item.description ? (
            <Surface as="section" padding="md">
              <h2 className="ui-section-title">Описание заказа</h2>
              <p className={styles.longText}>{item.description}</p>
            </Surface>
          ) : null}

          <OneTimeOrderReviewPanel
            item={item}
            onSave={async (payload) => { const updated = await updateOneTimeOrderReview(item.id, payload); setItem(updated); await loadAll(item.id); }}
            onClear={async () => { const updated = await clearOneTimeOrderReview(item.id); setItem(updated); await loadAll(item.id); }}
          />

          {isEditing && item.capabilities.canEditOperationalFields && editableInitialValue ? (
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
              formId="one-time-order-edit-form"
              autoFocus
              onDirtyChange={setIsEditFormDirty}
              onCancel={() => startEditing()}
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
                    const confirmed = await confirmScheduleConflicts(result.conflicts);
                    if (!confirmed) return;
                    conflictFingerprint = result.conflictFingerprint;
                  }
                }
                const updated = await updateOneTimeOrder(item.id, {
                  ...payload,
                  conflictFingerprint,
                });
                setItem(updated);
                setIsEditing(false);
                setIsEditFormDirty(false);
                await loadAll(item.id);
              }}
            />
          ) : null}
          </div>

          <div className={`ui-stack ${styles.content} ${orderStyles.orderDetailContent}`} id="workspace-panel-finance" role="tabpanel" aria-labelledby="workspace-tab-finance" hidden={activeSection !== 'finance'}>
          {item.financialNotes || item.expenseNotes || item.plannedPaymentMethod ? (
            <Surface as="section" padding="md">
              <div className="ui-section-header">
                <div>
                  <h2 className="ui-section-title">Условия заказа</h2>
                  <div className="ui-section-subtitle">Договорённости и заметки; это не подтверждение полученных денег.</div>
                </div>
              </div>
              <div className="ui-detail-grid">
                {item.plannedPaymentMethod ? <div className="ui-detail-field"><div className="ui-detail-label">Плановый способ оплаты</div><div className="ui-detail-value">{getOneTimeOrderPlannedPaymentMethodLabel(item.plannedPaymentMethod)}</div></div> : null}
                {item.financialNotes ? <div className="ui-detail-field"><div className="ui-detail-label">Заметка по оплате</div><div className={`ui-detail-value ${orderStyles.orderLongText}`}>{item.financialNotes}</div></div> : null}
                {item.expenseNotes ? <div className="ui-detail-field"><div className="ui-detail-label">Заметка о расходах</div><div className={`ui-detail-value ${orderStyles.orderLongText}`}>{item.expenseNotes}</div></div> : null}
              </div>
            </Surface>
          ) : null}
          <OneTimeOrderCompletionPanel
            item={item}
            completions={completions}
            onComplete={async (payload) => { await completeOneTimeOrder(item.id, payload); }}
            onRefresh={async () => {
              try {
                await loadAll(item.id);
                return true;
              } catch {
                return false;
              }
            }}
            onDraftChange={setIsCompletionDraftDirty}
            onReopen={async () => { await reopenOneTimeOrder(item.id); await loadAll(item.id); }}
            onCorrectPayment={async (paymentId, payload) => { await correctOneTimeOrderPayment(item.id, paymentId, payload); await loadAll(item.id); }}
            openFormSignal={completionFormSignal}
          />
          {accountability ? (
            <OneTimeOrderAccountabilityPanel
              view={accountability}
              completions={completions}
              orderStatus={item.status}
              workforce={workforce}
              workCycle={item.workCycle}
              onCreateExpense={async (payload) => {
                const expense = await createAccountabilityExpense({
                  amount: payload.amount,
                  description: payload.description,
                  oneTimeOrderId: item.id,
                  oneTimeOrderCompletionId:
                    payload.oneTimeOrderCompletionId,
                  employeeId: payload.employeeId,
                  oneTimeOrderWorkCycle:
                    payload.oneTimeOrderWorkCycle ?? undefined,
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
          <OneTimeOrderInventoryPanel items={inventoryMovements} />
          {equipment ? (
            <EquipmentScopePanel title="Оборудование заказа" units={equipment.units} />
          ) : null}
          </div>

          <div className={`ui-stack ${styles.content} ${orderStyles.orderDetailContent}`} id="workspace-panel-discussion" role="tabpanel" aria-labelledby="workspace-tab-discussion" hidden={activeSection !== 'discussion'}>
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
          <Surface padding="md">
            <div className="ui-section-header">
              <div><div className="ui-section-title">Рабочий чат разовых заказов</div><div className="ui-section-subtitle">Полный мессенджер живет отдельно от комментариев заказа.</div></div>
              <ButtonLink variant="ghost" href="/chats?room=one_time_orders">Открыть чат</ButtonLink>
            </div>
          </Surface>
          </div>

          <div className={`ui-stack ${styles.content} ${orderStyles.orderDetailContent}`} id="workspace-panel-execution" role="tabpanel" aria-labelledby="workspace-tab-execution" hidden={activeSection !== 'execution'}>
          <section id="one-time-order-specification" className={styles.executionAnchor} tabIndex={-1} aria-label="Техническое задание">
          <OneTimeOrderSpecificationPanel orderId={item.id} canManage={item.capabilities.canManageSpecification} canEditStructure={item.capabilities.canEditSpecification} orderStatus={item.status} onOpenDailyReport={() => { void selectSection('execution').then(() => { if (activeSectionRef.current === 'execution') window.setTimeout(() => document.getElementById('one-time-order-daily-report')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0); }); }} />
          </section>
          <section className="ui-stack ui-stack--lg" aria-label="Услуги заказа">
                <OneTimeOrderServiceLinesPanel orderId={item.id} onChanged={() => loadAll(item.id)} />
                <div className="ui-section-subtitle">
                  Услуги относятся к заказу «{item.title}»
                  {item.linkedObject ? ` · Объект: ${item.linkedObject.name}` : ''}.
                  {' '}Состав сотрудников и фактические выходы доступны в разделе «Команда».
                  {' '}Расходники и оборудование — в разделе «Финансы и ресурсы».
                </div>
          </section>
          <OneTimeOrderDailyReportPanel
            item={dailyReport}
            onSave={async (payload) => {
              const saved = await upsertTodayOneTimeOrderDailyReport(item.id, {
                content: payload.content,
              });

              setDailyReport(saved);
              const uploads = await uploadFileBatch({ entityType: 'one_time_order_daily_report', entityId: saved.id, files: payload.files });

              await loadAll(item.id);
              if (uploads.some((result) => result.status === 'rejected')) throw new Error('Текст отчёта сохранён. Не все вложения загрузились — повторите сохранение, уже загруженные файлы не продублируются.');
            }}
          />
          <section id="one-time-order-tasks" className={styles.executionAnchor} tabIndex={-1} aria-label="Задачи заказа">
          <OneTimeOrderTasksPanel
            items={tasks} assigneeOptions={taskAssignees}
            canCreateTask={item.capabilities.canCreateTask}
            linkedObject={item.linkedObject}
            onCreate={async ({ linkToObject, ...payload }) => {
              await createTask({ ...payload, ...(item.linkedObject && linkToObject ? { objectId: item.linkedObject.id } : {}), oneTimeOrderId: item.id, visibilityType: 'target_participants', requiresConfirmation: true, completionRequirement: 'comment_or_file' });
              await loadAll(item.id);
            }}
          />
          </section>
          </div>

          <div className={`ui-stack ${styles.content} ${orderStyles.orderDetailContent}`} id="workspace-panel-materials" role="tabpanel" aria-labelledby="workspace-tab-materials" hidden={activeSection !== 'materials'}>
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

          </div>

          <div className={`ui-stack ${styles.content} ${orderStyles.orderDetailContent}`} id="workspace-panel-history" role="tabpanel" aria-labelledby="workspace-tab-history" hidden={activeSection !== 'history'}>
            <HistoryFilterBar
              filters={historyFilters}
              eventTypes={(historyPageData?.facets.eventTypes ?? []).map((eventType) => ({
                value: eventType,
                label: getOneTimeOrderHistoryActionLabel(eventType),
              }))}
              actors={historyPageData?.facets.actors ?? []}
              actorsHasMore={historyPageData?.facets.actorsHasMore ?? false}
              eventTypesHasMore={historyPageData?.facets.eventTypesHasMore ?? false}
              busy={historyLoading}
              onActorSearch={async (actorSearch) => {
                const result = await listOneTimeOrderHistoryPage(item.id, {
                  page: 1, limit: 1, actorSearch,
                });
                return result.facets.actors;
              }}
              onChange={(nextFilters) => {
                setHistoryFilters(nextFilters);
                setHistoryPageNumber(1);
              }}
            />
            {historyError || (historyLoadedQueryKey !== historyQueryKey && history.length > 0) ? (
              <Alert tone={historyError ? 'warning' : 'info'} role={historyError ? 'alert' : 'status'}>
                <div className="ui-inline">
                  <span>{historyError ?? 'Показаны события по предыдущим фильтрам, пока загружается новый результат.'}</span>
                  {historyError ? <Button onClick={() => setHistoryRetry((value) => value + 1)}>Повторить</Button> : null}
                </div>
              </Alert>
            ) : null}
            {historyLoading && history.length === 0 ? <LoadingState label="Загружаем историю…" /> : null}
            {historyPageData && (!historyLoading || history.length > 0) ? (
              <OneTimeOrderHistoryList
                items={history}
                emptyText={historyLoadedQueryKey === historyQueryKey && historyPageData.total === 0 && hasHistoryFilters(appliedHistoryFilters) ? 'По выбранным фильтрам событий нет.' : 'История по заказу пока пуста.'}
              />
            ) : null}
            {historyPageData ? (
              <TablePagination
                page={historyPageData.page}
                totalPages={historyPageData.totalPages}
                pending={historyLoading || historyLoadedQueryKey !== historyQueryKey}
                label="Страницы истории заказа"
                summary={historyPageData.total > 0 ? `Показано ${(historyPageData.page - 1) * historyPageData.limit + 1}–${Math.min(historyPageData.page * historyPageData.limit, historyPageData.total)} из ${historyPageData.total}` : 'Событий не найдено'}
                onPageChange={setHistoryPageNumber}
              />
            ) : null}
          </div>
        </div>
      ) : (
        <EmptyState title="Разовый заказ не найден" description="Вернитесь к списку, чтобы выбрать доступный заказ." action={<ButtonLink href="/one-time-orders">К разовым заказам</ButtonLink>} />
      )}
      <ConfirmDialog
        open={scheduleConflictPrompt !== null}
        onOpenChange={(open) => { if (!open) closeScheduleConflictPrompt(false); }}
        title="Конфликт расписания"
        consequence={(
          <div>
            <div>Для этого действия найдены пересечения. Продолжить?</div>
            {scheduleConflictPrompt ? (
              <ul>
                {scheduleConflictPrompt.conflicts
                  .filter((conflict) => conflict.type !== 'pending_availability_request')
                  .slice(0, 8)
                  .map((conflict, index) => (
                    <li key={`${conflict.date}-${conflict.user.fullName}-${index}`}>
                      {conflict.date} · {conflict.user.fullName} · {getOneTimeOrderConflictTypeLabel(conflict.type)}
                    </li>
                  ))}
              </ul>
            ) : null}
          </div>
        )}
        confirmLabel="Продолжить"
        onConfirm={() => closeScheduleConflictPrompt(true)}
      />
      {editConfirmDialog}
    </div>
  );
}
