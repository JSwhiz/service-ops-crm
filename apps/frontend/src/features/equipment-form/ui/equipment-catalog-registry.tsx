'use client';

import React, { useEffect, useState } from 'react';
import { deleteEquipmentCatalogItem, listEquipmentCatalog } from '@/entities/equipment/api/equipment-client';
import type { EquipmentCatalogItem } from '@/entities/equipment/model/equipment.types';
import { useAuth } from '@/shared/auth/use-auth';
import { CreateNavigationLink } from '@/shared/create-navigation';
import { Alert, ButtonLink } from '@/shared/ui/foundation';
import { EquipmentCatalogManager } from './equipment-form';

export function EquipmentCatalogRegistry(): React.JSX.Element {
  const { user } = useAuth();
  const [catalog, setCatalog] = useState<EquipmentCatalogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const canManage = user?.capabilities?.canManageEquipmentCatalog ?? false;
  useEffect(() => {
    if (!canManage) { setLoading(false); return; }
    let active = true;
    void listEquipmentCatalog().then((items) => { if (active) setCatalog(items); })
      .catch((caught: unknown) => { if (active) setError(caught instanceof Error ? caught.message : 'Не удалось загрузить каталог.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [canManage, revision]);
  useEffect(() => {
    const reload = (): void => setRevision((value) => value + 1);
    window.addEventListener('equipment-catalog-created', reload);
    return () => window.removeEventListener('equipment-catalog-created', reload);
  }, []);
  if (!canManage) return <Alert>У вас нет доступа к управлению каталогом оборудования.</Alert>;
  return <div className="ui-stack ui-stack--md">
    <div className="ui-inline"><ButtonLink href="/equipment">Единицы оборудования</ButtonLink><CreateNavigationLink className="ui-button ui-button--primary" href="/equipment/new?kind=type">Создать тип</CreateNavigationLink></div>
    {loading ? <p role="status">Загрузка каталога…</p> : null}
    {error ? <Alert tone="danger" role="alert">{error}</Alert> : null}
    <EquipmentCatalogManager catalog={catalog} canDelete={user?.capabilities?.canDeleteEquipmentUnit ?? false} onDelete={async (id) => {
      await deleteEquipmentCatalogItem(id);
      setCatalog((current) => current.filter((item) => item.id !== id));
    }} />
  </div>;
}
