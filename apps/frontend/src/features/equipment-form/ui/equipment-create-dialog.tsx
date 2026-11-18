'use client';

import { useRouter } from 'next/navigation';
import React, { useEffect, useRef, useState } from 'react';
import { createEquipmentCatalogItem, createEquipmentUnit, listEquipmentCatalog } from '@/entities/equipment/api/equipment-client';
import type { EquipmentCatalogItem } from '@/entities/equipment/model/equipment.types';
import { useAuth } from '@/shared/auth/use-auth';
import { getAccessSessionGeneration } from '@/shared/auth/access-generation';
import { isSavedWithoutAccess } from '@/shared/api/saved-without-access';
import { useCreateDraft } from '@/shared/drafts';
import { useCreateNavigation } from '@/shared/create-navigation';
import { Alert, Button, Field } from '@/shared/ui/foundation';
import { FormDialog, useConfirm } from '@/shared/ui/overlays';
import { SearchableSelect } from '@/shared/ui/searchable-select/searchable-select';
import { equipmentTypePayload, equipmentUnitPayload, type EquipmentTypeValues, type EquipmentUnitValues } from '../model/equipment-create-payload';
import styles from './equipment-form.module.css';

const EMPTY_TYPE: EquipmentTypeValues = { category: '', name: '', brand: '', model: '', notes: '' };
const EMPTY_UNIT: EquipmentUnitValues = { catalogItemId: '', inventoryNumber: '', serialNumber: '', notes: '' };
interface EquipmentDraft {
  unit: EquipmentUnitValues;
  type: EquipmentTypeValues;
  typePanel: boolean;
  addedTypes: EquipmentCatalogItem[];
}

