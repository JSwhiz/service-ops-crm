'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@/shared/auth/use-auth';
import { useAccessRevision } from '@/shared/auth/use-access-revision';
import { getAccessGeneration, getAccessSessionGeneration, isAccessGenerationCurrent } from '@/shared/auth/access-generation';
import { AccessSnapshotBoundary } from '@/shared/auth/access-snapshot-boundary';
import { ApiError } from '@/shared/api/fetcher';
import { isSavedWithoutAccess } from '@/shared/api/saved-without-access';

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
import { getOneTimeOrderInventory, createOneTimeOrderInventoryIssue } from '@/entities/inventory/api/inventory-client';
import type { InventoryMovement, InventoryItem } from '@/entities/inventory/model/inventory.types';
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
import { assignManagerWithConflictConfirmation } from '@/features/one-time-order-managers/lib/assign-manager-with-conflicts';
import { OneTimeOrderInventoryPanel } from '@/features/one-time-order-inventory/ui/one-time-order-inventory-panel';
import { createOneTimeOrderInventoryReturn } from '@/features/one-time-order-inventory/api/order-inventory-return';
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
import { SearchableSelect, type SearchableSelectOption } from '@/shared/ui/searchable-select/searchable-select';
import styles from './one-time-order-detail.module.css';
import { Alert, Button, ButtonLink, EmptyState, LoadingState, StatusBadge, Surface } from '@/shared/ui/foundation';
import orderStyles from '@/entities/one-time-order/ui/one-time-order-ui.module.css';

function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  return fallback;
}

