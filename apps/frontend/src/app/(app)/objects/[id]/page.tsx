'use client';

import Link from 'next/link';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useAccessRevision } from '@/shared/auth/use-access-revision';
import { useAuth } from '@/shared/auth/use-auth';
import { AccessSnapshotBoundary } from '@/shared/auth/access-snapshot-boundary';
import { isSavedWithoutAccess, type SavedWithoutAccess } from '@/shared/api/saved-without-access';
import { captureObjectWriteFence, objectSavedWithoutAccess } from '@/features/object-shared-ui/object-write-fence';

import { getObjectEquipment } from '@/entities/equipment/api/equipment-client';
import type { EquipmentScope } from '@/entities/equipment/model/equipment.types';
import {
  createObjectInventoryIssue,
  getObjectInventory,
} from '@/entities/inventory/api/inventory-client';
import type { ObjectInventory } from '@/entities/inventory/model/inventory.types';
import {
  addEmployeeToObject,
  createObjectComment,
  getObjectFeed,
  getTodayArrivalPhoto,
  getTodayDailyReport,
  getTodayObjectAttendance,
  listLinkedOneTimeOrders,
  listObjectComments,
  listObjectEmployees,
  removeEmployeeFromObject,
  searchEmployeeDirectory,
  upsertObjectAttendance,
  upsertTodayArrivalPhoto,
  upsertTodayDailyReport,
  updateObjectEmployeeRatePolicy,
  type ObjectAttendanceToday,
} from '@/entities/object/api/object-operations-client';
import {
  addManagerToObject,
  addResponsibleToObject,
  changeObjectStatus,
  getObjectById,
  removeManagerFromObject,
  removeResponsibleFromObject,
} from '@/entities/object/api/object-client';
import type {
  ObjectArrivalPhoto,
  ObjectComment,
  ObjectDailyReport,
  ObjectFeedItem,
  LinkedOneTimeOrderProjection,
} from '@/entities/object/model/object-operations.types';
import type {
  ObjectEmployeeOption,
  ServiceObject,
} from '@/entities/object/model/object.types';
import {
  listFilesByEntity,
  uploadFileToEntity,
} from '@/entities/file/api/file-client';
import type { AttachedFile } from '@/entities/file/model/file.types';
import { ApiError } from '@/shared/api/fetcher';
import { listTasksByObject } from '@/entities/task/api/task-client';
import type { TaskItem } from '@/entities/task/model/task.types';
import {
  listSystemUsers,
  type SystemUserOption,
} from '@/entities/user/api/user-client';
import { EquipmentScopePanel } from '@/features/equipment-scope/ui/equipment-scope-panel';
import { LinkedOneTimeOrdersPanel } from '@/features/linked-one-time-orders/ui/linked-one-time-orders-panel';
import { ObjectArrivalPanel } from '@/features/object-arrival/ui/object-arrival-panel';
import { ObjectAttendancePanel } from '@/features/object-attendance/ui/object-attendance-panel';
import { ObjectSummaryCard } from '@/features/object-card/ui/object-summary-card';
import { ObjectContactsPanel } from '@/features/object-contacts/ui/object-contacts-panel';
import { ObjectPlanningPanel } from '@/features/object-planning/ui/object-planning-panel';
import { ObjectSchedulingPanel } from '@/features/object-scheduling/ui/object-scheduling-panel';
import { TodayShiftsPanel } from '@/features/object-scheduling/ui/today-shifts-panel';
import type { ShiftDayState } from '@/features/object-scheduling/model/shift-day-state';
import { ObjectSetupPanel } from '@/features/object-setup/ui/object-setup-panel';
import { ObjectRubberMatsPanel } from '@/features/object-rubber-mats/ui/object-rubber-mats-panel';
import { ObjectCommentsPanel } from '@/features/object-comments/ui/object-comments-panel';
import { ObjectFeedList } from '@/features/object-feed/ui/object-feed-list';
import { ObjectInventoryPanel } from '@/features/object-inventory/ui/object-inventory-panel';
import { ObjectDailyReportPanel } from '@/features/object-report/ui/object-daily-report-panel';
import { ObjectReportsPanel } from '@/features/object-report/ui/object-reports-panel';
import { ObjectStaffingPanel } from '@/features/object-staffing/ui/object-staffing-panel';
import {
  ObjectPanelError,
  ObjectPanelLoading,
} from '@/features/object-state/ui/object-state-panels';
import { ObjectStatusControlPanel } from '@/features/object-status-control/ui/object-status-control-panel';
import { ObjectTeamPanel } from '@/features/object-team/ui/object-team-panel';
import { TaskListTable } from '@/features/task-list/ui/task-list-table';
import { EntityFilesPanel } from '@/shared/ui/entity-files/entity-files-panel';

import styles from './object-detail-workspace.module.css';
import { Alert, Button, Surface } from '@/shared/ui/foundation';

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() ? error.message : fallback;
}

function getSectionReadError(error: unknown, section: string, fallback: string): string {
  if (error instanceof ApiError) {
    if (error.statusCode === 403) return `Нет доступа к разделу «${section}».`;
    if (error.statusCode === 404) return `Раздел «${section}» не найден или недоступен.`;
  }
  return getErrorMessage(error, fallback);
}

function todayAsBusinessDate(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Moscow',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const year = parts.find((part) => part.type === 'year')?.value ?? '';
  const month = parts.find((part) => part.type === 'month')?.value ?? '';
  const day = parts.find((part) => part.type === 'day')?.value ?? '';
  return `${year}-${month}-${day}`;
}

