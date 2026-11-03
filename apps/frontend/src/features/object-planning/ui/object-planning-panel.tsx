'use client';

import React, { useCallback, useEffect, useId, useState } from 'react';

import { getObjectPlanning, saveObjectPlanning, type ObjectPlanning, type PlanningInput } from '@/entities/object/api/object-planning-client';
import type { ServiceObject } from '@/entities/object/model/object.types';
import { getPayContours } from '@/entities/object/api/object-scheduling-client';
import type { PayContour } from '@/entities/object/model/object-scheduling.types';
import { getErrorMessage } from '@/shared/lib/error-message';
import { Alert, Button, FactStrip, Field, LoadingState, Stack, Surface } from '@/shared/ui/foundation';
import { Dialog } from '@/shared/ui/overlays';
import { SeasonFields } from './season-fields';
import { seasonPlanningPayload } from '../model/season-planning';
import { contourDisplayRate, nextSeasonBoundary } from '../model/season-summary';
import { TeamCompensationPanel } from '@/features/object-compensation/ui/team-compensation-panel';

const money = (amount: number) => new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB' }).format(amount);
const annualDate = (value: string | null) => value
  ? new Date(`2000-${value}T12:00:00Z`).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', timeZone: 'Europe/Moscow' })
  : 'Не задана';

