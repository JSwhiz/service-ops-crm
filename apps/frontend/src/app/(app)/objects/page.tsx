'use client';

import Link from 'next/link';
import React, { useEffect, useState } from 'react';

import { listObjects } from '@/entities/object/api/object-client';
import type { ServiceObject } from '@/entities/object/model/object.types';
import { ObjectFilters } from '@/features/object-filters/ui/object-filters';
import { ObjectListTable } from '@/features/object-list/ui/object-list-table';
import { PageTitle } from '@/shared/ui/page-title/page-title';

export default function ObjectsPage(): React.JSX.Element {
  const [items, setItems] = useState<ServiceObject[]>([]);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = async (): Promise<void> => {
      setIsLoading(true);
      setError(null);

      try {
        const response = await listObjects({
          search: search || undefined,
          status: (status as 'active' | 'archived' | 'frozen') || undefined,
        });
        setItems(response);
      } catch {
        setError('Не удалось загрузить объекты.');
      } finally {
        setIsLoading(false);
      }
    };

    void load();
  }, [search, status]);

  return (
    <>
      <div
        style={{
          display: 'flex',
          gap: 12,
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          marginBottom: 16,
        }}
      >
        <PageTitle title="Объекты" />
        <Link href="/objects/new">Создать объект</Link>
      </div>

      <ObjectFilters
        search={search}
        status={status}
        onSearchChange={setSearch}
        onStatusChange={setStatus}
      />

      {isLoading ? (
        <div className="page-card">Загрузка...</div>
      ) : error ? (
        <div className="page-card" style={{ color: '#b91c1c' }}>
          {error}
        </div>
      ) : (
        <ObjectListTable items={items} />
      )}
    </>
  );
}
