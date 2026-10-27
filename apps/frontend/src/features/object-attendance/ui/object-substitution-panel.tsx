'use client';

import React, { useEffect, useState } from 'react';
import { createObjectSubstitution, listObjectCompensationRates, searchEmployeeDirectory, type ObjectCompensationRate } from '@/entities/object/api/object-operations-client';
import type { ObjectEmployeeOption } from '@/entities/object/model/object.types';
import { Button, Field } from '@/shared/ui/foundation';
import { Select } from '@/shared/ui/searchable-select/select';
import { DatePicker } from '@/shared/ui/date-picker/date-picker';
import styles from '@/features/object-shared-ui/object-surfaces.module.css';

export function ObjectSubstitutionPanel({ objectId, employees, operationDate, onSaved }: {
  objectId: string; employees: ObjectEmployeeOption[]; operationDate: string; onSaved: () => Promise<void>;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [directory, setDirectory] = useState<ObjectEmployeeOption[]>([]);
  const [rates, setRates] = useState<ObjectCompensationRate[]>([]);
  const [employeeId, setEmployeeId] = useState('');
  const [substituteEmployeeId, setSubstituteEmployeeId] = useState('');
  const [rateOptionId, setRateOptionId] = useState('');
  const [startDate, setStartDate] = useState(operationDate);
  const [endDate, setEndDate] = useState(operationDate);
  const [reason, setReason] = useState('');
  const [pending, setPending] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    const timer = setTimeout(() => {
      void Promise.all([searchEmployeeDirectory(objectId, search), listObjectCompensationRates(objectId)])
        .then(([people, options]) => { if (!cancelled) { setDirectory(people); setRates(options.filter((option) => option.category === 'substitution' && option.isActive)); setError(null); } })
        .catch(() => { if (!cancelled) setError('Не удалось загрузить сотрудников и ставки.'); })
        .finally(() => { if (!cancelled) setLoading(false); });
    }, 300);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [open, objectId, search]);

  const save = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setPending(true); setError(null);
    try {
      await createObjectSubstitution(objectId, { employeeId, substituteEmployeeId, ...(rateOptionId ? { rateOptionId } : {}), startDate, ...(endDate ? { endDate } : {}), reason: reason.trim() });
      await onSaved();
      setOpen(false); setEmployeeId(''); setSubstituteEmployeeId(''); setReason('');
    } catch (caughtError) { setError(caughtError instanceof Error ? caughtError.message : 'Не удалось назначить подмену.'); }
    finally { setPending(false); }
  };

  return <div>
    <Button type="button" disabled={pending} onClick={() => setOpen((value) => !value)}>{open ? 'Скрыть подмену' : 'Назначить подмену'}</Button>
    {open ? <form className={styles.panelForm} onSubmit={save}>
      <Field label="Кого заменить" required><Select value={employeeId} onChange={(event) => setEmployeeId(event.target.value)} required disabled={pending}>
        <option value="">Выберите сотрудника объекта</option>
        {employees.filter((employee) => employee.isAssignedToObject).map((employee) => <option key={employee.id} value={employee.id}>{employee.fullName}</option>)}
      </Select></Field>
      <Field label="Поиск заменяющего"><input value={search} onChange={(event) => { setSearch(event.target.value); setSubstituteEmployeeId(''); }} disabled={pending} /></Field>
      <Field label="Заменяющий сотрудник" required><Select value={substituteEmployeeId} onChange={(event) => setSubstituteEmployeeId(event.target.value)} required disabled={pending || loading}>
        <option value="">{loading ? 'Загрузка…' : 'Выберите сотрудника'}</option>
        {directory.filter((employee) => employee.id !== employeeId).map((employee) => <option key={employee.id} value={employee.id}>{employee.fullName}</option>)}
      </Select></Field>
      <Field label="Ставка подмены"><Select value={rateOptionId} onChange={(event) => setRateOptionId(event.target.value)} disabled={pending || loading}>
        <option value="">По действующим правилам объекта</option>
        {rates.map((rate) => <option key={rate.id} value={rate.id}>{rate.name} · {rate.baseAmount.toLocaleString('ru-RU')} ₽{rate.ratePolicyType === 'monthly_fixed' ? ' / месяц' : ' / выход'}</option>)}
      </Select></Field>
      <Field label="Начало" required><DatePicker value={startDate} onChange={setStartDate} required disabled={pending} /></Field>
      <Field label="Окончание"><DatePicker value={endDate} onChange={setEndDate} min={startDate} disabled={pending} /></Field>
      <Field label="Причина" required><input value={reason} onChange={(event) => setReason(event.target.value)} minLength={2} maxLength={1000} required disabled={pending} /></Field>
      {error ? <div className={styles.error} role="alert">{error}</div> : null}
      <Button type="submit" disabled={pending || loading || !!error || !employeeId || !substituteEmployeeId || !startDate || reason.trim().length < 2}>{pending ? 'Назначаем…' : 'Сохранить подмену'}</Button>
    </form> : null}
  </div>;
}
