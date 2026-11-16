'use client';

import React, { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useAccessRevision } from '@/shared/auth/use-access-revision';
import { useOpenAccessRefresh } from '@/shared/auth/use-open-access-refresh';
import { AccessSnapshotBoundary } from '@/shared/auth/access-snapshot-boundary';
import { getAccessGeneration, isAccessGenerationCurrent } from '@/shared/auth/access-generation';
import { ApiError } from '@/shared/api/fetcher';
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
  const accessRevision = useAccessRevision();
  const accessGeneration = getAccessGeneration();
  const [loadedAccessRevision, setLoadedAccessRevision] = useState<string | null>(null);
  const [data, setData] = useState<RubberMatAggregate | null>(null);
  const [drafts, setDrafts] = useState<Record<string, { value: string; version: number }>>({});
  const [history, setHistory] = useState<{ accessRevision: string; changes: RubberMatQuantityChange[] } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const panelRef = useRef<HTMLDivElement>(null);
  useOpenAccessRefresh(data !== null, panelRef);

  useEffect(() => {
    let active = true;
    setLoadError(null);
    setHistory(null);
    void getRubberMatAggregate(objectId).then((result) => {
      if (active && isAccessGenerationCurrent(accessGeneration)) { setData(result); setLoadedAccessRevision(accessRevision); }
    }).catch((caught: unknown) => {
      if (active && isAccessGenerationCurrent(accessGeneration)) setLoadError(caught instanceof Error ? caught.message : 'Не удалось загрузить ковры');
    });
    return () => { active = false; };
  }, [objectId, revision, accessRevision, accessGeneration]);

  const accessCurrent = loadedAccessRevision === accessRevision && !loadError && data !== null;

  const save = async (sizeId: string): Promise<void> => {
    const item = data?.items.find((entry) => entry.id === sizeId);
    if (busy || !accessCurrent || !data?.canManage || !isAccessGenerationCurrent(accessGeneration) || !drafts[sizeId] || !item || drafts[sizeId].version !== item.quantityVersion) return;
    const { value, version } = drafts[sizeId];
    if (!value || !/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))) { setError('Введите целое неотрицательное количество'); return; }
    setBusy(true); setError(null);
    try {
      await setRubberMatQuantity(objectId, sizeId, { version, quantity: Number(value) });
      if (!isAccessGenerationCurrent(accessGeneration)) return;
      setLoadedAccessRevision(null);
      const result = await getRubberMatAggregate(objectId);
      if (!isAccessGenerationCurrent(accessGeneration)) return;
      setData(result); setLoadedAccessRevision(accessRevision);
      setDrafts((previous) => {
        if (previous[sizeId]?.value !== value || previous[sizeId]?.version !== version) return previous;
        const next = { ...previous }; delete next[sizeId]; return next;
      });
      setHistory(null);
      if (history && result.canReadHistory) {
        const changes = await getRubberMatQuantityHistory(objectId);
        if (isAccessGenerationCurrent(accessGeneration)) setHistory({ accessRevision, changes });
      }
    } catch (caught) {
      if (isAccessGenerationCurrent(accessGeneration)) {
        setError(caught instanceof Error ? caught.message : 'Не удалось сохранить количество');
        if (caught instanceof ApiError && caught.statusCode === 403) { setLoadedAccessRevision(null); setRevision((value) => value + 1); }
      }
    }
    finally { setBusy(false); }
  };

  const loadHistory = async (): Promise<void> => {
    if (busy || !accessCurrent || !data?.canReadHistory || !isAccessGenerationCurrent(accessGeneration)) return;
    setBusy(true); setError(null);
    try {
      const changes = await getRubberMatQuantityHistory(objectId);
      if (isAccessGenerationCurrent(accessGeneration)) setHistory({ accessRevision, changes });
    } catch (caught) {
      if (isAccessGenerationCurrent(accessGeneration)) {
        setHistory(null); setError(caught instanceof Error ? caught.message : 'Не удалось загрузить историю');
        if (caught instanceof ApiError && caught.statusCode === 403) { setLoadedAccessRevision(null); setRevision((value) => value + 1); }
      }
    } finally { setBusy(false); }
  };

  return <div className={styles.panel} ref={panelRef}>
    <p>Количество ковров по размеру. <Link href="/rubber-mats">Каталог размеров и стоимости замены</Link></p>
    {loadError || error ? <Alert tone="danger" role="alert">{loadError ?? error} <Button disabled={busy} onClick={() => { setError(null); setLoadError(null); setRevision((v) => v + 1); }}>Обновить данные</Button></Alert> : null}
    {!accessCurrent && !loadError ? <p role="status">Проверяем доступ к учёту ковров…</p> : null}
    <AccessSnapshotBoundary blocked={!accessCurrent}>
    {data ? <>
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
      {data.canReadHistory ? <Button disabled={busy} onClick={() => { void loadHistory(); }}>История количества</Button> : null}
      {data.canReadHistory && history?.accessRevision === accessRevision ? <ol className={styles.history}>{history.changes.length === 0 ? <li>Изменений пока нет.</li> : history.changes.map((change) => <li key={change.id}>
        <strong>{matSizeLabel(change)}: {change.beforeQuantity} → {change.afterQuantity}</strong>
        <span>{new Date(change.occurredAt).toLocaleString('ru-RU')} · {change.actorName ?? 'Перенос прежних записей'}</span>
        <span>Цена на момент изменения: {matMoney(change.replacementCostSnapshot)}</span>
      </li>)}</ol> : null}
    </> : null}
    </AccessSnapshotBoundary>
  </div>;
}
