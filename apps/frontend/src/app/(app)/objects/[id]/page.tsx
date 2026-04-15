'use client';

import React, { useEffect, useState } from 'react';

import {
  addManagerToObject,
  addResponsibleToObject,
  changeObjectStatus,
  getObjectById,
  removeManagerFromObject,
  removeResponsibleFromObject,
} from '@/entities/object/api/object-client';
import {
  type ObjectEmployeeOption,
  type ServiceObject,
} from '@/entities/object/model/object.types';
import {
  addEmployeeToObject,
  createObjectComment,
  getObjectFeed,
  getTodayArrivalPhoto,
  getTodayDailyReport,
  getTodayObjectAttendance,
  listObjectComments,
  listObjectEmployees,
  removeEmployeeFromObject,
  searchEmployeeDirectory,
  upsertObjectAttendance,
  upsertTodayArrivalPhoto,
  upsertTodayDailyReport,
} from '@/entities/object/api/object-operations-client';
import type {
  ObjectArrivalPhoto,
  ObjectComment,
  ObjectDailyReport,
  ObjectFeedItem,
} from '@/entities/object/model/object-operations.types';
import { listTasksByObject } from '@/entities/task/api/task-client';
import type { TaskItem } from '@/entities/task/model/task.types';
import {
  listSystemUsers,
  type SystemUserOption,
} from '@/entities/user/api/user-client';
import { ObjectArrivalPanel } from '@/features/object-arrival/ui/object-arrival-panel';
import { ObjectAttendancePanel } from '@/features/object-attendance/ui/object-attendance-panel';
import { ObjectSummaryCard } from '@/features/object-card/ui/object-summary-card';
import { ObjectCommentsPanel } from '@/features/object-comments/ui/object-comments-panel';
import { ObjectFeedList } from '@/features/object-feed/ui/object-feed-list';
import { ObjectDailyReportPanel } from '@/features/object-report/ui/object-daily-report-panel';
import { ObjectStaffingPanel } from '@/features/object-staffing/ui/object-staffing-panel';
import { ObjectStatusControlPanel } from '@/features/object-status-control/ui/object-status-control-panel';
import { ObjectTeamPanel } from '@/features/object-team/ui/object-team-panel';
import {
  ObjectPanelError,
  ObjectPanelLoading,
} from '@/features/object-state/ui/object-state-panels';
import { TaskListTable } from '@/features/task-list/ui/task-list-table';
import { PageTitle } from '@/shared/ui/page-title/page-title';

function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  return fallback;
}

