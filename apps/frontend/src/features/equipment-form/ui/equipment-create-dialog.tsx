'use client';

import { useRouter } from 'next/navigation';
import React, { useEffect, useRef, useState } from 'react';
import { createEquipmentCatalogItem, createEquipmentUnit, listEquipmentCatalog } from '@/entities/equipment/api/equipment-client';
import type { EquipmentCatalogItem } from '@/entities/equipment/model/equipment.types';
import { useAuth } from '@/shared/auth/use-auth';
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
  const [catalog, setCatalog] = useState<EquipmentCatalogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [localPending, setPending] = useState(false);
  const pending = localPending || draft.submitting;
  const [completed, setCompleted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lock = useRef(false);
  const [confirmDiscard, confirmDialog] = useConfirm();
  const canManage = user?.capabilities?.canManageEquipmentCatalog ?? false;
  const typePanel = draft.value.typePanel;
  const allTypes = [...draft.value.addedTypes, ...catalog.filter((item) => !draft.value.addedTypes.some((added) => added.id === item.id))].filter((item) => item.isActive);
  const fallbackParams = new URLSearchParams(params);
  fallbackParams.delete('kind');
  if (standaloneType) fallbackParams.set('view', 'types');
  const fallbackQuery = fallbackParams.toString();
  const closeContext = navigation.closeContext('/equipment' + (fallbackQuery ? '?' + fallbackQuery : ''));

  useEffect(() => {
    if (!canManage) { setLoading(false); return; }
    let active = true;
    void listEquipmentCatalog().then((items) => {
      if (!active) return;
      setCatalog(items);
    }).catch((caught: unknown) => { if (active) setError(caught instanceof Error ? caught.message : 'Не удалось загрузить каталог.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [canManage]);

  const selectedId = draft.value.unit.catalogItemId;
  const firstId = allTypes[0]?.id ?? '';
  const selectionExists = allTypes.some((item) => item.id === selectedId);
  const expectedDirty = !completed && (Object.values(draft.value.type).some(Boolean) || (!standaloneType && Boolean(draft.value.unit.inventoryNumber || draft.value.unit.serialNumber || draft.value.unit.notes || (selectedId && selectedId !== firstId))));
  useEffect(() => {
    if (draft.dirty !== expectedDirty) draft.setDirty(expectedDirty);
  }, [draft.dirty, expectedDirty]);
  useEffect(() => {
    if (loading || selectionExists || selectedId === firstId) return;
    const wasDirty = draft.dirty;
    draft.setValue((current) => ({ ...current, unit: { ...current.unit, catalogItemId: firstId } }));
    draft.setDirty(wasDirty);
  }, [firstId, loading, selectedId, selectionExists]);

  const updateType = (key: keyof EquipmentTypeValues, value: string): void => draft.setValue((current) => ({ ...current, type: { ...current.type, [key]: value } }));
  const updateUnit = (key: keyof EquipmentUnitValues, value: string): void => draft.setValue((current) => ({ ...current, unit: { ...current.unit, [key]: value } }));
  const backToUnit = async (): Promise<void> => {
    if (pending) return;
    if (Object.values(draft.value.type).some(Boolean) && !await confirmDiscard({ title: 'Закрыть создание типа?', consequence: 'Введённые поля нового типа будут удалены. Данные единицы оборудования сохранятся.', confirmLabel: 'Вернуться к единице', tone: 'danger' })) return;
    draft.setValue((current) => ({ ...current, typePanel: false, type: EMPTY_TYPE }));
    draft.setDirty(Boolean(draft.value.unit.inventoryNumber || draft.value.unit.serialNumber || draft.value.unit.notes || draft.value.unit.catalogItemId !== firstId));
    setError(null);
  };
  const submit = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (lock.current || pending || !canManage || completed || loading || (!typePanel && !allTypes.length)) return;
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
    let id: string;
    try { id = (await draft.submit(() => createEquipmentUnit(equipmentUnitPayload(draft.value.unit)))).id; }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Не удалось создать единицу.'); lock.current = false; setPending(false); return; }
    setCompleted(true); draft.clear(); setPending(false);
    router.push('/equipment/' + id);
  };

  return <FormDialog open title={typePanel ? 'Новый тип оборудования' : 'Новая единица оборудования'} size={typePanel ? 'compact' : 'regular'} busy={pending} dirty={draft.dirty} closeContext={closeContext} clearDraft={draft.clear}
    footer={({ requestClose }) => <div className="ui-inline">
      <Button disabled={pending} onClick={() => { if (typePanel && !standaloneType) void backToUnit(); else void requestClose(); }}>{typePanel && !standaloneType ? 'Назад к единице' : 'Отмена'}</Button>
      {canManage ? <Button variant="primary" type="submit" form="equipment-create-form" pending={pending} disabled={completed || loading || (!typePanel && !allTypes.length)}>{completed ? 'Создано' : typePanel ? 'Создать тип' : 'Создать единицу'}</Button> : null}
    </div>}>
    {confirmDialog}
    {!canManage ? <Alert tone="danger">У вас нет доступа к управлению каталогом оборудования.</Alert> : <form id="equipment-create-form" className={`ui-stack ui-stack--md ${styles.form}`} onSubmit={(event) => void submit(event)}>
      <fieldset className={styles.body} disabled={pending || completed}>
      <p className="ui-text-muted">* — обязательные поля</p>
      {loading ? <p role="status">Загрузка каталога…</p> : null}
      {typePanel ? <>
        <div className={styles.grid}>
          <Field label="Категория" required><input required value={draft.value.type.category} onChange={(event) => updateType('category', event.target.value)} disabled={pending} placeholder="Например, пылесос" /></Field>
          <Field label="Название" required><input required value={draft.value.type.name} onChange={(event) => updateType('name', event.target.value)} disabled={pending} placeholder="Как называть тип в списках" /></Field>
          <Field label="Бренд"><input value={draft.value.type.brand} onChange={(event) => updateType('brand', event.target.value)} disabled={pending} /></Field>
          <Field label="Модель"><input value={draft.value.type.model} onChange={(event) => updateType('model', event.target.value)} disabled={pending} /></Field>
        </div>
        <Field label="Заметки"><textarea rows={3} value={draft.value.type.notes} onChange={(event) => updateType('notes', event.target.value)} disabled={pending} /></Field>
      </> : <>
        <SearchableSelect label="Тип оборудования *" value={selectedId} options={allTypes.map((item) => ({ value: item.id, label: item.category + ' · ' + item.name }))} clearable={false} required disabled={pending || loading} onChange={(id) => updateUnit('catalogItemId', id)} />
        <Button variant="ghost" disabled={pending} onClick={() => { const wasDirty = draft.dirty; draft.setValue((current) => ({ ...current, typePanel: true })); draft.setDirty(wasDirty); setError(null); }}>Добавить тип</Button>
        <Field label="Инвентарный номер" required><input required value={draft.value.unit.inventoryNumber} onChange={(event) => updateUnit('inventoryNumber', event.target.value)} disabled={pending} placeholder="Инвентарный номер" /></Field>
        <Field label="Серийный номер"><input value={draft.value.unit.serialNumber} onChange={(event) => updateUnit('serialNumber', event.target.value)} disabled={pending} placeholder="Серийный номер" /></Field>
        <Field label="Заметки"><textarea rows={3} value={draft.value.unit.notes} onChange={(event) => updateUnit('notes', event.target.value)} disabled={pending} placeholder="Заметки" /></Field>
      </>}
      {error ? <Alert tone="danger" role="alert">{error}</Alert> : null}
      {completed ? <Alert tone="success" role="status">{standaloneType ? 'Тип оборудования создан.' : 'Единица оборудования создана.'}</Alert> : null}
      </fieldset>
    </form>}
  </FormDialog>;
}
