'use client';

import React, { useRef, useState } from 'react';

import { Alert, Button, Field } from '@/shared/ui/foundation';
import { DatePicker } from '@/shared/ui/date-picker/date-picker';
import { SearchableSelect, type SearchableSelectOption } from '@/shared/ui/searchable-select/searchable-select';
import { Select } from '@/shared/ui/searchable-select/select';
import { applyPreset, schedulePresets, type PositionDraft } from '../model/schedule-draft';
import styles from './object-scheduling.module.css';

interface PositionEditorProps {
  value: PositionDraft;
  onChange: (value: PositionDraft) => void;
  disabled?: boolean;
  canAssignEmployees: boolean;
  employeeAccessMessage?: string;
  searchEmployees: (query: string) => Promise<SearchableSelectOption[]>;
  contours?: { value: string; label: string }[];
  canSelectPayConditions?: boolean;
}

export function PositionEditor({ value, onChange, disabled = false, canAssignEmployees, employeeAccessMessage, searchEmployees, contours = [], canSelectPayConditions = false }: PositionEditorProps): React.JSX.Element {
  const [employeeError, setEmployeeError] = useState<string | null>(null);
  const employeeOptions = useRef(new Map<string, SearchableSelectOption>());
  const contourIds = new Set(value.groups.flatMap((group) => group.intervals.map((interval) => interval.contourId ?? '')));
  const positionContour = contourIds.size > 1 ? '__mixed__' : [...contourIds][0] ?? '';
  const patch = (next: Partial<PositionDraft>): void => onChange({ ...value, ...next });
  const changeGroup = (key: string, next: Partial<PositionDraft['groups'][number]>): void => patch({
    groups: value.groups.map((group) => group.key === key ? { ...group, ...next } : group),
  });
  return (
    <div className={styles.editor}>
      <div className={styles.grid}>
        <Field label="Название позиции" required>
          <input value={value.name} maxLength={200} disabled={disabled} onChange={(event) => patch({ name: event.target.value })} placeholder="Например, уборщик территории" />
        </Field>
        <Field label="Условия оплаты позиции" description="Например: «Уборщица» → «Уборка». Выбор применяется ко всем интервалам. Отдельные дневные и ночные условия можно уточнить ниже.">
          <Select value={positionContour} disabled={disabled || !canSelectPayConditions} onChange={(event) => {
            if (event.target.value === '__mixed__') return;
            const contourId = event.target.value || null;
            patch({ intervals: value.intervals.map((interval) => ({ ...interval, contourId })), groups: value.groups.map((group) => ({ ...group, intervals: group.intervals.map((interval) => ({ ...interval, contourId })) })) });
          }}>
            <option value="">Оплата объекта / сотрудника</option>
            {positionContour === '__mixed__' ? <option value="__mixed__">Разные условия по интервалам</option> : null}
            {positionContour && positionContour !== '__mixed__' && !contours.some((contour) => contour.value === positionContour) ? <option value={positionContour}>Сохранённые условия</option> : null}
            {contours.map((contour) => <option key={contour.value} value={contour.value}>{contour.label}</option>)}
          </Select>
        </Field>
        <Field label="Количество мест" description="Необязательно. Пустое поле — численность не задана.">
          <input type="number" min={0} max={10000} step={1} value={value.headcount} disabled={disabled} onChange={(event) => patch({ headcount: event.target.value })} />
        </Field>
        <Field label="Нужно одновременно на смене" description="Отдельно от общего штата. Если не задано, сервер использует потребность в одном сотруднике.">
          <input type="number" min={1} max={10000} step={1} value={value.requiredPerShift} disabled={disabled} onChange={(event) => patch({ requiredPerShift: event.target.value })} />
        </Field>
        <Field label="Шаблон графика">
          <Select value={value.preset} disabled={disabled} onChange={(event) => onChange(applyPreset(value, event.target.value))}>
            {schedulePresets.map((preset) => <option key={preset.value} value={preset.value}>{preset.label}</option>)}
          </Select>
        </Field>
        <Field label="Действует с" description="Дата начала действия новой версии.">
          <DatePicker value={value.effectiveDate} disabled={disabled} onChange={(effectiveDate) => patch({ effectiveDate })} />
        </Field>
      </div>
      {value.preset === 'weekly' ? (
        <div className={styles.cycle} aria-label="Рабочие дни недели">
          {['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map((day, index) => (
            <label key={day}><input type="checkbox" checked={value.weekdays.includes(index + 1)} disabled={disabled} onChange={(event) => patch({ weekdays: event.target.checked ? [...value.weekdays, index + 1].sort() : value.weekdays.filter((item) => item !== index + 1) })} /> {day}</label>
          ))}
        </div>
      ) : (
        <div className={styles.section}>
          <Field label="Начало цикла" description="Без даты график сохраняется как шаблон. Календарные даты не определяются.">
            <DatePicker value={value.anchorDate} disabled={disabled} onChange={(anchorDate) => patch({ anchorDate })} />
          </Field>
          <div className={styles.cycle} aria-label="Последовательность цикла">
            {value.cycle.map((working, index) => <Button key={index} size="sm" disabled={disabled} aria-pressed={working} onClick={() => patch({ preset: 'custom', cycle: value.cycle.map((day, dayIndex) => dayIndex === index ? !day : day) })}>
              {index + 1}: {working ? 'Работа' : 'Отдых'}
            </Button>)}
          </div>
          <div className="ui-inline">
            <Button disabled={disabled || value.cycle.length >= 366} onClick={() => patch({ preset: 'custom', cycle: [...value.cycle, true] })}>Добавить день цикла</Button>
            <Button disabled={disabled || value.cycle.length <= 1} onClick={() => patch({ preset: 'custom', cycle: value.cycle.slice(0, -1) })}>Убрать последний день</Button>
          </div>
        </div>
      )}
      {value.groups.length === 0 ? <Alert tone="info">Добавьте группу ротации, чтобы задать интервалы работы и сотрудников.</Alert> : null}
      <section className={styles.section} aria-label="Группы ротации">
        <h3 className="ui-section-title">Группы ротации</h3>
        <p className="ui-text-muted">Число групп не задаёт численность и не создаёт выходы. Покрытие проверяется серверным предпросмотром.</p>
        {!canAssignEmployees ? <Alert tone="info">{employeeAccessMessage ?? 'Выбор сотрудников недоступен с текущими правами.'}</Alert> : null}
        {employeeError ? <Alert tone="danger">{employeeError}</Alert> : null}
        {value.groups.map((group, groupIndex) => <section key={group.key} className={styles.section} aria-label={`Группа ${groupIndex + 1}`}>
          <div className={styles.grid}>
            <Field label="Название группы"><input value={group.name} disabled={disabled} onChange={(event) => changeGroup(group.key, { name: event.target.value })} /></Field>
            <Field label="Сдвиг, дней" description="Фаза относительно начала цикла."><input type="number" min={-3660} max={3660} step={1} value={group.offset} disabled={disabled || value.preset === 'weekly'} onChange={(event) => changeGroup(group.key, { offset: event.target.value })} /></Field>
          </div>
          <GroupIntervals value={group.intervals} disabled={disabled} contours={contours} canSelectPayConditions={canSelectPayConditions} onChange={(intervals) => changeGroup(group.key, { intervals })} />
          {group.assignments.map((assignment, assignmentIndex) => <div key={`${assignment.employeeId}-${assignmentIndex}`} className={styles.employee}>
            <strong>{assignment.employeeName}</strong>
            <div className={styles.grid}>
              <Field label="Назначен с"><DatePicker value={assignment.startDate} disabled={disabled || !canAssignEmployees} onChange={(startDate) => changeGroup(group.key, { assignments: group.assignments.map((item, index) => index === assignmentIndex ? { ...item, startDate } : item) })} /></Field>
              <Field label="Назначен по" description="Пусто — без даты окончания."><DatePicker value={assignment.endDate} disabled={disabled || !canAssignEmployees} onChange={(endDate) => changeGroup(group.key, { assignments: group.assignments.map((item, index) => index === assignmentIndex ? { ...item, endDate } : item) })} /></Field>
            </div>
            <div><Button disabled={disabled || !canAssignEmployees} onClick={() => changeGroup(group.key, { assignments: group.assignments.filter((_item, index) => index !== assignmentIndex) })}>Убрать назначение</Button></div>
          </div>)}
          {canAssignEmployees ? <SearchableSelect
            label={`Добавить сотрудника в ${group.name || `группу ${groupIndex + 1}`}`}
            value="" options={[]} disabled={disabled} viewportAware
            placeholder="Выберите сотрудника" emptyText="Доступные сотрудники не найдены"
            asyncSearch={async (query) => {
              setEmployeeError(null);
              try {
                const options = await searchEmployees(query);
                options.forEach((option) => employeeOptions.current.set(option.value, option));
                return options.filter((option) => !group.assignments.some((assignment) => assignment.employeeId === option.value));
              }
              catch (error) { setEmployeeError(error instanceof Error ? error.message : 'Не удалось загрузить сотрудников.'); throw error; }
            }}
            onChange={(employeeId) => {
              const option = employeeOptions.current.get(employeeId);
              if (!employeeId || !option || group.assignments.some((item) => item.employeeId === employeeId)) return;
              changeGroup(group.key, { assignments: [...group.assignments, { employeeId, employeeName: option.label, startDate: '', endDate: '' }] });
            }}
          /> : null}
          <div><Button disabled={disabled || value.groups.length <= 1 || (!canAssignEmployees && group.assignments.length > 0)} onClick={() => patch({ groups: value.groups.filter((item) => item.key !== group.key) })}>Убрать группу {groupIndex + 1}</Button></div>
        </section>)}
        <div><Button disabled={disabled || value.groups.length >= 32} onClick={() => patch({ groups: [...value.groups, { key: crypto.randomUUID(), name: `Группа ${value.groups.length + 1}`, offset: '0', assignments: [], intervals: value.intervals.map((interval) => ({ ...interval, key: crypto.randomUUID() })) }] })}>Добавить группу</Button></div>
      </section>
      <Alert tone="info">Группа ротации не является контуром оплаты. Один сотрудник в одном контуре получает оплату за выход один раз в день. Явно заданные отдельные дневной и ночной контуры суммируются в дневной ячейке. Месячная оплата рассчитывается по прежней формуле и не умножается на число смен или групп. Сохранение графика не подтверждает присутствие и не создаёт выплату.</Alert>
    </div>
  );
}

