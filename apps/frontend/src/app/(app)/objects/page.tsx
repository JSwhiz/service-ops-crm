'use client';

import React, { useEffect, useState } from 'react';

import { listObjects } from '@/entities/object/api/object-client';
import type { ServiceObject } from '@/entities/object/model/object.types';
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
          status: status || undefined,
        });
        setItems(response);
      } catch {
        setError('Не удалось загрузить список объектов.');
      } finally {
        setIsLoading(false);
      }
    };

    void load();
  }, [search, status]);

  return (
    <>
      <PageTitle title="Объекты" />

      <div
        className="page-card"
        style={{
          display: 'grid',
          gap: 12,
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
        }}
      >
        <label>
          <div style={{ marginBottom: 6 }}>Поиск</div>
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            style={{ width: '100%', padding: 10 }}
            placeholder="Название, адрес, внутреннее имя"
          />
        </label>

        <label>
          <div style={{ marginBottom: 6 }}>Статус</div>
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value)}
            style={{ width: '100%', padding: 10 }}
          >
            <option value="">Все</option>
            <option value="active">Активный</option>
            <option value="frozen">Заморожен</option>
            <option value="archived">Архив</option>
          </select>
        </label>
      </div>

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
