'use client';

import React, { useEffect, useState } from 'react';
import { getObjectSetup, saveObjectSetup } from '@/entities/object/api/object-setup-client';
import type { ObjectSetupData, ObjectSetupResponse } from '@/entities/object/model/object-setup.types';
import { listSystemUsers } from '@/entities/user/api/user-client';
import { ApiError } from '@/shared/api/fetcher';
import { Alert, Button, LoadingState, Surface } from '@/shared/ui/foundation';
import { useConfirm } from '@/shared/ui/overlays';
import type { SearchableSelectOption } from '@/shared/ui/searchable-select/searchable-select';
import { getUserDisplayName } from '@/shared/lib/display-name';
import { getErrorMessage } from '@/shared/lib/error-message';
import { budgetCategories, setupDraft, setupPayload, type SetupDraft } from '../model/setup-draft';
import { ObjectSetupEditor } from './object-setup-editor';
import styles from './object-setup.module.css';

function money(value: number | null): string { return value === null ? 'не задано' : `${value.toLocaleString('ru-RU')} ₽`; }
function sourceLabel(value: string): string { return value.replaceAll('TimesheetDayEntry.dayValue', 'Табель').replaceAll('InventoryMovement', 'Склад').replace(/\bapplied\b/g, 'проведённые'); }

