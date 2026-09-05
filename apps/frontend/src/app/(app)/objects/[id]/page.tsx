'use client';

import Link from 'next/link';
import React, { useEffect, useState } from 'react';

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
import { ObjectCommentsPanel } from '@/features/object-comments/ui/object-comments-panel';
import { ObjectFeedList } from '@/features/object-feed/ui/object-feed-list';
import { ObjectInventoryPanel } from '@/features/object-inventory/ui/object-inventory-panel';
import { ObjectDailyReportPanel } from '@/features/object-report/ui/object-daily-report-panel';
import { ObjectStaffingPanel } from '@/features/object-staffing/ui/object-staffing-panel';
import {
  ObjectPanelError,
  ObjectPanelLoading,
} from '@/features/object-state/ui/object-state-panels';
import { ObjectStatusControlPanel } from '@/features/object-status-control/ui/object-status-control-panel';
import { ObjectTeamPanel } from '@/features/object-team/ui/object-team-panel';
import { TaskListTable } from '@/features/task-list/ui/task-list-table';
import { EntityFilesPanel } from '@/shared/ui/entity-files/entity-files-panel';
import { PageTitle } from '@/shared/ui/page-title/page-title';

import styles from './object-detail-workspace.module.css';

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() ? error.message : fallback;
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
  description,
  children,
}: {
  id: string;
  title: string;
  description?: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <section id={id} className={styles.section} aria-labelledby={`${id}-title`}>
      <header className={styles.sectionHeader}>
        <div>
          <h2 id={`${id}-title`} className={styles.sectionTitle}>{title}</h2>
          {description ? <p className={styles.sectionDescription}>{description}</p> : null}
        </div>
      </header>
      {children}
    </section>
  );
}

