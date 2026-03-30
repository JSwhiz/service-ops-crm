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
import { PageTitle } from '@/shared/ui/page-title/page-title';

export default function ObjectDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): React.JSX.Element {
  const [item, setItem] = useState<ServiceObject | null>(null);
  const [arrival, setArrival] = useState<ObjectArrivalPhoto | null>(null);
  const [report, setReport] = useState<ObjectDailyReport | null>(null);
  const [comments, setComments] = useState<ObjectComment[]>([]);
  const [feed, setFeed] = useState<ObjectFeedItem[]>([]);
  const [objectId, setObjectId] = useState<string>('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadAll = async (resolvedId: string): Promise<void> => {
    const [objectResponse, arrivalResponse, reportResponse, commentsResponse, feedResponse] =
      await Promise.all([
        getObjectById(resolvedId),
        getTodayArrivalPhoto(resolvedId),
        getTodayDailyReport(resolvedId),
        listObjectComments(resolvedId),
        getObjectFeed(resolvedId),
      ]);

    setItem(objectResponse);
    setArrival(arrivalResponse);
    setReport(reportResponse);
    setComments(commentsResponse);
    setFeed(feedResponse);
  };

  useEffect(() => {
    const resolveAndLoad = async (): Promise<void> => {
      setIsLoading(true);
      setError(null);

      try {
        const resolved = await params;
        setObjectId(resolved.id);
        await loadAll(resolved.id);
      } catch {
        setError('Не удалось загрузить карточку объекта.');
      } finally {
        setIsLoading(false);
      }
    };

    void resolveAndLoad();
  }, [params]);

  const refreshOperations = async (): Promise<void> => {
    if (!objectId) {
      return;
    }

    const [arrivalResponse, reportResponse, commentsResponse, feedResponse] =
      await Promise.all([
        getTodayArrivalPhoto(objectId),
        getTodayDailyReport(objectId),
        listObjectComments(objectId),
        getObjectFeed(objectId),
      ]);

    setArrival(arrivalResponse);
    setReport(reportResponse);
    setComments(commentsResponse);
    setFeed(feedResponse);
  };

  return (
    <>
      <PageTitle title={item ? item.name : 'Карточка объекта'} />

      {isLoading ? (
        <div className="page-card">Загрузка...</div>
      ) : error ? (
        <div className="page-card" style={{ color: '#b91c1c' }}>
          {error}
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
            <ObjectArrivalPanel
              item={arrival}
              onSave={async (payload) => {
                await upsertTodayArrivalPhoto(objectId, payload);
                await refreshOperations();
              }}
            />

            <ObjectDailyReportPanel
              item={report}
              onSave={async (payload) => {
                await upsertTodayDailyReport(objectId, payload);
                await refreshOperations();
              }}
            />
          </div>

          <div
            style={{
              display: 'grid',
              gap: 16,
              gridTemplateColumns: 'minmax(0, 1.2fr) minmax(0, 0.8fr)',
            }}
          >
            <ObjectCommentsPanel
              items={comments}
              onCreate={async (payload) => {
                await createObjectComment(objectId, payload);
                await refreshOperations();
              }}
            />

            <ObjectFeedList items={feed} />
          </div>
        </div>
      ) : (
        <div className="page-card">Объект не найден.</div>
      )}
    </>
  );
}