function GroupIntervals({ value, disabled, onChange, contours, canSelectPayConditions }: { value: PositionDraft['intervals']; disabled: boolean; onChange: (value: PositionDraft['intervals']) => void; contours: { value: string; label: string }[]; canSelectPayConditions: boolean }): React.JSX.Element {
  return <div className={styles.section}>
    <h4 className="ui-section-title">Интервалы группы · Москва</h4>
    {value.map((interval, index) => <div className={styles.interval} key={interval.key}>
      <Field label={`Интервал ${index + 1}: начало`}><input value={interval.start} placeholder="09:00" pattern="([01][0-9]|2[0-3]):[0-5][0-9]" disabled={disabled} onChange={(event) => onChange(value.map((item, itemIndex) => itemIndex === index ? { ...item, start: event.target.value } : item))} /></Field>
      <Field label="Окончание"><input value={interval.end} placeholder="18:00" pattern="([01][0-9]|2[0-3]):[0-5][0-9]" disabled={disabled} onChange={(event) => onChange(value.map((item, itemIndex) => itemIndex === index ? { ...item, end: event.target.value } : item))} /></Field>
      <label><input type="checkbox" checked={interval.nextDay} disabled={disabled} onChange={(event) => onChange(value.map((item, itemIndex) => itemIndex === index ? { ...item, nextDay: event.target.checked } : item))} /> Окончание на следующий день</label>
      <Button disabled={disabled || value.length <= 1} onClick={() => onChange(value.filter((_item, itemIndex) => itemIndex !== index))}>Убрать интервал {index + 1}</Button>
      <p className="ui-text-muted">{interval.contourId ? 'Выбраны отдельные условия оплаты. Выбор готовых условий не разрешает менять ставки.' : 'Оплата по действующим условиям сотрудника и объекта.'}</p>
      <Field label="Условия оплаты интервала"><Select value={interval.contourId ?? ''} disabled={disabled || !canSelectPayConditions} onChange={(event) => onChange(value.map((item, itemIndex) => itemIndex === index ? { ...item, contourId: event.target.value || null } : item))}>
        <option value="">Оплата объекта / сотрудника</option>
        {interval.contourId && !contours.some((contour) => contour.value === interval.contourId) ? <option value={interval.contourId}>Сохранённый контур</option> : null}
        {contours.map((contour) => <option key={contour.value} value={contour.value}>{contour.label}</option>)}
      </Select></Field>
    </div>)}
    <div><Button disabled={disabled || value.length >= 12} onClick={() => onChange([...value, { key: crypto.randomUUID(), start: '09:00', end: '18:00', nextDay: false, contourId: null }])}>Добавить интервал</Button></div>
  </div>;
}
