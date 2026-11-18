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
  const canCreateType = user?.capabilities?.canManageEquipmentCatalog ?? false;
  const canReadCatalog = user?.capabilities?.canReadEquipmentCatalog ?? false;
  const canDeleteCatalog = user?.capabilities?.canDeleteEquipmentCatalog ?? false;
  useEffect(() => {
    if (!canReadCatalog) { setCatalog([]); setLoading(false); setError(null); return; }
    let active = true;
    setLoading(true); setError(null); setCatalog([]);
    void listEquipmentCatalog().then((items) => { if (active) setCatalog(items); })
      .catch((caught: unknown) => { if (active) setError(caught instanceof Error ? caught.message : 'Не удалось загрузить каталог.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [canReadCatalog, user?.id, user?.accessVersion, revision]);
  useEffect(() => {
    const reload = (): void => setRevision((value) => value + 1);
    window.addEventListener('equipment-catalog-created', reload);
    return () => window.removeEventListener('equipment-catalog-created', reload);
  }, []);
  if (!user) return <Alert>Войдите в систему для просмотра каталога оборудования.</Alert>;
  return <div className="ui-stack ui-stack--md">
    <div className="ui-inline"><ButtonLink href="/equipment">Единицы оборудования</ButtonLink>{canCreateType ? <CreateNavigationLink className="ui-button ui-button--primary" href="/equipment/new?kind=type">Создать тип</CreateNavigationLink> : null}</div>
    {!canReadCatalog ? <Alert>У вас нет права просматривать каталог типов оборудования.</Alert> : null}
    {canReadCatalog && loading ? <p role="status">Загрузка каталога…</p> : null}
    {canReadCatalog && error ? <Alert tone="danger" role="alert">{error}</Alert> : null}
    {canReadCatalog && !loading && !error ? <EquipmentCatalogManager catalog={catalog} canDelete={canDeleteCatalog} onDelete={async (id) => {
      if (!canDeleteCatalog) throw new Error('У вас нет права удалять типы оборудования.');
      await deleteEquipmentCatalogItem(id);
      setCatalog((current) => current.filter((item) => item.id !== id));
    }} /> : null}
  </div>;
}