export function ObjectPlanningPanel({ objectId, item, onChanged, financialRevision = 0 }: {
  objectId: string;
  item: ServiceObject;
  onChanged: () => void;
  financialRevision?: number;
}): React.JSX.Element {
  const [data, setData] = useState<ObjectPlanning | null>(null);
  const [budget, setBudget] = useState('');
  const [automatic, setAutomatic] = useState(false);
  const [summer, setSummer] = useState('');
  const [winter, setWinter] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [editing, setEditing] = useState<'budget' | 'seasons' | null>(null);
  const [contours, setContours] = useState<PayContour[] | null>(null);
  const [contourError, setContourError] = useState<string | null>(null);
  const [contourRetry, setContourRetry] = useState(0);
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

  useEffect(() => {
    if (item.capabilities.canViewCompensationRates === false) return;
    let active = true;
    let request = 0;
    const reload = () => {
      const current = ++request;
      setContourError(null);
      void getPayContours(objectId).then((response) => { if (active && current === request) setContours(response.contours); })
        .catch((caught: unknown) => { if (active && current === request) setContourError(getErrorMessage(caught, 'Не удалось загрузить готовые условия оплаты.')); });
    };
    const onSectionChange = () => { if (window.location.hash === '#planning') reload(); };
    setContours(null);
    reload();
    window.addEventListener('hashchange', onSectionChange);
    return () => { active = false; window.removeEventListener('hashchange', onSectionChange); };
  }, [objectId, item.capabilities.canViewCompensationRates, contourRetry]);

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
  const activeContours = contours?.filter((contour) => contour.isActive) ?? [];
  const legacyManualSeason = !data?.automaticSeasons && (data?.activeSeason === 'summer' || data?.activeSeason === 'winter');
  const visibleProfiles = data?.automaticSeasons || legacyManualSeason ? profiles : profiles.slice(0, 1);
  const nextBoundary = data?.automaticSeasons ? nextSeasonBoundary(data.summerStartsOn, data.winterStartsOn) : null;
  const profileFacts = (values: typeof profiles) => values.map((profile) => ({ key: profile.key, label: profile.label, value: <>
    <span>{profile.type === 'monthly' ? 'Оплата за месяц' : profile.type === 'daily' ? 'Оплата за выход' : 'Модель не задана'}</span>
    <span>{profile.type === 'monthly'
      ? profile.monthly === null ? 'Сумма не задана' : `${money(profile.monthly)} / месяц`
      : profile.type === 'daily' ? profile.daily === null ? 'Ставка не задана' : `${money(profile.daily)} / выход` : '—'}</span>
  </> }));

  return <Stack gap="xl">
    {item.capabilities.canViewCompensationRates !== false ? <TeamCompensationPanel key={objectId} objectId={objectId} financialRevision={financialRevision} writable={!['frozen', 'closed', 'archived'].includes(item.status)} /> : null}
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
          <h3 className="ui-section-title">Сезонность и условия оплаты</h3>
          {data.capabilities.canEditSeasons ? <Button disabled={editing !== null} onClick={() => { apply(data); setEditing('seasons'); }}>Настроить сезоны</Button> : null}
        </div>
        <FactStrip items={[
          { label: 'Текущие условия', value: data.activeSeason === 'summer' ? 'Лето' : data.activeSeason === 'winter' ? 'Зима' : data.automaticSeasons ? 'Не определены' : 'Базовые' },
          { label: 'Сезонность', value: data.automaticSeasons ? 'Включена · ежегодно по датам' : 'Выключена' },
          ...(data.automaticSeasons ? [
            { label: 'Начало лета', value: annualDate(data.summerStartsOn) },
            { label: 'Начало зимы', value: annualDate(data.winterStartsOn) },
          ] : []),
        ]} />
        {nextBoundary ? <p className="ui-section-subtitle">Следующее переключение: {nextBoundary.season === 'summer' ? 'лето' : 'зима'} · {new Date(`${nextBoundary.date}T12:00:00Z`).toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow' })}.</p> : null}
        {!data.automaticSeasons && (data.activeSeason === 'summer' || data.activeSeason === 'winter') ? <Alert tone="info">Сохранён прежний ручной {data.activeSeason === 'summer' ? 'летний' : 'зимний'} профиль. Сейчас действуют показанные условия. Сохранение выключенной сезонности переключит объект на базовый профиль; включение потребует явно заданных ежегодных границ. Просмотр ничего не меняет.</Alert> : null}
        {item.capabilities.canViewCompensationRates !== false ? <>
          <div className="ui-section-header">
            <h4 className="ui-section-title">Базовые ставки объекта</h4>
            {item.capabilities.canManageCompensationRates ? <a href="#compensation-versions">Задать датированную версию</a> : null}
          </div>
          <p className="ui-section-subtitle">Справочные настройки объекта до введения датированных условий. Действующая датированная версия, условия позиции и распределение фонда показаны выше. Применяемые условия сохраняются при подтверждении выхода.</p>
          <FactStrip items={profileFacts(visibleProfiles)} />
          {!data.automaticSeasons && !legacyManualSeason ? <details>
            <summary>Сохранённые сезонные настройки · сейчас не применяются</summary>
            <p className="ui-text-muted">Начало лета: {annualDate(data.summerStartsOn)}. Начало зимы: {annualDate(data.winterStartsOn)}.</p>
            <FactStrip items={profileFacts(profiles.slice(1))} />
          </details> : null}
          <div className="ui-section-header">
            <h4 className="ui-section-title">Готовые условия штатных позиций</h4>
            <a href="#team">Перейти к команде</a>
          </div>
          {contourError ? <Alert tone="danger" action={<Button onClick={() => setContourRetry((value) => value + 1)}>Повторить</Button>}>{contourError}</Alert>
            : contours === null ? <LoadingState label="Загрузка условий оплаты" />
              : activeContours.length ? <div className="ui-stack ui-stack--lg">{activeContours.map((contour) => {
                const currentRate = contourDisplayRate(contour, data.activeSeason);
                return <div key={contour.id}>
                  <h4 className="ui-section-title">{contour.name}</h4>
                  <FactStrip items={[
                    { label: 'Справочная ставка каталога', value: money(currentRate) },
                    { label: 'По умолчанию', value: money(contour.dailyRate) },
                    ...(data.automaticSeasons ? [
                      { label: 'Лето', value: contour.summerDailyRate === null ? 'По умолчанию' : money(contour.summerDailyRate) },
                      { label: 'Зима', value: contour.winterDailyRate === null ? 'По умолчанию' : money(contour.winterDailyRate) },
                    ] : []),
                  ]} />
                  <p className="ui-section-subtitle">Действуют с {new Date(`${contour.effectiveFrom.slice(0, 10)}T12:00:00Z`).toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow' })}. Назначение условия на позицию — в разделе «Команда».</p>
                </div>;
              })}</div> : <p className="ui-text-muted">Отдельные условия не заведены. Используются действующие условия сотрудника и объекта.</p>}
          <p className="ui-section-subtitle">Один контур — один оплачиваемый выход сотрудника за дату; отдельные дневной и ночной контуры могут суммироваться. План графика сам по себе не создаёт начисление. Индивидуальные исключения и ранее сохранённые суммы здесь не пересчитываются.</p>
        </> : null}
        <p className="ui-section-subtitle">Часовой пояс — Москва. Предыдущий сезон заканчивается накануне начала следующего. Новые условия вводятся с явной текущей или будущей датой; сохранённые начисления остаются прежними.</p>
      </Surface>
      <Dialog open={modalOpen} onOpenChange={(open) => { if (!open) closeEditor(); }} busy={pending}
        title={editing === 'budget' ? 'Плановый бюджет расходников' : 'Переключение сезонов'}
        description={editing === 'budget' ? 'План на календарный месяц по московскому времени.' : 'В автоматическом режиме границы сезонов повторяются каждый год. Год в календаре не учитывается.'}
        footer={<div className="ui-inline"><Button disabled={pending} onClick={closeEditor}>Отмена</Button><Button form={formId} type="submit" variant="primary" pending={pending} pendingLabel="Сохранение…">Сохранить</Button></div>}
      >
        <form id={formId} className="ui-stack ui-stack--lg" onSubmit={(event) => {
          event.preventDefault();
          if (editing === 'budget') void save({ monthlyBudget: budget.trim() === '' ? null : Number(budget) });
          else if (editing === 'seasons') {
            try { void save(seasonPlanningPayload(automatic, summer, winter)); }
            catch (caught) { setError(getErrorMessage(caught, 'Проверьте ежегодные границы сезонов.')); }
          }
        }}>
          {editing === 'budget' ? <Field label="План на месяц, ₽" description="Пустое поле отключает контроль бюджета. Ноль означает нулевой бюджет.">
            <input type="number" min="0" step="0.01" value={budget} onChange={(event) => setBudget(event.target.value)} disabled={pending} />
          </Field> : <>
            <SeasonFields automatic={automatic} summer={summer} winter={winter} onAutomaticChange={setAutomatic} onSummerChange={setSummer} onWinterChange={setWinter} disabled={pending} />
          </>}
          {error ? <Alert tone="danger">{error}</Alert> : null}
        </form>
      </Dialog>
    </> : null}
  </Stack>;
}