function WorkspaceSection({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <section id={id} className={styles.section} aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`} className={styles.visuallyHidden}>{title}</h2>
      {children}
    </section>
  );
}

export default function ObjectDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): React.JSX.Element {
  const accessRevision = useAccessRevision();
  const surfaceMounted = useRef(true);
  useEffect(() => { surfaceMounted.current = true; return () => { surfaceMounted.current = false; }; }, []);
  const { user, capabilitiesRefreshError, refreshUser } = useAuth();
  const canUploadFile = user?.capabilities?.canUploadFile === true;
  const [loadedAccessRevision, setLoadedAccessRevision] = useState<string | null>(null);
  const [loadedParams, setLoadedParams] = useState<typeof params | null>(null);
  const [objectId, setObjectId] = useState('');
  const [writeAcknowledged, setWriteAcknowledged] = useState<{ objectId: string; actorId: string | undefined; kind: 'arrival' | 'report' | 'comment' | 'workflow' } | null>(null);
  const [checkingWrite, setCheckingWrite] = useState(false);
  const [item, setItem] = useState<ServiceObject | null>(null);
  const [coreLoading, setCoreLoading] = useState(true);
  const [coreError, setCoreError] = useState<string | null>(null);
  const [coreRetry, setCoreRetry] = useState(0);
  const latestCoreRequest = useRef({ params, coreRetry, accessRevision, capabilitiesRefreshError, userId: user?.id });
  latestCoreRequest.current = { params, coreRetry, accessRevision, capabilitiesRefreshError, userId: user?.id };
  const activeObjectId = useRef('');
  const coreSequence = useRef(0);
  const [financialRevision, setFinancialRevision] = useState(0);

  useEffect(() => {
    // Sections arrive after the initial document; resolve a deep link only
    // once their anchors exist (including links from budget notifications).
    if (!capabilitiesRefreshError && !coreLoading && !coreError && loadedAccessRevision === accessRevision && loadedParams === params && window.location.hash) {
      const anchor = document.getElementById(window.location.hash.slice(1));
      if (anchor) window.location.replace(window.location.hash);
    }
  }, [coreLoading, coreError, objectId, loadedAccessRevision, accessRevision, loadedParams, params, capabilitiesRefreshError]);

  const [responsibleCandidates, setResponsibleCandidates] = useState<SystemUserOption[]>([]);
  const [managerCandidates, setManagerCandidates] = useState<SystemUserOption[]>([]);
  const [teamUsersLoading, setTeamUsersLoading] = useState(false);
  const [teamUsersError, setTeamUsersError] = useState<string | null>(null);

  const [assignedEmployees, setAssignedEmployees] = useState<ObjectEmployeeOption[]>([]);
  const [assignedEmployeesLoading, setAssignedEmployeesLoading] = useState(true);
  const [assignedEmployeesError, setAssignedEmployeesError] = useState<string | null>(null);
  const [employeeSearch, setEmployeeSearch] = useState('');
  const [directoryEmployees, setDirectoryEmployees] = useState<ObjectEmployeeOption[]>([]);
  const [directoryLoading, setDirectoryLoading] = useState(true);
  const [directoryError, setDirectoryError] = useState<string | null>(null);

  const [attendanceEmployeeIds, setAttendanceEmployeeIds] = useState<string[]>([]);
  const [attendanceEmployeeFacts, setAttendanceEmployeeFacts] = useState<ObjectAttendanceToday['employeeFacts']>([]);
  const [attendanceEmployees, setAttendanceEmployees] = useState<ObjectEmployeeOption[]>([]);
  const [attendanceLoading, setAttendanceLoading] = useState(true);
  const [attendanceError, setAttendanceError] = useState<string | null>(null);
  const [shiftDayState, setShiftDayState] = useState<(ShiftDayState & { objectId: string }) | null>(null);
  const onShiftDayStateChange = useCallback((state: ShiftDayState): void => {
    setShiftDayState({ ...state, objectId });
  }, [objectId]);
  const currentShiftDay = shiftDayState?.objectId === objectId ? shiftDayState : null;
  const legacyAttendanceReadOnlyReason = currentShiftDay?.owned
    ? 'Посещаемость за сегодня ведётся по подтверждённым сменам. Состав ниже показан только для чтения. Изменяйте или отменяйте выходы в блоке «Смены сегодня»; повторное дневное сохранение недоступно.'
    : !currentShiftDay?.checked || currentShiftDay.pending
      ? 'Проверяем сменные факты за сегодня. Дневная форма станет доступна после проверки, если за день нет подтверждённых смен. При ошибке обновите блок «Смены сегодня».'
      : undefined;

  const [arrival, setArrival] = useState<ObjectArrivalPhoto | null>(null);
  const [arrivalLoading, setArrivalLoading] = useState(true);
  const [arrivalError, setArrivalError] = useState<string | null>(null);
  const [report, setReport] = useState<ObjectDailyReport | null>(null);
  const [reportLoading, setReportLoading] = useState(true);
  const [reportError, setReportError] = useState<string | null>(null);
  const [comments, setComments] = useState<ObjectComment[]>([]);
  const [commentsLoading, setCommentsLoading] = useState(true);
  const [commentsError, setCommentsError] = useState<string | null>(null);
  const [feed, setFeed] = useState<ObjectFeedItem[]>([]);
  const [feedLoading, setFeedLoading] = useState(true);
  const [feedError, setFeedError] = useState<string | null>(null);
  const [linkedOrders, setLinkedOrders] = useState<LinkedOneTimeOrderProjection[]>([]);
  const [linkedOrdersLoading, setLinkedOrdersLoading] = useState(true);
  const [linkedOrdersError, setLinkedOrdersError] = useState<string | null>(null);
  const [objectFiles, setObjectFiles] = useState<AttachedFile[]>([]);
  const [objectFilesLoading, setObjectFilesLoading] = useState(true);
  const [objectFilesError, setObjectFilesError] = useState<string | null>(null);
  const [objectInventory, setObjectInventory] = useState<ObjectInventory | null>(null);
  const [objectInventoryLoading, setObjectInventoryLoading] = useState(true);
  const [objectInventoryError, setObjectInventoryError] = useState<string | null>(null);
  const [objectEquipment, setObjectEquipment] = useState<EquipmentScope | null>(null);
  const [objectEquipmentLoading, setObjectEquipmentLoading] = useState(true);
  const [objectEquipmentError, setObjectEquipmentError] = useState<string | null>(null);
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [tasksLoading, setTasksLoading] = useState(true);
  const [tasksError, setTasksError] = useState<string | null>(null);

  const canManageResponsibles = item?.capabilities.canManageResponsibles ?? false;
  const canManageManagers = item?.capabilities.canManageManagers ?? false;
  const canManageObjectStatus = Boolean(item && (
    (item.status !== 'active' && (item.status === 'archived' ? item.capabilities.canRestore ?? item.capabilities.canChangeStatus : item.capabilities.canChangeStatus)) ||
    (item.status !== 'frozen' && (item.capabilities.canFreeze ?? item.capabilities.canChangeStatus)) ||
    (item.status !== 'archived' && (item.capabilities.canArchive ?? item.capabilities.canChangeStatus))
  ));

  const isCurrentObjectRead = (id: string): boolean => activeObjectId.current === id &&
    !latestCoreRequest.current.capabilitiesRefreshError &&
    latestCoreRequest.current.params === params && latestCoreRequest.current.accessRevision === accessRevision &&
    latestCoreRequest.current.coreRetry === coreRetry;

  const captureOperation = () => {
    const targetId = objectId;
    const identity = user?.id;
    const requestParams = params;
    const fence = captureObjectWriteFence(() => surfaceMounted.current && activeObjectId.current === targetId && latestCoreRequest.current.params === requestParams && latestCoreRequest.current.userId === identity);
    const current = () => fence.current() && isCurrentObjectRead(targetId);
    const acknowledge = (kind: 'arrival' | 'report' | 'comment' | 'workflow', refreshSession = true) => {
      if (fence.sameTarget()) { setWriteAcknowledged({ objectId: targetId, actorId: identity, kind }); if (refreshSession) void refreshUser({ force: true }).catch(() => undefined); }
      return objectSavedWithoutAccess;
    };
    return { targetId, current, acknowledge };
  };

  const saveTeamChange = async (write: () => Promise<ServiceObject | SavedWithoutAccess>): Promise<void | SavedWithoutAccess> => {
    const operation = captureOperation();
    if (!operation.current()) throw new Error('Доступ изменился. Выбранные данные сохранены.');
    const result = await write();
    if (isSavedWithoutAccess(result) || !operation.current() || result.id !== operation.targetId) return operation.acknowledge('workflow', false);
    // The backend projected this DTO for the fresh subject. No second read.
    setItem(result);
  };
  const loadCore = async (id: string, isCancelled: () => boolean = () => false, publish = true): Promise<ServiceObject | null> => {
    if (isCancelled() || !isCurrentObjectRead(id)) return null;
    const sequence = ++coreSequence.current;
    const isCurrent = (): boolean => !isCancelled() && isCurrentObjectRead(id) && sequence === coreSequence.current;
    setCoreLoading(true);
    setCoreError(null);
    try {
      const response = await getObjectById(id);
      if (!isCurrent()) return null;
      if (publish) setItem(response);
      return response;
    } catch (error) {
      if (isCurrent()) {
        const message = error instanceof ApiError
          ? error.statusCode === 404
            ? 'Объект не найден или недоступен.'
            : error.statusCode === 403
              ? 'Нет доступа к просмотру объекта.'
              : 'Не удалось загрузить объект. Повторите попытку.'
          : 'Не удалось загрузить объект. Повторите попытку.';
        setCoreError(message);
      }
      return null;
    } finally {
      if (isCurrent()) setCoreLoading(false);
    }
  };

  const loadArrival = async (id: string, isCancelled: () => boolean = () => !isCurrentObjectRead(id)): Promise<void> => {
    if (isCancelled()) return;
    setArrivalLoading(true); setArrivalError(null);
    try { const response = await getTodayArrivalPhoto(id); if (!isCancelled()) setArrival(response); }
    catch (error) { if (!isCancelled()) setArrivalError(getErrorMessage(error, 'Не удалось загрузить фото прибытия.')); }
    finally { if (!isCancelled()) setArrivalLoading(false); }
  };
  const loadReport = async (id: string, isCancelled: () => boolean = () => !isCurrentObjectRead(id)): Promise<void> => {
    if (isCancelled()) return;
    setReportLoading(true); setReportError(null);
    try { const response = await getTodayDailyReport(id); if (!isCancelled()) setReport(response); }
    catch (error) { if (!isCancelled()) setReportError(getErrorMessage(error, 'Не удалось загрузить отчет дня.')); }
    finally { if (!isCancelled()) setReportLoading(false); }
  };
  const loadComments = async (id: string, isCancelled: () => boolean = () => !isCurrentObjectRead(id)): Promise<void> => {
    if (isCancelled()) return;
    setCommentsLoading(true); setCommentsError(null);
    try { const response = await listObjectComments(id); if (!isCancelled()) setComments(response); }
    catch (error) { if (!isCancelled()) setCommentsError(getErrorMessage(error, 'Не удалось загрузить комментарии объекта.')); }
    finally { if (!isCancelled()) setCommentsLoading(false); }
  };
  const loadFeed = async (id: string, isCancelled: () => boolean = () => !isCurrentObjectRead(id)): Promise<void> => {
    if (isCancelled()) return;
    setFeedLoading(true); setFeedError(null);
    try { const response = await getObjectFeed(id); if (!isCancelled()) setFeed(response); }
    catch (error) { if (!isCancelled()) setFeedError(getErrorMessage(error, 'Не удалось загрузить ленту объекта.')); }
    finally { if (!isCancelled()) setFeedLoading(false); }
  };
  const loadTasks = async (id: string, isCancelled: () => boolean = () => !isCurrentObjectRead(id)): Promise<void> => {
    if (isCancelled()) return;
    setTasksLoading(true); setTasksError(null);
    try { const response = await listTasksByObject(id); if (!isCancelled()) setTasks(response); }
    catch (error) { if (!isCancelled()) setTasksError(getErrorMessage(error, 'Не удалось загрузить задачи объекта.')); }
    finally { if (!isCancelled()) setTasksLoading(false); }
  };
  const loadLinkedOrders = async (id: string, isCancelled: () => boolean = () => !isCurrentObjectRead(id)): Promise<void> => {
    if (isCancelled()) return;
    setLinkedOrdersLoading(true); setLinkedOrdersError(null);
    try { const response = await listLinkedOneTimeOrders(id); if (!isCancelled()) setLinkedOrders(response); }
    catch (error) { if (!isCancelled()) setLinkedOrdersError(getSectionReadError(error, 'Связанные разовые заказы', 'Не удалось загрузить связанные разовые заказы.')); }
    finally { if (!isCancelled()) setLinkedOrdersLoading(false); }
  };
  const loadObjectInventory = async (id: string, isCancelled: () => boolean = () => !isCurrentObjectRead(id)): Promise<void> => {
    if (isCancelled()) return;
    setObjectInventoryLoading(true); setObjectInventoryError(null);
    try { const response = await getObjectInventory(id); if (!isCancelled()) setObjectInventory(response); }
    catch (error) { if (!isCancelled()) setObjectInventoryError(getSectionReadError(error, 'Расходники объекта', 'Не удалось загрузить расходники объекта.')); }
    finally { if (!isCancelled()) setObjectInventoryLoading(false); }
  };
  const loadObjectEquipment = async (id: string, isCancelled: () => boolean = () => !isCurrentObjectRead(id)): Promise<void> => {
    if (isCancelled()) return;
    setObjectEquipmentLoading(true); setObjectEquipmentError(null);
    try { const response = await getObjectEquipment(id); if (!isCancelled()) setObjectEquipment(response); }
    catch (error) { if (!isCancelled()) setObjectEquipmentError(getSectionReadError(error, 'Оборудование объекта', 'Не удалось загрузить оборудование объекта.')); }
    finally { if (!isCancelled()) setObjectEquipmentLoading(false); }
  };
  const loadObjectFiles = async (id: string, isCancelled: () => boolean = () => !isCurrentObjectRead(id), background = false): Promise<void> => {
    if (isCancelled()) return;
    if (!background) setObjectFilesLoading(true);
    setObjectFilesError(null);
    try { const response = await listFilesByEntity('object', id); if (!isCancelled()) setObjectFiles(response); }
    catch (error) { if (!isCancelled()) setObjectFilesError(getErrorMessage(error, 'Не удалось загрузить файлы объекта.')); }
    finally { if (!background && !isCancelled()) setObjectFilesLoading(false); }
  };
  const loadAssignedEmployees = async (id: string, isCancelled: () => boolean = () => !isCurrentObjectRead(id)): Promise<void> => {
    if (isCancelled()) return;
    setAssignedEmployeesLoading(true); setAssignedEmployeesError(null);
    try { const response = await listObjectEmployees(id); if (!isCancelled()) setAssignedEmployees(Array.isArray(response) ? response : []); }
    catch (error) { if (!isCancelled()) setAssignedEmployeesError(getErrorMessage(error, 'Не удалось загрузить текущий состав сотрудников.')); }
    finally { if (!isCancelled()) setAssignedEmployeesLoading(false); }
  };
  const loadDirectory = async (id: string, search: string, isCancelled: () => boolean = () => !isCurrentObjectRead(id)): Promise<void> => {
    if (isCancelled()) return;
    setDirectoryLoading(true); setDirectoryError(null);
    try { const response = await searchEmployeeDirectory(id, search); if (!isCancelled()) setDirectoryEmployees(Array.isArray(response) ? response : []); }
    catch (error) { if (!isCancelled()) setDirectoryError(getErrorMessage(error, 'Не удалось загрузить справочник сотрудников.')); }
    finally { if (!isCancelled()) setDirectoryLoading(false); }
  };
  const loadAttendance = async (id: string, isCancelled: () => boolean = () => !isCurrentObjectRead(id)): Promise<void> => {
    if (isCancelled()) return;
    setAttendanceLoading(true); setAttendanceError(null);
    try {
      const response = await getTodayObjectAttendance(id);
      if (!isCancelled()) {
        setAttendanceEmployeeIds(response.submittedAt ? response.employeeIds ?? [] : response.suggestedEmployeeIds ?? response.employeeIds ?? []);
        setAttendanceEmployeeFacts(response.employeeFacts ?? []);
        setAttendanceEmployees(Array.isArray(response.employees) ? response.employees : []);
      }
    } catch (error) {
      if (!isCancelled()) setAttendanceError(getErrorMessage(error, 'Не удалось загрузить отметку присутствия за сегодня.'));
    } finally {
      if (!isCancelled()) setAttendanceLoading(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    const isRequestCurrent = (): boolean => !cancelled && latestCoreRequest.current.params === params &&
      !latestCoreRequest.current.capabilitiesRefreshError &&
      latestCoreRequest.current.accessRevision === accessRevision && latestCoreRequest.current.coreRetry === coreRetry;
    setLoadedAccessRevision(null);
    if (capabilitiesRefreshError) return;
    setCoreLoading(true);
    setCoreError(null);
    void (async () => {
      const resolved = await params;
      if (!isRequestCurrent()) return;
      if (activeObjectId.current !== resolved.id) {
        setItem(null);
        activeObjectId.current = resolved.id;
      }
      setObjectId(resolved.id);
      const isCancelled = (): boolean => !isRequestCurrent() || activeObjectId.current !== resolved.id;
      const core = await loadCore(resolved.id, isCancelled, false);
      if (!core || isCancelled()) return;

      const employeeLoads = core.capabilities.canViewEmployees === false ? [] : [loadAssignedEmployees(resolved.id, isCancelled)];
      if (core.capabilities.canManageEmployees) employeeLoads.push(loadDirectory(resolved.id, '', isCancelled));
      const operationalLoads = core.capabilities.canViewOperationalSections
        ? [
            loadArrival(resolved.id, isCancelled), loadReport(resolved.id, isCancelled),
            loadComments(resolved.id, isCancelled), loadFeed(resolved.id, isCancelled),
            loadLinkedOrders(resolved.id, isCancelled), loadObjectInventory(resolved.id, isCancelled),
            loadObjectEquipment(resolved.id, isCancelled),
            loadTasks(resolved.id, isCancelled),
            ...(core.capabilities.canOperateAttendance === false ? [] : [loadAttendance(resolved.id, isCancelled)]),
          ]
        : core.capabilities.canViewReportsHistory ? [loadReport(resolved.id, isCancelled)] : [];
      const materialLoads = (core.capabilities.canReadMaterials ?? core.capabilities.canViewOperationalSections) ? [loadObjectFiles(resolved.id, isCancelled)] : [];
      await Promise.all([...employeeLoads, ...operationalLoads, ...materialLoads]);
      if (!isCancelled()) { setItem(core); setLoadedAccessRevision(accessRevision); setLoadedParams(params); }
    })().catch((error) => {
      if (!isRequestCurrent()) return;
      setCoreError(getErrorMessage(error, 'Не удалось загрузить объект. Повторите попытку.'));
      setCoreLoading(false);
    });
    return () => { cancelled = true; };
  }, [params, coreRetry, accessRevision, capabilitiesRefreshError]);

  useEffect(() => {
    if (!objectId || !item) return;
    if (!canManageResponsibles && !canManageManagers) {
      setResponsibleCandidates([]); setManagerCandidates([]); setTeamUsersError(null); setTeamUsersLoading(false); return;
    }
    let cancelled = false;
    void (async () => {
      setTeamUsersLoading(true); setTeamUsersError(null);
      try {
        const [responsibles, managers] = await Promise.all([
          canManageResponsibles ? listSystemUsers({ purpose: 'object_responsible', objectId }) : Promise.resolve([]),
          canManageManagers ? listSystemUsers({ purpose: 'object_manager', objectId }) : Promise.resolve([]),
        ]);
        if (!cancelled) { setResponsibleCandidates(responsibles); setManagerCandidates(managers); }
      } catch (error) {
        if (!cancelled) setTeamUsersError(getErrorMessage(error, 'Не удалось загрузить кандидатов для команды объекта.'));
      } finally { if (!cancelled) setTeamUsersLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [objectId, item, canManageResponsibles, canManageManagers]);

  useEffect(() => {
    if (!objectId || !item?.capabilities.canManageEmployees) return;
    let cancelled = false;
    const timeout = window.setTimeout(() => void loadDirectory(objectId, employeeSearch, () => cancelled), 250);
    return () => { cancelled = true; window.clearTimeout(timeout); };
  }, [objectId, employeeSearch, item?.capabilities.canManageEmployees, accessRevision]);

  return (
    <div className={`ui-page object-detail-page ${styles.fullWidth}`}>
      {(coreLoading || loadedAccessRevision !== accessRevision || loadedParams !== params) && !coreError ? <ObjectPanelLoading title="Обновление доступа к объекту" /> : null}
      {coreError ? <><ObjectPanelError title="Доступ к объекту не подтверждён" message={coreError} /><Button onClick={() => setCoreRetry((attempt) => attempt + 1)}>Повторить проверку доступа</Button></> : null}
      {capabilitiesRefreshError ? <Alert tone="warning" role="alert">{capabilitiesRefreshError}</Alert> : null}
      {(writeAcknowledged?.objectId === objectId && writeAcknowledged.actorId === user?.id) ? <Alert tone="warning" role="status">{writeAcknowledged.kind === 'workflow' ? 'Изменение сохранено. Подробности сейчас недоступны; повторная запись не отправлялась.' : 'Запись сохранена. Подробности или завершение вложений сейчас недоступны; черновик и файлы сохранены. Повторная запись не отправлялась.'}
        <Button pending={checkingWrite} disabled={checkingWrite} onClick={async () => {
          const receipt = writeAcknowledged;
          if (!receipt) return;
          const identity = user?.id;
          setCheckingWrite(true);
          try {
            await refreshUser({ force: true });
            const requestParams = latestCoreRequest.current.params;
            const fence = captureObjectWriteFence(() => surfaceMounted.current && activeObjectId.current === receipt.objectId && latestCoreRequest.current.params === requestParams && latestCoreRequest.current.userId === identity);
            const freshCore = await getObjectById(receipt.objectId);
            if (!fence.current() || latestCoreRequest.current.capabilitiesRefreshError || freshCore.id !== receipt.objectId) return;
            if (receipt.kind === 'report') {
              const fresh = await getTodayDailyReport(receipt.objectId);
              if (!fence.current() || (fresh && fresh.objectId !== receipt.objectId)) return;
              setReport(fresh);
            } else if (receipt.kind === 'arrival') {
              const fresh = await getTodayArrivalPhoto(receipt.objectId);
              if (!fence.current() || (fresh && fresh.objectId !== receipt.objectId)) return;
              setArrival(fresh);
            } else if (receipt.kind === 'comment') {
              const fresh = await listObjectComments(receipt.objectId);
              if (!fence.current()) return;
              setComments(fresh);
            }
            if (!fence.current()) return;
            setItem(freshCore); setLoadedAccessRevision(latestCoreRequest.current.accessRevision); setLoadedParams(requestParams); setCoreError(null); setWriteAcknowledged(null);
          } catch { /* The acknowledged primary write is never automatically repeated. */ }
          finally { if (activeObjectId.current === receipt.objectId && latestCoreRequest.current.userId === identity) setCheckingWrite(false); }
        }}>Проверить сохранённые данные</Button>
      </Alert> : null}
      <AccessSnapshotBoundary blocked={(writeAcknowledged?.objectId === objectId && writeAcknowledged.actorId === user?.id) || !!capabilitiesRefreshError || coreLoading || !!coreError || loadedAccessRevision !== accessRevision || loadedParams !== params}>
      {item ? (
        <div key={item.id} className={styles.workspace}>
          <ObjectSummaryCard item={item} />

          <nav className={styles.navigation} aria-label="Разделы объекта">
            <a href="#overview">Обзор</a>
            {item.capabilities.canViewOperationalSections ? <a href="#today">Сегодня</a> : null}
            <a href="#team">Команда</a>
            <a href="#contacts">Контакты</a>
            <a href="#planning">Бюджет и сезоны</a>
            {item.capabilities.canViewReportsHistory ? <a href="#reports">Отчёты</a> : null}
            {!item.capabilities.canViewOperationalSections && item.capabilities.canViewReportsHistory ? <>
              <a href="#history">История</a>
            </> : null}
            {item.capabilities.canViewOperationalSections ? <>
              <a href="#tasks">Задачи</a>
              <a href="#inventory">Склад</a>
              <a href="#equipment">Оборудование</a>
              <a href="#rubber-mats">Ковры</a>
              <a href="#files">Файлы</a>
              <a href="#history">История</a>
            </> : null}
          </nav>

          <WorkspaceSection id="overview" title="Обзор">
            <ObjectSetupPanel key={objectId} objectId={objectId} />
            {item.capabilities.canViewOperationalSections ? (
              <Surface padding="md" className={`${styles.quickAction}`}>
                <div className="ui-section-title">Рабочий чат</div>
                <Link href="/chats?room=objects">Открыть</Link>
              </Surface>
            ) : null}

            {canManageObjectStatus ? (
              <ObjectStatusControlPanel
                objectId={objectId}
                currentStatus={item.status}
                canChangeStatus={item.capabilities.canChangeStatus}
                canFreeze={item.capabilities.canFreeze}
                canArchive={item.capabilities.canArchive}
                canRestore={item.capabilities.canRestore}
                approvalsHref={`/approvals?sourceEntityType=object&sourceEntityId=${objectId}`}
                onChangeStatus={async (status) => {
                  const operation = captureOperation();
                  if (!operation.current()) throw new Error('Доступ изменился. Запрос не отправлен.');
                  const result = await changeObjectStatus(operation.targetId, { status });
                  if (isSavedWithoutAccess(result) || !operation.current()) return operation.acknowledge('workflow', false);
                }}
              />
            ) : null}

            {(canManageResponsibles || canManageManagers) ? (
              <div className={styles.twoColumn}>
                {teamUsersLoading ? <ObjectPanelLoading title="Ответственные и менеджеры объекта" /> : null}
                {teamUsersError ? (
                  <ObjectPanelError title="Ответственные и менеджеры объекта" message={teamUsersError} />
                ) : null}
                <AccessSnapshotBoundary blocked={teamUsersLoading || !!teamUsersError}>
                  {canManageResponsibles ? (
                    <ObjectTeamPanel
                      key={`${user?.id}:${objectId}:responsible`}
                      objectId={objectId}
                      title="Ответственный объекта"
                      replaceOnly
                      currentItems={item.responsibles}
                      availableUsers={responsibleCandidates}
                      emptyCurrentText="Ответственные пока не назначены."
                      emptyAvailableText="Подходящие пользователи не найдены."
                      addButtonText="Добавить ответственного"
                      removeButtonText="Снять"
                      onAdd={(userId) => saveTeamChange(() => addResponsibleToObject(objectId, userId))}
                      onRemove={(userId) => saveTeamChange(() => removeResponsibleFromObject(objectId, userId))}
                    />
                  ) : null}
                  {canManageManagers ? (
                    <ObjectTeamPanel
                      key={`${user?.id}:${objectId}:manager`}
                      objectId={objectId}
                      title="Менеджеры объекта"
                      currentItems={item.managers}
                      availableUsers={managerCandidates}
                      emptyCurrentText="Менеджеры пока не назначены."
                      emptyAvailableText="Подходящие пользователи не найдены."
                      addButtonText="Добавить менеджера"
                      removeButtonText="Снять"
                      onAdd={(userId) => saveTeamChange(() => addManagerToObject(objectId, userId))}
                      onRemove={(userId) => saveTeamChange(() => removeManagerFromObject(objectId, userId))}
                    />
                  ) : null}
                </AccessSnapshotBoundary>
              </div>
            ) : null}

            {item.capabilities.canViewOperationalSections ? (
              linkedOrdersLoading ? <ObjectPanelLoading title="Связанные разовые заказы" /> : linkedOrdersError ? (
                <ObjectPanelError title="Связанные разовые заказы" message={linkedOrdersError} />
              ) : <LinkedOneTimeOrdersPanel items={linkedOrders} />
            ) : null}
          </WorkspaceSection>

          {item.capabilities.canViewOperationalSections ? (
            <WorkspaceSection id="today" title="Сегодня">
              {item.capabilities.canOperateAttendance === false ? null : <TodayShiftsPanel key={objectId} objectId={objectId} employees={assignedEmployees} onDayStateChange={onShiftDayStateChange} onChanged={async () => { setFinancialRevision((value) => value + 1); await Promise.all([loadAttendance(objectId), loadAssignedEmployees(objectId)]); }} />}
              {item.capabilities.canOperateAttendance === false ? null : <>
              {attendanceLoading ? <ObjectPanelLoading title="Кто был сегодня на объекте" /> : null}
              {attendanceError ? (
                <ObjectPanelError title="Кто был сегодня на объекте" message={attendanceError} />
              ) : null}
              <AccessSnapshotBoundary blocked={attendanceLoading || !!attendanceError}>
                <ObjectAttendancePanel
                  objectId={objectId}
                  onSubstitutionSaved={async () => { await Promise.all([loadAttendance(objectId), loadAssignedEmployees(objectId)]); }}
                  employees={attendanceEmployees}
                  initialEmployeeIds={currentShiftDay?.owned ? [...new Set([...attendanceEmployeeFacts.map((fact) => fact.employeeId), ...currentShiftDay.confirmedEmployeeIds])] : attendanceEmployeeIds}
                  initialEmployeeFacts={attendanceEmployeeFacts}
                  readOnlyReason={legacyAttendanceReadOnlyReason}
                  canEditRates={item.capabilities.canEditDailyRate}
                  canAddExtraShift={item.capabilities.canAddExtraShift ?? false}
                  operationDate={todayAsBusinessDate()}
                  onSave={async (payload) => {
                    const result = await upsertObjectAttendance(objectId, payload);
                    if ('adjustmentId' in result) return result;
                    await Promise.all([loadAttendance(objectId), loadAssignedEmployees(objectId), loadDirectory(objectId, employeeSearch)]);
                  }}
                />
              </AccessSnapshotBoundary>
              </>}
              <div className={styles.todayGrid}>
              {arrivalLoading ? <ObjectPanelLoading title="Фото прибытия сегодня" /> : null}
              {arrivalError ? (
                  <ObjectPanelError title="Фото прибытия сегодня" message={arrivalError} />
              ) : null}
              <AccessSnapshotBoundary blocked={arrivalLoading || !!arrivalError}>
                  <ObjectArrivalPanel key={`${user?.id}:${objectId}`} objectId={objectId} item={arrival} canSave={item.capabilities.canCreateArrivalPhoto === true} onSave={async (payload) => {
                    const operation = captureOperation();
                    if (!operation.current()) throw new Error('Доступ изменился. Черновик сохранён.');
                    const saved = await upsertTodayArrivalPhoto(operation.targetId, { photoUrl: payload.photoUrl, photoType: payload.photoType ?? 'other', comment: payload.comment });
                    if (isSavedWithoutAccess(saved) || !operation.current() || saved.objectId !== operation.targetId) return operation.acknowledge('arrival');
                    try {
                      for (const [index, file] of payload.files.entries()) {
                        if (!operation.current()) return operation.acknowledge('arrival');
                        const uploaded = await uploadFileToEntity({ entityType: 'object_arrival_photo', entityId: saved.id, file, originalName: payload.fileNames[index] ?? file.name });
                        if (isSavedWithoutAccess(uploaded) || !operation.current()) return operation.acknowledge('arrival');
                      }
                      await loadArrival(operation.targetId, () => !operation.current());
                      if (!operation.current()) return operation.acknowledge('arrival');
                      await loadFeed(operation.targetId, () => !operation.current());
                      if (!operation.current()) return operation.acknowledge('arrival');
                    } catch { return operation.acknowledge('arrival'); }
                  }} />
              </AccessSnapshotBoundary>

                {reportLoading ? <ObjectPanelLoading title="Ежедневный отчет" /> : null}
                {reportError ? (
                  <ObjectPanelError title="Ежедневный отчет" message={reportError} />
                ) : null}
                <AccessSnapshotBoundary blocked={reportLoading || !!reportError}>
                  <ObjectDailyReportPanel key={`${user?.id}:${objectId}`} objectId={objectId} item={report} canSave={item.capabilities.canEditDailyReport === true} canSubmit={item.capabilities.canSubmitDailyReport === true}
                    onSavedWithoutAccess={() => { const operation = captureOperation(); operation.acknowledge('report'); }}
                    onAttachmentsUpdated={async () => {
                      const operation = captureOperation();
                      if (!operation.current()) return null;
                      const fresh = await getTodayDailyReport(operation.targetId);
                      if (!operation.current() || (fresh && fresh.objectId !== operation.targetId)) return null;
                      setReport(fresh); return fresh;
                    }} onSave={async (payload) => {
                      const operation = captureOperation();
                      if (!operation.current()) throw new Error('Доступ изменился. Черновик сохранён.');
                      const saved = await upsertTodayDailyReport(operation.targetId, { content: payload.content, expectedRevision: report?.revision ?? 0 });
                      if (isSavedWithoutAccess(saved) || !operation.current() || saved.objectId !== operation.targetId) return operation.acknowledge('report');
                      try {
                        const fresh = await getTodayDailyReport(operation.targetId);
                        if (!operation.current() || !fresh || fresh.objectId !== operation.targetId) return operation.acknowledge('report');
                        setReport(fresh);
                        await loadFeed(operation.targetId, () => !operation.current());
                        if (!operation.current()) return operation.acknowledge('report');
                        return fresh;
                      } catch { return operation.acknowledge('report'); }
                    }} />
                </AccessSnapshotBoundary>

              </div>

              {commentsLoading ? <ObjectPanelLoading title="Оперативный комментарий" /> : null}
              {commentsError ? (
                <ObjectPanelError title="Оперативный комментарий" message={commentsError} />
              ) : null}
              <AccessSnapshotBoundary blocked={commentsLoading || !!commentsError}>
                <ObjectCommentsPanel key={`${user?.id}:${objectId}`} objectId={objectId} items={comments} canCreate={item.capabilities.canCreateComment === true} onCreate={async (payload) => {
                  const operation = captureOperation();
                  if (!operation.current()) throw new Error('Доступ изменился. Черновик сохранён.');
                  const created = await createObjectComment(operation.targetId, { content: payload.content, commentType: payload.commentType });
                  if (isSavedWithoutAccess(created) || !operation.current() || created.objectId !== operation.targetId) return operation.acknowledge('comment');
                  return created;
                }} onUpload={async (commentId, file) => {
                  const operation = captureOperation();
                  if (!operation.current()) throw new Error('Доступ изменился. Очередь сохранена.');
                  const currentComments = await listObjectComments(operation.targetId);
                  if (!operation.current() || !currentComments.some(row => row.id === commentId && row.objectId === operation.targetId)) throw new Error('Сохранённый комментарий недоступен. Очередь сохранена.');
                  const uploaded = await uploadFileToEntity({ entityType: 'object_comment', entityId: commentId, file });
                  if (isSavedWithoutAccess(uploaded) || !operation.current()) return operation.acknowledge('comment');
                  return uploaded;
                }} onRefresh={async () => {
                  const operation = captureOperation();
                  if (!operation.current()) return false;
                  const fresh = await listObjectComments(operation.targetId);
                  if (!operation.current()) return false;
                  setComments(fresh);
                  await loadFeed(operation.targetId, () => !operation.current());
                  return operation.current();
                }} />
              </AccessSnapshotBoundary>
            </WorkspaceSection>
          ) : null}

          <WorkspaceSection id="team" title="Команда">
            {item.capabilities.canViewOperationalSections ? <ObjectSchedulingPanel key={objectId} objectId={objectId} canSelectEmployees={item.capabilities.canManageEmployees} employees={assignedEmployees} onChanged={() => { void loadAssignedEmployees(objectId); }} /> : null}
            {item.capabilities.canViewEmployees === false ? null : <>
            {assignedEmployeesLoading ? <ObjectPanelLoading title="Состав сотрудников объекта" /> : null}
            {assignedEmployeesError ? (
              <ObjectPanelError title="Состав сотрудников объекта" message={assignedEmployeesError} />
            ) : null}
            <AccessSnapshotBoundary blocked={assignedEmployeesLoading || !!assignedEmployeesError}>
              <ObjectStaffingPanel
                object={item}
                assignedEmployees={assignedEmployees}
                directoryEmployees={directoryEmployees}
                search={employeeSearch}
                isSearching={directoryLoading}
                searchError={directoryError}
                onSearchChange={setEmployeeSearch}
                onAdd={async (employeeId) => {
                  await addEmployeeToObject(objectId, employeeId);
                  const reloads = [loadAssignedEmployees(objectId), loadDirectory(objectId, employeeSearch)];
                  if (item.capabilities.canViewOperationalSections) reloads.push(loadAttendance(objectId));
                  await Promise.all(reloads);
                }}
                onRemove={async (employeeId) => {
                  await removeEmployeeFromObject(objectId, employeeId);
                  const reloads = [loadAssignedEmployees(objectId), loadDirectory(objectId, employeeSearch)];
                  if (item.capabilities.canViewOperationalSections) reloads.push(loadAttendance(objectId));
                  await Promise.all(reloads);
                }}
                canManageAssignments={item.capabilities.canManageEmployees}
                canViewRateOptions={item.capabilities.canManageCompensationRates || item.capabilities.canViewOperationalSections}
                canManageRatePolicy={item.capabilities.canManageCompensationRates ?? item.capabilities.canEditDailyRate}
                onUpdateRatePolicy={async (employeeId, payload) => {
                  await updateObjectEmployeeRatePolicy(objectId, employeeId, payload);
                  await Promise.all([loadAssignedEmployees(objectId), loadAttendance(objectId)]);
                }}
              />
            </AccessSnapshotBoundary>
            </>}
          </WorkspaceSection>

          {item.capabilities.canReadContacts !== false ? <WorkspaceSection id="contacts" title="Контакты">
            <ObjectContactsPanel objectId={objectId} canEdit={item.capabilities.canManageContacts ?? item.capabilities.canEdit}
              captureWrite={() => {
                const operation = captureOperation();
                return { current: operation.current, acknowledge: () => { operation.acknowledge('workflow', false); } };
              }}
            />
          </WorkspaceSection> : null}
          {item.capabilities.canViewReportsHistory ? <WorkspaceSection id="reports" title="Ежедневные отчёты"><ObjectReportsPanel objectId={objectId} /></WorkspaceSection> : null}
          {!item.capabilities.canViewOperationalSections && item.capabilities.canViewReportsHistory ? <>
            <WorkspaceSection id="history" title="История">
              <Link href={`/objects/${objectId}/history`}>Открыть историю объекта</Link>
            </WorkspaceSection>
          </> : null}
          <WorkspaceSection id="planning" title="Бюджет и сезоны">
            <ObjectPlanningPanel objectId={objectId} item={item} financialRevision={financialRevision} onChanged={() => { void loadCore(objectId); }} />
          </WorkspaceSection>
          {item.capabilities.canViewOperationalSections ? <>
            <WorkspaceSection id="tasks" title="Задачи">
              {tasksLoading ? <ObjectPanelLoading title="Задачи объекта" /> : tasksError ? (
                <ObjectPanelError title="Задачи объекта" message={tasksError} />
              ) : <TaskListTable items={tasks} emptyText="На объект пока не назначены задачи." />}
            </WorkspaceSection>

            <WorkspaceSection id="inventory" title="Склад">
              {objectInventoryLoading ? <ObjectPanelLoading title="Расходники объекта" /> : null}
              {objectInventoryError ? (
                <ObjectPanelError title="Расходники объекта" message={objectInventoryError} />
              ) : null}
              <AccessSnapshotBoundary blocked={objectInventoryLoading || !!objectInventoryError}>
              {objectInventory ? (
                <ObjectInventoryPanel
                  key={objectId}
                  movements={objectInventory.movements}
                  availableItems={objectInventory.availableItems}
                  canIssueInventoryToObject={objectInventory.capabilities.canIssueInventoryToObject}
                  onIssue={async (payload) => {
                    const created = await createObjectInventoryIssue(objectId, {
                      inventoryItemId: payload.inventoryItemId,
                      quantity: payload.quantity,
                      comment: payload.comment,
                    });
                    return created.id;
                  }}
                  onAttachEvidence={async (movementId, files) => {
                    await Promise.all(files.map((file) => uploadFileToEntity({ entityType: 'inventory_movement', entityId: movementId, file })));
                  }}
                  onRefresh={() => loadObjectInventory(objectId)}
                />
              ) : null}
              </AccessSnapshotBoundary>
            </WorkspaceSection>

            <WorkspaceSection id="equipment" title="Оборудование">
              {objectEquipmentLoading ? <ObjectPanelLoading title="Закреплённое оборудование" /> : objectEquipmentError ? (
                <ObjectPanelError title="Оборудование объекта" message={objectEquipmentError} />
              ) : objectEquipment ? <EquipmentScopePanel className={styles.equipmentPanel} title="Закреплённое оборудование" units={objectEquipment.units} /> : null}
            </WorkspaceSection>

            <WorkspaceSection id="rubber-mats" title="Резиновые ковры">
              <ObjectRubberMatsPanel objectId={objectId} />
            </WorkspaceSection>

          </> : null}
            {(item.capabilities.canReadMaterials ?? item.capabilities.canViewOperationalSections) ? <WorkspaceSection id="files" title="Материалы об объекте">
              {objectFilesLoading ? <ObjectPanelLoading title="Материалы об объекте" /> : null}
              {objectFilesError ? (
                <ObjectPanelError title="Материалы об объекте" message={objectFilesError} />
              ) : null}
              <AccessSnapshotBoundary blocked={objectFilesLoading || !!objectFilesError}>
                <EntityFilesPanel
                  key={objectId}
                  title="Материалы об объекте"
                  iconOnlyMediaActions
                  files={objectFiles}
                  canUpload={canUploadFile && (item.capabilities.canManageMaterials ?? item.capabilities.canEdit)}
                  onUpload={async (file) => {
                    if (!canUploadFile) throw new Error('Загрузка файлов недоступна.');
                    await uploadFileToEntity({ entityType: 'object', entityId: objectId, file });
                    // A same-source list refresh is not an authority change.
                    // Keep the selected batch usable between successful files.
                    await loadObjectFiles(objectId, undefined, true);
                  }}
                  emptyText="Вложений пока нет."
                />
              </AccessSnapshotBoundary>
            </WorkspaceSection> : null}

          {item.capabilities.canViewOperationalSections ? <>
            <WorkspaceSection id="history" title="История">
              <Surface padding="md" className={`${styles.quickAction}`}>
                <div className="ui-section-title">История изменений</div>
                <Link href={`/objects/${objectId}/history`}>Открыть</Link>
              </Surface>
              {feedLoading ? <ObjectPanelLoading title="Лента событий" /> : feedError ? (
                <ObjectPanelError title="Лента событий" message={feedError} />
              ) : <ObjectFeedList items={feed} />}
            </WorkspaceSection>
          </> : null}
        </div>
      ) : (
        <div className="ui-empty-state">Объект не найден.</div>
      )}
      </AccessSnapshotBoundary>
    </div>
  );
}
