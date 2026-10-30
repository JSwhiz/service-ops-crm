'use client';

import React from 'react';
import type { SetupBudgetCategory, SetupBudgetPeriod, SetupCapabilities } from '@/entities/object/model/object-setup.types';
import { Alert, Button, Field } from '@/shared/ui/foundation';
import { DatePicker } from '@/shared/ui/date-picker/date-picker';
import { SearchableSelect, type SearchableSelectOption } from '@/shared/ui/searchable-select/searchable-select';
import { Select } from '@/shared/ui/searchable-select/select';
import { budgetCategories, budgetPeriods, type SetupDraft } from '../model/setup-draft';
import styles from './object-setup.module.css';

export function ObjectSetupEditor({ value, onChange, capabilities: caps, disabled = false, searchUsers, selectedSalesUser }: {
  value: SetupDraft; onChange: (value: SetupDraft) => void; capabilities: SetupCapabilities; disabled?: boolean;
  searchUsers: (query: string) => Promise<SearchableSelectOption[]>; selectedSalesUser?: SearchableSelectOption | null;
}): React.JSX.Element {
  const patch = (next: Partial<SetupDraft>): void => onChange({ ...value, ...next });
  return <div className={styles.editor}>
    <section className={styles.section} aria-label="Сведения и договор">
      <h3 className="ui-section-title">Сведения и договор</h3>
      <p className="ui-section-subtitle">Все поля необязательны. Юридическое название независимо от контрагента.</p>
      <div className={styles.grid}>
        <Field label="Юридическое название"><input value={value.legalName} maxLength={300} disabled={disabled || !caps.canEditCore} onChange={(event) => patch({ legalName: event.target.value })} /></Field>
        <Field label="Площадь, м²"><input type="number" step="0.01" min={0} value={value.areaSqM} disabled={disabled || !caps.canEditCore} onChange={(event) => patch({ areaSqM: event.target.value })} /></Field>
        <Field label="Плановая дата запуска"><DatePicker value={value.plannedLaunchDate} disabled={disabled || !caps.canEditCore} onChange={(plannedLaunchDate) => patch({ plannedLaunchDate })} /></Field>
        <Field label="Начало договора"><DatePicker value={value.contractStartsOn} disabled={disabled || !caps.canEditCore} onChange={(contractStartsOn) => patch({ contractStartsOn })} /></Field>
        <Field label="Окончание договора" description="Пусто — дата окончания не задана. Даты не меняют статус объекта автоматически."><DatePicker value={value.contractEndsOn} disabled={disabled || !caps.canEditCore} onChange={(contractEndsOn) => patch({ contractEndsOn })} /></Field>
        {caps.canViewContractAmount ? <Field label="Сумма договора в месяц, ₽"><input type="number" step="0.01" min={0} value={value.contractMonthlyAmount} disabled={disabled || !caps.canEditContractAmount} onChange={(event) => patch({ contractMonthlyAmount: event.target.value })} /></Field> : null}
        <SearchableSelect label="Ответственный за продажи" value={value.salesResponsibleUserId} options={[]} selectedOption={selectedSalesUser} asyncSearch={searchUsers} disabled={disabled || !caps.canEditCore} placeholder="Не назначен" viewportAware onChange={(salesResponsibleUserId) => patch({ salesResponsibleUserId })} />
        {caps.canViewCoefficient ? <Field label="Коэффициент" description={caps.canEditCoefficient ? 'Сохраняется как настройка. В расчётах пока не применяется.' : 'В расчётах пока не применяется. Для изменения требуется отдельное право.'}><input type="number" step="0.0001" min={0} value={value.coefficient} disabled={disabled || !caps.canEditCoefficient} onChange={(event) => patch({ coefficient: event.target.value })} /></Field> : null}
      </div>
    </section>
    {caps.canViewBudgets ? <section className={styles.section} aria-label="Плановые бюджеты">
      <h3 className="ui-section-title">Плановые бюджеты</h3>
      <p className="ui-section-subtitle">Зарплата и расходники учитываются отдельно. План не создаёт расход или выплату. Пустая сумма означает «не задана».</p>
      {!caps.canEditBudgets ? <Alert tone="info">Изменение бюджета доступно по отдельному праву.</Alert> : null}
      {value.budgets.map((row, index) => {
        const update = (next: Partial<typeof row>): void => patch({ budgets: value.budgets.map((item, itemIndex) => itemIndex === index ? { ...item, ...next } : item) });
        return <section key={row.category} className={styles.section} aria-label={budgetCategories[row.category]}>
          <h4 className="ui-section-title">{budgetCategories[row.category]}</h4>
          <div className={styles.grid}>
            <Field label="План, ₽"><input type="number" step="0.01" min={0} value={row.amount} disabled={disabled || !caps.canEditBudgets} onChange={(event) => update({ amount: event.target.value })} /></Field>
            <Field label="Периодичность"><Select value={row.period} disabled={disabled || !caps.canEditBudgets} onChange={(event) => update({ period: event.target.value as SetupBudgetPeriod, monthlyAllocation: event.target.value === 'annual' ? row.monthlyAllocation : null })}>{Object.entries(budgetPeriods).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</Select></Field>
            {!['payroll', 'consumables_cleaning', 'consumables_household'].includes(row.category) ? <Field label="Плановое число выполнений"><input type="number" step={1} min={0} max={10000} value={row.plannedOccurrences} disabled={disabled || !caps.canEditBudgets} onChange={(event) => update({ plannedOccurrences: event.target.value })} /></Field> : null}
            {row.period === 'once' ? <Field label="Месяц разового плана" description="Формат ГГГГ-ММ, например 2026-11."><input value={row.targetMonth} placeholder="2026-11" pattern="[0-9]{4}-(0[1-9]|1[0-2])" disabled={disabled || !caps.canEditBudgets} onChange={(event) => update({ targetMonth: event.target.value })} /></Field> : null}
            <Field label="Название статьи / уточнение"><input value={row.label} maxLength={160} disabled={disabled || !caps.canEditBudgets} onChange={(event) => update({ label: event.target.value })} /></Field>
            <Field label="Примечание"><textarea value={row.notes} maxLength={2000} disabled={disabled || !caps.canEditBudgets} onChange={(event) => update({ notes: event.target.value })} /></Field>
          </div>
          {row.period === 'annual' ? <>
            <label><input type="checkbox" checked={row.monthlyAllocation !== null} disabled={disabled || !caps.canEditBudgets} onChange={(event) => update({ monthlyAllocation: event.target.checked ? Array<string>(12).fill('') : null })} /> Распределить по месяцам</label>
            {row.monthlyAllocation ? <div className={styles.months}>{row.monthlyAllocation.map((amount, month) => <Field key={month} label={['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'][month]}><input type="number" step="0.01" min={0} value={amount} disabled={disabled || !caps.canEditBudgets} onChange={(event) => update({ monthlyAllocation: row.monthlyAllocation!.map((cell, cellIndex) => cellIndex === month ? event.target.value : cell) })} /></Field>)}</div> : null}
          </> : null}
          {caps.canEditBudgets ? <div><Button disabled={disabled} onClick={() => patch({ budgets: value.budgets.filter((_item, itemIndex) => itemIndex !== index) })}>Убрать план по статье</Button></div> : null}
        </section>;
      })}
      {caps.canEditBudgets && value.budgets.length < Object.keys(budgetCategories).length ? <div className={styles.addBudget}>
        <SearchableSelect label="Добавить статью плана" value="" options={Object.entries(budgetCategories).filter(([category]) => !value.budgets.some((row) => row.category === category)).map(([category, label]) => ({ value: category, label }))} disabled={disabled} onChange={(category) => { if (category) patch({ budgets: [...value.budgets, { category: category as SetupBudgetCategory, amount: '', period: 'monthly', monthlyAllocation: null, plannedOccurrences: '', notes: '', targetMonth: '', label: '' }] }); }} />
      </div> : null}
    </section> : null}
  </div>;
}
