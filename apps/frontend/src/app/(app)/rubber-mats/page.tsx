'use client';

import Link from 'next/link';
import React, { useCallback, useEffect, useState } from 'react';

import {
  listRubberMatsRegistry,
  registerRubberMat,
  type RegisterRubberMatPayload,
  type RubberMatCondition,
  type RubberMatRegistryItem,
} from '@/entities/rubber-mat/api/rubber-mat-client';
import { listObjects } from '@/entities/object/api/object-client';
import type { ServiceObject } from '@/entities/object/model/object.types';
import { Button, Field } from '@/shared/ui/foundation';
import { DataTable } from '@/shared/ui/data-table/data-table';
import { PageTitle } from '@/shared/ui/page-title/page-title';
import { TablePagination } from '@/shared/ui/table-pagination/table-pagination';
import { SearchableSelect, type SearchableSelectOption } from '@/shared/ui/searchable-select/searchable-select';
import { useAuth } from '@/shared/auth/use-auth';

import styles from './rubber-mats.module.css';

const PAGE_SIZE = 20;
const CONDITIONS: Array<{ value: RubberMatCondition | ''; label: string }> = [
  { value: '', label: 'Все состояния' },
  { value: 'good', label: 'В хорошем состоянии' },
  { value: 'worn', label: 'Изношен' },
  { value: 'damaged', label: 'Повреждён' },
  { value: 'retired', label: 'Списан' },
];
const CONDITION_LABEL: Record<RubberMatCondition, string> = {
  good: 'Хорошее состояние', worn: 'Изношен', damaged: 'Повреждён', retired: 'Списан',
};

function objectOption(item: ServiceObject): SearchableSelectOption {
  return { value: item.id, label: item.name, description: item.address || item.internalName || undefined, searchText: `${item.internalName ?? ''} ${item.address}` };
}

function formatSize(item: RubberMatRegistryItem): string {
  const thickness = item.thicknessMm ? ` × ${item.thicknessMm} мм` : '';
  return `${item.lengthCm} × ${item.widthCm} см${thickness}`;
}

