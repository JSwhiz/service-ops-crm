'use client';

import React from 'react';

import type { ObjectAuditLogItem } from '@/entities/object/model/object.types';
import styles from '@/features/object-shared-ui/object-surfaces.module.css';
import { ActivityTimeline } from '@/shared/ui/activity-timeline/activity-timeline';
import {
  getUserDisplayName,
  getUserSecondaryLabel,
} from '@/shared/lib/display-name';

interface ObjectHistoryListProps {
  items: ObjectAuditLogItem[];
}

const FIELD_LABELS: Record<string, string> = {
  name: 'Название',
  internalName: 'Внутреннее имя',
  address: 'Адрес',
  status: 'Статус',
  seasonMode: 'Сезон',
  summerWindowWashing: 'Мытьё окон летом',
  summerEngineering: 'Инженерные работы',
  winterTractorMode: 'Работа трактора зимой',
  monthlySalary: 'ЗП за месяц',
  dailyRate: 'Старая дневная ставка',
  counterpartyId: 'Контрагент',
  responsibleUserId: 'Ответственный',
  managerUserIds: 'Менеджеры',
  notes: 'Что важно знать об объекте',
  paymentType: 'Тип оплаты',
  operationDate: 'Дата выхода',
  employeeCount: 'Количество сотрудников',
  attendanceStatus: 'Отметка о выходе',
  present: 'Отметка о выходе',
  reason: 'Причина',
  comment: 'Комментарий',
  automaticSeasons: 'Автоматическое переключение сезонов',
  summerStartsOn: 'Лето начинается',
  winterStartsOn: 'Зима начинается',
};

function getActionLabel(actionCode: string): string {
  switch (actionCode) {
    case 'daily_report.draft_saved':
      return 'Сохранён черновик ежедневного отчёта';
    case 'daily_report.submitted':
      return 'Ежедневный отчёт отправлен';
    case 'daily_report.attachments_corrected':
      return 'Исправлены вложения ежедневного отчёта';
    case 'scheduling_employee_assigned':
      return 'Сотрудник назначен в график';
    case 'scheduling_position_created':
      return 'Создана штатная позиция';
    case 'scheduling_position_archived':
      return 'Штатная позиция архивирована';
    case 'scheduling_position_versioned':
      return 'Сохранена новая версия графика';
    case 'scheduling_contour_created':
      return 'Созданы условия оплаты';
    case 'scheduling_contour_updated':
      return 'Условия оплаты изменены';
    case 'scheduling_shift_confirmed':
      return 'Выход по графику подтверждён';
    case 'scheduling_shift_cancelled':
      return 'Выход по графику отменён';
    case 'object.contact.created':
      return 'Добавлен контакт';
    case 'object.contact.updated':
      return 'Контакт изменён';
    case 'object.contact.deleted':
      return 'Контакт удалён';
    case 'object.planning.updated':
      return 'Настройки бюджета и сезонов изменены';
    case 'object.created':
      return 'Объект создан';
    case 'object.updated':
      return 'Карточка объекта изменена';
    case 'object.status_changed':
      return 'Статус объекта изменён';
    case 'object.status_change_requested':
      return 'Запрошено изменение статуса';
    case 'object.responsible_added':
      return 'Назначен ответственный';
    case 'object.responsible_removed':
      return 'Снят ответственный';
    case 'object.manager_added':
      return 'Назначен менеджер';
    case 'object.manager_removed':
      return 'Снят менеджер';
    case 'object.counterparty_changed':
      return 'Изменён контрагент';
    case 'attendance.submitted':
      return 'Отметка о выходе сохранена';
    case 'attendance.corrected':
      return 'Отметка о выходе исправлена';
    default:
      return 'Изменение объекта';
  }
}

