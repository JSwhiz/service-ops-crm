'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import React, { useCallback, useEffect, useRef, useState } from 'react';

import {
  approveOneTimeManagerAvailability,
  cancelOneTimeManagerAvailability,
  createDirectOneTimeManagerAvailability,
  createOwnOneTimeManagerAvailability,
  downloadOneTimeOrderCalendarExcel,
  getOneTimeOrderCalendar,
  listOneTimeOrderCalendarManagers,
  rejectOneTimeManagerAvailability,
  updateOneTimeManagerAvailability,
} from '@/entities/one-time-order/api/one-time-order-client';
import type {
  OneTimeOrderAvailabilityType,
  OneTimeOrderCalendarAvailability,
  OneTimeOrderCalendarDay,
  OneTimeOrderCalendarManager,
  OneTimeOrderCalendarResponse,
} from '@/entities/one-time-order/model/one-time-order.types';
import type { SystemUserOption } from '@/entities/user/model/user.types';
import { useAuth } from '@/shared/auth/use-auth';
import { useAccessRevision } from '@/shared/auth/use-access-revision';
import { AccessSnapshotBoundary } from '@/shared/auth/access-snapshot-boundary';
import { getAccessGeneration, isAccessGenerationCurrent } from '@/shared/auth/access-generation';
import { getUserDisplayName } from '@/shared/lib/display-name';
import { getOneTimeOrderStatusLabel } from '@/shared/lib/one-time-order-presentation';
import { MonthPeriodPicker } from '@/shared/ui/month-period-picker/month-period-picker';
import { SearchableSelect } from '@/shared/ui/searchable-select/searchable-select';
import { DatePicker } from '@/shared/ui/date-picker/date-picker';
import { Button, Surface } from '@/shared/ui/foundation';
import { Select } from '@/shared/ui/searchable-select/select';
import { PlusIcon } from '@/shared/ui/icons/icons';
import { CreateNavigationLink } from '@/shared/create-navigation';
import { useConfirm } from '@/shared/ui/overlays';
import calendarStyles from '@/features/one-time-order-calendar/ui/one-time-order-calendar.module.css';
import { PersonName } from '@/shared/ui/person-presentation/person-presentation';

const AVAILABILITY_OPTIONS: Array<{
  value: OneTimeOrderAvailabilityType;
  label: string;
}> = [
  { value: 'day_off', label: 'Выходной' },
  { value: 'vacation', label: 'Отпуск' },
  { value: 'sick_leave', label: 'Больничный' },
];

interface SelectedDay {
  manager: OneTimeOrderCalendarManager;
  day: OneTimeOrderCalendarDay;
}

interface AvailabilityFormState {
  mode: 'own' | 'direct' | 'edit';
  availabilityId?: string;
  userId: string;
  entryType: OneTimeOrderAvailabilityType;
  startDate: string;
  endDate: string;
  comment: string;
}

function getMoscowDateParts(): { year: string; month: string; day: string } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Moscow',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const value = (type: string): string =>
    parts.find((part) => part.type === type)?.value ?? '';

  return {
    year: value('year'),
    month: value('month'),
    day: value('day'),
  };
}

function getCurrentMonth(): string {
  const { year, month } = getMoscowDateParts();
  return `${year}-${month}`;
}

function getTodayDate(): string {
  const { year, month, day } = getMoscowDateParts();
  return `${year}-${month}-${day}`;
}

function normalizeMonth(value: string | null): string {
  return value && /^\d{4}-\d{2}$/.test(value) ? value : getCurrentMonth();
}

function formatDate(value: string, options?: Intl.DateTimeFormatOptions): string {
  const [year, month, day] = value.split('-').map(Number);
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone: 'UTC',
    ...(options ?? { day: '2-digit', month: '2-digit', year: 'numeric' }),
  }).format(new Date(Date.UTC(year!, month! - 1, day!)));
}

function isWeekend(value: string): boolean {
  const [year, month, day] = value.split('-').map(Number);
  const weekday = new Date(Date.UTC(year!, month! - 1, day!)).getUTCDay();
  return weekday === 0 || weekday === 6;
}

function availabilityLabel(type: string): string {
  return AVAILABILITY_OPTIONS.find((option) => option.value === type)?.label ?? type;
}

function conflictLabel(level: OneTimeOrderCalendarDay['conflictLevel']): string | null {
  if (level === 'multiple_orders_and_availability') {
    return 'Несколько заказов + отсутствие';
  }
  if (level === 'multiple_orders') return 'Несколько заказов';
  if (level === 'approved_availability') return 'Заказ во время отсутствия';
  return null;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error && error.message.trim()
    ? error.message
    : 'Не удалось выполнить действие.';
}