export default function ObjectDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): React.JSX.Element {
  const [objectId, setObjectId] = useState('');
  const [item, setItem] = useState<ServiceObject | null>(null);
  const [coreLoading, setCoreLoading] = useState(true);
  const [coreError, setCoreError] = useState<string | null>(null);

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
  const canManageObjectStatus = item?.capabilities.canChangeStatus ?? false;

  const loadCore = async (id: string, cancelled = false): Promise<ServiceObject | null> => {
    setCoreLoading(true);
    setCoreError(null);
    try {
      const response = await getObjectById(id);
      if (!cancelled) setItem(response);
      return response;
    } catch (error) {
      if (!cancelled) setCoreError(getErrorMessage(error, 'Не удалось загрузить карточку объекта.'));
      return null;
    } finally {
      if (!cancelled) setCoreLoading(false);
    }
  };

  const loadArrival = async (id: string, cancelled = false): Promise<void> => {
    setArrivalLoading(true); setArrivalError(null);
    try { const response = await getTodayArrivalPhoto(id); if (!cancelled) setArrival(response); }
    catch (error) { if (!cancelled) setArrivalError(getErrorMessage(error, 'Не удалось загрузить фото прибытия.')); }
    finally { if (!cancelled) setArrivalLoading(false); }
  };
  const loadReport = async (id: string, cancelled = false): Promise<void> => {
    setReportLoading(true); setReportError(null);
    try { const response = await getTodayDailyReport(id); if (!cancelled) setReport(response); }
    catch (error) { if (!cancelled) setReportError(getErrorMessage(error, 'Не удалось загрузить отчет дня.')); }
    finally { if (!cancelled) setReportLoading(false); }
  };
  const loadComments = async (id: string, cancelled = false): Promise<void> => {
    setCommentsLoading(true); setCommentsError(null);
    try { const response = await listObjectComments(id); if (!cancelled) setComments(response); }
    catch (error) { if (!cancelled) setCommentsError(getErrorMessage(error, 'Не удалось загрузить комментарии объекта.')); }
    finally { if (!cancelled) setCommentsLoading(false); }
  };
  const loadFeed = async (id: string, cancelled = false): Promise<void> => {
    setFeedLoading(true); setFeedError(null);
    try { const response = await getObjectFeed(id); if (!cancelled) setFeed(response); }
    catch (error) { if (!cancelled) setFeedError(getErrorMessage(error, 'Не удалось загрузить ленту объекта.')); }
    finally { if (!cancelled) setFeedLoading(false); }
  };
  const loadTasks = async (id: string, cancelled = false): Promise<void> => {
    setTasksLoading(true); setTasksError(null);
    try { const response = await listTasksByObject(id); if (!cancelled) setTasks(response); }
    catch (error) { if (!cancelled) setTasksError(getErrorMessage(error, 'Не удалось загрузить задачи объекта.')); }
    finally { if (!cancelled) setTasksLoading(false); }
  };
  const loadLinkedOrders = async (id: string, cancelled = false): Promise<void> => {
    setLinkedOrdersLoading(true); setLinkedOrdersError(null);
    try { const response = await listLinkedOneTimeOrders(id); if (!cancelled) setLinkedOrders(response); }
    catch (error) { if (!cancelled) setLinkedOrdersError(getErrorMessage(error, 'Не удалось загрузить связанные разовые заказы.')); }
    finally { if (!cancelled) setLinkedOrdersLoading(false); }
  };
  const loadObjectInventory = async (id: string, cancelled = false): Promise<void> => {
    setObjectInventoryLoading(true); setObjectInventoryError(null);
    try { const response = await getObjectInventory(id); if (!cancelled) setObjectInventory(response); }
    catch (error) { if (!cancelled) setObjectInventoryError(getErrorMessage(error, 'Не удалось загрузить расходники объекта.')); }
    finally { if (!cancelled) setObjectInventoryLoading(false); }
  };
  const loadObjectEquipment = async (id: string, cancelled = false): Promise<void> => {
    setObjectEquipmentLoading(true); setObjectEquipmentError(null);
    try { const response = await getObjectEquipment(id); if (!cancelled) setObjectEquipment(response); }
    catch (error) { if (!cancelled) setObjectEquipmentError(getErrorMessage(error, 'Не удалось загрузить оборудование объекта.')); }
    finally { if (!cancelled) setObjectEquipmentLoading(false); }
  };
  const loadObjectFiles = async (id: string, cancelled = false): Promise<void> => {
    setObjectFilesLoading(true); setObjectFilesError(null);
    try { const response = await listFilesByEntity('object', id); if (!cancelled) setObjectFiles(response); }
    catch (error) { if (!cancelled) setObjectFilesError(getErrorMessage(error, 'Не удалось загрузить файлы объекта.')); }
    finally { if (!cancelled) setObjectFilesLoading(false); }
  };
  const loadAssignedEmployees = async (id: string, cancelled = false): Promise<void> => {
    setAssignedEmployeesLoading(true); setAssignedEmployeesError(null);
    try { const response = await listObjectEmployees(id); if (!cancelled) setAssignedEmployees(Array.isArray(response) ? response : []); }
    catch (error) { if (!cancelled) setAssignedEmployeesError(getErrorMessage(error, 'Не удалось загрузить текущий состав сотрудников.')); }
    finally { if (!cancelled) setAssignedEmployeesLoading(false); }
  };
  const loadDirectory = async (id: string, search: string, cancelled = false): Promise<void> => {
    setDirectoryLoading(true); setDirectoryError(null);
    try { const response = await searchEmployeeDirectory(id, search); if (!cancelled) setDirectoryEmployees(Array.isArray(response) ? response : []); }
    catch (error) { if (!cancelled) setDirectoryError(getErrorMessage(error, 'Не удалось загрузить справочник сотрудников.')); }
    finally { if (!cancelled) setDirectoryLoading(false); }
  };
  const loadAttendance = async (id: string, cancelled = false): Promise<void> => {
    setAttendanceLoading(true); setAttendanceError(null);
    try {
      const response = await getTodayObjectAttendance(id);
      if (!cancelled) {
        setAttendanceEmployeeIds(response.employeeIds ?? []);
        setAttendanceEmployeeFacts(response.employeeFacts ?? []);
        setAttendanceEmployees(Array.isArray(response.employees) ? response.employees : []);
      }
    } catch (error) {
      if (!cancelled) setAttendanceError(getErrorMessage(error, 'Не удалось загрузить отметку присутствия за сегодня.'));
    } finally {
      if (!cancelled) setAttendanceLoading(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const resolved = await params;
      if (cancelled) return;
      setObjectId(resolved.id);
      const core = await loadCore(resolved.id, cancelled);
      if (!core || cancelled) return;

      const employeeLoads = [loadAssignedEmployees(resolved.id, cancelled)];
      if (core.capabilities.canManageEmployees) employeeLoads.push(loadDirectory(resolved.id, '', cancelled));
      const operationalLoads = core.capabilities.canViewOperationalSections
        ? [
            loadArrival(resolved.id, cancelled), loadReport(resolved.id, cancelled),
            loadComments(resolved.id, cancelled), loadFeed(resolved.id, cancelled),
            loadLinkedOrders(resolved.id, cancelled), loadObjectInventory(resolved.id, cancelled),
            loadObjectEquipment(resolved.id, cancelled), loadObjectFiles(resolved.id, cancelled),
            loadTasks(resolved.id, cancelled), loadAttendance(resolved.id, cancelled),
          ]
        : [];
      await Promise.all([...employeeLoads, ...operationalLoads]);
    })();
    return () => { cancelled = true; };
  }, [params]);

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
    const timeout = window.setTimeout(() => void loadDirectory(objectId, employeeSearch, cancelled), 250);
    return () => { cancelled = true; window.clearTimeout(timeout); };
  }, [objectId, employeeSearch, item?.capabilities.canManageEmployees]);

  return (
    <div className="workspace-page object-detail-page">
      <PageTitle title={item ? item.name : 'Карточка объекта'} />

      {coreLoading ? (
        <div className="page-card workspace-surface workspace-empty">Загрузка...</div>
      ) : coreError ? (
        <div className="page-card workspace-surface inline-notice inline-notice--warning">{coreError}</div>
      ) : item ? (
        <div className={styles.workspace}>
          <ObjectSummaryCard item={item} />

          <nav className={styles.navigation} aria-label="Разделы объекта">
            <a href="#overview">Обзор</a>
            {item.capabilities.canViewOperationalSections ? <a href="#today">Сегодня</a> : null}
            <a href="#team">Команда</a>
            {item.capabilities.canViewOperationalSections ? <>
              <a href="#tasks">Задачи</a>
              <a href="#inventory">Склад</a>
              <a href="#equipment">Оборудование</a>
              <a href="#files">Файлы</a>
              <a href="#history">История</a>
            </> : null}
          </nav>

          <WorkspaceSection id="overview" title="Обзор" description="Основные данные, управление объектом и связанные операционные контексты.">
            {item.capabilities.canViewOperationalSections ? (
              <div className="page-card workspace-surface">
                <div className="section-header" style={{ paddingBottom: 0 }}>
                  <div>
                    <div className="section-title">Рабочий чат объектов</div>
                    <div className="section-subtitle">Полный мессенджер живет отдельно от комментариев объекта.</div>
                  </div>
                  <Link href="/chats?room=objects">Открыть чат</Link>
                </div>
              </div>
            ) : null}

            {canManageObjectStatus ? (
              <ObjectStatusControlPanel
                currentStatus={item.status}
                approvalsHref={`/approvals?sourceEntityType=object&sourceEntityId=${objectId}`}
                onChangeStatus={async (status) => { await changeObjectStatus(objectId, { status }); }}
              />
            ) : null}

            {(canManageResponsibles || canManageManagers) ? (
              <div className={styles.twoColumn}>
                {teamUsersLoading ? <ObjectPanelLoading title="Ответственные и менеджеры объекта" /> : teamUsersError ? (
                  <ObjectPanelError title="Ответственные и менеджеры объекта" message={teamUsersError} />
                ) : <>
                  {canManageResponsibles ? (
                    <ObjectTeamPanel
                      title="Ответственные объекта"
                      currentItems={item.responsibles}
                      availableUsers={responsibleCandidates}
                      emptyCurrentText="Ответственные пока не назначены."
                      emptyAvailableText="Подходящие пользователи не найдены."
                      addButtonText="Добавить ответственного"
                      removeButtonText="Снять"
                      onAdd={async (userId) => { await addResponsibleToObject(objectId, userId); await loadCore(objectId); }}
                      onRemove={async (userId) => { await removeResponsibleFromObject(objectId, userId); await loadCore(objectId); }}
                    />
                  ) : null}
                  {canManageManagers ? (
                    <ObjectTeamPanel
                      title="Менеджеры объекта"
                      currentItems={item.managers}
                      availableUsers={managerCandidates}
                      emptyCurrentText="Менеджеры пока не назначены."
                      emptyAvailableText="Подходящие пользователи не найдены."
                      addButtonText="Добавить менеджера"
                      removeButtonText="Снять"
                      onAdd={async (userId) => { await addManagerToObject(objectId, userId); await loadCore(objectId); }}
                      onRemove={async (userId) => { await removeManagerFromObject(objectId, userId); await loadCore(objectId); }}
                    />
                  ) : null}
                </>}
              </div>
            ) : null}

            {item.capabilities.canViewOperationalSections ? (
              linkedOrdersLoading ? <ObjectPanelLoading title="Связанные разовые заказы" /> : linkedOrdersError ? (
                <ObjectPanelError title="Связанные разовые заказы" message={linkedOrdersError} />
              ) : <LinkedOneTimeOrdersPanel items={linkedOrders} />
            ) : null}
          </WorkspaceSection>

          {item.capabilities.canViewOperationalSections ? (
            <WorkspaceSection id="today" title="Сегодня" description="Ежедневная операционная работа по объекту в одном месте.">
              <div className={styles.todayGrid}>
                {arrivalLoading ? <ObjectPanelLoading title="Фото прибытия сегодня" /> : arrivalError ? (
                  <ObjectPanelError title="Фото прибытия сегодня" message={arrivalError} />
                ) : (
                  <ObjectArrivalPanel item={arrival} onSave={async (payload) => {
                    const saved = await upsertTodayArrivalPhoto(objectId, {
                      photoUrl: payload.photoUrl,
                      photoType: payload.photoType ?? 'other',
                      comment: payload.comment,
                    });
                    await Promise.all(payload.files.map((file) => uploadFileToEntity({ entityType: 'object_arrival_photo', entityId: saved.id, file })));
                    await Promise.all([loadArrival(objectId), loadFeed(objectId)]);
                  }} />
                )}

                {reportLoading ? <ObjectPanelLoading title="Ежедневный отчет" /> : reportError ? (
                  <ObjectPanelError title="Ежедневный отчет" message={reportError} />
                ) : (
                  <ObjectDailyReportPanel item={report} onSave={async (payload) => {
                    const saved = await upsertTodayDailyReport(objectId, { content: payload.content });
                    await Promise.all(payload.files.map((file) => uploadFileToEntity({ entityType: 'object_daily_report', entityId: saved.id, file })));
                    await Promise.all([loadReport(objectId), loadFeed(objectId)]);
                  }} />
                )}

                {attendanceLoading ? <ObjectPanelLoading title="Кто был сегодня на объекте" /> : attendanceError ? (
                  <ObjectPanelError title="Кто был сегодня на объекте" message={attendanceError} />
                ) : (
                  <ObjectAttendancePanel
                    employees={attendanceEmployees}
                    initialEmployeeIds={attendanceEmployeeIds}
                    initialEmployeeFacts={attendanceEmployeeFacts}
                    operationDate={todayAsBusinessDate()}
                    onSave={async (payload) => {
                      await upsertObjectAttendance(objectId, payload);
                      await Promise.all([loadAttendance(objectId), loadAssignedEmployees(objectId), loadDirectory(objectId, employeeSearch)]);
                    }}
                  />
                )}
              </div>

              {commentsLoading ? <ObjectPanelLoading title="Оперативный комментарий" /> : commentsError ? (
                <ObjectPanelError title="Оперативный комментарий" message={commentsError} />
              ) : (
                <ObjectCommentsPanel items={comments} onCreate={async (payload) => {
                  const created = await createObjectComment(objectId, { content: payload.content, commentType: payload.commentType });
                  await Promise.all(payload.files.map((file) => uploadFileToEntity({ entityType: 'object_comment', entityId: created.id, file })));
                  await Promise.all([loadComments(objectId), loadFeed(objectId)]);
                }} />
              )}
            </WorkspaceSection>
          ) : null}

          <WorkspaceSection id="team" title="Команда" description="Текущий состав сотрудников, назначения и правила ставок.">
            {assignedEmployeesLoading ? <ObjectPanelLoading title="Состав сотрудников объекта" /> : assignedEmployeesError ? (
              <ObjectPanelError title="Состав сотрудников объекта" message={assignedEmployeesError} />
            ) : (
              <ObjectStaffingPanel
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
                canManageRatePolicy={item.capabilities.canEditDailyRate}
                onUpdateRatePolicy={async (employeeId, payload) => {
                  await updateObjectEmployeeRatePolicy(objectId, employeeId, payload);
                  await Promise.all([loadAssignedEmployees(objectId), loadAttendance(objectId)]);
                }}
              />
            )}
          </WorkspaceSection>

          {item.capabilities.canViewOperationalSections ? <>
            <WorkspaceSection id="tasks" title="Задачи" description="Все задачи, связанные с этим объектом.">
              {tasksLoading ? <ObjectPanelLoading title="Задачи объекта" /> : tasksError ? (
                <ObjectPanelError title="Задачи объекта" message={tasksError} />
              ) : <TaskListTable items={tasks} />}
            </WorkspaceSection>

            <WorkspaceSection id="inventory" title="Склад" description="Расходники объекта и разрешенные операции выдачи.">
              {objectInventoryLoading ? <ObjectPanelLoading title="Расходники объекта" /> : objectInventoryError ? (
                <ObjectPanelError title="Расходники объекта" message={objectInventoryError} />
              ) : objectInventory ? (
                <ObjectInventoryPanel
                  movements={objectInventory.movements}
                  availableItems={objectInventory.availableItems}
                  canIssueInventoryToObject={objectInventory.capabilities.canIssueInventoryToObject}
                  onIssue={async (payload) => {
                    const created = await createObjectInventoryIssue(objectId, {
                      inventoryItemId: payload.inventoryItemId,
                      quantity: payload.quantity,
                      comment: payload.comment,
                    });
                    await Promise.all(payload.evidenceFiles.map((file) => uploadFileToEntity({ entityType: 'inventory_movement', entityId: created.id, file })));
                    await loadObjectInventory(objectId);
                  }}
                />
              ) : null}
            </WorkspaceSection>

            <WorkspaceSection id="equipment" title="Оборудование" description="Оборудование, закрепленное за объектом.">
              {objectEquipmentLoading ? <ObjectPanelLoading title="Оборудование объекта" /> : objectEquipmentError ? (
                <ObjectPanelError title="Оборудование объекта" message={objectEquipmentError} />
              ) : objectEquipment ? <EquipmentScopePanel title="Оборудование объекта" units={objectEquipment.units} /> : null}
            </WorkspaceSection>

            <WorkspaceSection id="files" title="Файлы" description="Документы и вложения объекта.">
              {objectFilesLoading ? <ObjectPanelLoading title="Файлы объекта" /> : objectFilesError ? (
                <ObjectPanelError title="Файлы объекта" message={objectFilesError} />
              ) : (
                <EntityFilesPanel
                  title="Файлы объекта"
                  files={objectFiles}
                  canUpload={item.capabilities.canEdit}
                  onUpload={async (file) => {
                    await uploadFileToEntity({ entityType: 'object', entityId: objectId, file });
                    await loadObjectFiles(objectId);
                  }}
                  emptyText="Файлы объекта пока не загружены."
                />
              )}
            </WorkspaceSection>

            <WorkspaceSection id="history" title="История" description="Операционная лента и полная история изменений объекта.">
              <div className="page-card workspace-surface">
                <div className="section-header" style={{ paddingBottom: 0 }}>
                  <div>
                    <div className="section-title">Полная история изменений</div>
                    <div className="section-subtitle">Аудит изменений объекта доступен отдельным представлением.</div>
                  </div>
                  <Link href={`/objects/${objectId}/history`}>Открыть историю</Link>
                </div>
              </div>
              {feedLoading ? <ObjectPanelLoading title="Лента объекта" /> : feedError ? (
                <ObjectPanelError title="Лента объекта" message={feedError} />
              ) : <ObjectFeedList items={feed} />}
            </WorkspaceSection>
          </> : null}
        </div>
      ) : (
        <div className="page-card workspace-surface workspace-empty">Объект не найден.</div>
      )}
    </div>
  );
}
