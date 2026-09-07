'use client';

import Link from 'next/link';
import React, { useEffect, useState } from 'react';

import {
  getObjectById,
  listObjectAuditLogs,
} from '@/entities/object/api/object-client';
import type {
  ObjectAuditLogItem,
  ServiceObject,
} from '@/entities/object/model/object.types';
import { ObjectHistoryList } from '@/features/object-history/ui/object-history-list';
import styles from '@/features/object-shared-ui/object-surfaces.module.css';
import { PageTitle } from '@/shared/ui/page-title/page-title';

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() ? error.message : fallback;
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
      if (cancelled) return;

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
        if (!cancelled) setLoadError(getErrorMessage(error, 'Не удалось загрузить историю объекта.'));
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    void load();
    return () => { cancelled = true; };
  }, [params]);

  return (
    <div className={`workspace-page ${styles.page}`}>
      <PageTitle title={item ? `История: ${item.name}` : 'История объекта'} />

      <div className={styles.backRow}>
        <Link className={styles.backLink} href={objectId ? `/objects/${objectId}` : '/objects'}>
          ← Вернуться в карточку объекта
        </Link>
      </div>

      {isLoading ? (
        <div className={styles.notice}>Загрузка истории...</div>
      ) : loadError ? (
        <div className={styles.error}>{loadError}</div>
      ) : (
        <ObjectHistoryList items={auditItems} />
      )}
    </div>
  );
}