export function OneTimeOrderCalendar(): React.JSX.Element {
  const { user } = useAuth();
  const accessRevision = useAccessRevision();
  const [confirm, confirmDialog] = useConfirm();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const month = normalizeMonth(searchParams.get('month'));
  const requestedManagerUserId = searchParams.get('managerUserId') ?? '';
  const canView = user?.capabilities?.canViewOneTimeOrderCalendar ?? false;
  const canCreateOrder = user?.capabilities?.canCreateOneTimeOrder ?? false;
  // The endpoint resolves its own default scope. A /me decision about the actor
  // is not a decision about the requested manager.
  const managerUserId = requestedManagerUserId;
  const snapshotKey = JSON.stringify([accessRevision, month, managerUserId]);
  const snapshotKeyRef = useRef(snapshotKey);
  snapshotKeyRef.current = snapshotKey;
  const requestRef = useRef(0);
  const [loadedSnapshotKey, setLoadedSnapshotKey] = useState<string | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [confirmationTarget, setConfirmationTarget] = useState<{ id: string; scope: string } | null>(null);
  const [calendar, setCalendar] = useState<OneTimeOrderCalendarResponse | null>(null);
  const [managerOptions, setManagerOptions] = useState<SystemUserOption[]>([]);
  const [selectedDay, setSelectedDay] = useState<SelectedDay | null>(null);
  const [availabilityForm, setAvailabilityForm] =
    useState<AvailabilityFormState | null>(null);
  const [decisionComment, setDecisionComment] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const calendarRootRef = useRef<HTMLDivElement | null>(null);
  const lastTodayScrollKeyRef = useRef<string | null>(null);
  const snapshotFresh = canView && loadedSnapshotKey === snapshotKey && !readError;
  const directTargets = calendar?.availabilityTargets?.filter(target => target.capabilities.canCreateAvailability) ?? [];
  const canManageOwn = snapshotFresh && calendar?.capabilities?.canRequestOwnAvailability === true;
  const canManageAny = snapshotFresh && directTargets.length > 0;
  const selectedManager = calendar?.managers.find(manager => manager.user.id === selectedDay?.manager.user.id);
  const selectedCalendarDay = selectedManager?.days.find(day => day.date === selectedDay?.day.date);
  const currentSelectedDay = selectedManager && selectedCalendarDay ? { manager: selectedManager, day: selectedCalendarDay } : null;
  const findAvailability = (id?: string) => calendar?.managers.flatMap(manager => manager.days.flatMap(day =>
    [day.availability, ...day.pendingRequests].filter((entry): entry is OneTimeOrderCalendarAvailability => !!entry),
  )).find(entry => entry.id === id);
  const formAllowed = snapshotFresh && !!availabilityForm && (availabilityForm.mode === 'own'
    ? canManageOwn && availabilityForm.userId === user?.id
    : availabilityForm.mode === 'direct'
      ? directTargets.some(target => target.user.id === availabilityForm.userId)
      : findAvailability(availabilityForm.availabilityId)?.capabilities?.canEdit === true);
  const confirmationAllowed = snapshotFresh && confirmationTarget?.scope === snapshotKey &&
    findAvailability(confirmationTarget.id)?.capabilities?.canCancel === true;

  const scrollTodayIntoView = (): void => {
    window.requestAnimationFrame(() => {
      const root = calendarRootRef.current;
      const grid = root?.querySelector<HTMLElement>(`.${calendarStyles.oneTimeCalendarGridShell}`);
      const desktopToday = grid?.querySelector<HTMLElement>('[data-today="true"]');
      if (grid && desktopToday && grid.clientWidth > 0 && grid.getClientRects().length > 0) {
        grid.scrollLeft = Math.max(
          0,
          desktopToday.offsetLeft - grid.clientWidth / 2 + desktopToday.clientWidth / 2,
        );
        return;
      }
      root
        ?.querySelector<HTMLElement>(`.${calendarStyles.oneTimeCalendarMobile} [data-today="true"]`)
        ?.scrollIntoView({ block: 'center', behavior: 'auto' });
    });
  };

  const replaceQuery = (nextMonth: string, nextManagerId = managerUserId): void => {
    const query = new URLSearchParams();
    query.set('month', nextMonth);
    if (nextManagerId) query.set('managerUserId', nextManagerId);
    router.replace(`${pathname}?${query.toString()}`, { scroll: false });
  };

  const loadCalendar = useCallback(async (): Promise<void> => {
    if (snapshotKeyRef.current !== snapshotKey) return;
    const requestId = ++requestRef.current;
    setIsLoading(true);
    setReadError(null);
    setError(null);
    setLoadedSnapshotKey(null);
    try {
      const response = await getOneTimeOrderCalendar({
        month,
        managerUserId: managerUserId || undefined,
      });
      if (requestId !== requestRef.current || snapshotKeyRef.current !== snapshotKey) return;
      setCalendar(response);
      setLoadedSnapshotKey(snapshotKey);
    } catch (loadError) {
      if (requestId === requestRef.current && snapshotKeyRef.current === snapshotKey) setReadError(getErrorMessage(loadError));
    } finally {
      if (requestId === requestRef.current && snapshotKeyRef.current === snapshotKey) setIsLoading(false);
    }
  }, [month, managerUserId, snapshotKey]);

  useEffect(() => {
    if (!canView) {
      setIsLoading(false);
      return;
    }
    void loadCalendar();
    return () => { requestRef.current += 1; };
  }, [canView, loadCalendar]);

  useEffect(() => {
    if (!canView) return;
    let cancelled = false;
    setManagerOptions([]);
    void listOneTimeOrderCalendarManagers()
      .then((items) => { if (!cancelled)
        setManagerOptions(
          items.map((item) => ({
            ...item,
            roleCode: '',
            roleCodes: [],
            isActive: true,
          })),
        );
      })
      .catch(() => { if (!cancelled) setManagerOptions([]); });
    return () => { cancelled = true; };
  }, [canView, accessRevision]);

  useEffect(() => {
    if (!calendar || month !== getCurrentMonth()) {
      if (month !== getCurrentMonth()) lastTodayScrollKeyRef.current = null;
      return;
    }
    const key = `${month}:${managerUserId}`;
    if (lastTodayScrollKeyRef.current === key) return;
    lastTodayScrollKeyRef.current = key;
    scrollTodayIntoView();
  }, [calendar, managerUserId, month]);

  const openAvailabilityForm = (
    mode: AvailabilityFormState['mode'],
    params?: {
      date?: string;
      managerId?: string;
      availability?: OneTimeOrderCalendarAvailability;
    },
  ): void => {
    if (!snapshotFresh || isSubmitting) return;
    const availability = params?.availability;
    const targetId = mode === 'own' ? user?.id ?? '' : params?.managerId ?? directTargets[0]?.user.id ?? '';
    if (mode === 'own' ? !canManageOwn
      : mode === 'direct' ? !directTargets.some(target => target.user.id === targetId)
        : !availability || !findAvailability(availability.id)?.capabilities?.canEdit) return;
    const date = params?.date ?? getTodayDate();
    setAvailabilityForm({
      mode,
      availabilityId: availability?.id,
      userId: targetId,
      entryType: availability?.entryType ?? 'day_off',
      startDate: availability?.startDate ?? date,
      endDate: availability?.endDate ?? date,
      comment: availability?.comment ?? '',
    });
    setError(null);
  };

  const submitAvailability = async (
    event: React.FormEvent<HTMLFormElement>,
  ): Promise<void> => {
    event.preventDefault();
    if (!availabilityForm || !formAllowed || isSubmitting) return;
    const generation = getAccessGeneration();
    const mutationScope = snapshotKey;
    setIsSubmitting(true);
    setError(null);
    try {
      const payload = {
        entryType: availabilityForm.entryType,
        startDate: availabilityForm.startDate,
        endDate: availabilityForm.endDate,
        comment: availabilityForm.comment || undefined,
      };
      if (availabilityForm.mode === 'own') {
        await createOwnOneTimeManagerAvailability(payload);
      } else if (availabilityForm.mode === 'direct') {
        await createDirectOneTimeManagerAvailability({
          ...payload,
          userId: availabilityForm.userId,
        });
      } else if (availabilityForm.availabilityId) {
        await updateOneTimeManagerAvailability(
          availabilityForm.availabilityId,
          payload,
        );
      }
      if (!isAccessGenerationCurrent(generation) || snapshotKeyRef.current !== mutationScope) return;
      setAvailabilityForm(null);
      setSelectedDay(null);
      await loadCalendar();
    } catch (submitError) {
      if (isAccessGenerationCurrent(generation) && snapshotKeyRef.current === mutationScope) setError(getErrorMessage(submitError));
    } finally {
      setIsSubmitting(false);
    }
  };

  const resolvePending = async (
    decision: 'approve' | 'reject',
    pending: OneTimeOrderCalendarAvailability,
  ): Promise<void> => {
    const current = findAvailability(pending.id);
    if (!snapshotFresh || isSubmitting || !(decision === 'approve' ? current?.capabilities?.canApprove : current?.capabilities?.canReject)) return;
    const generation = getAccessGeneration();
    const mutationScope = snapshotKey;
    if (decision === 'reject' && !decisionComment.trim()) {
      setError('Для отклонения укажите причину.');
      return;
    }
    setIsSubmitting(true);
    setError(null);
    try {
      if (decision === 'approve') {
        await approveOneTimeManagerAvailability(
          pending.id,
          decisionComment.trim() || undefined,
        );
      } else {
        await rejectOneTimeManagerAvailability(pending.id, decisionComment.trim());
      }
      if (!isAccessGenerationCurrent(generation) || snapshotKeyRef.current !== mutationScope) return;
      setSelectedDay(null);
      setDecisionComment('');
      await loadCalendar();
    } catch (resolveError) {
      if (isAccessGenerationCurrent(generation) && snapshotKeyRef.current === mutationScope) setError(getErrorMessage(resolveError));
    } finally {
      setIsSubmitting(false);
    }
  };

  const cancelAvailability = async (
    availability: OneTimeOrderCalendarAvailability,
  ): Promise<void> => {
    if (!snapshotFresh || isSubmitting || !findAvailability(availability.id)?.capabilities?.canCancel) return;
    const generation = getAccessGeneration();
    const confirmationScope = snapshotKey;
    setConfirmationTarget({ id: availability.id, scope: confirmationScope });
    if (!(await confirm({
      title: `Отменить запись «${availabilityLabel(availability.entryType)}»?`,
      consequence: 'Запись пропадёт из календаря менеджера.',
      confirmLabel: 'Отменить запись',
      tone: 'danger',
    }))) {
      return;
    }
    if (!isAccessGenerationCurrent(generation) || snapshotKeyRef.current !== confirmationScope) return;
    setIsSubmitting(true);
    setError(null);
    try {
      await cancelOneTimeManagerAvailability(availability.id);
      if (!isAccessGenerationCurrent(generation) || snapshotKeyRef.current !== confirmationScope) return;
      setSelectedDay(null);
      await loadCalendar();
    } catch (cancelError) {
      if (isAccessGenerationCurrent(generation) && snapshotKeyRef.current === confirmationScope) setError(getErrorMessage(cancelError));
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!canView) {
    return <Surface padding="md">У вас нет доступа к календарю разовых заказов.</Surface>;
  }

  const today = getTodayDate();
  const mobileManager =
    calendar?.managers.find((manager) => manager.user.id === managerUserId) ??
    calendar?.managers[0] ??
    null;
  const availableManagers =
    managerOptions.length > 0
      ? managerOptions
      : calendar?.managers.map((manager) => ({
          ...manager.user,
          roleCode: '',
          roleCodes: [],
          isActive: manager.isActive,
        })) ?? [];

  return (
    <div className={calendarStyles.oneTimeCalendar} ref={calendarRootRef}>
      {!snapshotFresh ? <Surface padding="md" role={readError ? 'alert' : 'status'}>
        {readError || 'Проверяем доступ к календарю…'}
        {readError ? <Button onClick={() => void loadCalendar()}>Повторить проверку доступа</Button> : null}
      </Surface> : null}
      <AccessSnapshotBoundary blocked={!snapshotFresh}>
      <AccessSnapshotBoundary blocked={!confirmationAllowed}>{confirmDialog}</AccessSnapshotBoundary>
      <Surface padding="md" className={`filter-panel ${calendarStyles.oneTimeCalendarToolbar}`}>
        <div className={calendarStyles.oneTimeCalendarMonthNav}>
          <MonthPeriodPicker
            year={Number(month.slice(0, 4))}
            month={Number(month.slice(5, 7))}
            onChange={(year, nextMonth) =>
              replaceQuery(
                `${year}-${String(nextMonth).padStart(2, '0')}`,
              )
            }
          />
        </div>
        <div className={calendarStyles.oneTimeCalendarManagerFilter}>
          <SearchableSelect
            label="Чей календарь"
            value={managerUserId}
            options={availableManagers.map((manager) => ({
              value: manager.id,
              label: getUserDisplayName(manager),
              searchText: manager.login,
            }))}
            onChange={(value) => replaceQuery(month, value)}
            clearable
            placeholder="Доступный календарь"
            asyncSearch={async (search) =>
              (await listOneTimeOrderCalendarManagers(search)).map((manager) => ({
                value: manager.id,
                label: manager.fullName || manager.login,
                searchText: manager.login,
              }))
            }
          />
          {canManageOwn &&
          user?.id &&
          managerUserId !== user.id ? (
            <Button

              onClick={() => replaceQuery(month, user.id)}
            >
              Мой календарь
            </Button>
          ) : null}
        </div>
        <div className={`ui-inline ${calendarStyles.oneTimeCalendarActions}`}>
          <Button
            disabled={isExporting || !snapshotFresh || calendar?.capabilities?.canExport !== true}
            onClick={() => {
              if (!snapshotFresh || calendar?.capabilities?.canExport !== true) return;
              const generation = getAccessGeneration();
              const exportScope = snapshotKey;
              setIsExporting(true);
              setError(null);
              void downloadOneTimeOrderCalendarExcel({
                month,
                managerUserId: managerUserId || undefined,
              })
                .then((blob) => {
                  if (!isAccessGenerationCurrent(generation) || snapshotKeyRef.current !== exportScope) return;
                  const url = URL.createObjectURL(blob);
                  const anchor = document.createElement('a');
                  anchor.href = url;
                  anchor.download = `one-time-orders-calendar-${month}.xlsx`;
                  anchor.click();
                  window.setTimeout(() => URL.revokeObjectURL(url), 0);
                })
                .catch((exportError: unknown) => {
                  if (isAccessGenerationCurrent(generation) && snapshotKeyRef.current === exportScope) setError(getErrorMessage(exportError));
                })
                .finally(() => setIsExporting(false));
            }}
          >
            {isExporting ? 'Готовим Excel...' : 'Скачать Excel'}
          </Button>
          {canManageOwn ? (
            <Button onClick={() => openAvailabilityForm('own')}>
              Запросить отсутствие
            </Button>
          ) : null}
          {canManageAny ? (
            <Button onClick={() => openAvailabilityForm('direct')}>
              Добавить запись
            </Button>
          ) : null}
          {canCreateOrder ? (
            <CreateNavigationLink className="ui-button ui-button--primary" href="/one-time-orders/new">
              <span className="ui-button__icon" aria-hidden="true"><PlusIcon /></span>Создать заказ
            </CreateNavigationLink>
          ) : null}
        </div>
      </Surface>

      <div className={calendarStyles.oneTimeCalendarLegend} aria-label="Обозначения календаря">
        {AVAILABILITY_OPTIONS.map((option) => (
          <span key={option.value} data-availability={option.value}>
            {option.label}
          </span>
        ))}
        <span className={calendarStyles.oneTimeCalendarLegendWarning}>Конфликт расписания</span>
      </div>

      {error ? <Surface padding="md" className={calendarStyles.oneTimeCalendarError}>{error}</Surface> : null}
      {isLoading ? (
        <Surface padding="md">Загрузка календаря...</Surface>
      ) : !calendar || calendar.managers.length === 0 ? (
        <Surface padding="md" className="ui-text-muted">Менеджеры за выбранный период не найдены.</Surface>
      ) : (
        <>
          <Surface padding="md" className={`data-table-shell ${calendarStyles.oneTimeCalendarGridShell}`}>
            <table className={calendarStyles.oneTimeCalendarGrid}>
              <thead>
                <tr>
                  <th scope="col" className={calendarStyles.oneTimeCalendarManagerCell}>Менеджер</th>
                  {calendar.managers[0]!.days.map((day) => (
                    <th
                      key={day.date}
                      scope="col"
                      className={isWeekend(day.date) ? 'is-weekend' : undefined}
                      data-today={day.date === today || undefined}
                    >
                      <span>{formatDate(day.date, { weekday: 'short' })}</span>
                      <strong>{Number(day.date.slice(-2))}</strong>
                    </th>
                  ))}
                  <th scope="col" className={calendarStyles.oneTimeCalendarWorkedCell}>Дни</th>
                </tr>
              </thead>
              <tbody>
                {calendar.managers.map((manager) => (
                  <tr key={manager.user.id}>
                    <th scope="row" className={calendarStyles.oneTimeCalendarManagerCell}>
                      <PersonName person={manager.user} compact />
                      <span>{manager.isActive ? 'Активен' : 'Неактивен'}</span>
                    </th>
                    {manager.days.map((day) => {
                      const warning = conflictLabel(day.conflictLevel);
                      return (
                        <td
                          key={day.date}
                          className={isWeekend(day.date) ? 'is-weekend' : undefined}
                          data-today={day.date === today || undefined}
                          data-conflict={day.conflictLevel !== 'none' || undefined}
                          tabIndex={0}
                          role="button"
                          aria-label={`${getUserDisplayName(manager.user)}, ${formatDate(day.date)}${warning ? `, ${warning}` : ''}: открыть детали дня`}
                          onClick={() => {
                            setError(null);
                            setSelectedDay({ manager, day });
                            setDecisionComment('');
                          }}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault();
                              setError(null);
                              setSelectedDay({ manager, day });
                              setDecisionComment('');
                            }
                          }}
                        >
                          <CalendarDayContent day={day} warning={warning} />
                        </td>
                      );
                    })}
                    <td className={calendarStyles.oneTimeCalendarWorkedCell}>
                      <strong>{manager.workedDays}</strong>
                      <span>из {calendar.daysInMonth}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Surface>

          {mobileManager ? (
            <div className={calendarStyles.oneTimeCalendarMobile}>
              {!managerUserId && calendar.managers.length > 1 ? (
                <div className="ui-text-muted">
                  На узком экране показан первый менеджер. Выберите нужного в фильтре.
                </div>
              ) : null}
              <Surface padding="md" className="ui-section-header">
                <div>
                  <div className="ui-section-title">
                    {getUserDisplayName(mobileManager.user)}
                  </div>
                  <div className="ui-section-subtitle">
                    Рабочих дней: {mobileManager.workedDays}
                  </div>
                </div>
              </Surface>
              {mobileManager.days.map((day) => (
                <button
                  key={day.date}
                  type="button"
                  className={calendarStyles.oneTimeCalendarMobileDay}
                  data-today={day.date === today || undefined}
                  data-conflict={day.conflictLevel !== 'none' || undefined}
                  onClick={() => {
                    setError(null);
                    setSelectedDay({ manager: mobileManager, day });
                  }}
                >
                  <span className={calendarStyles.oneTimeCalendarMobileDate}>
                    <strong>{formatDate(day.date, { day: 'numeric', month: 'long' })}</strong>
                    <span>{formatDate(day.date, { weekday: 'long' })}</span>
                  </span>
                  <span className={calendarStyles.oneTimeCalendarMobileSummary}>
                    {day.orders.length} заказов
                    {day.availability
                      ? ` · ${availabilityLabel(day.availability.entryType)}`
                      : ''}
                    {conflictLabel(day.conflictLevel) ? ' · Конфликт' : ''}
                  </span>
                </button>
              ))}
            </div>
          ) : null}
        </>
      )}

      {currentSelectedDay ? (
        <DayDetailsModal
          selected={currentSelectedDay}
          canCreateOrder={canCreateOrder}
          decisionComment={decisionComment}
          isSubmitting={isSubmitting}
          error={error}
          onDecisionCommentChange={setDecisionComment}
          onClose={() => setSelectedDay(null)}
          onEdit={(availability) =>
            openAvailabilityForm('edit', { availability, managerId: currentSelectedDay.manager.user.id })
          }
          onCancel={cancelAvailability}
          onApprove={(pending) => resolvePending('approve', pending)}
          onReject={(pending) => resolvePending('reject', pending)}
          onCreateOwn={(date) => openAvailabilityForm('own', { date })}
          onCreateDirect={(date) => openAvailabilityForm('direct', { date, managerId: currentSelectedDay.manager.user.id })}
        />
      ) : null}

      {availabilityForm && formAllowed ? (
        <AvailabilityModal
          form={availabilityForm}
          managerOptions={directTargets.map(target => ({ ...target.user, roleCode: '', roleCodes: [], isActive: true }))}
          isSubmitting={isSubmitting}
          error={error}
          onChange={setAvailabilityForm}
          onClose={() => setAvailabilityForm(null)}
          onSubmit={submitAvailability}
        />
      ) : null}
      {availabilityForm && !formAllowed ? <Surface padding="md" role="status">Действие больше недоступно. Черновик сохранён до восстановления доступа.
        <Button onClick={() => setAvailabilityForm(null)}>Закрыть черновик</Button>
      </Surface> : null}
      </AccessSnapshotBoundary>
    </div>
  );
}

function CalendarDayContent({
  day,
  warning,
}: {
  day: OneTimeOrderCalendarDay;
  warning: string | null;
}): React.JSX.Element {
  return (
    <div className={calendarStyles.oneTimeCalendarDayContent}>
      {day.availability ? (
        <span className={calendarStyles.oneTimeCalendarAvailability} data-availability={day.availability.entryType}>
          {availabilityLabel(day.availability.entryType)}
        </span>
      ) : null}
      {day.pendingRequests.length > 0 ? (
        <span className={calendarStyles.oneTimeCalendarPending}>
          Ожидает согласования: {day.pendingRequests.length}
        </span>
      ) : null}
      {day.orders.slice(0, 2).map((order, index) =>
        order.relatedOrder ? (
          <Link
            key={order.relatedOrder.id}
            href={`/one-time-orders/${order.relatedOrder.id}`}
            title={`${order.relatedOrder.title} · ${order.relatedOrder.executionAddress}`}
            onClick={(event) => event.stopPropagation()}
          >
            {order.relatedOrder.title}
          </Link>
        ) : (
          <span
            className="one-time-calendar__restricted-order"
            key={`restricted-${index}`}
          >
            Занят
          </span>
        ),
      )}
      {day.orders.length > 2 ? (
        <span className={calendarStyles.oneTimeCalendarMore}>Еще {day.orders.length - 2}</span>
      ) : null}
      {warning ? <span className={calendarStyles.oneTimeCalendarWarning}>{warning}</span> : null}
    </div>
  );
}

function DayDetailsModal({
  selected,
  canCreateOrder,
  decisionComment,
  error,
  isSubmitting,
  onDecisionCommentChange,
  onClose,
  onEdit,
  onCancel,
  onApprove,
  onReject,
  onCreateOwn,
  onCreateDirect,
}: {
  selected: SelectedDay;
  canCreateOrder: boolean;
  decisionComment: string;
  error: string | null;
  isSubmitting: boolean;
  onDecisionCommentChange: (value: string) => void;
  onClose: () => void;
  onEdit: (availability: OneTimeOrderCalendarAvailability) => void;
  onCancel: (availability: OneTimeOrderCalendarAvailability) => void;
  onApprove: (availability: OneTimeOrderCalendarAvailability) => void;
  onReject: (availability: OneTimeOrderCalendarAvailability) => void;
  onCreateOwn: (date: string) => void;
  onCreateDirect: (date: string) => void;
}): React.JSX.Element {
  const { manager, day } = selected;
  const warning = conflictLabel(day.conflictLevel);

  return (
    <div className={calendarStyles.calendarModalBackdrop} role="presentation" onMouseDown={onClose}>
      <div
        className={calendarStyles.calendarModal}
        role="dialog"
        aria-modal="true"
        aria-label="Детали дня"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="ui-section-header">
          <div>
            <div className="ui-section-title">{formatDate(day.date)}</div>
            <div className="ui-section-subtitle">{getUserDisplayName(manager.user)}</div>
          </div>
          <Button onClick={onClose}>Закрыть</Button>
        </div>

        {warning ? <div className={calendarStyles.calendarModalWarning}>{warning}</div> : null}
        {error ? <div className={calendarStyles.oneTimeCalendarError}>{error}</div> : null}

        {day.availability ? (
          <div className={calendarStyles.calendarModalSection}>
            <strong>{availabilityLabel(day.availability.entryType)}</strong>
            <span>
              {formatDate(day.availability.startDate)} — {formatDate(day.availability.endDate)}
            </span>
            {day.availability.comment ? <p>{day.availability.comment}</p> : null}
            {day.availability.capabilities?.canEdit || day.availability.capabilities?.canCancel ? (
              <div className="ui-inline">
                {day.availability.capabilities?.canEdit ? <Button disabled={isSubmitting} onClick={() => onEdit(day.availability!)}>
                  Изменить
                </Button> : null}
                {day.availability.capabilities?.canCancel ? <Button disabled={isSubmitting} onClick={() => onCancel(day.availability!)}>
                  Отменить запись
                </Button> : null}
              </div>
            ) : null}
          </div>
        ) : null}

        {day.pendingRequests.map((pending) => (
          <div
            className={`${calendarStyles.calendarModalSection} ${calendarStyles.calendarModalSectionPending}`}
            key={pending.id}
          >
            <strong>Запрос: {availabilityLabel(pending.entryType)}</strong>
            <span>
              {formatDate(pending.startDate)} — {formatDate(pending.endDate)}
            </span>
            {pending.comment ? <p>{pending.comment}</p> : null}
            {pending.capabilities?.canApprove || pending.capabilities?.canReject ? (
              <>
                <label>
                  <span>Комментарий решения</span>
                  <textarea
                    rows={2}
                    value={decisionComment}
                    onChange={(event) => onDecisionCommentChange(event.target.value)}
                    placeholder="Обязателен при отклонении"
                  />
                </label>
                <div className="ui-inline">
                  {pending.capabilities?.canApprove ? <Button
                    disabled={isSubmitting}
                    onClick={() => onApprove(pending)}
                  >
                    Согласовать
                  </Button> : null}
                  {pending.capabilities?.canReject ? <Button
                    disabled={isSubmitting}
                    onClick={() => onReject(pending)}
                  >
                    Отклонить
                  </Button> : null}
                </div>
              </>
            ) : null}
            {pending.capabilities?.canCancel ? (
              <Button
                disabled={isSubmitting}
                onClick={() => onCancel(pending)}
              >
                Отменить запрос
              </Button>
            ) : null}
          </div>
        ))}

        <div className={calendarStyles.calendarModalSection}>
          <strong>Заказы: {day.orders.length}</strong>
          {day.orders.length === 0 ? <span className="ui-text-muted">Нет заказов</span> : null}
          {day.orders.map((order, index) =>
            order.relatedOrder ? (
              <Link
                className={calendarStyles.calendarModalOrder}
                key={order.relatedOrder.id}
                href={`/one-time-orders/${order.relatedOrder.id}`}
              >
                <strong>{order.relatedOrder.title}</strong>
                <span>{order.relatedOrder.executionAddress}</span>
                <span>
                  {formatDate(order.relatedOrder.executionStartDate)} —{' '}
                  {formatDate(order.relatedOrder.executionEndDate)}
                </span>
                <span>{getOneTimeOrderStatusLabel(order.relatedOrder.status)}</span>
                <span>
                  {order.relatedOrder.managers
                    .map((managerItem) => getUserDisplayName(managerItem))
                    .join(', ')}
                </span>
              </Link>
            ) : (
              <div
                className={`${calendarStyles.calendarModalOrder} calendar-modal__order--restricted`}
                key={`restricted-${index}`}
              >
                <strong>Занят</strong>
                <span>Детали заказа ограничены</span>
              </div>
            ),
          )}
        </div>

        <div className="ui-inline">
          {canCreateOrder ? (
            <CreateNavigationLink
              className="ui-button"
              href={`/one-time-orders/new?date=${day.date}&managerUserId=${manager.user.id}`}
            >
              <span className="ui-button__icon" aria-hidden="true"><PlusIcon /></span>
              Создать заказ на дату
            </CreateNavigationLink>
          ) : null}
          {manager.capabilities?.canRequestOwnAvailability ? (
            <Button onClick={() => onCreateOwn(day.date)}>
              Запросить отсутствие
            </Button>
          ) : null}
          {manager.capabilities?.canCreateAvailability ? <Button disabled={isSubmitting} onClick={() => onCreateDirect(day.date)}>Добавить запись</Button> : null}
        </div>
      </div>
    </div>
  );
}

function AvailabilityModal({
  form,
  managerOptions,
  isSubmitting,
  error,
  onChange,
  onClose,
  onSubmit,
}: {
  form: AvailabilityFormState;
  managerOptions: SystemUserOption[];
  isSubmitting: boolean;
  error: string | null;
  onChange: (value: AvailabilityFormState) => void;
  onClose: () => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => Promise<void>;
}): React.JSX.Element {
  const title =
    form.mode === 'own'
      ? 'Запросить отсутствие'
      : form.mode === 'direct'
        ? 'Добавить запись менеджеру'
        : 'Изменить запись';
  return (
    <div className={calendarStyles.calendarModalBackdrop} role="presentation" onMouseDown={onClose}>
      <form
        className={`${calendarStyles.calendarModal} ${calendarStyles.calendarModalForm}`}
        onSubmit={onSubmit}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="ui-section-header">
          <div className="ui-section-title">{title}</div>
          <Button onClick={onClose}>Закрыть</Button>
        </div>
        {error ? <div className={calendarStyles.oneTimeCalendarError}>{error}</div> : null}
        {form.mode === 'direct' ? (
          <label>
            <span>Менеджер</span>
            <Select
              required
              value={form.userId}
              onChange={(event) => onChange({ ...form, userId: event.target.value })}
            >
              <option value="">Выберите менеджера</option>
              {managerOptions.map((manager) => (
                <option key={manager.id} value={manager.id}>
                  {getUserDisplayName(manager)}
                </option>
              ))}
            </Select>
          </label>
        ) : null}
        <label>
          <span>Тип</span>
          <Select
            value={form.entryType}
            onChange={(event) =>
              onChange({
                ...form,
                entryType: event.target.value as OneTimeOrderAvailabilityType,
              })
            }
          >
            {AVAILABILITY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </Select>
        </label>
        <div className={calendarStyles.calendarModalDateGrid}>
          <label>
            <span>Дата начала</span>
            <DatePicker required value={form.startDate} onChange={(nextValue) => onChange({ ...form, startDate: nextValue })} />
          </label>
          <label>
            <span>Дата окончания</span>
            <DatePicker required min={form.startDate} value={form.endDate} onChange={(nextValue) => onChange({ ...form, endDate: nextValue })} />
          </label>
        </div>
        <label>
          <span>Комментарий</span>
          <textarea
            rows={3}
            value={form.comment}
            onChange={(event) => onChange({ ...form, comment: event.target.value })}
          />
        </label>
        <div className="ui-inline">
          <Button variant="primary" type="submit" disabled={isSubmitting}>
            {isSubmitting ? 'Сохранение...' : 'Сохранить'}
          </Button>
          <Button onClick={onClose}>Отмена</Button>
        </div>
      </form>
    </div>
  );
}
