'use client';

import React, { useEffect, useMemo, useState } from 'react';

import {
  assignObjectManager,
  assignObjectResponsible,
  getObjectById,
  listObjectEmployees,
  removeObjectManager,
  removeObjectResponsible,
  type ObjectEmployeeOption,
  upsertObjectAttendance,
} from '@/entities/object/api/object-client';
import {
  createObjectComment,
  getObjectFeed,
  getTodayArrivalPhoto,
  getTodayDailyReport,
  listObjectComments,
  upsertTodayArrivalPhoto,
  upsertTodayDailyReport,
} from '@/entities/object/api/object-operations-client';
import type { ServiceObject } from '@/entities/object/model/object.types';
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
import { ObjectManagersPanel } from '@/features/object-managers/ui/object-managers-panel';
import { ObjectDailyReportPanel } from '@/features/object-report/ui/object-daily-report-panel';
import {
  ObjectPanelError,
  ObjectPanelLoading,
} from '@/features/object-state/ui/object-state-panels';
import { TaskListTable } from '@/features/task-list/ui/task-list-table';
import { PageTitle } from '@/shared/ui/page-title/page-title';

const LEADERSHIP_ROLE_CODES = [
  'founder',
  'deputy_founder',
  'director',
  'deputy_director',
  'corporate_director',
] as const;

const MANAGER_ROLE_CODES = [
  'founder',
  'deputy_founder',
  'director',
  'deputy_director',
  'corporate_director',
  'manager',
  'senior_manager',
  'operation_manager',
] as const;

function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  return fallback;
}

