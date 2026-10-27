'use client';

import Link from 'next/link';
import React, { useEffect, useId, useMemo, useRef, useState } from 'react';

import {
  addEmployeeAvailability,
  addEmployeeSubstitution,
  deleteEmployeeAvailability,
  getEmployeeAttendance,
  listEmployeeObjectReferences,
  listEmployees,
  updateEmployeeAvailability,
  updateEmployeeSubstitution,
} from '@/entities/employee/api/employee-client';
import {
  EMPLOYEE_SUBSTITUTION_STATUS_OPTIONS,
  getEmployeeShortName,
} from '@/entities/employee/lib/employee-presentation';
import type {
  EmployeeAttendanceMonth,
  EmployeeDetail,
} from '@/entities/employee/model/employee.types';
import { Alert, Badge, Button, Field, IconButton, Surface } from '@/shared/ui/foundation';
import { ChevronLeftIcon, ChevronRightIcon } from '@/shared/ui/icons/icons';
import { WorkspaceTabs } from '@/shared/ui/workspace-tabs/workspace-tabs';
import { DatePicker } from '@/shared/ui/date-picker/date-picker';
import { ConfirmDialog, Dialog } from '@/shared/ui/overlays';
import { OverflowMenu, type OverflowMenuItem } from '@/shared/ui/overflow-menu/overflow-menu';

import {
  WEEKDAY_LABELS,
  buildMonthGrid,
  coversDay,
  currentMonth,
  formatCalendarDay,
  formatMonth,
  formatPeriod,
  shiftMonth,
  toDateKey,
  type MonthCursor,
} from './employee-calendar';
import styles from './employee-workspace.module.css';
import { SelectField } from '@/shared/ui/searchable-select/select-field';
import { Select } from '@/shared/ui/searchable-select/select';

type Substitution = EmployeeDetail['substitutions'][number];
type AvailabilityWindow = EmployeeDetail['availabilityWindows'][number];
type EventKind = 'worked' | 'unavailable' | 'substitution';
type DayEvent = { key: string; kind: EventKind; label: string; title: string };
type BadgeTone = 'neutral' | 'info' | 'success' | 'warning';

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() ? error.message : fallback;
}

function isOpen(substitution: Substitution): boolean {
  return substitution.status === 'planned' || substitution.status === 'active';
}

/** What the person sees; stored status stays untouched until someone acts. */
function substitutionState(substitution: Substitution, now: number): { label: string; tone: BadgeTone } {
  if (substitution.status === 'cancelled') return { label: 'Отменена', tone: 'neutral' };
  if (substitution.status === 'completed') return { label: 'Завершена', tone: 'success' };
  const start = new Date(substitution.startDate).getTime();
  const end = substitution.endDate ? new Date(substitution.endDate).getTime() : null;
  if (end !== null && end < now) return { label: 'Нужно закрыть', tone: 'warning' };
  if (start <= now) return { label: 'Идёт', tone: 'info' };
  return { label: 'Запланирована', tone: 'neutral' };
}

/** Completed records without an end date occupy only their first day. */
function substitutionEnd(substitution: Substitution): string | null {
  if (substitution.endDate) return substitution.endDate;
  return substitution.status === 'completed' ? substitution.startDate : null;
}

function windowIsOngoing(windowItem: AvailabilityWindow, now: number): boolean {
  return !windowItem.endDate || new Date(windowItem.endDate).getTime() > now;
}

