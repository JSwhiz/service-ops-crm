import React from 'react';

import {
  formatEmployeeDate,
  formatEmployeeRate,
  getEmployeeAge,
  getEmployeeScheduleLabel,
  getEmployeeStatusLabel,
  getEmployeeTypeLabel,
} from '@/entities/employee/lib/employee-presentation';
import type { EmployeeDetail } from '@/entities/employee/model/employee.types';
import { Surface } from '@/shared/ui/foundation';

import styles from './employee-workspace.module.css';
import { formatPhone, getPhoneHref } from '@/shared/lib/phone';

const timestampFormatter = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
});

function Value({ children }: { children: React.ReactNode }): React.JSX.Element {
  return children === null || children === undefined || children === ''
    ? <span className={styles.empty}>Не указано</span>
    : <>{children}</>;
}

function Detail({ label, children }: { label: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div className={styles.detailRow}>
      <dt>{label}</dt>
      <dd><Value>{children}</Value></dd>
    </div>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <Surface className={styles.section} role="region" aria-labelledby={id}>
      <h2 id={id} className={styles.sectionTitle}>{title}</h2>
      {children}
    </Surface>
  );
}

/** Read-only profile; editing happens through the header «Редактировать» action. */
export function EmployeeProfileSection({ item }: { item: EmployeeDetail }): React.JSX.Element {
  const age = getEmployeeAge(item.birthDate);
  const documents = [
    ['passportReceived', 'Паспорт', item.passportReceivedByName] as const,
    ['contractReceived', 'Трудовой договор', item.contractReceivedByName] as const,
  ];

  return (
    <div className={styles.panel}>
      <div className={styles.panelGrid}>
        <Section id="employee-contacts" title="Контакты">
          <dl className={styles.details}>
            <Detail label={item.phones.length > 1 ? 'Телефоны' : 'Телефон'}>
              {item.phones.length ? (
                <span className={styles.phoneList}>
                  {item.phones.map((phone) => {
                    const href = getPhoneHref(phone);
                    return href
                      ? <a key={phone} href={href}>{formatPhone(phone)}</a>
                      : <span key={phone}>{phone}</span>;
                  })}
                </span>
              ) : null}
            </Detail>
            <Detail label="Дата рождения">
              {item.birthDate ? `${formatEmployeeDate(item.birthDate)}${age !== null ? ` · ${age} лет` : ''}` : null}
            </Detail>
            <Detail label="Адрес проживания">{item.residenceAddress}</Detail>
          </dl>
        </Section>

        <Section id="employee-work" title="Работа">
          <dl className={styles.details}>
            <Detail label="Должность">{item.position}</Detail>
            <Detail label="Тип">{getEmployeeTypeLabel(item.employeeType)}</Detail>
            <Detail label="Статус работы">{getEmployeeStatusLabel(item.employmentStatus)}</Detail>
            <Detail label="Базовая ставка">
              {item.baseDailyRate !== null ? `${formatEmployeeRate(item.baseDailyRate)} в день` : null}
            </Detail>
          </dl>
        </Section>

        <Section id="employee-mode" title="Рабочий режим">
          <dl className={styles.details}>
            <Detail label="График">
              {item.workScheduleCode ? getEmployeeScheduleLabel(item.workScheduleCode, item.workScheduleCustom) : null}
            </Detail>
            <Detail label="Время работы">{item.workTimeText}</Detail>
            <Detail label="Предпочтения">{item.shiftPreferences}</Detail>
          </dl>
        </Section>

        <Section id="employee-documents" title="Документы">
          <dl className={styles.details}>
            {documents.map(([field, label, authorName]) => {
              const changedAt = item[`${field}At`];
              return (
                <Detail key={field} label={label}>
                  <span className={styles.cellStack}>
                    <span>{item[field] ? 'Получен' : 'Не получен'}</span>
                    {changedAt ? (
                      <span className={styles.recordMeta}>
                        {timestampFormatter.format(new Date(changedAt))} · {authorName ?? 'автор недоступен'}
                      </span>
                    ) : null}
                  </span>
                </Detail>
              );
            })}
          </dl>
        </Section>
      </div>

      <Section id="employee-note" title="Примечание">
        {item.notes ? <p className={styles.note}>{item.notes}</p> : <span className={styles.empty}>Примечаний нет</span>}
      </Section>

      <p className={styles.recordMeta}>
        Карточка создана {timestampFormatter.format(new Date(item.createdAt))} · изменена {timestampFormatter.format(new Date(item.updatedAt))}
      </p>
    </div>
  );
}