function getOrderLoadError(error: unknown): string {
  return error instanceof ApiError && (error.statusCode === 403 || error.statusCode === 404)
    ? 'Разовый заказ не найден или недоступен.'
    : 'Не удалось загрузить карточку заказа.';
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
  const { user, refreshUser, capabilitiesRefreshError } = useAuth();
  const resourceRenderSession = getAccessSessionGeneration();
  const accessRevision = useAccessRevision();
  const [loadedAccessRevision, setLoadedAccessRevision] = useState<string | null>(null);
  const [loadedParams, setLoadedParams] = useState<typeof params | null>(null);
  const [accessRetry, setAccessRetry] = useState(0);
  const loadGeneration = useRef(0);
  const activeOrderId = useRef<string | null>(null);
  const latestAccessRevision = useRef(accessRevision);
  latestAccessRevision.current = accessRevision;
  const latestParams = useRef(params);
  latestParams.current = params;
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
  const [fileRefreshError, setFileRefreshError] = useState<string | null>(null);
  const [photos, setPhotos] = useState<OneTimeOrderPhotoItem[]>([]);
  const [equipment, setEquipment] = useState<EquipmentScope | null>(null);
  const [inventoryMovements, setInventoryMovements] = useState<InventoryMovement[]>([]);
  const [inventoryAvailableItems, setInventoryAvailableItems] = useState<InventoryItem[]>([]);
  const [inventoryReturnItems, setInventoryReturnItems] = useState<InventoryItem[]>([]);
  const [canReturnInventory, setCanReturnInventory] = useState(false);
  const [canIssueInventory, setCanIssueInventory] = useState(false);
  const [workforce, setWorkforce] = useState<OneTimeWorkforceEmployee[]>([]);
  const [accountability, setAccountability] =
    useState<OneTimeOrderAccountabilityView | null>(null);
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [taskAssignees, setTaskAssignees] = useState<SystemUserOption[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savedManagerAssignment, setSavedManagerAssignment] = useState<{ params: typeof params; userId: string; session: number } | null>(null);
  const [savedShipment, setSavedShipment] = useState<{ params: typeof params; userId: string; hasUnsentPhotos: boolean; title?: string } | null>(null);
  const [savedExpenseNotice, setSavedExpenseNotice] = useState<{ params: typeof params; userId: string; message: string } | null>(null);
  const [expenseRecovery, setExpenseRecovery] = useState<{
    params: typeof params;
    userId: string;
    session: number;
    orderId: string;
    expenseId: string | null;
    files: File[];
    message: string;
  } | null>(null);
  const [isRetryingExpense, setIsRetryingExpense] = useState(false);
  const expenseRetryBusy = useRef(false);
  const expenseSession = getAccessSessionGeneration();

  useEffect(() => {
    setExpenseRecovery(null);
    setSavedExpenseNotice(null);
    setIsRetryingExpense(false);
    expenseRetryBusy.current = false;
  }, [params, user?.id, expenseSession]);
  const [activeSection, setActiveSection] = useState('overview');
  const [isEditing, setIsEditing] = useState(false);
  const isEditingRef = useRef(isEditing);
  isEditingRef.current = isEditing;
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
    isCurrent: () => boolean;
  } | null>(null);

  const confirmScheduleConflicts = (conflicts: ScheduleConflict[], isCurrent: () => boolean): Promise<boolean> =>
    new Promise((resolve) => {
      if (!isCurrent()) { resolve(false); return; }
      setScheduleConflictPrompt({ conflicts, resolve, isCurrent });
    });

  const orderContext = useRef({ item, params, accessRevision, capabilitiesRefreshError, ready: false });
  const snapshotReady = !capabilitiesRefreshError && !isLoading && !error && loadedAccessRevision === accessRevision && loadedParams === params;
  orderContext.current = { item, params, accessRevision, capabilitiesRefreshError, ready: snapshotReady };
  const captureOrderAction = (leaf: keyof OneTimeOrderItem['capabilities']): (() => boolean) => {
    const generation = getAccessGeneration();
    const origin = { item, params, accessRevision };
    return () => isAccessGenerationCurrent(generation) && orderContext.current.ready &&
      orderContext.current.params === origin.params && orderContext.current.accessRevision === origin.accessRevision &&
      orderContext.current.item === origin.item && orderContext.current.item?.id === origin.item?.id && origin.item !== null &&
      orderContext.current.item?.capabilities[leaf] === true;
  };

  useEffect(() => {
    if (scheduleConflictPrompt && !scheduleConflictPrompt.isCurrent()) {
      scheduleConflictPrompt.resolve(false);
      setScheduleConflictPrompt(null);
    }
  }, [scheduleConflictPrompt, snapshotReady, accessRevision, item, params]);
  useEffect(() => () => { orderContext.current = { ...orderContext.current, ready: false }; }, []);

  const closeScheduleConflictPrompt = (confirmed: boolean): void => {
    setScheduleConflictPrompt((current) => {
      if (current !== scheduleConflictPrompt) return current;
      current?.resolve(confirmed && current.isCurrent());
      return null;
    });
  };

  const canSelectLinkedObject = Boolean(item?.capabilities.canChangeLinkedObject);
  const canRead = (key: keyof OneTimeOrderItem['capabilities']): boolean => item?.capabilities[key] !== false;

  const sections = useMemo(() => [
    { value: 'overview', label: 'Обзор' },
    { value: 'execution', label: 'Работы' },
    { value: 'team', label: 'Команда' },
    { value: 'finance', label: 'Финансы и ресурсы' },
    { value: 'materials', label: 'Медиа' },
    { value: 'discussion', label: 'Комментарии' },
    { value: 'history', label: 'История' },
  ].filter(section => {
    if (!item) return true;
    const canRead = (key: keyof OneTimeOrderItem['capabilities']): boolean => item.capabilities[key] !== false;
    if (section.value === 'team') return canRead('canReadEmployees') || item.capabilities.canReadAttendance === true || item.capabilities.canReadTimesheet === true || item.capabilities.canManageManagers;
    if (section.value === 'finance') return ['canReadFinance', 'canReadInventory', 'canReadEquipment', 'canReadAccountability'].some(key => canRead(key as keyof OneTimeOrderItem['capabilities'])) || item.capabilities.canComplete;
    if (section.value === 'materials') return canRead('canReadPhotos') || canRead('canReadFiles');
    if (section.value === 'discussion') return canRead('canReadComments');
    if (section.value === 'history') return canRead('canReadHistory');
    return true;
  }), [item]);

  useEffect(() => {
    if (item && !sections.some(section => section.value === activeSection)) {
      activeSectionRef.current = 'overview';
      setActiveSection('overview');
    }
  }, [item, activeSection, sections]);

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
    if (isEditingRef.current) return;
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
      setError(null);
      setLoadedAccessRevision(null);

      if (capabilitiesRefreshError) return;

      try {
        const resolved = await params;

        if (cancelled) {
          return;
        }

        if (activeOrderId.current !== resolved.id) {
          setItem(null);
          setIsEditing(false);
          setIsEditFormDirty(false);
          setIsCompletionDraftDirty(false);
          setFileRefreshError(null);
          activeOrderId.current = resolved.id;
        }
        await loadAll(resolved.id, () => cancelled);
      } catch (loadError) {
        if (!cancelled) {
          setError(getOrderLoadError(loadError));
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
      loadGeneration.current += 1;
    };
  }, [params, accessRevision, accessRetry, capabilitiesRefreshError]);

  const loadAll = async (id: string, isCancelled: () => boolean = () => false): Promise<void> => {
    if (orderContext.current.capabilitiesRefreshError || activeOrderId.current !== id || latestAccessRevision.current !== accessRevision || latestParams.current !== params || isCancelled()) return;
    const revision = accessRevision;
    const generation = ++loadGeneration.current;
    const isCurrent = (): boolean => !orderContext.current.capabilitiesRefreshError && !isCancelled() && generation === loadGeneration.current &&
      activeOrderId.current === id && latestAccessRevision.current === revision && latestParams.current === params;
    setLoadedAccessRevision(null);
    setError(null);
    setFileRefreshError(null);
    const rejectLoad = (cause: unknown): never => {
      if (isCurrent()) setError(getOrderLoadError(cause));
      throw cause;
    };
    const order = await getOneTimeOrderById(id).catch(rejectLoad);

    if (!isCurrent()) {
      return;
    }

    setItem(order);
    setHistoryRefreshVersion((version) => version + 1);

    const permitted = (key: keyof OneTimeOrderItem['capabilities']): boolean => order.capabilities[key] !== false;
    // A denied subsection must neither be fetched nor retain data from an earlier grant.
    if (!permitted('canReadComments')) setComments([]);
    if (!permitted('canReadFinance')) setCompletions([]);
    if (!permitted('canReadReports')) setDailyReport(null);
    if (!permitted('canReadFiles')) setFiles([]);
    if (!permitted('canReadPhotos')) setPhotos([]);
    if (!permitted('canReadEquipment')) setEquipment(null);
    if (!permitted('canReadInventory')) { setInventoryMovements([]); setInventoryAvailableItems([]); setCanIssueInventory(false); setCanReturnInventory(false); setInventoryReturnItems([]); }
    if (!permitted('canReadEmployees')) setWorkforce([]);
    if (!permitted('canReadTasks')) setTasks([]);
    if (!permitted('canReadAccountability')) setAccountability(null);
    if (!permitted('canReadHistory')) { setHistoryPageData(null); setHistoryLoadedQueryKey(null); }
    const requests: Array<Promise<void>> = [];
    if (permitted('canReadComments')) requests.push(listOneTimeOrderComments(id).then((response) => {
        if (isCurrent()) {
          setComments(response);
        }
      }));
    if (permitted('canReadFinance')) requests.push(listOneTimeOrderCompletions(id).then((response) => {
        if (isCurrent()) {
          setCompletions(response);
        }
      }));
    if (permitted('canReadReports')) requests.push(getTodayOneTimeOrderDailyReport(id).then((response) => {
        if (isCurrent()) {
          setDailyReport(response);
        }
      }));
    if (permitted('canReadFiles')) requests.push(listFilesByEntity('one_time_order', id).then((response) => {
        if (isCurrent()) {
          setFiles(response);
        }
      }));
    if (permitted('canReadPhotos')) requests.push(listOneTimeOrderPhotos(id, {
        includeDeleted: order.capabilities.canRestorePhotos,
      }).then((response) => {
        if (isCurrent()) {
          setPhotos(response);
        }
      }));
    if (permitted('canReadEquipment')) requests.push(getOneTimeOrderEquipment(id).then((response) => {
        if (isCurrent()) {
          setEquipment(response);
        }
      }));
    if (permitted('canReadInventory')) requests.push(getOneTimeOrderInventory(id).then((response) => {
        if (isCurrent()) {
          setInventoryMovements(response.items);
          setInventoryAvailableItems(response.availableItems);
          setCanIssueInventory(response.capabilities.canIssueInventoryToOrder);
          setCanReturnInventory(response.capabilities.canReturnInventoryFromOrder);
          setInventoryReturnItems(response.availableReturnItems);
        }
      }));
    if (permitted('canReadEmployees')) requests.push(listOneTimeWorkforce(id).then((response) => {
        if (isCurrent()) {
          setWorkforce(response);
        }
      }));
    if (permitted('canReadTasks')) requests.push(listTasksByOneTimeOrder(id).then((response) => {
        if (isCurrent()) {
          setTasks(response);
        }
      }));
    if (permitted('canReadAccountability')) requests.push(getOneTimeOrderAccountability(id).then((response) => {
        if (isCurrent()) {
          setAccountability(response);
        }
      }));

    if (order.capabilities.canCreateTask) {
      requests.push(
        listOneTimeOrderTaskAssigneeCandidates(id).then((response) => {
          if (isCurrent()) {
            setTaskAssignees(response);
          }
        }),
      );
    } else if (isCurrent()) {
      setTaskAssignees([]);
    }

    await Promise.all(requests).catch(rejectLoad);
    if (isCurrent()) {
      setLoadedAccessRevision(revision);
      setLoadedParams(params);
    }
  };

  useEffect(() => {
    const timeout = window.setTimeout(() => setAppliedHistoryFilters(historyFilters), 250);
    return () => window.clearTimeout(timeout);
  }, [historyFilters]);

  const historyQueryKey = JSON.stringify([item?.id, accessRevision, item?.capabilities.canReadFinance, historyPageNumber, appliedHistoryFilters]);
  const latestHistoryQueryKey = useRef(historyQueryKey);
  latestHistoryQueryKey.current = historyQueryKey;

  useEffect(() => {
    const orderId = item?.id;
    if (!snapshotReady || activeSection !== 'history' || !orderId || item.capabilities.canReadHistory === false) return;
    let active = true;
    const requestKey = historyQueryKey;
    const generation = getAccessGeneration();
    const isCurrentHistory = (): boolean => active && isAccessGenerationCurrent(generation) &&
      orderContext.current.ready && latestHistoryQueryKey.current === requestKey;
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
        if (!isCurrentHistory()) return;
        setHistoryPageData(response);
        setHistoryLoadedQueryKey(requestKey);
      })
      .catch((caughtError) => {
        if (isCurrentHistory()) setHistoryError(getErrorMessage(caughtError, 'Не удалось загрузить историю заказа.'));
      })
      .finally(() => {
        if (isCurrentHistory()) setHistoryLoading(false);
      });
    return () => { active = false; };
  }, [activeSection, appliedHistoryFilters, historyPageNumber, historyQueryKey, historyRefreshVersion, historyRetry, item?.id, accessRevision, snapshotReady]);

  const currentHistoryPageData = snapshotReady && canRead('canReadHistory') && historyLoadedQueryKey === historyQueryKey ? historyPageData : null;
  const history = currentHistoryPageData?.items ?? [];

  const activeWorkforce = workforce.filter((employee) => employee.isActive);
  const formerWorkforce = workforce.filter((employee) => !employee.isActive);

  const currentExpenseRecovery = expenseRecovery && expenseRecovery.params === params &&
    expenseRecovery.userId === user?.id && expenseRecovery.session === getAccessSessionGeneration() &&
    expenseRecovery.orderId === item?.id ? expenseRecovery : null;
  const recoveredExpense = currentExpenseRecovery
    ? accountability?.accounts.flatMap((account) => account.expenses)
      .find((expense) => expense.id === currentExpenseRecovery.expenseId)
    : undefined;

  const recoveryDrafts = snapshotReady && currentExpenseRecovery && !currentExpenseRecovery.expenseId
    ? accountability?.accounts.filter((account) => account.user.id === user?.id)
      .flatMap((account) => account.expenses).filter((expense) => expense.status === 'draft' &&
        expense.createdBy.id === user?.id && expense.oneTimeOrderId === currentExpenseRecovery.orderId) ?? []
    : [];

  if (savedExpenseNotice && savedExpenseNotice.params === params && savedExpenseNotice.userId === user?.id) {
    return <div className="ui-page">
      <ButtonLink href="/one-time-orders">К списку заказов</ButtonLink>
      <Alert tone="success" role="status">{savedExpenseNotice.message}</Alert>
      {capabilitiesRefreshError ? <Alert tone="danger" role="alert">{capabilitiesRefreshError}</Alert> : null}
      <Button onClick={() => {
        const session = getAccessSessionGeneration();
        void refreshUser({ force: true }).then(() => {
          if (getAccessSessionGeneration() === session && latestParams.current === params) {
            setSavedExpenseNotice(null);
            setAccessRetry((current) => current + 1);
          }
        }).catch(() => undefined);
      }}>Проверить доступ</Button>
    </div>;
  }

  if (savedManagerAssignment && savedManagerAssignment.params === params &&
      savedManagerAssignment.userId === user?.id && savedManagerAssignment.session === getAccessSessionGeneration()) {
    return (
      <div className={`ui-page ${orderStyles.orderDetailPage}`}>
        <ButtonLink href="/one-time-orders">К списку заказов</ButtonLink>
        <Alert tone="success" role="status" title="Менеджер назначен.">
          Доступ к карточке изменился. Вернитесь к списку заказов.
        </Alert>
      </div>
    );
  }

  if (savedShipment && savedShipment.params === params && savedShipment.userId === user?.id) {
    return (
      <div className={`ui-page ${orderStyles.orderDetailPage}`}>
        <ButtonLink href="/one-time-orders">К списку заказов</ButtonLink>
        <Alert tone="success" role="status" title={savedShipment.title ?? 'Отгрузка записана'}>
          Доступ к карточке изменился. Вернитесь к списку заказов.
          {savedShipment.hasUnsentPhotos ? ' Выбранные фото не прикрепились. Если доступ восстановится, добавьте их в журнале движений.' : ''}
        </Alert>
      </div>
    );
  }

  return (
    <div className={`ui-page ${orderStyles.orderDetailPage}`}>
      {(isLoading || loadedAccessRevision !== accessRevision || loadedParams !== params) && !error ? <LoadingState label="Обновление доступа к заказу…" /> : null}
      {error ? <Alert tone="warning" role="alert" action={<Button onClick={() => setAccessRetry((value) => value + 1)}>Повторить проверку доступа</Button>}>{fileRefreshError ?? error}</Alert> : null}
      {capabilitiesRefreshError ? <Alert tone="warning" role="alert">{capabilitiesRefreshError}</Alert> : null}
      <AccessSnapshotBoundary blocked={!snapshotReady}>
      {item ? (
        <div key={item.id} className="ui-stack ui-stack--lg order-detail-workspace">
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
          {!canRead('canReadEmployees') && (item.capabilities.canReadAttendance === true || item.capabilities.canReadTimesheet === true) ? <Surface padding="md">
            <ButtonLink href={`/one-time-orders/${item.id}/workforce`}>Открыть выходы и табель</ButtonLink>
          </Surface> : null}
          {canRead('canReadEmployees') ? <Surface as="section" padding="md" className={orderStyles.orderTeamOverview}>
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
          </Surface> : null}
          <OneTimeOrderManagersPanel
            item={item}
            searchCandidates={(query) => listOneTimeOrderManagerCandidates(item.id, query)}
            onAssign={async (userId) => {
              const isCurrent = captureOrderAction('canManageManagers');
              if (!isCurrent()) return;
              const session = getAccessSessionGeneration();
              const actorId = user?.id;
              const updated = await assignManagerWithConflictConfirmation({
                save: (fingerprint) => assignOneTimeOrderManager(item.id, userId, fingerprint),
                isCurrent,
                confirm: (conflicts) => confirmScheduleConflicts(conflicts, isCurrent),
              });
              if (!updated || getAccessSessionGeneration() !== session || latestParams.current !== params) return;
              if (isSavedWithoutAccess(updated)) {
                if (actorId) setSavedManagerAssignment({ params, userId: actorId, session });
                return;
              }
              if (!isCurrent()) return;
              setItem(updated); await loadAll(item.id);
            }}
            onRemove={async (userId) => {
              const updated = await removeOneTimeOrderManager(item.id, userId);
              setItem(updated); await loadAll(item.id);
            }}
          />
          {canRead('canReadEscorts') ? <OneTimeOrderEscortsPanel key={`${item.id}:${user?.accessVersion ?? 0}`} orderId={item.id} workforce={workforce} onChanged={() => loadAll(item.id)} /> : null}
          </div>

          <div className={`ui-stack ${styles.content} ${orderStyles.orderDetailContent}`} id="workspace-panel-overview" role="tabpanel" aria-labelledby="workspace-tab-overview" hidden={activeSection !== 'overview'}>
          {canRead('canReadDeadline') ? <OneTimeOrderDeadlinePanel key={`${item.id}:${user?.accessVersion ?? 0}`} orderId={item.id} onChanged={() => loadAll(item.id)} /> : null}
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
                      const isCurrent = captureOrderAction('canChangeStatus');
                      if (!isCurrent()) return;
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
                          const confirmed = await confirmScheduleConflicts(result.conflicts, isCurrent);
                          if (!confirmed) return;
                          conflictFingerprint = result.conflictFingerprint;
                        }
                      }
                      if (!isCurrent()) return;
                      const updated = await changeOneTimeOrderStatus(
                        item.id,
                        option.value,
                        conflictFingerprint,
                      );
                      if (!isCurrent()) return;
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

          {isEditing && editableInitialValue ? (
            <AccessSnapshotBoundary blocked={!item.capabilities.canEditOperationalFields}>
            <OneTimeOrderForm
              operation="update"
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
                item.capabilities.canEditFinancialFields && canRead('canReadFinance')
              }
              includeManagers={false}
              allowStatusEdit={false}
              submitLabel="Сохранить изменения"
              onSubmit={async (payload) => {
                const isCurrent = captureOrderAction('canEditOperationalFields');
                if (!isCurrent()) return;
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
                    const confirmed = await confirmScheduleConflicts(result.conflicts, isCurrent);
                    if (!confirmed) return;
                    conflictFingerprint = result.conflictFingerprint;
                  }
                }
                if (!isCurrent()) return;
                const updated = await updateOneTimeOrder(item.id, {
                  ...payload,
                  conflictFingerprint,
                });
                if (!isCurrent()) return;
                setItem(updated);
                setIsEditing(false);
                setIsEditFormDirty(false);
                await loadAll(item.id);
              }}
            />
            </AccessSnapshotBoundary>
          ) : null}
          </div>

          <div className={`ui-stack ${styles.content} ${orderStyles.orderDetailContent}`} id="workspace-panel-finance" role="tabpanel" aria-labelledby="workspace-tab-finance" hidden={activeSection !== 'finance'}>
          {canRead('canReadFinance') && (item.financialNotes || item.expenseNotes || item.plannedPaymentMethod) ? (
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
          <AccessSnapshotBoundary blocked={!canRead('canReadFinance') && !item.capabilities.canComplete}><OneTimeOrderCompletionPanel
            key={item.id}
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
          /></AccessSnapshotBoundary>
          {currentExpenseRecovery && canRead('canReadAccountability') && accountability ? (
            <Alert tone="warning" role="status">
              {currentExpenseRecovery.message}
              {!currentExpenseRecovery.expenseId && currentExpenseRecovery.files.length > 0 && snapshotReady ? (
                <SearchableSelect label="Сохранённый расход для прикрепления файлов" value=""
                  placeholder="Выберите сохранённый расход вручную" disabled={isRetryingExpense}
                  options={recoveryDrafts.map((expense) => ({ value: expense.id,
                    label: `${expense.description} · ${expense.amount.toLocaleString('ru-RU')} ₽ · ${new Date(expense.createdAt).toLocaleDateString('ru-RU')}` }))}
                  onChange={(expenseId) => {
                    if (!snapshotReady || !orderContext.current.ready || !recoveryDrafts.some((expense) => expense.id === expenseId)) return;
                    setExpenseRecovery((current) => current === currentExpenseRecovery &&
                      current.session === getAccessSessionGeneration() && latestParams.current === current.params
                      ? { ...current, expenseId, message: 'Расход выбран. Прикрепите сохранённые файлы отдельным действием.' } : current);
                  }} />
              ) : null}
              {currentExpenseRecovery.files.length > 0 || recoveredExpense?.capabilities.canSubmit ? (
                <Button disabled={!snapshotReady || isRetryingExpense || !currentExpenseRecovery.expenseId || (currentExpenseRecovery.files.length > 0
                  ? user?.capabilities?.canUploadFile === false || !recoveredExpense?.capabilities.canEdit
                  : !recoveredExpense?.capabilities.canSubmit)} onClick={() => void (async () => {
                    if (!snapshotReady || expenseRetryBusy.current) return;
                    const pending = currentExpenseRecovery;
                    const expenseId = pending.expenseId;
                    if (!expenseId) return;
                    const generation = getAccessGeneration();
                    const isCurrentContext = (): boolean => getAccessSessionGeneration() === pending.session &&
                      latestParams.current === pending.params;
                    const canAct = (): boolean => isCurrentContext() && isAccessGenerationCurrent(generation) &&
                      orderContext.current.ready && orderContext.current.params === pending.params &&
                      orderContext.current.item?.id === pending.orderId;
                    if (!canAct()) return;
                    expenseRetryBusy.current = true;
                    setIsRetryingExpense(true);
                    try {
                      if (pending.files.length > 0) {
                        const outcomes = await Promise.allSettled(pending.files.map((file) => uploadFileToEntity({
                          entityType: 'accountability_expense', entityId: expenseId, file,
                        })));
                        if (!isCurrentContext()) return;
                        const failed = pending.files.filter((_, index) => outcomes[index]?.status !== 'fulfilled');
                        setExpenseRecovery({ ...pending, files: failed, message: failed.length
                          ? 'Расход сохранён. Не все файлы прикреплены. Повторите прикрепление после проверки доступа.'
                          : 'Файлы прикреплены. Отправьте сохранённый расход на проверку отдельным действием.' });
                      } else {
                        const result = await submitAccountabilityExpense(expenseId);
                        if (!isCurrentContext()) return;
                        if (isSavedWithoutAccess(result) || !canAct()) {
                          setSavedExpenseNotice({ params: pending.params, userId: pending.userId, message: 'Расход отправлен на проверку.' });
                          return;
                        }
                        setExpenseRecovery(null);
                      }
                      if (canAct()) await loadAll(pending.orderId);
                    } catch {
                      if (isCurrentContext()) setExpenseRecovery((current) => current?.expenseId === pending.expenseId
                        ? { ...current, message: 'Расход сохранён. Не удалось подтвердить следующий шаг. Проверьте его состояние в списке расходов.' }
                        : current);
                    } finally {
                      if (isCurrentContext()) {
                        expenseRetryBusy.current = false;
                        setIsRetryingExpense(false);
                      }
                    }
                  })()}>{isRetryingExpense ? 'Выполняем...' : currentExpenseRecovery.files.length > 0
                    ? 'Повторить прикрепление' : 'Отправить сохранённый расход'}</Button>
              ) : null}
            </Alert>
          ) : null}
          {canRead('canReadAccountability') && accountability ? (
            <OneTimeOrderAccountabilityPanel
              key={`accountability:${item.id}`}
              view={accountability}
              completions={completions}
              orderStatus={item.status}
              workforce={workforce}
              workCycle={item.workCycle}
              onCreateExpense={async (payload) => {
                const generation = getAccessGeneration();
                const session = getAccessSessionGeneration();
                const orderId = item.id;
                const isCurrentContext = (): boolean => getAccessSessionGeneration() === session &&
                  latestParams.current === params;
                const canAct = (): boolean => isCurrentContext() && isAccessGenerationCurrent(generation) &&
                  orderContext.current.ready && orderContext.current.params === params &&
                  orderContext.current.item?.id === orderId;
                const acknowledge = (message: string): void => {
                  if (user?.id && isCurrentContext()) setSavedExpenseNotice({ params, userId: user.id, message });
                };
                let committedExpenseId: string | null = null;
                let failedFiles = payload.files;
                const retainRecovery = (message: string): void => {
                  if ((committedExpenseId || failedFiles.length > 0) && user?.id && isCurrentContext()) {
                    setExpenseRecovery({ params, userId: user.id, session, orderId,
                      expenseId: committedExpenseId, files: failedFiles, message });
                  }
                };
                if (currentExpenseRecovery?.files.length || expenseRetryBusy.current) {
                  throw new Error('Сначала завершите прикрепление файлов к уже сохранённому расходу.');
                }
                if (!canAct()) throw new Error('Доступ к заказу изменился. Проверьте доступ перед сохранением.');
                expenseRetryBusy.current = true;
                setIsRetryingExpense(true);
                try {
                  const expense = await createAccountabilityExpense({
                    clientRequestId: payload.clientRequestId,
                    amount: payload.amount,
                    description: payload.description,
                    oneTimeOrderId: orderId,
                    oneTimeOrderCompletionId: payload.oneTimeOrderCompletionId,
                    employeeId: payload.employeeId,
                    oneTimeOrderWorkCycle: payload.oneTimeOrderWorkCycle ?? undefined,
                    expenseCategory: payload.expenseCategory,
                    expenseDate: payload.expenseDate,
                  });
                  if (!isCurrentContext()) return;
                  if (isSavedWithoutAccess(expense)) {
                    if (payload.files.length > 0) retainRecovery('Расход сохранён. После проверки доступа выберите свой сохранённый черновик вручную для прикрепления файлов.');
                    acknowledge(payload.files.length ? 'Черновик расхода сохранён. Файлы не прикреплены.' : 'Черновик расхода сохранён.');
                    return;
                  }
                  committedExpenseId = expense.id;
                  retainRecovery('Черновик расхода сохранён.');
                  if (!canAct()) {
                    acknowledge('Черновик расхода сохранён. Файлы и отправку проверьте после восстановления доступа.');
                    return;
                  }
                  const uploads = await Promise.allSettled(payload.files.map((file) => uploadFileToEntity({
                    entityType: 'accountability_expense', entityId: expense.id, file,
                  })));
                  if (!isCurrentContext()) return;
                  failedFiles = payload.files.filter((_, index) => uploads[index]?.status !== 'fulfilled');
                  retainRecovery(failedFiles.length
                    ? 'Черновик расхода сохранён. Часть файлов не прикреплена; отправка на проверку не выполнена.'
                    : 'Черновик расхода сохранён.');
                  if (!canAct()) {
                    acknowledge('Черновик расхода сохранён. Проверьте вложения после восстановления доступа.');
                    return;
                  }
                  if (failedFiles.length) {
                    await loadAll(orderId);
                    return;
                  }
                  if (payload.submitAfterSave) {
                    const submitted = await submitAccountabilityExpense(expense.id);
                    if (!isCurrentContext()) return;
                    if (isSavedWithoutAccess(submitted) || !canAct()) {
                      acknowledge('Расход отправлен на проверку.');
                      return;
                    }
                  }
                  setExpenseRecovery(null);
                  await loadAll(orderId);
                } catch (caughtError) {
                  if (!isCurrentContext()) return;
                  if (!committedExpenseId) throw caughtError;
                  const message = 'Расход сохранён. Не удалось подтвердить следующий шаг. Проверьте его состояние в списке расходов.';
                  retainRecovery(message);
                  if (!canAct()) acknowledge(message);
                  else await loadAll(orderId).catch(() => undefined);
                } finally {
                  if (isCurrentContext()) {
                    expenseRetryBusy.current = false;
                    setIsRetryingExpense(false);
                  }
                }
              }}
            />
          ) : null}
          {canRead('canReadInventory') ? <OneTimeOrderInventoryPanel
            key={item.id}
            orderId={item.id}
            items={inventoryMovements}
            availableItems={inventoryAvailableItems}
            canIssue={canIssueInventory}
            canReturn={canReturnInventory}
            availableReturnItems={inventoryReturnItems}
            onReturn={async (payload, hasPendingPhotos) => {
              const result = await createOneTimeOrderInventoryReturn(item.id, payload);
              if ('outcome' in result) {
                if (user) setSavedShipment({ params, userId: user.id, hasUnsentPhotos: hasPendingPhotos });
                return null;
              }
              return result.id;
            }}
            onIssue={async (payload, hasPendingPhotos) => {
              const result = await createOneTimeOrderInventoryIssue(item.id, payload);
              if ('outcome' in result) {
                if (user) setSavedShipment({ params, userId: user.id, hasUnsentPhotos: hasPendingPhotos });
                return null;
              }
              return result.id;
            }}
            onAttachEvidence={async (movementId, evidenceFiles) => {
              const results = await uploadFileBatch({ entityType: 'inventory_movement', entityId: movementId, files: evidenceFiles });
              const failed = results.filter((result) => result.status === 'rejected').length;
              if (failed) throw new Error(`Отгрузка записана. Не удалось загрузить фото: ${failed}. Повторите сохранение — отгрузка не будет продублирована.`);
            }}
            onRefresh={async () => {
              try {
                const response = await getOneTimeOrderInventory(item.id);
                setInventoryMovements(response.items);
                setInventoryAvailableItems(response.availableItems);
                setCanIssueInventory(response.capabilities.canIssueInventoryToOrder);
          setCanReturnInventory(response.capabilities.canReturnInventoryFromOrder);
          setInventoryReturnItems(response.availableReturnItems);
              } catch (error) {
                if (user && error instanceof ApiError && [403, 404].includes(error.statusCode)) {
                  setSavedShipment({ params, userId: user.id, hasUnsentPhotos: false });
                  return;
                }
                throw error;
              }
            }}
          /> : null}
          {canRead('canReadEquipment') && equipment ? (
            <EquipmentScopePanel title="Оборудование заказа" units={equipment.units} orderId={item.id}
              onRefresh={async () => { await loadAll(item.id); }}
              onSavedWithoutAccess={() => {
                if (user && latestParams.current === params && resourceRenderSession === getAccessSessionGeneration()) setSavedShipment({ params, userId: user.id, hasUnsentPhotos: false, title: 'Движение оборудования записано' });
              }} />
          ) : null}
          </div>

          <div className={`ui-stack ${styles.content} ${orderStyles.orderDetailContent}`} id="workspace-panel-discussion" role="tabpanel" aria-labelledby="workspace-tab-discussion" hidden={activeSection !== 'discussion'}>
          <AccessSnapshotBoundary blocked={!canRead('canReadComments')}><OneTimeOrderCommentsPanel
            key={item.id}
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
          /></AccessSnapshotBoundary>
          <Surface padding="md">
            <div className="ui-section-header">
              <div><div className="ui-section-title">Рабочий чат разовых заказов</div><div className="ui-section-subtitle">Полный мессенджер живет отдельно от комментариев заказа.</div></div>
              <ButtonLink variant="ghost" href="/chats?room=one_time_orders">Открыть чат</ButtonLink>
            </div>
          </Surface>
          </div>

          <div className={`ui-stack ${styles.content} ${orderStyles.orderDetailContent}`} id="workspace-panel-execution" role="tabpanel" aria-labelledby="workspace-tab-execution" hidden={activeSection !== 'execution'}>
          <AccessSnapshotBoundary blocked={!canRead('canReadSpecification')}><section id="one-time-order-specification" className={styles.executionAnchor} tabIndex={-1} aria-label="Техническое задание">
          <OneTimeOrderSpecificationPanel key={item.id} orderId={item.id} readSnapshot={item} canManage={item.capabilities.canManageSpecification} canEditStructure={item.capabilities.canEditSpecification} canCommentSpecification={item.capabilities.canCommentSpecification} canDetachSpecificationFiles={item.capabilities.canDetachSpecificationFiles} orderStatus={item.status} onOpenDailyReport={() => { void selectSection('execution').then(() => { if (activeSectionRef.current === 'execution') window.setTimeout(() => document.getElementById('one-time-order-daily-report')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0); }); }} />
          </section></AccessSnapshotBoundary>
          {canRead('canReadServiceLines') ? <section className="ui-stack ui-stack--lg" aria-label="Услуги заказа">
                <OneTimeOrderServiceLinesPanel key={`${item.id}:${user?.accessVersion ?? 0}`} orderId={item.id} onChanged={() => loadAll(item.id)} />
                <div className="ui-section-subtitle">
                  Услуги относятся к заказу «{item.title}»
                  {item.linkedObject ? ` · Объект: ${item.linkedObject.name}` : ''}.
                  {' '}Состав сотрудников и фактические выходы доступны в разделе «Команда».
                  {' '}Расходники и оборудование — в разделе «Финансы и ресурсы».
                </div>
          </section> : null}
          {canRead('canReadReports') ? <OneTimeOrderDailyReportPanel
            key={item.id}
            item={dailyReport}
            canEdit={item.capabilities.canUpdateReports !== false}
            onSave={async (payload) => {
              const saved = await upsertTodayOneTimeOrderDailyReport(item.id, {
                content: payload.content,
              });

              setDailyReport(saved);
              const uploads = await uploadFileBatch({ entityType: 'one_time_order_daily_report', entityId: saved.id, files: payload.files });

              await loadAll(item.id);
              if (uploads.some((result) => result.status === 'rejected')) throw new Error('Текст отчёта сохранён. Не все вложения загрузились — повторите сохранение, уже загруженные файлы не продублируются.');
            }}
          /> : null}
          {canRead('canReadTasks') ? <section id="one-time-order-tasks" className={styles.executionAnchor} tabIndex={-1} aria-label="Задачи заказа">
          <OneTimeOrderTasksPanel
            items={tasks} assigneeOptions={taskAssignees}
            canCreateTask={item.capabilities.canCreateTask}
            linkedObject={item.linkedObject}
            onCreate={async ({ linkToObject, ...payload }) => {
              await createTask({ ...payload, ...(item.linkedObject && linkToObject ? { objectId: item.linkedObject.id } : {}), oneTimeOrderId: item.id, visibilityType: 'target_participants', requiresConfirmation: true, completionRequirement: 'comment_or_file' });
              await loadAll(item.id);
            }}
          />
          </section> : null}
          </div>

          <div className={`ui-stack ${styles.content} ${orderStyles.orderDetailContent}`} id="workspace-panel-materials" role="tabpanel" aria-labelledby="workspace-tab-materials" hidden={activeSection !== 'materials'}>
          <AccessSnapshotBoundary blocked={!canRead('canReadPhotos')}><OneTimeOrderPhotosPanel
            key={item.id}
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
          /></AccessSnapshotBoundary>

          {canRead('canReadFiles') ? <><OneTimeOrderFilesPanel
            key={item.id}
            files={files}
            canUpload={item.capabilities.canAttachFiles}
            onUpload={async (file) => {
              await uploadFileToEntity({
                entityType: 'one_time_order',
                entityId: item.id,
                file,
              });
              try {
                await loadAll(item.id);
                setFileRefreshError(null);
              } catch {
                setFileRefreshError('Файл сохранён, но не удалось обновить заказ. Обновите страницу; повторная загрузка файла не нужна.');
              }
            }}
          />{fileRefreshError ? <Alert tone="warning" role="alert">{fileRefreshError}</Alert> : null}</> : null}

          </div>

          <div className={`ui-stack ${styles.content} ${orderStyles.orderDetailContent}`} id="workspace-panel-history" role="tabpanel" aria-labelledby="workspace-tab-history" hidden={activeSection !== 'history'}>
            <HistoryFilterBar
              filters={historyFilters}
              key={`${item.id}:${accessRevision}:${item.capabilities.canReadFinance}`}
              eventTypes={(currentHistoryPageData?.facets.eventTypes ?? []).map((eventType) => ({
                value: eventType,
                label: getOneTimeOrderHistoryActionLabel(eventType),
              }))}
              actors={currentHistoryPageData?.facets.actors ?? []}
              actorsHasMore={currentHistoryPageData?.facets.actorsHasMore ?? false}
              eventTypesHasMore={currentHistoryPageData?.facets.eventTypesHasMore ?? false}
              busy={historyLoading}
              onActorSearch={async (actorSearch) => {
                const generation = getAccessGeneration();
                const requestKey = historyQueryKey;
                const isCurrent = (): boolean => isAccessGenerationCurrent(generation) && orderContext.current.ready &&
                  latestHistoryQueryKey.current === requestKey && orderContext.current.item?.capabilities.canReadHistory !== false;
                if (!isCurrent()) return [];
                const result = await listOneTimeOrderHistoryPage(item.id, {
                  page: 1, limit: 1, actorSearch,
                });
                return isCurrent() ? result.facets.actors : [];
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
            {currentHistoryPageData && (!historyLoading || history.length > 0) ? (
              <OneTimeOrderHistoryList
                items={history}
                emptyText={currentHistoryPageData.total === 0 && hasHistoryFilters(appliedHistoryFilters) ? 'По выбранным фильтрам событий нет.' : 'История по заказу пока пуста.'}
              />
            ) : null}
            {currentHistoryPageData ? (
              <TablePagination
                page={currentHistoryPageData.page}
                totalPages={currentHistoryPageData.totalPages}
                pending={historyLoading || historyLoadedQueryKey !== historyQueryKey}
                label="Страницы истории заказа"
                summary={currentHistoryPageData.total > 0 ? `Показано ${(currentHistoryPageData.page - 1) * currentHistoryPageData.limit + 1}–${Math.min(currentHistoryPageData.page * currentHistoryPageData.limit, currentHistoryPageData.total)} из ${currentHistoryPageData.total}` : 'Событий не найдено'}
                onPageChange={setHistoryPageNumber}
              />
            ) : null}
          </div>
        </div>
      ) : (
        <EmptyState title="Разовый заказ не найден" description="Вернитесь к списку, чтобы выбрать доступный заказ." action={<ButtonLink href="/one-time-orders">К разовым заказам</ButtonLink>} />
      )}
      <ConfirmDialog
        open={scheduleConflictPrompt !== null && scheduleConflictPrompt.isCurrent()}
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
      </AccessSnapshotBoundary>
    </div>
  );
}
