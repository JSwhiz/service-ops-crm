'use client';

import { useRouter } from 'next/navigation';
import React, { useEffect, useState } from 'react';

import {
  createEquipmentCatalogItem,
  createEquipmentUnit,
  listEquipmentCatalog,
} from '@/entities/equipment/api/equipment-client';
import type { EquipmentCatalogItem } from '@/entities/equipment/model/equipment.types';
import {
  EquipmentCatalogItemForm,
  EquipmentUnitForm,
} from '@/features/equipment-form/ui/equipment-form';
import { useAuth } from '@/shared/auth/use-auth';
import { PageTitle } from '@/shared/ui/page-title/page-title';

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() ? error.message : fallback;
}

export default function EquipmentNewPage(): React.JSX.Element {
  const { user } = useAuth();
  const router = useRouter();
  const canManageEquipmentCatalog =
    user?.capabilities?.canManageEquipmentCatalog ?? false;
  const [catalog, setCatalog] = useState<EquipmentCatalogItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!canManageEquipmentCatalog) {
      setCatalog([]);
      setIsLoading(false);
      return;
    }

    let cancelled = false;

    const load = async (): Promise<void> => {
      setIsLoading(true);
      setError(null);

      try {
        const response = await listEquipmentCatalog();

        if (!cancelled) {
          setCatalog(response);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(getErrorMessage(loadError, 'Не удалось загрузить каталог.'));
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
  }, [canManageEquipmentCatalog]);

  return (
    <>
      <PageTitle title="Новое оборудование" />

      {!canManageEquipmentCatalog ? (
        <div className="page-card">
          У вас нет доступа к управлению каталогом оборудования.
        </div>
      ) : isLoading ? (
        <div className="page-card">Загрузка...</div>
      ) : error ? (
        <div className="page-card" style={{ color: '#b91c1c' }}>
          {error}
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 16 }}>
          <EquipmentCatalogItemForm
            onSubmit={async (payload) => {
              const created = await createEquipmentCatalogItem(payload);
              setCatalog((current) => [created, ...current]);
            }}
          />
          <EquipmentUnitForm
            catalog={catalog}
            onSubmit={async (payload) => {
              const created = await createEquipmentUnit(payload);
              router.push(`/equipment/${created.id}`);
            }}
          />
        </div>
      )}
    </>
  );
}
