'use client';

import Link from 'next/link';
import React, { useEffect, useState } from 'react';

import { listEquipmentUnits } from '@/entities/equipment/api/equipment-client';
import type { EquipmentUnit } from '@/entities/equipment/model/equipment.types';
import { EquipmentListTable } from '@/features/equipment-list/ui/equipment-list-table';
import { useAuth } from '@/shared/auth/use-auth';
import { PageTitle } from '@/shared/ui/page-title/page-title';

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() ? error.message : fallback;
}

export default function EquipmentPage(): React.JSX.Element {
  const { user } = useAuth();
  const canAccessEquipment = user?.capabilities?.canAccessEquipment ?? false;
  const canManageEquipmentCatalog =
    user?.capabilities?.canManageEquipmentCatalog ?? false;
  const [items, setItems] = useState<EquipmentUnit[]>([]);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!canAccessEquipment) {
      setItems([]);
      setError(null);
      setIsLoading(false);
      return;
    }

    let cancelled = false;

    const load = async (): Promise<void> => {
      setIsLoading(true);
      setError(null);

      try {
        const response = await listEquipmentUnits({
          ...(search.trim() ? { search: search.trim() } : {}),
          ...(status ? { status } : {}),
        });

        if (!cancelled) {
          setItems(response);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(getErrorMessage(loadError, 'Не удалось загрузить оборудование.'));
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
  }, [canAccessEquipment, search, status]);

  return (
    <>
      <PageTitle title="Оборудование" />

      {!canAccessEquipment ? (
        <div className="page-card">У вас нет доступа к equipment-модулю.</div>
      ) : (
        <div style={{ display: 'grid', gap: 16 }}>
          <div className="page-card" style={{ display: 'grid', gap: 12 }}>
            <div
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
                  placeholder="Название, инвентарный или серийный номер"
                />
              </label>
              <label>
                <div style={{ marginBottom: 6 }}>Статус</div>
                <select
                  value={status}
                  onChange={(event) => setStatus(event.target.value)}
                  style={{ width: '100%', padding: 10 }}
                >
                  <option value="">Все статусы</option>
                  <option value="in_storage">На складе</option>
                  <option value="assigned_to_object">На объекте</option>
                  <option value="assigned_to_one_time_order">На заказе</option>
                  <option value="under_repair">В ремонте</option>
                  <option value="broken">Неисправно</option>
                  <option value="lost">Утеряно</option>
                  <option value="written_off">Списано</option>
                </select>
              </label>
            </div>

            {canManageEquipmentCatalog ? (
              <div>
                <Link href="/equipment/new">
                  <button type="button">Добавить оборудование</button>
                </Link>
              </div>
            ) : null}
          </div>

          {isLoading ? (
            <div className="page-card">Загрузка...</div>
          ) : error ? (
            <div className="page-card" style={{ color: '#b91c1c' }}>
              {error}
            </div>
          ) : (
            <EquipmentListTable items={items} />
          )}
        </div>
      )}
    </>
  );
}
