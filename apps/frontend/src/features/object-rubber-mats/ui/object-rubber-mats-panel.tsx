'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  getRubberMatAggregate, getRubberMatQuantityHistory, setRubberMatQuantity,
  matMoney, matSizeLabel, type RubberMatAggregate, type RubberMatQuantityChange,
} from '@/entities/rubber-mat/api/rubber-mat-client';
import { Alert, Button, Field } from '@/shared/ui/foundation';
import { DataTable } from '@/shared/ui/data-table/data-table';
import styles from './object-rubber-mats-panel.module.css';

export function ObjectRubberMatsPanel({ objectId }: { objectId: string }): React.JSX.Element {
  return <RubberMatWorkspace key={objectId} objectId={objectId} />;
}

function RubberMatWorkspace({ objectId }: { objectId: string }): React.JSX.Element {
  const [data, setData] = useState<RubberMatAggregate | null>(null);
  const [drafts, setDrafts] = useState<Record<string, { value: string; version: number }>>({});
  const [history, setHistory] = useState<RubberMatQuantityChange[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    let active = true;
    void getRubberMatAggregate(objectId).then((result) => {
      if (active) setData(result);
    }).catch((caught: unknown) => { if (active) setError(caught instanceof Error ? caught.message : 'Не удалось загрузить ковры'); });
    return () => { active = false; };
  }, [objectId, revision]);

  const save = async (sizeId: string): Promise<void> => {
    if (!drafts[sizeId]) return;
    const { value, version } = drafts[sizeId];
    if (!value || !/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))) { setError('Введите целое неотрицательное количество'); return; }
    setBusy(true); setError(null);
    try {
      await setRubberMatQuantity(objectId, sizeId, { version, quantity: Number(value) });
      const [result, changes] = await Promise.all([getRubberMatAggregate(objectId), history ? getRubberMatQuantityHistory(objectId) : Promise.resolve(null)]);
      setData(result); setDrafts((previous) => { const next = { ...previous }; delete next[sizeId]; return next; }); setHistory(changes);
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Не удалось сохранить количество'); }
    finally { setBusy(false); }
  };

  return <div className={styles.panel}>
    <p>Количество ковров по размеру. <Link href="/rubber-mats">Каталог размеров и стоимости замены</Link></p>
    {error ? <Alert tone="danger" role="alert">{error} <Button disabled={busy} onClick={() => { setError(null); setRevision((v) => v + 1); }}>Обновить данные</Button></Alert> : null}
    {!data ? error ? null : <p role="status">Загружаем учёт ковров…</p> : <>
      <p>Стоимость замены: {data.totalReplacementCost === null ? 'Не определена — у части ковров не указана цена.' : matMoney(data.totalReplacementCost)}{data.totalReplacementCost === null ? ' Известная часть: ' + matMoney(data.knownReplacementCost) + '.' : ''}</p>
      <DataTable label="Количество ковров по размерам">
        <thead><tr><th>Размер</th><th>Стоимость замены за ковёр</th><th>Количество</th><th>Изменить</th></tr></thead>
        <tbody>{data.items.length === 0 ? <tr><td colSpan={4}>В каталоге пока нет размеров. Добавьте согласованные размеры в каталоге.</td></tr> : data.items.map((item) => <tr key={item.id}>
          <td>{matSizeLabel(item)}</td><td>{matMoney(item.replacementCost)}</td><td>{item.quantity}</td>
          <td>{data.canManage ? <form className={styles.serviceForm} onSubmit={(event) => { event.preventDefault(); void save(item.id); }}>
            <Field label={'Количество ' + matSizeLabel(item)} description={drafts[item.id]?.version !== undefined && drafts[item.id]?.version !== item.quantityVersion ? 'Количество изменилось. Сравните с текущим значением и введите новое количество.' : undefined}><input type="number" min="0" max="2147483647" step="1" value={drafts[item.id]?.value ?? String(item.quantity)} disabled={busy} onChange={(event) => setDrafts((previous) => ({ ...previous, [item.id]: { value: event.target.value, version: item.quantityVersion } }))} /></Field>
            <Button type="submit" disabled={busy || drafts[item.id] === undefined || drafts[item.id]?.value === String(item.quantity) || drafts[item.id]?.version !== item.quantityVersion}>Сохранить</Button>
            {drafts[item.id] ? <Button variant="ghost" disabled={busy} onClick={() => setDrafts((previous) => { const next = { ...previous }; delete next[item.id]; return next; })}>Отменить ввод</Button> : null}
          </form> : 'Только просмотр'}</td>
        </tr>)}</tbody>
      </DataTable>
      <Button disabled={busy} onClick={async () => {
        setBusy(true); setError(null);
        try { setHistory(await getRubberMatQuantityHistory(objectId)); }
        catch (caught) { setError(caught instanceof Error ? caught.message : 'Не удалось загрузить историю'); }
        finally { setBusy(false); }
      }}>История количества</Button>
      {history ? <ol className={styles.history}>{history.length === 0 ? <li>Изменений пока нет.</li> : history.map((change) => <li key={change.id}>
        <strong>{matSizeLabel(change)}: {change.beforeQuantity} → {change.afterQuantity}</strong>
        <span>{new Date(change.occurredAt).toLocaleString('ru-RU')} · {change.actorName ?? 'Перенос прежних записей'}</span>
        <span>Цена на момент изменения: {matMoney(change.replacementCostSnapshot)}</span>
      </li>)}</ol> : null}
    </>}
  </div>;
}
