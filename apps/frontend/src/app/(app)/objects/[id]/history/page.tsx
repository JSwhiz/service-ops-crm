'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';

import {
  getObjectById,
  listObjectAuditLogs,
} from '@/entities/object/api/object-client';
import type {
  ObjectAuditLogItem,
  ServiceObject,
} from '@/entities/object/model/object.types';
import { ObjectHistoryList } from '@/features/object-history/ui/object-history-list';
import { PageTitle } from '@/shared/ui/page-title/page-title';

function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  return fallback;
}

export default function ObjectHistoryPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): React.JSX.Element {
  const [objectId, setObjectId] = useState('');
  const [item, setItem] = useState<ServiceObject | null>(null);
  const [auditItems, setAuditItems] = useState<ObjectAuditLogItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const load = async (): Promise<void> => {
      const resolved = await params;

      if (cancelled) {
        return;
      }

      setObjectId(resolved.id);
      setIsLoading(true);
      setLoadError(null);

      try {
        const [objectResponse, auditResponse] = await Promise.all([
          getObjectById(resolved.id),
          listObjectAuditLogs(resolved.id),
        ]);

        if (!cancelled) {
          setItem(objectResponse);
          setAuditItems(auditResponse);
        }
      } catch (error) {
        if (!cancelled) {
          setLoadError(
            getErrorMessage(error, 'Не удалось загрузить историю объекта.'),
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

  return (
    <>
      <PageTitle title={item ? `История: ${item.name}` : 'История объекта'} />

      <div style={{ marginBottom: 16 }}>
        <Link href={objectId ? `/objects/${objectId}` : '/objects'}>← Вернуться в карточку объекта</Link>
      </div>

      {isLoading ? (
        <div className="page-card">Загрузка...</div>
      ) : loadError ? (
        <div className="page-card" style={{ color: '#b91c1c' }}>
          {loadError}
        </div>
      ) : (
        <ObjectHistoryList items={auditItems} />
      )}
    </>
  );
}
