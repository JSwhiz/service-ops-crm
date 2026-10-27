'use client';

import Link from 'next/link';
import React, { useEffect, useState } from 'react';
import {
  createRubberMatSize, getRubberMatAggregateRegistry, getRubberMatCatalog, getRubberMatCostHistory,
  matMoney, matSizeLabel, setRubberMatCost,
  type RubberMatAggregateRegistry, type RubberMatCostChange, type RubberMatSize,
} from '@/entities/rubber-mat/api/rubber-mat-client';
import { Alert, Button, Field } from '@/shared/ui/foundation';
import { DataTable } from '@/shared/ui/data-table/data-table';
import { TablePagination } from '@/shared/ui/table-pagination/table-pagination';
import { RegistryToolbar } from '@/shared/ui/registry-filters/registry-toolbar';
import styles from './rubber-mats.module.css';

export default function RubberMatsPage(): React.JSX.Element {
  const [catalog, setCatalog] = useState<{ items: RubberMatSize[]; canManage: boolean } | null>(null);
  const [registry, setRegistry] = useState<RubberMatAggregateRegistry | null>(null);
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({ length: '', width: '', cost: '' });
  const [costDrafts, setCostDrafts] = useState<Record<string, { value: string; version: number }>>({});
  const [history, setHistory] = useState<{ size: RubberMatSize; changes: RubberMatCostChange[] } | null>(null);

  useEffect(() => {
    let active = true;
    void getRubberMatCatalog().then((result) => { if (active) setCatalog(result); })
      .catch((caught: unknown) => { if (active) setError(caught instanceof Error ? caught.message : 'Не удалось загрузить каталог'); });
    return () => { active = false; };
  }, [revision]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    const timer = window.setTimeout(() => {
      void getRubberMatAggregateRegistry(query, page, 20).then((result) => {
        if (active) setRegistry(result);
      }).catch((caught: unknown) => { if (active) { setRegistry(null); setError(caught instanceof Error ? caught.message : 'Не удалось загрузить учёт ковров'); } })
        .finally(() => { if (active) setLoading(false); });
    }, 300);
    return () => { active = false; window.clearTimeout(timer); };
  }, [query, page, revision]);

  const run = async (action: () => Promise<unknown>): Promise<void> => {
    setBusy(true); setError(null);
    try {
      await action();
      setRevision((value) => value + 1);
      setHistory(null);
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Не удалось сохранить изменения'); }
    finally { setBusy(false); }
  };

  return <div className={styles.page}>
    <p>Количество ковров на объектах и каталог стоимости замены.</p>
    {error ? <Alert tone="danger" role="alert">{error} <Button onClick={() => { setError(null); setRevision((value) => value + 1); }}>Обновить данные</Button></Alert> : null}
    <RegistryToolbar searchValue={query} searchLabel="Поиск объектов" searchPlaceholder="Название или адрес объекта" onSearchChange={(value) => { setQuery(value); setPage(1); }} activeFilters={[]} availableFilters={[]} />
    <DataTable label="Ковры на доступных объектах" frameClassName={styles.tableFrame}>
      <thead><tr><th>Объект</th><th>Количество ковров</th><th>Стоимость замены</th></tr></thead>
      <tbody>{loading ? <tr><td colSpan={3}>Загружаем учёт…</td></tr> : !registry || registry.items.length === 0 ? <tr><td colSpan={3}>Объекты не найдены.</td></tr> : registry.items.map((row) => <tr key={row.object.id}>
        <td><Link href={'/objects/' + row.object.id + '#rubber-mats'}>{row.object.name}</Link><small>{row.object.address}</small></td>
        <td>{row.quantity}</td><td>{row.totalReplacementCost === null ? 'Не определена' : matMoney(row.totalReplacementCost)}{row.totalReplacementCost === null ? <small>Известная часть: {matMoney(row.knownReplacementCost)}</small> : null}</td>
      </tr>)}</tbody>
    </DataTable>
    <TablePagination page={page} totalPages={registry?.totalPages || 1} pending={loading} label="Страницы объектов с коврами" summary={'Объектов: ' + (registry?.total ?? 0)} onPageChange={setPage} />

    <div className="ui-inline"><h2>Каталог размеров</h2>{catalog?.canManage ? <Button onClick={() => setCreateOpen((value) => !value)}>{createOpen ? 'Закрыть форму' : 'Добавить размер'}</Button> : null}</div>
    <p>Новые размеры и цены вводятся явно. Пустая цена означает, что стоимость ещё не указана.</p>
    {createOpen && catalog?.canManage ? <form className={styles.createForm} onSubmit={(event) => {
      event.preventDefault();
      void run(async () => {
        await createRubberMatSize({ lengthCm: Number(form.length), widthCm: Number(form.width), replacementCost: form.cost.trim() || null });
        setForm({ length: '', width: '', cost: '' }); setCreateOpen(false);
      });
    }}>
      <div className={styles.formGrid}>
        <Field label="Длина, см" required><input required type="number" min="0.01" max="99999999.99" step="0.01" value={form.length} disabled={busy} onChange={(event) => setForm((old) => ({ ...old, length: event.target.value }))} /></Field>
        <Field label="Ширина, см" required><input required type="number" min="0.01" max="99999999.99" step="0.01" value={form.width} disabled={busy} onChange={(event) => setForm((old) => ({ ...old, width: event.target.value }))} /></Field>
        <Field label="Стоимость замены, ₽"><input type="number" min="0" max="999999999999.99" step="0.01" value={form.cost} disabled={busy} onChange={(event) => setForm((old) => ({ ...old, cost: event.target.value }))} /></Field>
      </div>
      <Button type="submit" variant="primary" disabled={busy}>Добавить размер</Button>
    </form> : null}
    <DataTable label="Каталог размеров ковров" frameClassName={styles.tableFrame}>
      <thead><tr><th>Размер</th><th>Стоимость замены за ковёр</th><th>Действия</th></tr></thead>
      <tbody>{!catalog ? <tr><td colSpan={3}>{error ? 'Каталог не загружен.' : 'Загружаем каталог…'}</td></tr> : catalog.items.length === 0 ? <tr><td colSpan={3}>Размеры пока не добавлены.</td></tr> : catalog.items.map((size) => <tr key={size.id}>
        <td>{matSizeLabel(size)}</td><td>{matMoney(size.replacementCost)}</td>
        <td>{catalog.canManage ? <form className={styles.formGrid} onSubmit={(event) => {
          event.preventDefault();
          const draft = costDrafts[size.id];
          if (!draft) return;
          void run(async () => {
            await setRubberMatCost(size.id, { version: draft.version, replacementCost: draft.value.trim() || null });
            setCostDrafts((old) => { const next = { ...old }; delete next[size.id]; return next; });
          });
        }}>
          <Field label={'Стоимость замены ' + matSizeLabel(size) + ', ₽'} description={costDrafts[size.id]?.version !== undefined && costDrafts[size.id]?.version !== size.version ? 'Стоимость изменилась. Сравните с текущей ценой и введите новую стоимость.' : undefined}><input type="number" min="0" max="999999999999.99" step="0.01" value={costDrafts[size.id]?.value ?? size.replacementCost ?? ''} disabled={busy} onChange={(event) => setCostDrafts((old) => ({ ...old, [size.id]: { value: event.target.value, version: size.version } }))} /></Field>
          <Button type="submit" disabled={busy || costDrafts[size.id] === undefined || costDrafts[size.id]?.version !== size.version}>Сохранить</Button>
          {costDrafts[size.id] ? <Button variant="ghost" disabled={busy} onClick={() => setCostDrafts((old) => { const next = { ...old }; delete next[size.id]; return next; })}>Отменить ввод</Button> : null}
        </form> : null}
          <Button variant="ghost" disabled={busy} onClick={async () => {
            setBusy(true); setError(null);
            try { setHistory({ size, changes: await getRubberMatCostHistory(size.id) }); }
            catch (caught) { setError(caught instanceof Error ? caught.message : 'Не удалось загрузить историю'); }
            finally { setBusy(false); }
          }}>История стоимости</Button>
        </td>
      </tr>)}</tbody>
    </DataTable>
    {history ? <section><h3>История стоимости: {matSizeLabel(history.size)}</h3><ol>{history.changes.length === 0 ? <li>Изменений пока нет.</li> : history.changes.map((change) => <li key={change.id}>{matMoney(change.beforeCost)} → {matMoney(change.afterCost)} · {change.actorName ?? 'Перенос прежних записей'} · {new Date(change.occurredAt).toLocaleString('ru-RU')}</li>)}</ol></section> : null}
  </div>;
}