export function EmployeeScheduleSection({
  item,
  onItemChange,
}: {
  item: EmployeeDetail;
  onItemChange: (employee: EmployeeDetail) => void;
}): React.JSX.Element {
  const [cursor, setCursor] = useState<MonthCursor>(currentMonth);
  const [attendance, setAttendance] = useState<EmployeeAttendanceMonth | null>(null);
  const [attendanceError, setAttendanceError] = useState<string | null>(null);
  const [isAttendanceLoading, setIsAttendanceLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);
  const [sideTab, setSideTab] = useState<'substitutions' | 'availability'>('substitutions');
  const sideTabsId = useId();
  const [availabilityOpen, setAvailabilityOpen] = useState(false);
  const [substitutionOpen, setSubstitutionOpen] = useState(false);
  const [confirm, setConfirm] = useState<{ title: string; consequence: string; label: string; tone: 'neutral' | 'danger'; run: () => Promise<EmployeeDetail> } | null>(null);
  const [confirmPending, setConfirmPending] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const requestRef = useRef(0);
  const now = Date.now();

  const canManage = (item.capabilities.canManageAvailability || item.capabilities.canManageSubstitutions) && !item.isArchived;

  useEffect(() => {
    const request = ++requestRef.current;
    setIsAttendanceLoading(true);
    setAttendanceError(null);
    void getEmployeeAttendance(item.id, cursor.year, cursor.month)
      .then((response) => { if (request === requestRef.current) setAttendance(response); })
      .catch((error) => {
        if (request === requestRef.current) {
          setAttendance(null);
          setAttendanceError(errorMessage(error, 'Не удалось загрузить выходы.'));
        }
      })
      .finally(() => { if (request === requestRef.current) setIsAttendanceLoading(false); });
  }, [cursor, item.id, reloadKey]);

  const grid = useMemo(() => buildMonthGrid(cursor), [cursor]);
  const substitutions = useMemo(
    () => [...item.substitutions].sort((left, right) => right.startDate.localeCompare(left.startDate)),
    [item.substitutions],
  );
  const windows = useMemo(
    () => [...item.availabilityWindows].sort((left, right) => right.startDate.localeCompare(left.startDate)),
    [item.availabilityWindows],
  );

  const eventsByDay = useMemo(() => {
    const result = new Map<string, DayEvent[]>();
    const workedByDate = new Map((attendance?.days ?? []).map((day) => [day.date, day]));
    for (const day of grid) {
      if (!day.inMonth) continue;
      const events: DayEvent[] = [];
      workedByDate.get(day.key)?.objects.forEach((object) => events.push({
        key: `w-${object.objectId}`,
        kind: 'worked',
        label: object.objectName,
        title: `Выход: ${object.objectName}${object.workedHours ? `, ${object.workedHours} ч` : ''}`,
      }));
      windows
        .filter((windowItem) => windowItem.availabilityStatus === 'unavailable' && coversDay(windowItem.startDate, windowItem.endDate, day.date))
        .forEach((windowItem) => events.push({
          key: `u-${windowItem.id}`,
          kind: 'unavailable',
          label: windowItem.comment?.trim() || 'Недоступна',
          title: `Недоступна${windowItem.comment ? `: ${windowItem.comment}` : ''}`,
        }));
      const seen = new Set<string>();
      substitutions
        .filter((substitution) => substitution.status !== 'cancelled' &&
          coversDay(substitution.startDate, substitutionEnd(substitution), day.date))
        .forEach((substitution) => {
          const dedupe = `${substitution.role}-${substitution.counterpartEmployeeId}`;
          if (seen.has(dedupe)) return;
          seen.add(dedupe);
          const shortName = getEmployeeShortName(substitution.counterpartEmployeeName);
          events.push({
            key: `s-${substitution.id}`,
            kind: 'substitution',
            label: substitution.role === 'primary' ? `Вместо неё: ${shortName}` : `Подменяет: ${shortName}`,
            title: substitution.role === 'primary'
              ? `Выходит вместо: ${substitution.counterpartEmployeeName}${substitution.objectName ? `, ${substitution.objectName}` : ''}`
              : `Подменяет сотрудника ${substitution.counterpartEmployeeName}${substitution.objectName ? `, ${substitution.objectName}` : ''}`,
          });
        });
      if (events.length) result.set(day.key, events);
    }
    return result;
  }, [attendance, grid, substitutions, windows]);

  const monthDays = grid.filter((day) => day.inMonth);
  const countDays = (kind: EventKind): number =>
    monthDays.filter((day) => eventsByDay.get(day.key)?.some((event) => event.kind === kind)).length;
  const needsClosing = substitutions.filter((substitution) => substitutionState(substitution, now).tone === 'warning').length;

  const ask = (next: NonNullable<typeof confirm>): void => {
    setConfirmError(null);
    setConfirm(next);
  };

  const substitutionActions = (substitution: Substitution): OverflowMenuItem[] => {
    if (!item.capabilities.canManageSubstitutions || item.isArchived || !isOpen(substitution)) return [];
    const ended = substitution.endDate && new Date(substitution.endDate).getTime() < now;
    return [
      {
        key: 'complete',
        label: 'Завершить',
        onSelect: () => ask({
          title: 'Завершить подмену?',
          consequence: ended
            ? 'Подмена будет отмечена завершённой с указанной датой окончания.'
            : 'Подмена закончится сейчас и будет отмечена завершённой.',
          label: 'Завершить',
          tone: 'neutral',
          run: () => updateEmployeeSubstitution(item.id, substitution.id, {
            status: 'completed',
            ...(ended ? {} : { endDate: new Date().toISOString() }),
          }),
        }),
      },
      {
        key: 'cancel',
        label: 'Отменить подмену',
        tone: 'danger',
        onSelect: () => ask({
          title: 'Отменить подмену?',
          consequence: 'Подмена останется в истории как отменённая и перестанет показываться в календаре.',
          label: 'Отменить подмену',
          tone: 'danger',
          run: () => updateEmployeeSubstitution(item.id, substitution.id, { status: 'cancelled' }),
        }),
      },
    ];
  };

  const windowActions = (windowItem: AvailabilityWindow): OverflowMenuItem[] => {
    if (!item.capabilities.canManageAvailability || item.isArchived) return [];
    const ongoing = windowIsOngoing(windowItem, now) && new Date(windowItem.startDate).getTime() <= now;
    return [
      ...(ongoing ? [{
        key: 'end',
        label: 'Завершить сегодня',
        onSelect: () => ask({
          title: 'Завершить период сегодня?',
          consequence: 'Период недоступности закончится сегодняшним днём.',
          label: 'Завершить',
          tone: 'neutral' as const,
          run: () => updateEmployeeAvailability(item.id, windowItem.id, {
            endDate: windowItem.availabilityMode === 'full_day' ? toDateKey(new Date()) : new Date().toISOString(),
          }),
        }),
      }] : []),
      {
        key: 'delete',
        label: 'Удалить ошибочную запись',
        tone: 'danger' as const,
        onSelect: () => ask({
          title: 'Удалить период недоступности?',
          consequence: 'Используйте, только если период внесён по ошибке. Запись об удалении сохранится в журнале.',
          label: 'Удалить',
          tone: 'danger',
          run: () => deleteEmployeeAvailability(item.id, windowItem.id),
        }),
      },
    ];
  };

  const eventClass: Record<EventKind, string> = {
    worked: styles.eventWorked!,
    unavailable: styles.eventUnavailable!,
    substitution: styles.eventSubstitution!,
  };
  const swatchClass: Record<EventKind, string> = {
    worked: styles.swatchWorked!,
    unavailable: styles.swatchUnavailable!,
    substitution: styles.swatchSubstitution!,
  };

  return (
    <Surface className={`${styles.section} ${styles.schedule}`} aria-labelledby="employee-schedule-title">
      <div className={styles.scheduleHeader}>
        <div className={styles.monthNav}>
          <h2 id="employee-schedule-title" className={styles.visuallyHidden}>График</h2>
          <IconButton bordered aria-label="Предыдущий месяц" onClick={() => setCursor((value) => shiftMonth(value, -1))}><ChevronLeftIcon /></IconButton>
          <span className={styles.monthTitle} aria-live="polite">{formatMonth(cursor)}</span>
          <IconButton bordered aria-label="Следующий месяц" onClick={() => setCursor((value) => shiftMonth(value, 1))}><ChevronRightIcon /></IconButton>
          <Button size="sm" variant="ghost" onClick={() => setCursor(currentMonth())}>Сегодня</Button>
        </div>
        <ul className={styles.legend} aria-label="Итоги месяца">
          <li><span className={`${styles.swatch} ${styles.swatchWorked}`} aria-hidden="true" />Выходы: <strong>{isAttendanceLoading ? '…' : attendanceError ? '—' : attendance?.days.length ?? 0}</strong></li>
          <li><span className={`${styles.swatch} ${styles.swatchUnavailable}`} aria-hidden="true" />Недоступна: <strong>{countDays('unavailable')}</strong></li>
          <li><span className={`${styles.swatch} ${styles.swatchSubstitution}`} aria-hidden="true" />Подмены: <strong>{countDays('substitution')}</strong></li>
        </ul>
        {canManage ? (
          <div className={styles.sectionActions}>
            {item.capabilities.canManageAvailability ? (
              <Button onClick={() => setAvailabilityOpen(true)}>Отметить недоступность</Button>
            ) : null}
            {item.capabilities.canManageSubstitutions ? (
              <Button variant="primary" onClick={() => setSubstitutionOpen(true)}>Назначить подмену</Button>
            ) : null}
          </div>
        ) : null}
      </div>

      {attendanceError ? (
        <Alert tone="danger" title="Выходы не загрузились"
          action={<Button size="sm" onClick={() => setReloadKey((value) => value + 1)}>Повторить</Button>}>
          {attendanceError}
        </Alert>
      ) : null}

      <div className={styles.scheduleBody}>
        <div className={styles.calendarColumn}>
          <div className={styles.calendar} role="table" aria-label={`Календарь: ${formatMonth(cursor)}`} aria-busy={isAttendanceLoading}>
            <div role="row" className={styles.calendarRow}>
              {WEEKDAY_LABELS.map((weekday) => (
                <div key={weekday} role="columnheader" className={styles.weekday}>{weekday}</div>
              ))}
            </div>
            {Array.from({ length: grid.length / 7 }, (_unused, week) => (
              <div key={week} role="row" className={styles.calendarRow}>
                {grid.slice(week * 7, week * 7 + 7).map((day) => {
                  const events = eventsByDay.get(day.key) ?? [];
                  const kinds = [...new Set(events.map((event) => event.kind))];
                  return (
                    <div
                      key={day.key}
                      role="cell"
                      aria-label={`${formatCalendarDay(day.date)}${events.length ? `: ${events.map((event) => event.title).join('; ')}` : ''}`}
                      className={[
                        styles.day,
                        !day.inMonth && styles.dayOutside,
                        kinds.includes('unavailable') && styles.dayUnavailable,
                      ].filter(Boolean).join(' ')}
                    >
                      <span className={`${styles.dayNumber} ${day.isToday ? styles.dayToday : ''}`} aria-hidden="true">
                        {day.date.getDate()}
                      </span>
                      {events.slice(0, 2).map((event) => (
                        <span key={event.key} className={`${styles.event} ${eventClass[event.kind]}`} title={event.title}>
                          {event.label}
                        </span>
                      ))}
                      {events.length > 2 ? (
                        <span className={styles.moreEvents} title={events.slice(2).map((event) => event.title).join('\n')}>
                          ещё {events.length - 2}
                        </span>
                      ) : null}
                      {kinds.length ? (
                        <span className={styles.dots} aria-hidden="true">
                          {kinds.map((kind) => <span key={kind} className={`${styles.dot} ${swatchClass[kind]}`} />)}
                        </span>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>

          <ul className={`${styles.list} ${styles.dayList}`} aria-label="События месяца">
            {monthDays.filter((day) => eventsByDay.has(day.key)).map((day) => (
              <li key={day.key} className={styles.listRow}>
                <div className={styles.listMain}>
                  <span className={styles.listTitle}>{formatCalendarDay(day.date)}</span>
                  <span className={styles.listMeta}>{eventsByDay.get(day.key)!.map((event) => event.title).join(' · ')}</span>
                </div>
              </li>
            ))}
            {!isAttendanceLoading && !attendanceError && !monthDays.some((day) => eventsByDay.has(day.key)) ? (
              <li className={styles.listEmpty}>В этом месяце событий нет.</li>
            ) : null}
          </ul>
        </div>

        <aside className={styles.sidePanel} aria-label="Подмены и недоступность">
          <div className={styles.sideTabs}>
            <WorkspaceTabs
              idPrefix={sideTabsId}
              label="Подмены и недоступность"
              value={sideTab}
              onChange={(value) => setSideTab(value as typeof sideTab)}
              items={[
                { value: 'substitutions', label: `Подмены (${substitutions.length})` },
                { value: 'availability', label: `Недоступность (${windows.length})` },
              ]}
            />
          </div>
          {sideTab === 'substitutions' && needsClosing ? (
            <p className={styles.sideNotice}>Нужно закрыть: {needsClosing}. Срок прошёл, а подмена ещё открыта.</p>
          ) : null}

          <div className={styles.sideList}>
            <div role="tabpanel" id={`${sideTabsId}-panel-substitutions`} aria-labelledby={`${sideTabsId}-tab-substitutions`} hidden={sideTab !== 'substitutions'} tabIndex={0}>
              {substitutions.length === 0 ? <p className={styles.listEmpty}>Подмен не было.</p> : (
                <ul className={styles.list}>
                  {substitutions.map((substitution) => {
                    const state = substitutionState(substitution, now);
                    return (
                      <li key={substitution.id} className={styles.sideRow}>
                        <div className={styles.listMain}>
                          <span className={styles.sideRowTitle}>
                            <span className={styles.muted}>{substitution.role === 'primary' ? 'Вместо неё' : 'Подменяет'}</span>{' '}
                            <Link href={`/employees/${substitution.counterpartEmployeeId}`}>{substitution.counterpartEmployeeName}</Link>
                          </span>
                          <span className={styles.listMeta}>{formatPeriod(substitution.startDate, substitution.endDate, true)}</span>
                          <span className={styles.listMeta}>
                            {[substitution.objectName, substitution.reason].filter(Boolean).join(' · ')}
                          </span>
                        </div>
                        <div className={styles.sideRowAside}>
                          <Badge className={styles.badge} tone={state.tone}>{state.label}</Badge>
                          <OverflowMenu items={substitutionActions(substitution)} triggerLabel="Действия с подменой" />
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
            <div role="tabpanel" id={`${sideTabsId}-panel-availability`} aria-labelledby={`${sideTabsId}-tab-availability`} hidden={sideTab !== 'availability'} tabIndex={0}>
              {windows.length === 0 ? <p className={styles.listEmpty}>Периодов недоступности нет.</p> : (
                <ul className={styles.list}>
                  {windows.map((windowItem) => (
                    <li key={windowItem.id} className={styles.sideRow}>
                      <div className={styles.listMain}>
                        <span className={styles.sideRowTitle}>
                          {formatPeriod(windowItem.startDate, windowItem.endDate, windowItem.availabilityMode !== 'full_day')}
                        </span>
                        <span className={styles.listMeta}>{windowItem.comment || (windowItem.availabilityMode === 'full_day' ? 'Целые дни' : 'Часть дня')}</span>
                      </div>
                      <div className={styles.sideRowAside}>
                        <Badge className={styles.badge} tone={windowItem.availabilityStatus === 'unavailable' ? 'warning' : 'success'}>
                          {windowItem.availabilityStatus === 'unavailable' ? 'Недоступна' : 'Доступна'}
                        </Badge>
                        <OverflowMenu items={windowActions(windowItem)} triggerLabel="Действия с периодом" />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </aside>
      </div>

      {item.capabilities.canManageAvailability && !item.isArchived ? (
        <AvailabilityDialog
          open={availabilityOpen}
          onOpenChange={setAvailabilityOpen}
          employee={item}
          onSaved={(updated) => { onItemChange(updated); setAvailabilityOpen(false); setSideTab('availability'); }}
        />
      ) : null}
      {item.capabilities.canManageSubstitutions && !item.isArchived ? (
        <SubstitutionDialog
          open={substitutionOpen}
          onOpenChange={setSubstitutionOpen}
          employee={item}
          onSaved={(updated) => { onItemChange(updated); setSubstitutionOpen(false); setSideTab('substitutions'); }}
        />
      ) : null}

      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(open) => { if (!open) setConfirm(null); }}
        title={confirm?.title ?? ''}
        consequence={confirm?.consequence ?? ''}
        confirmLabel={confirm?.label ?? 'Подтвердить'}
        tone={confirm?.tone ?? 'neutral'}
        pending={confirmPending}
        error={confirmError}
        onConfirm={async () => {
          if (!confirm) return;
          setConfirmPending(true);
          setConfirmError(null);
          try {
            onItemChange(await confirm.run());
            setConfirm(null);
          } catch (error) {
            setConfirmError(errorMessage(error, 'Не удалось выполнить действие.'));
          } finally {
            setConfirmPending(false);
          }
        }}
      />
    </Surface>
  );
}

type FieldErrors = Partial<Record<'start' | 'end' | 'substitute' | 'reason', string>>;

function AvailabilityDialog({
  open,
  onOpenChange,
  employee,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  employee: EmployeeDetail;
  onSaved: (employee: EmployeeDetail) => void;
}): React.JSX.Element {
  const formId = useId();
  const empty = { availabilityStatus: 'unavailable', availabilityMode: 'full_day', startDate: '', endDate: '', comment: '' };
  const [form, setForm] = useState(empty);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timed = form.availabilityMode === 'timed';

  useEffect(() => {
    if (open) { setForm(empty); setErrors({}); setError(null); }
    // Reset once per opening.
  }, [open]);

  const validate = (): FieldErrors => {
    const next: FieldErrors = {};
    if (!form.startDate) next.start = 'Укажите дату начала.';
    if (form.endDate && form.startDate && form.endDate < form.startDate) next.end = 'Окончание раньше начала.';
    return next;
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Отметить недоступность"
      description={employee.fullName}
      busy={pending}
      footer={
        <div className={styles.dialogActions}>
          <Button variant="ghost" disabled={pending} onClick={() => onOpenChange(false)}>Отмена</Button>
          <Button type="submit" form={formId} variant="primary" pending={pending} pendingLabel="Сохранение…">Сохранить</Button>
        </div>
      }
    >
      <form
        id={formId}
        className={styles.dialogForm}
        noValidate
        onSubmit={async (event) => {
          event.preventDefault();
          const nextErrors = validate();
          setErrors(nextErrors);
          if (Object.keys(nextErrors).length) return;
          setPending(true);
          setError(null);
          try {
            onSaved(await addEmployeeAvailability(employee.id, {
              startDate: timed ? new Date(form.startDate).toISOString() : form.startDate,
              endDate: form.endDate ? (timed ? new Date(form.endDate).toISOString() : form.endDate) : undefined,
              availabilityMode: form.availabilityMode,
              availabilityStatus: form.availabilityStatus,
              comment: form.comment.trim() || undefined,
            }));
          } catch (caught) {
            setError(errorMessage(caught, 'Не удалось сохранить период.'));
          } finally {
            setPending(false);
          }
        }}
      >
        {error ? <Alert tone="danger" role="alert">{error}</Alert> : null}
        <div className={styles.twoColumns}>
          <div role="radiogroup" aria-label="Состояние">
            <div className={styles.fieldGroupLabel}>Состояние</div>
            <div className={styles.segmented}>
              {[['unavailable', 'Недоступна'], ['available', 'Доступна']].map(([value, label]) => (
                <label key={value}>
                  <input type="radio" name="availabilityStatus" value={value} checked={form.availabilityStatus === value}
                    onChange={() => setForm((current) => ({ ...current, availabilityStatus: value! }))} />
                  {label}
                </label>
              ))}
            </div>
          </div>
          <div role="radiogroup" aria-label="Период">
            <div className={styles.fieldGroupLabel}>Период</div>
            <div className={styles.segmented}>
              {[['full_day', 'Целые дни'], ['timed', 'Часть дня']].map(([value, label]) => (
                <label key={value}>
                  <input type="radio" name="availabilityMode" value={value} checked={form.availabilityMode === value}
                    onChange={() => setForm((current) => ({ ...current, availabilityMode: value!, startDate: '', endDate: '' }))} />
                  {label}
                </label>
              ))}
            </div>
          </div>
        </div>
        <div className={styles.twoColumns}>
          <Field label="С" required error={errors.start}>
            <DatePicker value={form.startDate} withTime={timed}
              onChange={(startDate) => setForm((current) => ({ ...current, startDate }))} />
          </Field>
          <Field label="По" error={errors.end}>
            <DatePicker value={form.endDate} withTime={timed} min={form.startDate || undefined} placeholder="Без окончания"
              defaultTime="18:00" onChange={(endDate) => setForm((current) => ({ ...current, endDate }))} />
          </Field>
        </div>
        <Field label="Причина или комментарий">
          <textarea rows={3} value={form.comment} maxLength={1000} placeholder="Например, больничный или отпуск"
            onChange={(event) => setForm((current) => ({ ...current, comment: event.target.value }))} />
        </Field>
      </form>
    </Dialog>
  );
}

function SubstitutionDialog({
  open,
  onOpenChange,
  employee,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  employee: EmployeeDetail;
  onSaved: (employee: EmployeeDetail) => void;
}): React.JSX.Element {
  const formId = useId();
  const currentObjects = employee.currentObjectAssignments.map((assignment) => ({
    value: assignment.objectId,
    label: assignment.objectName,
  }));
  const empty = {
    substituteEmployeeId: '',
    objectId: currentObjects.length === 1 ? currentObjects[0]!.value : '',
    startDate: '',
    endDate: '',
    status: 'planned',
    reason: '',
    comment: '',
  };
  const [form, setForm] = useState(empty);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) { setForm(empty); setErrors({}); setError(null); }
    // Reset once per opening.
  }, [open]);

  const validate = (): FieldErrors => {
    const next: FieldErrors = {};
    if (!form.substituteEmployeeId) next.substitute = 'Выберите, кто выйдет на подмену.';
    if (!form.startDate) next.start = 'Укажите начало подмены.';
    if (form.endDate && form.startDate && form.endDate < form.startDate) next.end = 'Окончание раньше начала.';
    if (form.reason.trim().length < 2) next.reason = 'Укажите причину.';
    return next;
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Назначить подмену"
      description={`Кто выйдет вместо: ${employee.fullName}. Постоянный состав объекта не меняется.`}
      busy={pending}
      footer={
        <div className={styles.dialogActions}>
          <Button variant="ghost" disabled={pending} onClick={() => onOpenChange(false)}>Отмена</Button>
          <Button type="submit" form={formId} variant="primary" pending={pending} pendingLabel="Сохранение…">Сохранить</Button>
        </div>
      }
    >
      <form
        id={formId}
        className={styles.dialogForm}
        noValidate
        onSubmit={async (event) => {
          event.preventDefault();
          const nextErrors = validate();
          setErrors(nextErrors);
          if (Object.keys(nextErrors).length) return;
          setPending(true);
          setError(null);
          try {
            onSaved(await addEmployeeSubstitution(employee.id, {
              substituteEmployeeId: form.substituteEmployeeId,
              objectId: form.objectId || undefined,
              startDate: new Date(form.startDate).toISOString(),
              endDate: form.endDate ? new Date(form.endDate).toISOString() : undefined,
              status: form.status,
              reason: form.reason.trim(),
              comment: form.comment.trim() || undefined,
            }));
          } catch (caught) {
            setError(errorMessage(caught, 'Не удалось сохранить подмену.'));
          } finally {
            setPending(false);
          }
        }}
      >
        {error ? <Alert tone="danger" role="alert">{error}</Alert> : null}
        <SelectField
          label="Кто подменяет"
          required
          error={errors.substitute}
          value={form.substituteEmployeeId}
          options={[]}
          placeholder="Выберите сотрудника"
          searchPlaceholder="ФИО или телефон"
          minimumSearchLength={2}
          searchPromptText="Введите не менее 2 символов"
          asyncSearch={async (query) =>
            (await listEmployees({ search: query, employmentStatus: 'active', archiveState: 'active', limit: 20 })).items
              .filter((candidate) => candidate.id !== employee.id)
              .map((candidate) => ({
                value: candidate.id,
                label: candidate.fullName,
                description: [candidate.position, candidate.currentObjects[0]?.name].filter(Boolean).join(' · ') || undefined,
              }))}
          onChange={(substituteEmployeeId) => setForm((current) => ({ ...current, substituteEmployeeId }))}
        />
        <SelectField
          label="Объект"
          value={form.objectId}
          options={currentObjects}
          placeholder="Без привязки к объекту"
          asyncSearch={async (query) =>
            (await listEmployeeObjectReferences(query)).map((object) => ({ value: object.id, label: object.name }))}
          onChange={(objectId) => setForm((current) => ({ ...current, objectId }))}
        />
        <div className={styles.twoColumns}>
          <Field label="Начало" required error={errors.start}>
            <DatePicker withTime defaultTime="08:00" value={form.startDate}
              onChange={(startDate) => setForm((current) => ({ ...current, startDate }))} />
          </Field>
          <Field label="Окончание" error={errors.end}>
            <DatePicker withTime defaultTime="20:00" value={form.endDate} min={form.startDate || undefined}
              placeholder="Без окончания" onChange={(endDate) => setForm((current) => ({ ...current, endDate }))} />
          </Field>
        </div>
        <div className={styles.twoColumns}>
          <Field label="Причина" required error={errors.reason}>
            <input value={form.reason} maxLength={300} placeholder="Больничный, отпуск"
              onChange={(event) => setForm((current) => ({ ...current, reason: event.target.value }))} />
          </Field>
          <Field label="Статус">
            <Select value={form.status} onChange={(event) => setForm((current) => ({ ...current, status: event.target.value }))}>
              {EMPLOYEE_SUBSTITUTION_STATUS_OPTIONS.filter((option) => option.value === 'planned' || option.value === 'active').map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label="Комментарий">
          <textarea rows={2} value={form.comment} maxLength={1000}
            onChange={(event) => setForm((current) => ({ ...current, comment: event.target.value }))} />
        </Field>
      </form>
    </Dialog>
  );
}