function todayAsBusinessDate(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export default function ObjectDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): React.JSX.Element {
  const [objectId, setObjectId] = useState<string>('');

  const [item, setItem] = useState<ServiceObject | null>(null);
  const [coreLoading, setCoreLoading] = useState(true);
  const [coreError, setCoreError] = useState<string | null>(null);

  const [responsibleCandidates, setResponsibleCandidates] = useState<
    SystemUserOption[]
  >([]);
  const [managerCandidates, setManagerCandidates] = useState<SystemUserOption[]>(
    [],
  );
  const [teamUsersLoading, setTeamUsersLoading] = useState(false);
  const [teamUsersError, setTeamUsersError] = useState<string | null>(null);

  const [assignedEmployees, setAssignedEmployees] = useState<
    ObjectEmployeeOption[]
  >([]);
  const [assignedEmployeesLoading, setAssignedEmployeesLoading] =
    useState(true);
  const [assignedEmployeesError, setAssignedEmployeesError] = useState<
    string | null
  >(null);

  const [employeeSearch, setEmployeeSearch] = useState('');
  const [directoryEmployees, setDirectoryEmployees] = useState<
    ObjectEmployeeOption[]
  >([]);
  const [directoryLoading, setDirectoryLoading] = useState(true);
  const [directoryError, setDirectoryError] = useState<string | null>(null);

  const [attendanceEmployeeIds, setAttendanceEmployeeIds] = useState<string[]>(
    [],
  );
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

  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [tasksLoading, setTasksLoading] = useState(true);
  const [tasksError, setTasksError] = useState<string | null>(null);

  const canManageResponsibles = item?.capabilities.canManageResponsibles ?? false;
  const canManageManagers = item?.capabilities.canManageManagers ?? false;
  const canManageObjectStatus = item?.capabilities.canChangeStatus ?? false;

  useEffect(() => {
    let cancelled = false;

    const boot = async (): Promise<void> => {
      const resolved = await params;

      if (cancelled) {
        return;
      }

      setObjectId(resolved.id);

      await Promise.all([
        loadCore(resolved.id, cancelled),
        loadArrival(resolved.id, cancelled),
        loadReport(resolved.id, cancelled),
        loadComments(resolved.id, cancelled),
        loadFeed(resolved.id, cancelled),
        loadTasks(resolved.id, cancelled),
        loadAssignedEmployees(resolved.id, cancelled),
        loadAttendance(resolved.id, cancelled),
        loadDirectory(resolved.id, '', cancelled),
      ]);
    };

    void boot();

    return () => {
      cancelled = true;
    };
  }, [params]);

  useEffect(() => {
    if (!objectId || !item) {
      return;
    }

    if (!canManageResponsibles && !canManageManagers) {
      setResponsibleCandidates([]);
      setManagerCandidates([]);
      setTeamUsersError(null);
      setTeamUsersLoading(false);
      return;
    }

    let cancelled = false;

    const loadTeamCandidates = async (): Promise<void> => {
      setTeamUsersLoading(true);
      setTeamUsersError(null);

      try {
        const [responsibles, managers] = await Promise.all([
          canManageResponsibles
            ? listSystemUsers({
                purpose: 'object_responsible',
                objectId,
              })
            : Promise.resolve([]),
          canManageManagers
            ? listSystemUsers({
                purpose: 'object_manager',
                objectId,
              })
            : Promise.resolve([]),
        ]);

        if (!cancelled) {
          setResponsibleCandidates(responsibles);
          setManagerCandidates(managers);
        }
      } catch (error) {
        if (!cancelled) {
          setTeamUsersError(
            getErrorMessage(
              error,
              'Не удалось загрузить кандидатов для команды объекта.',
            ),
          );
        }
      } finally {
        if (!cancelled) {
          setTeamUsersLoading(false);
        }
      }
    };

    void loadTeamCandidates();

    return () => {
      cancelled = true;
    };
  }, [objectId, item, canManageResponsibles, canManageManagers]);

  useEffect(() => {
    if (!objectId) {
      return;
    }

    let cancelled = false;

    const timeout = window.setTimeout(() => {
      void loadDirectory(objectId, employeeSearch, cancelled);
    }, 250);

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [objectId, employeeSearch]);

  const loadCore = async (id: string, cancelled = false): Promise<void> => {
    setCoreLoading(true);
    setCoreError(null);

    try {
      const response = await getObjectById(id);

      if (!cancelled) {
        setItem(response);
      }
    } catch (error) {
      if (!cancelled) {
        setCoreError(
          getErrorMessage(error, 'Не удалось загрузить карточку объекта.'),
        );
      }
    } finally {
      if (!cancelled) {
        setCoreLoading(false);
      }
    }
  };

  const loadArrival = async (id: string, cancelled = false): Promise<void> => {
    setArrivalLoading(true);
    setArrivalError(null);

    try {
      const response = await getTodayArrivalPhoto(id);

      if (!cancelled) {
        setArrival(response);
      }
    } catch (error) {
      if (!cancelled) {
        setArrivalError(
          getErrorMessage(error, 'Не удалось загрузить фото прибытия.'),
        );
      }
    } finally {
      if (!cancelled) {
        setArrivalLoading(false);
      }
    }
  };

  const loadReport = async (id: string, cancelled = false): Promise<void> => {
    setReportLoading(true);
    setReportError(null);

    try {
      const response = await getTodayDailyReport(id);

      if (!cancelled) {
        setReport(response);
      }
    } catch (error) {
      if (!cancelled) {
        setReportError(
          getErrorMessage(error, 'Не удалось загрузить отчет дня.'),
        );
      }
    } finally {
      if (!cancelled) {
        setReportLoading(false);
      }
    }
  };

  const loadComments = async (
    id: string,
    cancelled = false,
  ): Promise<void> => {
    setCommentsLoading(true);
    setCommentsError(null);

    try {
      const response = await listObjectComments(id);

      if (!cancelled) {
        setComments(response);
      }
    } catch (error) {
      if (!cancelled) {
        setCommentsError(
          getErrorMessage(error, 'Не удалось загрузить комментарии объекта.'),
        );
      }
    } finally {
      if (!cancelled) {
        setCommentsLoading(false);
      }
    }
  };

  const loadFeed = async (id: string, cancelled = false): Promise<void> => {
    setFeedLoading(true);
    setFeedError(null);

    try {
      const response = await getObjectFeed(id);

      if (!cancelled) {
        setFeed(response);
      }
    } catch (error) {
      if (!cancelled) {
        setFeedError(
          getErrorMessage(error, 'Не удалось загрузить ленту объекта.'),
        );
      }
    } finally {
      if (!cancelled) {
        setFeedLoading(false);
      }
    }
  };

  const loadTasks = async (id: string, cancelled = false): Promise<void> => {
    setTasksLoading(true);
    setTasksError(null);

    try {
      const response = await listTasksByObject(id);

      if (!cancelled) {
        setTasks(response);
      }
    } catch (error) {
      if (!cancelled) {
        setTasksError(
          getErrorMessage(error, 'Не удалось загрузить задачи объекта.'),
        );
      }
    } finally {
      if (!cancelled) {
        setTasksLoading(false);
      }
    }
  };

  const loadAssignedEmployees = async (
    id: string,
    cancelled = false,
  ): Promise<void> => {
    setAssignedEmployeesLoading(true);
    setAssignedEmployeesError(null);

    try {
      const response = await listObjectEmployees(id);

      if (!cancelled) {
        setAssignedEmployees(Array.isArray(response) ? response : []);
      }
    } catch (error) {
      if (!cancelled) {
        setAssignedEmployeesError(
          getErrorMessage(
            error,
            'Не удалось загрузить текущий состав сотрудников.',
          ),
        );
      }
    } finally {
      if (!cancelled) {
        setAssignedEmployeesLoading(false);
      }
    }
  };

  const loadDirectory = async (
    id: string,
    search: string,
    cancelled = false,
  ): Promise<void> => {
    setDirectoryLoading(true);
    setDirectoryError(null);

    try {
      const response = await searchEmployeeDirectory(id, search);

      if (!cancelled) {
        setDirectoryEmployees(Array.isArray(response) ? response : []);
      }
    } catch (error) {
      if (!cancelled) {
        setDirectoryError(
          getErrorMessage(error, 'Не удалось загрузить справочник сотрудников.'),
        );
      }
    } finally {
      if (!cancelled) {
        setDirectoryLoading(false);
      }
    }
  };

  const loadAttendance = async (
    id: string,
    cancelled = false,
  ): Promise<void> => {
    setAttendanceLoading(true);
    setAttendanceError(null);

    try {
      const response = await getTodayObjectAttendance(id);

      if (!cancelled) {
        setAttendanceEmployeeIds(response.employeeIds ?? []);
      }
    } catch (error) {
      if (!cancelled) {
        setAttendanceError(
          getErrorMessage(
            error,
            'Не удалось загрузить отметку присутствия за сегодня.',
          ),
        );
      }
    } finally {
      if (!cancelled) {
        setAttendanceLoading(false);
      }
    }
  };

  return (
    <>
      <PageTitle title={item ? item.name : 'Карточка объекта'} />

      {coreLoading ? (
        <div className="page-card">Загрузка...</div>
      ) : coreError ? (
        <div className="page-card" style={{ color: '#b91c1c' }}>
          {coreError}
        </div>
      ) : item ? (
        <div style={{ display: 'grid', gap: 16 }}>
          <ObjectSummaryCard item={item} />

          {canManageObjectStatus ? (
            <ObjectStatusControlPanel
              currentStatus={item.status}
              onChangeStatus={async (status) => {
                const updated = await changeObjectStatus(objectId, { status });
                setItem(updated);
              }}
            />
          ) : null}

          {(canManageResponsibles || canManageManagers) && (
            <div
              style={{
                display: 'grid',
                gap: 16,
                gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
              }}
            >
              {teamUsersLoading ? (
                <ObjectPanelLoading title="Ответственные и менеджеры объекта" />
              ) : teamUsersError ? (
                <ObjectPanelError
                  title="Ответственные и менеджеры объекта"
                  message={teamUsersError}
                />
              ) : (
                <>
                  {canManageResponsibles ? (
                    <ObjectTeamPanel
                      title="Ответственные объекта"
                      currentItems={item.responsibles}
                      availableUsers={responsibleCandidates}
                      emptyCurrentText="Ответственные пока не назначены."
                      emptyAvailableText="Подходящие пользователи не найдены."
                      addButtonText="Добавить ответственного"
                      removeButtonText="Снять"
                      onAdd={async (userId) => {
                        await addResponsibleToObject(objectId, userId);
                        await loadCore(objectId);
                      }}
                      onRemove={async (userId) => {
                        await removeResponsibleFromObject(objectId, userId);
                        await loadCore(objectId);
                      }}
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
                      onAdd={async (userId) => {
                        await addManagerToObject(objectId, userId);
                        await loadCore(objectId);
                      }}
                      onRemove={async (userId) => {
                        await removeManagerFromObject(objectId, userId);
                        await loadCore(objectId);
                      }}
                    />
                  ) : null}
                </>
              )}
            </div>
          )}

          <div
            style={{
              display: 'grid',
              gap: 16,
              gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
            }}
          >
            {arrivalLoading ? (
              <ObjectPanelLoading title="Фото прибытия сегодня" />
            ) : arrivalError ? (
              <ObjectPanelError
                title="Фото прибытия сегодня"
                message={arrivalError}
              />
            ) : (
              <ObjectArrivalPanel
                item={arrival}
                onSave={async (payload) => {
                  const saved = await upsertTodayArrivalPhoto(objectId, {
                    photoUrl: payload.photoUrl,
                    photoType: payload.photoType ?? 'arrival',
                    comment: payload.comment,
                  });

                  setArrival(saved);
                  await loadFeed(objectId);
                }}
              />
            )}

            {reportLoading ? (
              <ObjectPanelLoading title="Ежедневный отчет" />
            ) : reportError ? (
              <ObjectPanelError
                title="Ежедневный отчет"
                message={reportError}
              />
            ) : (
              <ObjectDailyReportPanel
                item={report}
                onSave={async (payload) => {
                  const saved = await upsertTodayDailyReport(objectId, payload);
                  setReport(saved);
                  await loadFeed(objectId);
                }}
              />
            )}

            {attendanceLoading ? (
              <ObjectPanelLoading title="Кто был сегодня на объекте" />
            ) : attendanceError ? (
              <ObjectPanelError
                title="Кто был сегодня на объекте"
                message={attendanceError}
              />
            ) : (
              <ObjectAttendancePanel
                employees={assignedEmployees}
                initialEmployeeIds={attendanceEmployeeIds}
                operationDate={todayAsBusinessDate()}
                onSave={async (payload) => {
                  await upsertObjectAttendance(objectId, payload);
                  setAttendanceEmployeeIds(payload.employeeIds);
                }}
              />
            )}
          </div>

          {assignedEmployeesLoading ? (
            <ObjectPanelLoading title="Состав сотрудников объекта" />
          ) : assignedEmployeesError ? (
            <ObjectPanelError
              title="Состав сотрудников объекта"
              message={assignedEmployeesError}
            />
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
                await Promise.all([
                  loadAssignedEmployees(objectId),
                  loadDirectory(objectId, employeeSearch),
                ]);
              }}
              onRemove={async (employeeId) => {
                await removeEmployeeFromObject(objectId, employeeId);
                await Promise.all([
                  loadAssignedEmployees(objectId),
                  loadDirectory(objectId, employeeSearch),
                  loadAttendance(objectId),
                ]);
              }}
            />
          )}

          {tasksLoading ? (
            <ObjectPanelLoading title="Задачи объекта" />
          ) : tasksError ? (
            <ObjectPanelError title="Задачи объекта" message={tasksError} />
          ) : (
            <TaskListTable items={tasks} />
          )}

          <div
            style={{
              display: 'grid',
              gap: 16,
              gridTemplateColumns: 'minmax(0, 1.2fr) minmax(0, 0.8fr)',
            }}
          >
            {commentsLoading ? (
              <ObjectPanelLoading title="Комментарии объекта" />
            ) : commentsError ? (
              <ObjectPanelError
                title="Комментарии объекта"
                message={commentsError}
              />
            ) : (
              <ObjectCommentsPanel
                items={comments}
                onCreate={async (payload) => {
                  const created = await createObjectComment(objectId, {
                    content: payload.content,
                    commentType: payload.commentType,
                  });

                  setComments((prev) => [created, ...prev]);
                  await loadFeed(objectId);
                }}
              />
            )}

            {feedLoading ? (
              <ObjectPanelLoading title="Лента объекта" />
            ) : feedError ? (
              <ObjectPanelError title="Лента объекта" message={feedError} />
            ) : (
              <ObjectFeedList items={feed} />
            )}
          </div>
        </div>
      ) : (
        <div className="page-card">Объект не найден.</div>
      )}
    </>
  );
}