export function ObjectSetupPanel({ objectId }: { objectId: string }): React.JSX.Element {
  const [data, setData] = useState<ObjectSetupResponse | null>(null);
  const [baseline, setBaseline] = useState<ObjectSetupResponse | null>(null);
  const [draft, setDraft] = useState<SetupDraft | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [salesUser, setSalesUser] = useState<SearchableSelectOption | null>(null);
  const [confirm, dialog] = useConfirm();
  useEffect(() => {
    let active = true;
    setLoading(true); setError(null);
    void getObjectSetup(objectId).then((response) => { if (active) setData(response); })
      .catch((caught) => { if (active) setError(getErrorMessage(caught, 'Не удалось загрузить сведения объекта.')); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [objectId]);
  useEffect(() => {
    const selectedId = data?.data.salesResponsibleUserId;
    if (!selectedId) { setSalesUser(null); return; }
    let active = true;
    void listSystemUsers({ purpose: 'object_responsible', objectId, selectedId, limit: 20 }).then((users) => {
      const selected = users.find((user) => user.id === selectedId);
      if (active) setSalesUser(selected ? { value: selected.id, label: getUserDisplayName(selected) } : { value: selectedId, label: 'Назначен пользователь' });
    }).catch(() => { if (active) setSalesUser({ value: selectedId, label: 'Назначен пользователь' }); });
    return () => { active = false; };
  }, [objectId, data?.data.salesResponsibleUserId]);
  const refresh = async (): Promise<void> => {
    setError(null);
    try { setData(await getObjectSetup(objectId)); }
    catch (caught) { setError(getErrorMessage(caught, 'Не удалось обновить сведения.')); }
  };
  const begin = (snapshot = data): void => {
    if (!snapshot) return;
    setBaseline(snapshot); setDraft(setupDraft(snapshot.data)); setConflict(false); setError(null); setSuccess(false);
  };
  const save = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    if (pending || !draft || !baseline || conflict) return;
    setPending(true); setError(null); setSuccess(false);
    try {
      const before = setupPayload(setupDraft(baseline.data), baseline.capabilities);
      const next = setupPayload(draft, baseline.capabilities);
      const changes = Object.fromEntries(Object.entries(next).filter(([key, value]) => JSON.stringify(before[key as keyof ObjectSetupData]) !== JSON.stringify(value)));
      if (Object.keys(changes).length === 0) { setDraft(null); return; }
      const saved = await saveObjectSetup(objectId, { ...changes, expectedVersion: baseline.version });
      setData(saved); setDraft(null); setBaseline(null); setSuccess(true);
    } catch (caught) {
      setError(getErrorMessage(caught, 'Не удалось сохранить настройки.'));
      setConflict(caught instanceof ApiError && caught.statusCode === 409);
    } finally { setPending(false); }
  };
  const caps = data?.capabilities;
  const canEdit = caps && (caps.canEditCore || caps.canEditContractAmount || caps.canEditBudgets || caps.canEditCoefficient);
  return <Surface padding="md">
    {dialog}
    <div className={styles.editor}>
      <div className="ui-section-header"><h3 className="ui-section-title">Сведения, договор и плановые статьи</h3>{canEdit && !draft ? <Button onClick={() => begin()}>Изменить сведения</Button> : null}</div>
      {loading ? <LoadingState label="Загрузка сведений объекта" /> : null}
      {error ? <Alert tone="danger">{error}<div><Button disabled={pending} onClick={() => { void refresh(); }}>Обновить данные</Button></div></Alert> : null}
      {success ? <Alert tone="success">Сведения сохранены.</Alert> : null}
      {conflict ? <Alert tone="warning">Настройки изменены. Черновик сохранён и не перезаписывается при обновлении. Сравните его со свежими сведениями ниже.
        <div><Button disabled={pending} onClick={async () => {
          try {
            const fresh = await getObjectSetup(objectId);
            setData(fresh);
            if (await confirm({ title: 'Заменить черновик сохранёнными данными?', consequence: 'Несохранённые значения будут потеряны. При необходимости сначала скопируйте их для сравнения.', confirmLabel: 'Загрузить данные' })) begin(fresh);
          } catch (caught) { setError(getErrorMessage(caught, 'Не удалось загрузить свежую версию.')); }
        }}>Загрузить данные в редактор</Button></div>
      </Alert> : null}
      {draft && baseline ? <form className={styles.editor} onSubmit={(event) => { void save(event); }}>
        <ObjectSetupEditor value={draft} onChange={setDraft} capabilities={baseline.capabilities} disabled={pending} selectedSalesUser={salesUser}
          searchUsers={async (q) => (await listSystemUsers({ purpose: 'object_responsible', objectId, q, limit: 20 })).map((user) => ({ value: user.id, label: getUserDisplayName(user) }))} />
        <div className="ui-inline"><Button type="submit" variant="primary" pending={pending} disabled={conflict}>Сохранить сведения</Button><Button disabled={pending} onClick={async () => { if (await confirm({ title: 'Закрыть редактор?', consequence: 'Несохранённые сведения будут потеряны.', confirmLabel: 'Закрыть' })) setDraft(null); }}>Отмена</Button></div>
      </form> : null}
      {data ? <section className={styles.section} aria-label="Сохранённые сведения">
        {draft ? <h4 className="ui-section-title">Сохранённые сведения для сравнения</h4> : null}
        <div className="ui-detail-grid">
          {[
            ['Юридическое название', data.data.legalName ?? 'не задано'], ['Площадь, м²', data.data.areaSqM?.toLocaleString('ru-RU') ?? 'не задана'],
            ['Плановый запуск', data.data.plannedLaunchDate ?? 'не задан'], ['Начало договора', data.data.contractStartsOn ?? 'не задано'], ['Окончание договора', data.data.contractEndsOn ?? 'не задано'],
            ['Ответственный за продажи', data.data.salesResponsibleUserId ? salesUser?.label ?? 'Назначен пользователь' : 'не назначен'],
            ...(caps?.canViewContractAmount ? [['Сумма договора в месяц', money(data.data.contractMonthlyAmount)]] : []),
            ...(caps?.canViewCoefficient ? [['Коэффициент (не применяется)', data.data.coefficient?.toLocaleString('ru-RU') ?? 'не задан']] : []),
          ].map(([label, value]) => <div className="ui-detail-field" key={label}><div className="ui-detail-label">{label}</div><div className="ui-detail-value">{value}</div></div>)}
        </div>
        {caps?.canViewBudgets ? <>
          <h4 className="ui-section-title">План и факт за {data.budgets.month}</h4>
          <p>Общий расход расходников: {data.budgets.consumablesActualAmount === null ? 'нет подтверждённого факта' : money(data.budgets.consumablesActualAmount)}.</p>
          <p className="ui-text-muted">{sourceLabel(data.budgets.consumablesSource)}. Общий расход не прибавляется повторно к статьям.</p>
          {data.budgets.rows.map((row) => <div key={row.category}><strong>{budgetCategories[row.category]}</strong> · план: {money(row.planAmount)}; факт: {row.actualAmount === null ? 'нет подтверждённого источника / факта' : money(row.actualAmount)}.<div className="ui-text-muted">{sourceLabel(row.source)}</div></div>)}
        </> : null}
      </section> : null}
    </div>
  </Surface>;
}