function hasAnyRole(user: SystemUserOption, allowed: readonly string[]): boolean {
  const roleCodes = user.roleCodes?.length ? user.roleCodes : [user.roleCode];

  return roleCodes.some((roleCode) =>
    allowed.includes(roleCode as (typeof allowed)[number]),
  );
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

  const [users, setUsers] = useState<SystemUserOption[]>([]);
  const [usersLoading, setUsersLoading] = useState(true);
  const [usersError, setUsersError] = useState<string | null>(null);

  const [employees, setEmployees] = useState<ObjectEmployeeOption[]>([]);
  const [employeesLoading, setEmployeesLoading] = useState(true);
  const [employeesError, setEmployeesError] = useState<string | null>(null);

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

  useEffect(() => {
    let isCancelled = false;

    const resolveAndLoad = async (): Promise<void> => {
      const resolved = await params;

      if (isCancelled) {
        return;
      }

      setObjectId(resolved.id);

      await Promise.all([
        loadCore(resolved.id, isCancelled),
        loadUsers(isCancelled),
        loadEmployees(resolved.id, isCancelled),
        loadOperations(resolved.id, isCancelled),
      ]);
    };

    void resolveAndLoad();

    return () => {
      isCancelled = true;
    };
  }, [params]);

  const loadCore = async (
    resolvedId: string,
    isCancelled = false,
  ): Promise<void> => {
    setCoreLoading(true);
    setCoreError(null);

    try {
      const response = await getObjectById(resolvedId);
      if (!isCancelled) {
        setItem(response);
      }
    } catch (error: unknown) {
      if (!isCancelled) {
        setCoreError(
          getErrorMessage(error, 'Не удалось загрузить карточку объекта.'),
        );
      }
    } finally {
      if (!isCancelled) {
        setCoreLoading(false);
      }
    }
  };

  const loadUsers = async (isCancelled = false): Promise<void> => {
    setUsersLoading(true);
    setUsersError(null);

    try {
      const response = await listSystemUsers();
      if (!isCancelled) {
        setUsers(response);
      }
    } catch (error: unknown) {
      if (!isCancelled) {
        setUsersError(
          getErrorMessage(
            error,
            'Не удалось загрузить пользователей системы.',
          ),
        );
      }
    } finally {
      if (!isCancelled) {
        setUsersLoading(false);
      }
    }
  };

  const loadEmployees = async (
    resolvedId: string,
    isCancelled = false,
  ): Promise<void> => {
    setEmployeesLoading(true);
    setEmployeesError(null);

    try {
      const response = await listObjectEmployees(resolvedId);
      if (!isCancelled) {
        setEmployees(response);
      }
    } catch (error: unknown) {
      if (!isCancelled) {
        setEmployeesError(
          getErrorMessage(error, 'Не удалось загрузить сотрудников объекта.'),
        );
      }
    } finally {
      if (!isCancelled) {
        setEmployeesLoading(false);
      }
    }
  };

  const loadOperations = async (
    resolvedId: string,
    isCancelled = false,
  ): Promise<void> => {
    setArrivalLoading(true);
    setArrivalError(null);

    setReportLoading(true);
    setReportError(null);

    setCommentsLoading(true);
    setCommentsError(null);

    setFeedLoading(true);
    setFeedError(null);

    setTasksLoading(true);
    setTasksError(null);

    await Promise.all([
      (async () => {
        try {
          const response = await getTodayArrivalPhoto(resolvedId);
          if (!isCancelled) {
            setArrival(response);
          }
        } catch (error: unknown) {
          if (!isCancelled) {
            setArrivalError(
              getErrorMessage(error, 'Не удалось загрузить фото прибытия.'),
            );
          }
        } finally {
          if (!isCancelled) {
            setArrivalLoading(false);
          }
        }
      })(),
      (async () => {
        try {
          const response = await getTodayDailyReport(resolvedId);
          if (!isCancelled) {
            setReport(response);
          }
        } catch (error: unknown) {
          if (!isCancelled) {
            setReportError(
              getErrorMessage(error, 'Не удалось загрузить отчет дня.'),
            );
          }
        } finally {
          if (!isCancelled) {
            setReportLoading(false);
          }
        }
      })(),
      (async () => {
        try {
          const response = await listObjectComments(resolvedId);
          if (!isCancelled) {
            setComments(response);
          }
        } catch (error: unknown) {
          if (!isCancelled) {
            setCommentsError(
              getErrorMessage(error, 'Не удалось загрузить комментарии объекта.'),
            );
          }
        } finally {
          if (!isCancelled) {
            setCommentsLoading(false);
          }
        }
      })(),
      (async () => {
        try {
          const response = await getObjectFeed(resolvedId);
          if (!isCancelled) {
            setFeed(response);
          }
        } catch (error: unknown) {
          if (!isCancelled) {
            setFeedError(
              getErrorMessage(error, 'Не удалось загрузить ленту объекта.'),
            );
          }
        } finally {
          if (!isCancelled) {
            setFeedLoading(false);
          }
        }
      })(),
      (async () => {
        try {
          const response = await listTasksByObject(resolvedId);
          if (!isCancelled) {
            setTasks(response);
          }
        } catch (error: unknown) {
          if (!isCancelled) {
            setTasksError(
              getErrorMessage(error, 'Не удалось загрузить задачи объекта.'),
            );
          }
        } finally {
          if (!isCancelled) {
            setTasksLoading(false);
          }
        }
      })(),
    ]);
  };

  const refreshCore = async (): Promise<void> => {
    if (!objectId) {
      return;
    }

    await loadCore(objectId);
  };

  const responsibleCandidates = useMemo(() => {
    return users.filter((user) => hasAnyRole(user, LEADERSHIP_ROLE_CODES));
  }, [users]);

  const managerCandidates = useMemo(() => {
    return users.filter((user) => hasAnyRole(user, MANAGER_ROLE_CODES));
  }, [users]);

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

          {usersLoading ? (
            <ObjectPanelLoading title="Управление составом объекта" />
          ) : usersError ? (
            <ObjectPanelError
              title="Управление составом объекта"
              message={usersError}
            />
          ) : (
            <ObjectManagersPanel
              responsibles={item.responsibles}
              managers={item.managers}
              responsibleCandidates={responsibleCandidates}
              managerCandidates={managerCandidates}
              onAddResponsible={async (userId) => {
                const updated = await assignObjectResponsible(objectId, { userId });
                setItem(updated);
              }}
              onRemoveResponsible={async (userId) => {
                const updated = await removeObjectResponsible(objectId, userId);
                setItem(updated);
              }}
              onAddManager={async (userId) => {
                const updated = await assignObjectManager(objectId, { userId });
                setItem(updated);
              }}
              onRemoveManager={async (userId) => {
                const updated = await removeObjectManager(objectId, userId);
                setItem(updated);
              }}
            />
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
                  const updated = await upsertTodayArrivalPhoto(objectId, {
                    photoUrl: payload.photoUrl,
                    photoType: payload.photoType ?? 'arrival',
                    comment: payload.comment,
                  });
                  setArrival(updated);
                  await loadOperations(objectId);
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
                  const updated = await upsertTodayDailyReport(objectId, payload);
                  setReport(updated);
                  await loadOperations(objectId);
                }}
              />
            )}

            {employeesLoading ? (
              <ObjectPanelLoading title="Кто был сегодня на объекте" />
            ) : employeesError ? (
              <ObjectPanelError
                title="Кто был сегодня на объекте"
                message={employeesError}
              />
            ) : (
              <ObjectAttendancePanel
                employees={employees}
                onSave={async (payload) => {
                  await upsertObjectAttendance(objectId, payload);
                  await loadEmployees(objectId);
                }}
              />
            )}
          </div>

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
                  await loadOperations(objectId);
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
