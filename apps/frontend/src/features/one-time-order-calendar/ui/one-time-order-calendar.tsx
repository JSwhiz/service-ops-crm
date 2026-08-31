'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import React, { useEffect, useRef, useState } from 'react';

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
import { getUserDisplayName } from '@/shared/lib/display-name';
import { getOneTimeOrderStatusLabel } from '@/shared/lib/one-time-order-presentation';
import { SearchableSelect } from '@/shared/ui/searchable-select/searchable-select';

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

function getCurrentMonth(): string {
  const today = new Date();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
}

function getTodayDate(): string {
  const today = new Date();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
}

function normalizeMonth(value: string | null): string {
  return value && /^\d{4}-\d{2}$/.test(value) ? value : getCurrentMonth();
}

function shiftMonth(month: string, delta: number): string {
  const [year, monthNumber] = month.split('-').map(Number);
  const date = new Date(Date.UTC(year!, monthNumber! - 1 + delta, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
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
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const month = normalizeMonth(searchParams.get('month'));
  const managerUserId = searchParams.get('managerUserId') ?? '';
  const canView = user?.capabilities?.canViewOneTimeOrderCalendar ?? false;
  const canCreateOrder = user?.capabilities?.canCreateOneTimeOrder ?? false;
  const canManageOwn =
    user?.capabilities?.canManageOwnOneTimeOrderAvailability ?? false;
  const canManageAny =
    user?.capabilities?.canManageAnyOneTimeOrderAvailability ?? false;
  const canApprove =
    user?.capabilities?.canApproveOneTimeOrderAvailability ?? false;
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

  const scrollTodayIntoView = (): void => {
    window.requestAnimationFrame(() => {
      const root = calendarRootRef.current;
      const grid = root?.querySelector<HTMLElement>('.one-time-calendar__grid-shell');
      const desktopToday = grid?.querySelector<HTMLElement>('[data-today="true"]');
      if (grid && desktopToday && grid.clientWidth > 0 && grid.getClientRects().length > 0) {
        grid.scrollLeft = Math.max(
          0,
          desktopToday.offsetLeft - grid.clientWidth / 2 + desktopToday.clientWidth / 2,
        );
        return;
      }
      root
        ?.querySelector<HTMLElement>('.one-time-calendar__mobile [data-today="true"]')
        ?.scrollIntoView({ block: 'center', behavior: 'auto' });
    });
  };

  const replaceQuery = (nextMonth: string, nextManagerId = managerUserId): void => {
    const query = new URLSearchParams();
    query.set('month', nextMonth);
    if (nextManagerId) query.set('managerUserId', nextManagerId);
    router.replace(`${pathname}?${query.toString()}`, { scroll: false });
  };

  const loadCalendar = async (): Promise<void> => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await getOneTimeOrderCalendar({
        month,
        managerUserId: managerUserId || undefined,
      });
      setCalendar(response);
    } catch (loadError) {
      setError(getErrorMessage(loadError));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (!canView) {
      setIsLoading(false);
      return;
    }
    let cancelled = false;
    setIsLoading(true);
    setError(null);
    void getOneTimeOrderCalendar({
      month,
      managerUserId: managerUserId || undefined,
    })
      .then((response) => {
        if (!cancelled) setCalendar(response);
      })
      .catch((loadError: unknown) => {
        if (!cancelled) setError(getErrorMessage(loadError));
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [canView, managerUserId, month]);

  useEffect(() => {
    if (!canView) return;
    void listOneTimeOrderCalendarManagers()
      .then((items) =>
        setManagerOptions(
          items.map((item) => ({
            ...item,
            roleCode: '',
            roleCodes: [],
            isActive: true,
          })),
        ),
      )
      .catch(() => setManagerOptions([]));
  }, [canView]);

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
    const availability = params?.availability;
    const date = params?.date ?? getTodayDate();
    setAvailabilityForm({
      mode,
      availabilityId: availability?.id,
      userId: params?.managerId ?? user?.id ?? '',
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
    if (!availabilityForm) return;
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
      setAvailabilityForm(null);
      setSelectedDay(null);
      await loadCalendar();
    } catch (submitError) {
      setError(getErrorMessage(submitError));
    } finally {
      setIsSubmitting(false);
    }
  };

  const resolvePending = async (
    decision: 'approve' | 'reject',
    pending: OneTimeOrderCalendarAvailability,
  ): Promise<void> => {
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
      setSelectedDay(null);
      setDecisionComment('');
      await loadCalendar();
    } catch (resolveError) {
      setError(getErrorMessage(resolveError));
    } finally {
      setIsSubmitting(false);
    }
  };

  const cancelAvailability = async (
    availability: OneTimeOrderCalendarAvailability,
  ): Promise<void> => {
    if (!window.confirm(`Отменить запись «${availabilityLabel(availability.entryType)}»?`)) {
      return;
    }
    setIsSubmitting(true);
    setError(null);
    try {
      await cancelOneTimeManagerAvailability(availability.id);
      setSelectedDay(null);
      await loadCalendar();
    } catch (cancelError) {
      setError(getErrorMessage(cancelError));
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!canView) {
    return <div className="page-card">У вас нет доступа к календарю разовых заказов.</div>;
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
    <div className="one-time-calendar" ref={calendarRootRef}>
      <div className="page-card workspace-surface filter-panel one-time-calendar__toolbar">
        <div className="one-time-calendar__month-nav">
          <button type="button" onClick={() => replaceQuery(shiftMonth(month, -1))}>
            Назад
          </button>
          <input
            aria-label="Месяц календаря"
            type="month"
            value={month}
            onChange={(event) => replaceQuery(event.target.value)}
          />
          <button type="button" onClick={() => replaceQuery(shiftMonth(month, 1))}>
            Вперед
          </button>
          <button
            type="button"
            onClick={() => {
              const currentMonth = getCurrentMonth();
              if (month === currentMonth) scrollTodayIntoView();
              else replaceQuery(currentMonth);
            }}
          >
            Текущий месяц
          </button>
        </div>
        <div className="one-time-calendar__manager-filter">
          <SearchableSelect
            label="Менеджер"
            value={managerUserId}
            options={availableManagers.map((manager) => ({
              value: manager.id,
              label: getUserDisplayName(manager),
              searchText: manager.login,
            }))}
            onChange={(value) => replaceQuery(month, value)}
            placeholder="Все менеджеры"
            asyncSearch={async (search) =>
              (await listOneTimeOrderCalendarManagers(search)).map((manager) => ({
                value: manager.id,
                label: manager.fullName || manager.login,
                searchText: manager.login,
              }))
            }
          />
        </div>
        <div className="action-row one-time-calendar__actions">
          <button
            type="button"
            disabled={isExporting}
            onClick={() => {
              setIsExporting(true);
              setError(null);
              void downloadOneTimeOrderCalendarExcel({
                month,
                managerUserId: managerUserId || undefined,
              })
                .then((blob) => {
                  const url = URL.createObjectURL(blob);
                  const anchor = document.createElement('a');
                  anchor.href = url;
                  anchor.download = `one-time-orders-calendar-${month}.xlsx`;
                  anchor.click();
                  window.setTimeout(() => URL.revokeObjectURL(url), 0);
                })
                .catch((exportError: unknown) => {
                  setError(getErrorMessage(exportError));
                })
                .finally(() => setIsExporting(false));
            }}
          >
            {isExporting ? 'Готовим Excel...' : 'Скачать Excel'}
          </button>
          {canManageOwn ? (
            <button type="button" onClick={() => openAvailabilityForm('own')}>
              Запросить отсутствие
            </button>
          ) : null}
          {canManageAny ? (
            <button type="button" onClick={() => openAvailabilityForm('direct')}>
              Добавить запись
            </button>
          ) : null}
          {canCreateOrder ? (
            <Link className="button-link" href="/one-time-orders/new">
              Создать заказ
            </Link>
          ) : null}
        </div>
      </div>

      <div className="one-time-calendar__legend" aria-label="Обозначения календаря">
        {AVAILABILITY_OPTIONS.map((option) => (
          <span key={option.value} data-availability={option.value}>
            {option.label}
          </span>
        ))}
        <span className="one-time-calendar__legend-warning">Конфликт расписания</span>
      </div>

      {error ? <div className="page-card one-time-calendar__error">{error}</div> : null}
      {isLoading ? (
        <div className="page-card">Загрузка календаря...</div>
      ) : !calendar || calendar.managers.length === 0 ? (
        <div className="page-card page-muted">Менеджеры за выбранный период не найдены.</div>
      ) : (
        <>
          <div className="page-card workspace-surface data-table-shell one-time-calendar__grid-shell">
            <table className="one-time-calendar__grid">
              <thead>
                <tr>
                  <th className="one-time-calendar__manager-cell">Менеджер</th>
                  {calendar.managers[0]!.days.map((day) => (
                    <th
                      key={day.date}
                      className={isWeekend(day.date) ? 'is-weekend' : undefined}
                      data-today={day.date === today || undefined}
                    >
                      <span>{formatDate(day.date, { weekday: 'short' })}</span>
                      <strong>{Number(day.date.slice(-2))}</strong>
                    </th>
                  ))}
                  <th className="one-time-calendar__worked-cell">Дни</th>
                </tr>
              </thead>
              <tbody>
                {calendar.managers.map((manager) => (
                  <tr key={manager.user.id}>
                    <th className="one-time-calendar__manager-cell">
                      <strong>{getUserDisplayName(manager.user)}</strong>
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
                          onClick={() => {
                            setError(null);
                            setSelectedDay({ manager, day });
                            setDecisionComment('');
                          }}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              setError(null);
                              setSelectedDay({ manager, day });
                            }
                          }}
                        >
                          <CalendarDayContent day={day} warning={warning} />
                        </td>
                      );
                    })}
                    <td className="one-time-calendar__worked-cell">
                      <strong>{manager.workedDays}</strong>
                      <span>из {calendar.daysInMonth}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {mobileManager ? (
            <div className="one-time-calendar__mobile">
              {!managerUserId && calendar.managers.length > 1 ? (
                <div className="page-muted">
                  На узком экране показан первый менеджер. Выберите нужного в фильтре.
                </div>
              ) : null}
              <div className="page-card section-header">
                <div>
                  <div className="section-title">
                    {getUserDisplayName(mobileManager.user)}
                  </div>
                  <div className="section-subtitle">
                    Рабочих дней: {mobileManager.workedDays}
                  </div>
                </div>
              </div>
              {mobileManager.days.map((day) => (
                <button
                  key={day.date}
                  type="button"
                  className="one-time-calendar__mobile-day"
                  data-today={day.date === today || undefined}
                  data-conflict={day.conflictLevel !== 'none' || undefined}
                  onClick={() => {
                    setError(null);
                    setSelectedDay({ manager: mobileManager, day });
                  }}
                >
                  <span className="one-time-calendar__mobile-date">
                    <strong>{formatDate(day.date, { day: 'numeric', month: 'long' })}</strong>
                    <span>{formatDate(day.date, { weekday: 'long' })}</span>
                  </span>
                  <span className="one-time-calendar__mobile-summary">
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

      {selectedDay ? (
        <DayDetailsModal
          selected={selectedDay}
          currentUserId={user?.id ?? ''}
          canCreateOrder={canCreateOrder}
          canManageAny={canManageAny}
          canApprove={canApprove}
          decisionComment={decisionComment}
          isSubmitting={isSubmitting}
          error={error}
          onDecisionCommentChange={setDecisionComment}
          onClose={() => setSelectedDay(null)}
          onEdit={(availability) =>
            openAvailabilityForm('edit', { availability })
          }
          onCancel={cancelAvailability}
          onApprove={(pending) => resolvePending('approve', pending)}
          onReject={(pending) => resolvePending('reject', pending)}
          onCreateOwn={(date) => openAvailabilityForm('own', { date })}
          canManageOwn={canManageOwn}
        />
      ) : null}

      {availabilityForm ? (
        <AvailabilityModal
          form={availabilityForm}
          managerOptions={availableManagers}
          isSubmitting={isSubmitting}
          error={error}
          onChange={setAvailabilityForm}
          onClose={() => setAvailabilityForm(null)}
          onSubmit={submitAvailability}
        />
      ) : null}
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
    <div className="one-time-calendar__day-content">
      {day.availability ? (
        <span className="one-time-calendar__availability" data-availability={day.availability.entryType}>
          {availabilityLabel(day.availability.entryType)}
        </span>
      ) : null}
      {day.pendingRequests.length > 0 ? (
        <span className="one-time-calendar__pending">
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
        <span className="one-time-calendar__more">Еще {day.orders.length - 2}</span>
      ) : null}
      {warning ? <span className="one-time-calendar__warning">{warning}</span> : null}
    </div>
  );
}

function DayDetailsModal({
  selected,
  currentUserId,
  canCreateOrder,
  canManageOwn,
  canManageAny,
  canApprove,
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
}: {
  selected: SelectedDay;
  currentUserId: string;
  canCreateOrder: boolean;
  canManageOwn: boolean;
  canManageAny: boolean;
  canApprove: boolean;
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
}): React.JSX.Element {
  const { manager, day } = selected;
  const warning = conflictLabel(day.conflictLevel);

  return (
    <div className="calendar-modal-backdrop" role="presentation" onMouseDown={onClose}>
      <div
        className="calendar-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Детали дня"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="section-header">
          <div>
            <div className="section-title">{formatDate(day.date)}</div>
            <div className="section-subtitle">{getUserDisplayName(manager.user)}</div>
          </div>
          <button type="button" onClick={onClose}>Закрыть</button>
        </div>

        {warning ? <div className="calendar-modal__warning">{warning}</div> : null}
        {error ? <div className="one-time-calendar__error">{error}</div> : null}

        {day.availability ? (
          <div className="calendar-modal__section">
            <strong>{availabilityLabel(day.availability.entryType)}</strong>
            <span>
              {formatDate(day.availability.startDate)} — {formatDate(day.availability.endDate)}
            </span>
            {day.availability.comment ? <p>{day.availability.comment}</p> : null}
            {canManageAny ? (
              <div className="action-row">
                <button type="button" onClick={() => onEdit(day.availability!)}>
                  Изменить
                </button>
                <button type="button" onClick={() => onCancel(day.availability!)}>
                  Отменить запись
                </button>
              </div>
            ) : null}
          </div>
        ) : null}

        {day.pendingRequests.map((pending) => (
          <div
            className="calendar-modal__section calendar-modal__section--pending"
            key={pending.id}
          >
            <strong>Запрос: {availabilityLabel(pending.entryType)}</strong>
            <span>
              {formatDate(pending.startDate)} — {formatDate(pending.endDate)}
            </span>
            {pending.comment ? <p>{pending.comment}</p> : null}
            {canApprove ? (
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
                <div className="action-row">
                  <button
                    type="button"
                    disabled={isSubmitting}
                    onClick={() => onApprove(pending)}
                  >
                    Согласовать
                  </button>
                  <button
                    type="button"
                    disabled={isSubmitting}
                    onClick={() => onReject(pending)}
                  >
                    Отклонить
                  </button>
                </div>
              </>
            ) : manager.user.id === currentUserId ? (
              <button
                type="button"
                disabled={isSubmitting}
                onClick={() => onCancel(pending)}
              >
                Отменить запрос
              </button>
            ) : null}
          </div>
        ))}

        <div className="calendar-modal__section">
          <strong>Заказы: {day.orders.length}</strong>
          {day.orders.length === 0 ? <span className="page-muted">Нет заказов</span> : null}
          {day.orders.map((order, index) =>
            order.relatedOrder ? (
              <Link
                className="calendar-modal__order"
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
                className="calendar-modal__order calendar-modal__order--restricted"
                key={`restricted-${index}`}
              >
                <strong>Занят</strong>
                <span>Детали заказа ограничены</span>
              </div>
            ),
          )}
        </div>

        <div className="action-row">
          {canCreateOrder ? (
            <Link
              className="button-link"
              href={`/one-time-orders/new?date=${day.date}&managerUserId=${manager.user.id}`}
            >
              Создать заказ на дату
            </Link>
          ) : null}
          {canManageOwn && manager.user.id === currentUserId ? (
            <button type="button" onClick={() => onCreateOwn(day.date)}>
              Запросить отсутствие
            </button>
          ) : null}
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
    <div className="calendar-modal-backdrop" role="presentation" onMouseDown={onClose}>
      <form
        className="calendar-modal calendar-modal--form"
        onSubmit={onSubmit}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="section-header">
          <div className="section-title">{title}</div>
          <button type="button" onClick={onClose}>Закрыть</button>
        </div>
        {error ? <div className="one-time-calendar__error">{error}</div> : null}
        {form.mode === 'direct' ? (
          <label>
            <span>Менеджер</span>
            <select
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
            </select>
          </label>
        ) : null}
        <label>
          <span>Тип</span>
          <select
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
          </select>
        </label>
        <div className="calendar-modal__date-grid">
          <label>
            <span>Дата начала</span>
            <input
              type="date"
              required
              value={form.startDate}
              onChange={(event) => onChange({ ...form, startDate: event.target.value })}
            />
          </label>
          <label>
            <span>Дата окончания</span>
            <input
              type="date"
              required
              min={form.startDate}
              value={form.endDate}
              onChange={(event) => onChange({ ...form, endDate: event.target.value })}
            />
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
        <div className="action-row">
          <button type="submit" disabled={isSubmitting}>
            {isSubmitting ? 'Сохранение...' : 'Сохранить'}
          </button>
          <button type="button" onClick={onClose}>Отмена</button>
        </div>
      </form>
    </div>
  );
}