export default function RubberMatsPage(): React.JSX.Element {
  const { user } = useAuth();
  const canRegisterRubberMat = (user?.roleCodes ?? [user?.roleCode ?? '']).some((role) =>
    ['founder', 'deputy_founder', 'director', 'corporate_director', 'deputy_director'].includes(role),
  );
  const [query, setQuery] = useState('');
  const [condition, setCondition] = useState<RubberMatCondition | ''>('');
  const [objectId, setObjectId] = useState('');
  const [items, setItems] = useState<RubberMatRegistryItem[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [form, setForm] = useState({ lengthCm: '', widthCm: '', thicknessMm: '', inventoryCode: '', notes: '', note: '' });

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const result = await listRubberMatsRegistry({ q: query, condition, objectId, page, limit: PAGE_SIZE });
      setItems(result.items);
      setTotal(result.total);
      setTotalPages(result.totalPages);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось загрузить реестр ковров.');
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [condition, objectId, page, query]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, query ? 250 : 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const searchObjects = useCallback(async (value: string): Promise<SearchableSelectOption[]> => {
    if (value.trim().length < 2) return [];
    const found = await listObjects({ search: value.trim() });
    return found.slice(0, 30).map(objectOption);
  }, []);

  const submitCreate = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (!form.lengthCm || !form.widthCm || form.note.trim().length < 2) return;
    setSaving(true);
    setCreateError(null);
    const payload: RegisterRubberMatPayload = {
      lengthCm: Number(form.lengthCm), widthCm: Number(form.widthCm),
      ...(form.thicknessMm ? { thicknessMm: Number(form.thicknessMm) } : {}),
      ...(form.inventoryCode.trim() ? { inventoryCode: form.inventoryCode.trim() } : {}),
      ...(form.notes.trim() ? { notes: form.notes.trim() } : {}),
      note: form.note.trim(),
    };
    try {
      await registerRubberMat(payload);
      setForm({ lengthCm: '', widthCm: '', thicknessMm: '', inventoryCode: '', notes: '', note: '' });
      setCreateOpen(false);
      setPage(1);
      await load();
    } catch (caught) {
      setCreateError(caught instanceof Error ? caught.message : 'Не удалось зарегистрировать ковёр.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={styles.page}>
      <div className={styles.heading}>
        <PageTitle title="Ковры" />
        {canRegisterRubberMat ? (
          <Button variant="primary" onClick={() => { setCreateOpen((value) => !value); setCreateError(null); }}>
            {createOpen ? 'Скрыть форму' : 'Добавить ковёр'}
          </Button>
        ) : null}
      </div>

      <p className={styles.intro}>Общий реестр активов: сначала зарегистрируйте ковёр, затем назначьте его на объект из карточки объекта. Возврат в свободный реестр, перемещение, обслуживание и списание сохраняются в истории актива.</p>

      {createOpen && canRegisterRubberMat ? (
        <form className={styles.createForm} onSubmit={(event) => void submitCreate(event)}>
          <h2>Новый ковёр</h2>
          <div className={styles.formGrid}>
            <Field label="Длина, см" required><input type="number" min="1" max="5000" step="0.01" value={form.lengthCm} onChange={(event) => setForm((current) => ({ ...current, lengthCm: event.target.value }))} /></Field>
            <Field label="Ширина, см" required><input type="number" min="1" max="5000" step="0.01" value={form.widthCm} onChange={(event) => setForm((current) => ({ ...current, widthCm: event.target.value }))} /></Field>
            <Field label="Толщина, мм"><input type="number" min="0.1" max="500" step="0.01" value={form.thicknessMm} onChange={(event) => setForm((current) => ({ ...current, thicknessMm: event.target.value }))} /></Field>
            <Field label="Инвентарный номер"><input value={form.inventoryCode} maxLength={80} onChange={(event) => setForm((current) => ({ ...current, inventoryCode: event.target.value }))} /></Field>
            <Field label="Примечание"><input value={form.notes} maxLength={2000} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} /></Field>
            <Field label="Основание регистрации" required><input value={form.note} maxLength={500} onChange={(event) => setForm((current) => ({ ...current, note: event.target.value }))} placeholder="Например, первичная инвентаризация" /></Field>
          </div>
          {createError ? <p className={styles.error} role="alert">{createError}</p> : null}
          <div className={styles.formActions}><Button type="submit" variant="primary" disabled={saving}>{saving ? 'Сохраняем…' : 'Зарегистрировать'}</Button><Button type="button" onClick={() => setCreateOpen(false)}>Отмена</Button></div>
        </form>
      ) : null}

      <section className={styles.filters} aria-label="Фильтры ковров">
        <Field label="Поиск по коврам">
          <input type="search" value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder="Номер, зона, размер или примечание" />
        </Field>
        <Field label="Объект">
          <SearchableSelect label="Фильтр по объекту" value={objectId} options={[]} asyncSearch={searchObjects} minimumSearchLength={2} searchPlaceholder="Название, адрес или внутреннее имя" searchPromptText="Введите не менее 2 символов" placeholder="Все объекты" onChange={(value) => { setObjectId(value); setPage(1); }} />
        </Field>
        <Field label="Состояние">
          <select value={condition} onChange={(event) => { setCondition(event.target.value as RubberMatCondition | ''); setPage(1); }}>
            {CONDITIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
        </Field>
      </section>

      {error ? <div className={styles.error} role="alert">{error}</div> : null}
      <DataTable label="Реестр резиновых ковров" frameClassName={styles.tableFrame}>
        <thead><tr><th>Ковёр</th><th>Объект</th><th>Зона</th><th>Размер</th><th>Состояние</th><th>Обновлён</th><th aria-label="Открыть карточку" /></tr></thead>
        <tbody>
          {loading ? <tr><td colSpan={7} className={styles.empty}>Загружаем реестр…</td></tr> : items.length === 0 ? <tr><td colSpan={7} className={styles.empty}>Ковры по выбранным фильтрам не найдены.</td></tr> : items.map((item) => (
            <tr key={item.id}>
              <td><strong>{item.inventoryCode || 'Без номера'}</strong><small>{item.notes || 'Резиновый ковёр'}</small></td>
              <td>{item.object ? <><Link href={`/objects/${item.object.id}#rubber-mats`}>{item.object.name}</Link><small>{item.object.address || item.object.internalName || 'Адрес не указан'}</small></> : <span>Свободный реестр</span>}</td>
              <td>{item.zone || 'Не назначена'}</td><td>{formatSize(item)}</td>
              <td><span className={`${styles.condition} ${styles[item.condition]}`}>{CONDITION_LABEL[item.condition]}</span></td>
              <td>{new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short' }).format(new Date(item.updatedAt))}</td>
              <td>{item.object ? <Link className={styles.openLink} href={`/objects/${item.object.id}#rubber-mats`} aria-label={`Открыть ковёр ${item.inventoryCode || item.zone || ''} в карточке объекта`}>›</Link> : null}</td>
            </tr>
          ))}
        </tbody>
      </DataTable>
      <TablePagination page={page} totalPages={totalPages || 1} pending={loading} label="Страницы реестра ковров" summary={`Показано ${items.length ? (page - 1) * PAGE_SIZE + 1 : 0}–${Math.min(page * PAGE_SIZE, total)} из ${total}`} onPageChange={setPage} />
    </div>
  );
}
