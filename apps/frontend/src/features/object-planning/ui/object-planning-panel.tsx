'use client';

import React, { useCallback, useEffect, useId, useState } from 'react';

import { updateObject } from '@/entities/object/api/object-client';
import { getObjectPlanning, saveObjectPlanning, type ObjectPlanning, type PlanningInput } from '@/entities/object/api/object-planning-client';
import type { ServiceObject } from '@/entities/object/model/object.types';
import { ObjectEditForm } from '@/features/object-edit/ui/object-edit-form';
import { getErrorMessage } from '@/shared/lib/error-message';
import { DatePicker } from '@/shared/ui/date-picker/date-picker';
import { Alert, Button, FactStrip, Field, LoadingState, Stack, Surface } from '@/shared/ui/foundation';
import { Dialog } from '@/shared/ui/overlays';
import { Select } from '@/shared/ui/searchable-select/select';

const money = (amount: number) => new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB' }).format(amount);
const annualDate = (value: string | null) => value
  ? new Date(`2000-${value}T12:00:00Z`).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', timeZone: 'Europe/Moscow' })
  : 'Не задана';

export function ObjectPlanningPanel({ objectId, item, onChanged }: {
  objectId: string;
  item: ServiceObject;
  onChanged: () => void;
}): React.JSX.Element {
  const [data, setData] = useState<ObjectPlanning | null>(null);
  const [budget, setBudget] = useState('');
  const [automatic, setAutomatic] = useState(false);
  const [summer, setSummer] = useState('');
  const [winter, setWinter] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [editing, setEditing] = useState<'budget' | 'seasons' | 'rates' | null>(null);
  const formId = useId();

  const apply = useCallback((value: ObjectPlanning) => {
    setData(value);
    setBudget(value.monthlyBudget === null ? '' : String(value.monthlyBudget));
    setAutomatic(value.automaticSeasons);
    const year = new Intl.DateTimeFormat('en', { year: 'numeric', timeZone: 'Europe/Moscow' }).format(new Date());
    setSummer(value.summerStartsOn ? `${year}-${value.summerStartsOn}` : '');
    setWinter(value.winterStartsOn ? `${year}-${value.winterStartsOn}` : '');
  }, []);

  useEffect(() => {
    let active = true;
    setLoaded(false);
    setError(null);
    void getObjectPlanning(objectId).then((value) => { if (active) apply(value); })
      .catch((e: unknown) => { if (active) setError(getErrorMessage(e, 'Не удалось загрузить бюджет и сезоны.')); })
      .finally(() => { if (active) setLoaded(true); });
    return () => { active = false; };
  }, [objectId, apply]);

  const save = async (payload: Omit<PlanningInput, 'expectedVersion'>) => {
    if (!data || pending) return;
    setPending(true);
    setError(null);
    try {
      apply(await saveObjectPlanning(objectId, { ...payload, expectedVersion: data.version }));
      setEditing(null);
      onChanged();
    } catch (e) {
      setError(getErrorMessage(e, 'Не удалось сохранить настройки. Обновите данные при конфликте.'));
    } finally { setPending(false); }
  };

  const closeEditor = () => {
    if (pending) return;
    if (data) apply(data);
    setError(null);
    setEditing(null);
  };
  const modalOpen = editing === 'budget' || editing === 'seasons';
  const base = item.baseCompensationProfile ?? item;
  const profiles = [
    { key: 'base', label: 'Базовый профиль', type: base.paymentType, daily: base.dailyRate, monthly: base.monthlySalary },
    { key: 'summer', label: 'Лето', type: item.summerPaymentType, daily: item.summerDailyRate, monthly: item.summerMonthlySalary },
    { key: 'winter', label: 'Зима', type: item.winterPaymentType, daily: item.winterDailyRate, monthly: item.winterMonthlySalary },
  ];

  return <Stack gap="xl">
    {error && !modalOpen ? <Alert tone="danger" action={<Button disabled={pending} onClick={() => {
      void getObjectPlanning(objectId).then(apply).then(() => setError(null)).catch((e: unknown) => setError(getErrorMessage(e, 'Не удалось обновить данные.')));
    }}>Обновить данные</Button>}>{error}</Alert> : null}
    {!loaded ? <LoadingState label="Загрузка бюджета и сезонов" /> : null}
    {data ? <>
      {data.capabilities.canViewBudget ? <Surface padding="md" as="section">
        <div className="ui-section-header">
          <div>
            <h3 className="ui-section-title">Бюджет расходников</h3>
            <p className="ui-section-subtitle">{new Date(`${data.month}-01T12:00:00Z`).toLocaleDateString('ru-RU', { month: 'long', year: 'numeric', timeZone: 'Europe/Moscow' })}</p>
          </div>
          {data.capabilities.canEditBudget ? <Button disabled={editing !== null} onClick={() => { apply(data); setEditing('budget'); }}>Изменить бюджет</Button> : null}
        </div>
        <FactStrip items={[
          { label: 'План на месяц', value: data.monthlyBudget === null ? 'Не задан' : money(data.monthlyBudget) },
          { label: 'Подтверждённый расход', value: data.actualAmount === null ? '—' : money(data.actualAmount) },
          { label: 'Перерасход', value: data.excessAmount === null ? '—' : money(data.excessAmount) },
        ]} />
        {(data.excessAmount ?? 0) > 0 ? <Alert tone="warning" title="Бюджет превышен">Перерасход {money(data.excessAmount!)}. Работа не блокируется; руководство получает уведомление и запись в чате «Руководство».</Alert> : null}
        <p className="ui-section-subtitle">Учитываются проведённые выдачи по сохранённой стоимости. Возвраты уменьшают расход. Превышение разрешено и фиксируется для руководства.</p>
      </Surface> : null}

      <Surface padding="md" as="section">
        <div className="ui-section-header">
          <h3 className="ui-section-title">Сезоны и ставки</h3>
          {data.capabilities.canEditSeasons ? <Button disabled={editing !== null} onClick={() => { apply(data); setEditing('seasons'); }}>Настроить сезоны</Button> : null}
        </div>
        <FactStrip items={[
          { label: 'Текущий сезон', value: data.activeSeason === 'summer' ? 'Лето' : data.activeSeason === 'winter' ? 'Зима' : 'Без сезонности' },
          { label: 'Переключение', value: data.automaticSeasons ? 'Ежегодно по датам' : 'Вручную' },
          { label: 'Начало лета', value: annualDate(data.summerStartsOn) },
          { label: 'Начало зимы', value: annualDate(data.winterStartsOn) },
        ]} />
        {item.capabilities.canViewCompensationRates !== false ? <>
          <div className="ui-section-header">
            <h4 className="ui-section-title">Условия оплаты</h4>
            {item.capabilities.canManageCompensationRates ? <Button disabled={editing !== null} onClick={() => setEditing('rates')}>Изменить ставки</Button> : null}
          </div>
          <FactStrip items={profiles.map((profile) => ({ key: profile.key, label: profile.label, value: <>
            <span>{profile.type === 'monthly' ? 'Оплата за месяц' : profile.type === 'daily' ? 'Оплата за выход' : 'Модель не задана'}</span>
            <span>{profile.daily === null ? 'За выход: не задано' : `${money(profile.daily)} / выход`}</span>
            <span>{profile.monthly === null ? 'За месяц: не задано' : `${money(profile.monthly)} / месяц`}</span>
          </> }))} />
        </> : null}
        <p className="ui-section-subtitle">Часовой пояс — Москва. Предыдущий сезон заканчивается накануне начала следующего. Новые ставки действуют со дня сохранения; сохранённые начисления остаются прежними.</p>
      </Surface>
      {editing === 'rates' && item.capabilities.canManageCompensationRates ? <ObjectEditForm
        mode="compensation"
        item={item}
        canEditObject={item.capabilities.canEdit && !data.automaticSeasons}
        canManageCompensationRates
        canLinkCounterparty={false}
        onCancel={closeEditor}
        onSubmit={async (payload) => { await updateObject(objectId, payload); onChanged(); }}
      /> : null}
      <Dialog open={modalOpen} onOpenChange={(open) => { if (!open) closeEditor(); }} busy={pending}
        title={editing === 'budget' ? 'Плановый бюджет расходников' : 'Переключение сезонов'}
        description={editing === 'budget' ? 'План на календарный месяц по московскому времени.' : 'В автоматическом режиме границы сезонов повторяются каждый год. Год в календаре не учитывается.'}
        footer={<div className="ui-inline"><Button disabled={pending} onClick={closeEditor}>Отмена</Button><Button form={formId} type="submit" variant="primary" pending={pending} pendingLabel="Сохранение…">Сохранить</Button></div>}
      >
        <form id={formId} className="ui-stack ui-stack--lg" onSubmit={(event) => {
          event.preventDefault();
          if (editing === 'budget') void save({ monthlyBudget: budget.trim() === '' ? null : Number(budget) });
          else if (editing === 'seasons') void save({ automaticSeasons: automatic, ...(summer ? { summerStartsOn: summer.slice(5) } : {}), ...(winter ? { winterStartsOn: winter.slice(5) } : {}) });
        }}>
          {editing === 'budget' ? <Field label="План на месяц, ₽" description="Пустое поле отключает контроль бюджета. Ноль означает нулевой бюджет.">
            <input type="number" min="0" step="0.01" value={budget} onChange={(event) => setBudget(event.target.value)} disabled={pending} />
          </Field> : <>
            <Field label="Переключение сезонов"><Select value={automatic ? 'automatic' : 'manual'} onChange={(event) => setAutomatic(event.target.value === 'automatic')} disabled={pending}><option value="manual">Вручную</option><option value="automatic">Ежегодно по датам</option></Select></Field>
            <Field label="Начало лета"><DatePicker value={summer} onChange={setSummer} required={automatic} disabled={pending} /></Field>
            <Field label="Начало зимы"><DatePicker value={winter} onChange={setWinter} required={automatic} disabled={pending} /></Field>
          </>}
          {error ? <Alert tone="danger">{error}</Alert> : null}
        </form>
      </Dialog>
    </> : null}
  </Stack>;
}
