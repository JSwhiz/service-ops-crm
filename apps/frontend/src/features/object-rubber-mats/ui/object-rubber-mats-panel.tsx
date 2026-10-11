'use client';

import React, { useEffect, useMemo, useState } from 'react';

import { listObjects } from '@/entities/object/api/object-client';
import type { ServiceObject } from '@/entities/object/model/object.types';
import {
  assignRubberMat,
  getRubberMatHistory,
  listAvailableRubberMats,
  listRubberMats,
  moveRubberMat,
  recordRubberMatService,
  updateRubberMat,
  returnRubberMatToStock,
  type RubberMatEvent,
  type RubberMatItem,
} from '@/entities/rubber-mat/api/rubber-mat-client';

import styles from './object-rubber-mats-panel.module.css';

const conditionLabels = { good: 'В работе', worn: 'Изношен', damaged: 'Повреждён', retired: 'Списан' } as const;

function displayError(error: unknown): string {
  return error instanceof Error && error.message ? error.message : 'Не удалось выполнить действие.';
}

export function ObjectRubberMatsPanel({ objectId }: { objectId: string }): React.JSX.Element {
  const [items, setItems] = useState<RubberMatItem[]>([]);
  const [objects, setObjects] = useState<ServiceObject[]>([]);
  const [available, setAvailable] = useState<RubberMatItem[]>([]);
  const [history, setHistory] = useState<Record<string, RubberMatEvent[]>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [serviceDrafts, setServiceDrafts] = useState<Record<string, string>>({});
  const [serviceOpenId, setServiceOpenId] = useState<string | null>(null);
  const [conditionDrafts, setConditionDrafts] = useState<Record<string, { condition: RubberMatItem['condition']; note: string }>>({});
  const [draft, setDraft] = useState({ matId: '', zone: '', note: '' });
  const [moveDrafts, setMoveDrafts] = useState<Record<string, { targetObjectId: string; zone: string; note: string }>>({});
  const [search, setSearch] = useState('');
  const [conditionFilter, setConditionFilter] = useState<RubberMatItem['condition'] | ''>('');

  const visibleItems = useMemo(() => {
    const term = search.trim().toLocaleLowerCase('ru-RU');
    return items.filter((item) => {
      if (conditionFilter && item.condition !== conditionFilter) return false;
      if (!term) return true;
      return `${item.inventoryCode ?? ''} ${item.zone} ${item.notes ?? ''} ${item.lengthCm} ${item.widthCm}`
        .toLocaleLowerCase('ru-RU').includes(term);
    });
  }, [conditionFilter, items, search]);

  const reload = async (): Promise<void> => {
    const [mats, freeMats] = await Promise.all([listRubberMats(objectId), listAvailableRubberMats(objectId)]);
    setItems(mats);
    setAvailable(freeMats);
  };

  useEffect(() => {
    let cancelled = false;
    void Promise.all([listRubberMats(objectId), listAvailableRubberMats(objectId), listObjects()]).then(([mats, freeMats, availableObjects]) => {
      if (cancelled) return;
      setItems(mats);
      setAvailable(freeMats);
      setObjects(availableObjects.filter((object) => object.id !== objectId));
    }).catch((loadError) => { if (!cancelled) setError(displayError(loadError)); });
    return () => { cancelled = true; };
  }, [objectId]);

  const run = async (action: () => Promise<unknown>): Promise<void> => {
    setBusy(true); setError(null);
    try { await action(); await reload(); }
    catch (actionError) { setError(displayError(actionError)); }
    finally { setBusy(false); }
  };

  return (
    <div className={styles.panel}>
      <div className={styles.intro}>
        <strong>Ковры объекта</strong>
        <span>Здесь отображаются ковры, назначенные именно этому объекту. Новые ковры сначала регистрируются в общем разделе «Ковры», затем выбираются из свободного реестра.</span>
      </div>
      {error ? <div className={styles.error}>{error}</div> : null}

      <form className={styles.form} onSubmit={(event) => {
        event.preventDefault();
        void run(async () => {
          if (!draft.matId) return;
          await assignRubberMat(objectId, draft.matId, {
            zone: draft.zone,
            note: draft.note,
          });
          setDraft({ matId: '', zone: '', note: '' });
        });
      }}>
        <h3>Назначить ковёр из реестра</h3>
        <div className={styles.fields}>
          <label className={styles.wide}>Свободный ковёр<select required value={draft.matId} disabled={busy || available.length === 0} onChange={(event) => setDraft({ ...draft, matId: event.target.value })}><option value="">{available.length ? 'Выберите зарегистрированный ковёр' : 'Нет свободных ковров'}</option>{available.map((mat) => <option key={mat.id} value={mat.id}>{mat.inventoryCode || 'Без номера'} · {mat.lengthCm} × {mat.widthCm} см{mat.thicknessMm ? ` · ${mat.thicknessMm} мм` : ''}</option>)}</select></label>
          <label>Зона<input required maxLength={160} value={draft.zone} onChange={(event) => setDraft({ ...draft, zone: event.target.value })} placeholder="Вход, кухня, санузел" /></label>
          <label className={styles.wide}>Основание записи<input required minLength={2} maxLength={500} value={draft.note} onChange={(event) => setDraft({ ...draft, note: event.target.value })} placeholder="Например: первичная инвентаризация" /></label>
        </div>
        <button type="submit" disabled={busy || available.length === 0 || !draft.matId}>Назначить объекту</button>
      </form>

      {items.length === 0 ? <div className={styles.empty}>На объекте пока нет учтённых ковров.</div> : (
        <div className={styles.list}>
          <div className={styles.summary}>Всего: {items.length} · в работе: {items.filter((item) => item.condition === 'good').length} · требуют внимания: {items.filter((item) => item.condition === 'worn' || item.condition === 'damaged').length} · списано: {items.filter((item) => item.condition === 'retired').length}</div>
          <div className={styles.filters}>
            <label>Поиск по коврам<input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Номер, зона, размер или примечание" /></label>
            <label>Состояние<select value={conditionFilter} onChange={(event) => setConditionFilter(event.target.value as RubberMatItem['condition'] | '')}><option value="">Все состояния</option>{Object.entries(conditionLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          </div>
          {visibleItems.length === 0 ? <div className={styles.empty}>Ковры по заданным фильтрам не найдены.</div> : visibleItems.map((mat) => {
            const moveDraft = moveDrafts[mat.id] ?? { targetObjectId: '', zone: mat.zone ?? '', note: '' };
            const matHistory = history[mat.id];
            const conditionDraft = conditionDrafts[mat.id] ?? { condition: mat.condition, note: '' };
            return <article className={styles.mat} key={mat.id}>
              <div className={styles.matHeader}>
                <div><strong>{mat.zone}</strong><span>{mat.lengthCm} × {mat.widthCm} см{mat.thicknessMm ? ` · ${mat.thicknessMm} мм` : ''}{mat.inventoryCode ? ` · ${mat.inventoryCode}` : ''}</span></div>
                <span className={`${styles.badge} ${styles[mat.condition]}`}>{conditionLabels[mat.condition]}</span>
              </div>
              {mat.notes ? <p>{mat.notes}</p> : null}
              {mat.condition !== 'retired' ? <div className={styles.actions}>
                <select aria-label={`Новое состояние ковра ${mat.zone}`} value={conditionDraft.condition} disabled={busy} onChange={(event) => setConditionDrafts({ ...conditionDrafts, [mat.id]: { ...conditionDraft, condition: event.target.value as RubberMatItem['condition'] } })}>
                  {Object.entries(conditionLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
                {conditionDraft.condition !== mat.condition ? <>
                  <input aria-label="Причина изменения состояния" value={conditionDraft.note} onChange={(event) => setConditionDrafts({ ...conditionDrafts, [mat.id]: { ...conditionDraft, note: event.target.value } })} placeholder="Причина изменения состояния" />
                  <button type="button" className={styles.secondary} disabled={busy || !conditionDraft.note.trim()} onClick={() => void run(async () => {
                    await updateRubberMat(objectId, mat.id, { condition: conditionDraft.condition, note: conditionDraft.note.trim() });
                    setConditionDrafts({ ...conditionDrafts, [mat.id]: { condition: conditionDraft.condition, note: '' } });
                  })}>Сохранить состояние</button>
                </> : null}
                <button type="button" className={styles.secondary} disabled={busy} onClick={() => {
                  setServiceOpenId(serviceOpenId === mat.id ? null : mat.id);
                }}>Записать обслуживание</button>
                <button type="button" className={styles.secondary} disabled={busy} onClick={() => {
                  const note = window.prompt('Укажите причину возврата ковра в свободный реестр:');
                  if (note?.trim()) void run(() => returnRubberMatToStock(objectId, mat.id, note.trim()));
                }}>Вернуть в реестр</button>
                {objects.length ? <>
                  <select aria-label={`Объект назначения для ковра ${mat.zone}`} value={moveDraft.targetObjectId} disabled={busy} onChange={(event) => setMoveDrafts({ ...moveDrafts, [mat.id]: { ...moveDraft, targetObjectId: event.target.value } })}>
                    <option value="">Переместить на объект…</option>
                    {objects.map((object) => <option key={object.id} value={object.id}>{object.name}</option>)}
                  </select>
                  {moveDraft.targetObjectId ? <>
                    <input aria-label="Новая зона ковра" value={moveDraft.zone} onChange={(event) => setMoveDrafts({ ...moveDrafts, [mat.id]: { ...moveDraft, zone: event.target.value } })} placeholder="Зона назначения" />
                    <input aria-label="Причина перемещения" value={moveDraft.note} onChange={(event) => setMoveDrafts({ ...moveDrafts, [mat.id]: { ...moveDraft, note: event.target.value } })} placeholder="Причина перемещения" />
                    <button type="button" className={styles.secondary} disabled={busy || !moveDraft.note.trim()} onClick={() => void run(async () => { await moveRubberMat(objectId, mat.id, moveDraft); setMoveDrafts({ ...moveDrafts, [mat.id]: { targetObjectId: '', zone: mat.zone ?? '', note: '' } }); })}>Переместить</button>
                  </> : null}
                </> : null}
              </div> : null}
              {serviceOpenId === mat.id ? <div className={styles.serviceForm}>
                <label>Что сделано<input value={serviceDrafts[mat.id] ?? ''} maxLength={500} onChange={(event) => setServiceDrafts({ ...serviceDrafts, [mat.id]: event.target.value })} placeholder="Например: промыт и высушен" /></label>
                <button type="button" disabled={busy || !(serviceDrafts[mat.id] ?? '').trim()} onClick={() => {
                  const note = serviceDrafts[mat.id]?.trim();
                  if (!note) return;
                  void run(async () => {
                  await recordRubberMatService(objectId, mat.id, note);
                  setServiceOpenId(null);
                  setServiceDrafts({ ...serviceDrafts, [mat.id]: '' });
                  });
                }}>Сохранить запись</button>
              </div> : null}
              <button type="button" className={styles.historyButton} onClick={async () => {
                try { setHistory({ ...history, [mat.id]: await getRubberMatHistory(objectId, mat.id) }); }
                catch (loadError) { setError(displayError(loadError)); }
              }}>{matHistory ? 'Обновить историю' : 'История ковра'}</button>
              {matHistory ? <ol className={styles.history}>{matHistory.map((event) => <li key={event.id}><strong>{event.action === 'serviced' ? 'Обслуживание' : event.action === 'moved' ? 'Перемещение' : event.action === 'retired' ? 'Списание' : event.action === 'registered' ? 'Добавлен в реестр' : event.action === 'assigned' ? 'Назначен на объект' : event.action === 'returned_to_stock' ? 'Возвращён в реестр' : 'Изменение состояния'}</strong><span>{new Date(event.occurredAt).toLocaleString('ru-RU')} · {event.actor.fullName}</span><span>{event.note}</span></li>)}</ol> : null}
            </article>
          })}
        </div>
      )}
    </div>
  );
}
