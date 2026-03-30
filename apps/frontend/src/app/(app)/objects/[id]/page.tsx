'use client';

import React, { useEffect, useState } from 'react';

import { getObjectById } from '@/entities/object/api/object-client';
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
import { ObjectArrivalPanel } from '@/features/object-arrival/ui/object-arrival-panel';
import { ObjectSummaryCard } from '@/features/object-card/ui/object-summary-card';
import { ObjectCommentsPanel } from '@/features/object-comments/ui/object-comments-panel';
import { ObjectFeedList } from '@/features/object-feed/ui/object-feed-list';
import { ObjectDailyReportPanel } from '@/features/object-report/ui/object-daily-report-panel';
import {
  ObjectPanelError,
  ObjectPanelLoading,
} from '@/features/object-state/ui/object-state-panels';
import { PageTitle } from '@/shared/ui/page-title/page-title';

export default function ObjectDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): React.JSX.Element {
  const [objectId, setObjectId] = useState<string>('');

  const [item, setItem] = useState<ServiceObject | null>(null);
  const [coreLoading, setCoreLoading] = useState(true);
  const [coreError, setCoreError] = useState<string | null>(null);

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

  useEffect(() => {
    const resolveAndLoad = async (): Promise<void> => {
      const resolved = await params;
      setObjectId(resolved.id);

      setCoreLoading(true);
      setCoreError(null);

      try {
        const objectResponse = await getObjectById(resolved.id);
        setItem(objectResponse);
      } catch {
        setCoreError('Не удалось загрузить карточку объекта.');
      } finally {
        setCoreLoading(false);
      }

      void loadOperations(resolved.id);
    };

    void resolveAndLoad();
  }, [params]);

  const loadOperations = async (resolvedId: string): Promise<void> => {
    setArrivalLoading(true);
    setArrivalError(null);
    try {
      const arrivalResponse = await getTodayArrivalPhoto(resolvedId);
      setArrival(arrivalResponse);
    } catch {
      setArrivalError('Не удалось загрузить фото прибытия.');
    } finally {
      setArrivalLoading(false);
    }

    setReportLoading(true);
    setReportError(null);
    try {
      const reportResponse = await getTodayDailyReport(resolvedId);
      setReport(reportResponse);
    } catch {
      setReportError('Не удалось загрузить отчет дня.');
    } finally {
      setReportLoading(false);
    }

    setCommentsLoading(true);
    setCommentsError(null);
    try {
      const commentsResponse = await listObjectComments(resolvedId);
      setComments(commentsResponse);
    } catch {
      setCommentsError('Не удалось загрузить комментарии объекта.');
    } finally {
      setCommentsLoading(false);
    }

    setFeedLoading(true);
    setFeedError(null);
    try {
      const feedResponse = await getObjectFeed(resolvedId);
      setFeed(feedResponse);
    } catch {
      setFeedError('Не удалось загрузить ленту объекта.');
    } finally {
      setFeedLoading(false);
    }
  };

  const refreshOperations = async (): Promise<void> => {
    if (!objectId) {
      return;
    }

    await loadOperations(objectId);
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
                  await upsertTodayArrivalPhoto(objectId, payload);
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
          </div>

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
                  await createObjectComment(objectId, payload);
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