function formatValue(field: string, value: unknown): string {
  if (value === null || value === undefined || value === '') return 'Не указано';
  if (field === 'status') {
    if (value === 'active') return 'Активный';
    if (value === 'frozen') return 'Заморожен';
    if (value === 'archived') return 'Архив';
  }
  if (field === 'seasonMode') {
    if (value === 'summer') return 'Летний';
    if (value === 'winter') return 'Зимний';
  }
  if (field === 'paymentType') {
    if (value === 'monthly') return 'Фиксированная ЗП за месяц';
    if (value === 'daily') return 'Дневная ставка';
  }
  if (field === 'monthlySalary' || field === 'dailyRate') {
    const numeric = Number(value);
    return Number.isFinite(numeric)
      ? `${numeric.toLocaleString('ru-RU')} ₽`
      : String(value);
  }
  if (Array.isArray(value)) {
    return value.length === 0 ? 'Нет' : `${value.length} шт.`;
  }
  if (typeof value === 'boolean') return value ? 'Да' : 'Нет';
  return String(value);
}

function getReadableChanges(
  payload: Record<string, unknown>,
): Array<{ label: string; before?: string; after: string }> {
  const changes = payload.changes;
  if (changes && typeof changes === 'object' && !Array.isArray(changes)) {
    return Object.entries(changes as Record<string, unknown>).flatMap(
      ([field, rawChange]) => {
        const label = FIELD_LABELS[field];
        if (!label) return [];
        if (!rawChange || typeof rawChange !== 'object' || Array.isArray(rawChange)) {
          return [];
        }
        const change = rawChange as {
          oldValue?: unknown;
          newValue?: unknown;
        };
        return [{
          label,
          before: formatValue(field, change.oldValue),
          after: formatValue(field, change.newValue),
        }];
      },
    );
  }

  if ('fullName' in payload) {
    return [
      {
        label: 'Пользователь',
        after: String(payload.fullName),
      },
    ];
  }

  if ('oldStatus' in payload || 'newStatus' in payload) {
    return [
      {
        label: 'Статус',
        before: formatValue('status', payload.oldStatus),
        after: formatValue('status', payload.newStatus),
      },
    ];
  }

  return Object.entries(payload)
    .filter(([field]) => Boolean(FIELD_LABELS[field]))
    .map(([field, value]) => ({
      label: FIELD_LABELS[field]!,
      after: formatValue(field, value),
    }));
}

export function ObjectHistoryList({
  items,
}: ObjectHistoryListProps): React.JSX.Element {
  if (items.length === 0) {
    return <div className={styles.emptyState}>Изменений пока нет.</div>;
  }

  return (
    <section className={`${styles.surface} ${styles.historySurface}`}>
      <ActivityTimeline entries={items.map((item) => {
          const changes = item.payload
            ? getReadableChanges(item.payload as Record<string, unknown>)
            : [];

          return {
            id: item.id,
            title: getActionLabel(item.actionCode),
            occurredAt: item.createdAt,
            actor: [getUserDisplayName(item.actor), getUserSecondaryLabel(item.actor)].filter(Boolean).join(' · '),
            children: <>
              {changes.length > 0 ? (
                <details className={styles.auditTechnical}>
                  <summary>Подробности</summary>
                <div className={styles.auditChanges}>
                  {changes.map((change, index) => (
                    <div className={styles.auditChangeRow} key={`${change.label}-${index}`}>
                      <span>{change.label}</span>
                      <div>
                        {change.before !== undefined ? (
                          <>
                            <del>{change.before}</del>
                            <span className={styles.auditArrow}>→</span>
                          </>
                        ) : null}
                        <strong>{change.after}</strong>
                      </div>
                    </div>
                  ))}
                </div>
                </details>
              ) : null}
              {item.payload ? <details className={styles.auditTechnical}>
                <summary>Технические сведения события</summary>
                <pre className={styles.auditPayload}>{JSON.stringify({ action: item.actionCode, payload: item.payload }, null, 2)}</pre>
              </details> : null}
            </>,
          };
        })} />
    </section>
  );
}