export function EquipmentCreateDialog(): React.JSX.Element {
  const router = useRouter();
  const navigation = useCreateNavigation();
  const { user } = useAuth();
  const params = navigation.getTargetSearchParams();
  const standaloneType = params.get('kind') === 'type';
  const draft = useCreateDraft<EquipmentDraft>('equipment-create', { unit: EMPTY_UNIT, type: EMPTY_TYPE, typePanel: standaloneType, addedTypes: [] });
  const [catalog, setCatalog] = useState<{ items: EquipmentCatalogItem[]; identity: string | null }>({ items: [], identity: null });
  const [loading, setLoading] = useState(true);
  const [localPending, setPending] = useState(false);
  const pending = localPending || draft.submitting;
  const [completed, setCompleted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lock = useRef(false);
  const [confirmDiscard, confirmDialog] = useConfirm();
  const canCreateUnit = user?.capabilities?.canCreateEquipmentUnit ?? false;
  const canCreateType = user?.capabilities?.canManageEquipmentCatalog ?? false;
  const canReadCatalog = user?.capabilities?.canReadEquipmentCatalog ?? false;
  const typePanel = draft.value.typePanel;
  const canSubmit = typePanel ? canCreateType : canCreateUnit;
  const catalogIdentity = `${user?.id ?? ''}:${user?.accessVersion ?? ''}`;
  const catalogCurrent = catalog.identity === catalogIdentity;
  // Only fresh readable catalog data may label or authorize a retained draft target.
  const allTypes = canReadCatalog && canCreateUnit && catalogCurrent ? catalog.items.filter((item) => item.isActive) : [];
  const fallbackParams = new URLSearchParams(params);
  fallbackParams.delete('kind');
  if (standaloneType) fallbackParams.set('view', 'types');
  const fallbackQuery = fallbackParams.toString();
  const closeContext = navigation.closeContext('/equipment' + (fallbackQuery ? '?' + fallbackQuery : ''));

  useEffect(() => {
    if (typePanel || !canCreateUnit || !canReadCatalog) { setCatalog({ items: [], identity: null }); setLoading(false); return; }
    let active = true;
    setLoading(true);
    setCatalog({ items: [], identity: null });
    void listEquipmentCatalog().then((items) => {
      if (!active) return;
      setCatalog({ items, identity: catalogIdentity });
    }).catch((caught: unknown) => { if (active) { setCatalog({ items: [], identity: catalogIdentity }); setError(caught instanceof Error ? caught.message : 'Не удалось загрузить каталог.'); } })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [canCreateUnit, canReadCatalog, typePanel, catalogIdentity]);

  const selectedId = draft.value.unit.catalogItemId;
  const selectionExists = allTypes.some((item) => item.id === selectedId);
  const unitSelectionBlocked = loading || !catalogCurrent || !canReadCatalog || !selectionExists;
  const expectedDirty = !completed && (Object.values(draft.value.type).some(Boolean) || (!standaloneType && Boolean(draft.value.unit.inventoryNumber || draft.value.unit.serialNumber || draft.value.unit.notes || selectedId)));
  useEffect(() => {
    if (draft.dirty !== expectedDirty) draft.setDirty(expectedDirty);
  }, [draft.dirty, expectedDirty]);


  const updateType = (key: keyof EquipmentTypeValues, value: string): void => draft.setValue((current) => ({ ...current, type: { ...current.type, [key]: value } }));
  const updateUnit = (key: keyof EquipmentUnitValues, value: string): void => draft.setValue((current) => ({ ...current, unit: { ...current.unit, [key]: value } }));
  const backToUnit = async (): Promise<void> => {
    if (pending) return;
    if (Object.values(draft.value.type).some(Boolean) && !await confirmDiscard({ title: 'Закрыть создание типа?', consequence: 'Введённые поля нового типа будут удалены. Данные единицы оборудования сохранятся.', confirmLabel: 'Вернуться к единице', tone: 'danger' })) return;
    draft.setValue((current) => ({ ...current, typePanel: false, type: EMPTY_TYPE }));
    draft.setDirty(Boolean(draft.value.unit.inventoryNumber || draft.value.unit.serialNumber || draft.value.unit.notes || draft.value.unit.catalogItemId));
    setError(null);
  };
  const submit = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (lock.current || pending || !canSubmit || completed || (!typePanel && unitSelectionBlocked)) return;
    lock.current = true; setPending(true); setError(null);
    if (typePanel) {
      let created: EquipmentCatalogItem;
      try { created = await draft.submit(() => createEquipmentCatalogItem(equipmentTypePayload(draft.value.type))); }
      catch (caught) { setError(caught instanceof Error ? caught.message : 'Не удалось создать тип.'); lock.current = false; setPending(false); return; }
      window.dispatchEvent(new Event('equipment-catalog-created'));
      if (!standaloneType) {
        draft.setValue((current) => ({ ...current, addedTypes: [created, ...current.addedTypes], type: EMPTY_TYPE, typePanel: false, unit: { ...current.unit, catalogItemId: created.id } }));
        lock.current = false; setPending(false); return;
      }
      setCompleted(true); draft.clear(); setPending(false);
      router.replace(closeContext.kind === 'intercepted' ? closeContext.returnTo : closeContext.fallbackHref);
      return;
    }
    const session = getAccessSessionGeneration();
    try {
      const created = await draft.submit(() => createEquipmentUnit(equipmentUnitPayload(draft.value.unit)));
      if (getAccessSessionGeneration() !== session) return;
      setCompleted(true); draft.clear(); setPending(false);
      // A successful response still acknowledges the committed unit when rights
      // changed. Its obsolete details must not be rendered or used to navigate.
      if (!isSavedWithoutAccess(created)) router.push('/equipment/' + created.id);
    } catch (caught) {
      if (getAccessSessionGeneration() !== session) return;
      setError(caught instanceof Error ? caught.message : 'Не удалось создать единицу.'); lock.current = false; setPending(false);
    }
  };

  return <FormDialog open title={completed && !typePanel ? 'Единица оборудования создана' : typePanel ? 'Новый тип оборудования' : 'Новая единица оборудования'} size={typePanel ? 'compact' : 'regular'} busy={pending} dirty={draft.dirty} closeContext={closeContext} clearDraft={draft.clear}
    footer={({ requestClose }) => <div className="ui-inline">
      <Button disabled={pending} onClick={() => { if (typePanel && !standaloneType) void backToUnit(); else void requestClose(); }}>{completed ? 'Закрыть' : typePanel && !standaloneType ? 'Назад к единице' : 'Отмена'}</Button>
      {canSubmit && !completed ? <Button variant="primary" type="submit" form="equipment-create-form" pending={pending} disabled={completed || (!typePanel && unitSelectionBlocked)}>{completed ? 'Создано' : typePanel ? 'Создать тип' : 'Создать единицу'}</Button> : null}
    </div>}>
    {confirmDialog}
    {completed ? <Alert tone="success" role="status">{standaloneType ? 'Тип оборудования создан.' : 'Единица оборудования создана.'}</Alert> : !canSubmit ? <Alert tone="danger">{typePanel ? 'У вас нет права создавать типы оборудования.' : 'У вас нет права создавать единицы оборудования.'}</Alert> : <form id="equipment-create-form" className={`ui-stack ui-stack--md ${styles.form}`} onSubmit={(event) => void submit(event)}>
      <fieldset className={styles.body} disabled={pending || completed}>
      <p className="ui-text-muted">* — обязательные поля</p>
      {!typePanel && loading ? <p role="status">Загрузка каталога…</p> : null}
      {typePanel ? <>
        <div className={styles.grid}>
          <Field label="Категория" required><input required value={draft.value.type.category} onChange={(event) => updateType('category', event.target.value)} disabled={pending} placeholder="Например, пылесос" /></Field>
          <Field label="Название" required><input required value={draft.value.type.name} onChange={(event) => updateType('name', event.target.value)} disabled={pending} placeholder="Как называть тип в списках" /></Field>
          <Field label="Бренд"><input value={draft.value.type.brand} onChange={(event) => updateType('brand', event.target.value)} disabled={pending} /></Field>
          <Field label="Модель"><input value={draft.value.type.model} onChange={(event) => updateType('model', event.target.value)} disabled={pending} /></Field>
        </div>
        <Field label="Заметки"><textarea rows={3} value={draft.value.type.notes} onChange={(event) => updateType('notes', event.target.value)} disabled={pending} /></Field>
      </> : <>
        {!canReadCatalog ? <Alert>У вас нет права просматривать каталог типов оборудования.</Alert> : null}
        <SearchableSelect label="Тип оборудования *" value={selectionExists ? selectedId : ''} placeholder="Выберите тип оборудования" options={allTypes.map((item) => ({ value: item.id, label: item.category + ' · ' + item.name }))} clearable={false} required disabled={pending || loading || !catalogCurrent || !canReadCatalog} onChange={(id) => updateUnit('catalogItemId', id)} />
        {canReadCatalog && catalogCurrent && !loading && selectedId && !selectionExists ? <Alert tone="warning" role="status">Выбранный тип оборудования сейчас недоступен. Выбор и остальные поля сохранены. Дождитесь восстановления доступа или явно выберите другой тип, чтобы создать единицу.</Alert> : null}
        {canCreateType ? <Button variant="ghost" disabled={pending} onClick={() => { const wasDirty = draft.dirty; draft.setValue((current) => ({ ...current, typePanel: true })); draft.setDirty(wasDirty); setError(null); }}>Добавить тип</Button> : null}
        <Field label="Инвентарный номер" required><input required value={draft.value.unit.inventoryNumber} onChange={(event) => updateUnit('inventoryNumber', event.target.value)} disabled={pending} placeholder="Инвентарный номер" /></Field>
        <Field label="Серийный номер"><input value={draft.value.unit.serialNumber} onChange={(event) => updateUnit('serialNumber', event.target.value)} disabled={pending} placeholder="Серийный номер" /></Field>
        <Field label="Заметки"><textarea rows={3} value={draft.value.unit.notes} onChange={(event) => updateUnit('notes', event.target.value)} disabled={pending} placeholder="Заметки" /></Field>
      </>}
      {error ? <Alert tone="danger" role="alert">{error}</Alert> : null}
      </fieldset>
    </form>}
  </FormDialog>;
}
