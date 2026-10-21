'use client';

import React, { useEffect, useState } from 'react';

import { createEquipmentMovement, listEquipmentUnits } from '@/entities/equipment/api/equipment-client';
import type { EquipmentUnit } from '@/entities/equipment/model/equipment.types';
import { uploadFileToEntity } from '@/entities/file/api/file-client';
import { EquipmentListTable } from '@/features/equipment-list/ui/equipment-list-table';
import { useAuth } from '@/shared/auth/use-auth';
import { RegistryToolbar } from '@/shared/ui/registry-filters/registry-toolbar';
import { Alert, ButtonLink } from '@/shared/ui/foundation';
import { PlusIcon } from '@/shared/ui/icons/icons';

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

  const statusOptions = [
    { value: 'in_storage', label: 'На складе' },
    { value: 'assigned_to_object', label: 'На объекте' },
    { value: 'assigned_to_one_time_order', label: 'На заказе' },
    { value: 'under_repair', label: 'В ремонте' },
    { value: 'broken', label: 'Неисправно' },
    { value: 'lost', label: 'Утеряно' },
    { value: 'written_off', label: 'Списано' },
  ];

  return (
    <>
      {!canAccessEquipment ? (
        <div className="page-card">У вас нет доступа к equipment-модулю.</div>
      ) : (
        <div className="page-stack workspace-page equipment-workspace">
          <RegistryToolbar
            searchValue={search}
            searchLabel="Поиск по оборудованию"
            searchPlaceholder="Название, инвентарный или серийный номер"
            onSearchChange={setSearch}
            activeFilters={status ? [{
              id: 'status', label: 'Статус', value: status, options: statusOptions,
              onChange: setStatus, onRemove: () => setStatus(''),
            }] : []}
            availableFilters={status ? [] : [{ id: 'status', label: 'Статус', options: statusOptions, onAdd: setStatus }]}
            actions={canManageEquipmentCatalog ? <ButtonLink variant="primary" icon={<PlusIcon />} href="/equipment/new">Добавить оборудование</ButtonLink> : null}
          />

          {isLoading ? (
            <div className="page-card">Загрузка...</div>
          ) : error ? (
            <Alert tone="danger" role="alert">
              {error}
            </Alert>
          ) : (
            <EquipmentListTable
              items={items}
              onWriteoffUnit={(unitId, comment) => createEquipmentMovement(unitId, { movementType: 'writeoff', comment })}
              onAttachEvidence={async (movementId, files) => {
                for (const file of files) {
                  await uploadFileToEntity({ entityType: 'equipment_movement', entityId: movementId, file });
                }
              }}
              onRefresh={async () => {
                const updated = await listEquipmentUnits({
                  ...(search.trim() ? { search: search.trim() } : {}),
                  ...(status ? { status } : {}),
                });
                setItems(updated);
              }}
            />
          )}
        </div>
      )}
    </>
  );
}
