'use client';

import React, { useEffect, useState } from 'react';

import {
  getObjectById,
  listObjectEmployees,
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
import { ObjectArrivalPanel } from '@/features/object-arrival/ui/object-arrival-panel';
import { ObjectAttendancePanel } from '@/features/object-attendance/ui/object-attendance-panel';
import { ObjectSummaryCard } from '@/features/object-card/ui/object-summary-card';
import { ObjectCommentsPanel } from '@/features/object-comments/ui/object-comments-panel';
import { ObjectFeedList } from '@/features/object-feed/ui/object-feed-list';
import { ObjectDailyReportPanel } from '@/features/object-report/ui/object-daily-report-panel';
import {
  ObjectPanelError,
  ObjectPanelLoading,
} from '@/features/object-state/ui/object-state-panels';
import { TaskListTable } from '@/features/task-list/ui/task-list-table';
import { PageTitle } from '@/shared/ui/page-title/page-title';

function getErrorMessage(
  error: unknown,
  fallback: string,
): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  return fallback;
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

      setCoreLoading(true);
      setCoreError(null);

      try {
        const objectResponse = await getObjectById(resolved.id);
        if (!isCancelled) {
          setItem(objectResponse);
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

      if (!isCancelled) {
        await Promise.all([
          loadEmployees(resolved.id, isCancelled),
          loadOperations(resolved.id, isCancelled),
        ]);
      }
    };

    void resolveAndLoad();

    return () => {
      isCancelled = true;
    };
  }, [params]);

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
          const arrivalResponse = await getTodayArrivalPhoto(resolvedId);
          if (!isCancelled) {
            setArrival(arrivalResponse);
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
          const reportResponse = await getTodayDailyReport(resolvedId);
          if (!isCancelled) {
            setReport(reportResponse);
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
          const commentsResponse = await listObjectComments(resolvedId);
          if (!isCancelled) {
            setComments(commentsResponse);
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
          const feedResponse = await getObjectFeed(resolvedId);
          if (!isCancelled) {
            setFeed(feedResponse);
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
          const tasksResponse = await listTasksByObject(resolvedId);
          if (!isCancelled) {
            setTasks(tasksResponse);
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

  const refreshOperations = async (): Promise<void> => {
    if (!objectId) {
      return;
    }

    await Promise.all([loadEmployees(objectId), loadOperations(objectId)]);
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
                  await upsertTodayArrivalPhoto(objectId, {
                    photoUrl: payload.photoUrl,
                    photoType: payload.photoType ?? 'arrival',
                    comment: payload.comment,
                  });
                  await refreshOperations();
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
                  await upsertTodayDailyReport(objectId, payload);
                  await refreshOperations();
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
                  await refreshOperations();
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
                  await createObjectComment(objectId, {
                    content: payload.content,
                    commentType: payload.commentType,
                  });
                  await refreshOperations();
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
