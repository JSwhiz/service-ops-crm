'use client';

import React, { useState } from 'react';

import type { ServiceObject } from '@/entities/object/model/object.types';
import type { CreateOneTimeOrderPayload } from '@/entities/one-time-order/model/one-time-order.types';
import type { SystemUserOption } from '@/entities/user/model/user.types';
import {
  getUserDisplayName,
  getUserSecondaryLabel,
} from '@/shared/lib/display-name';
import {
  ONE_TIME_ORDER_STATUS_OPTIONS,
} from '@/shared/lib/one-time-order-presentation';

type OneTimeOrderFormPayload = {
  title: string;
  executionAddress: string;
  linkedObjectId?: string | null;
  status?: string;
  description?: string;
  executionDate?: string;
  contactName: string;
  contactPhone?: string;
  agreedSum?: number;
  financialNotes?: string;
  expenseNotes?: string;
  managerUserIds?: string[];
};

export function OneTimeOrderForm({
  objects,
  managerOptions,
  initialValue,
  canSelectLinkedObject,
  includeManagers,
  allowStatusEdit,
  submitLabel,
  onSubmit,
}: {
  objects: ServiceObject[];
  managerOptions: SystemUserOption[];
  initialValue?: Partial<CreateOneTimeOrderPayload>;
  canSelectLinkedObject: boolean;
  includeManagers: boolean;
  allowStatusEdit: boolean;
  submitLabel: string;
  onSubmit: (payload: OneTimeOrderFormPayload) => Promise<void>;
}): React.JSX.Element {
  const [form, setForm] = useState({
    title: initialValue?.title ?? '',
    executionAddress: initialValue?.executionAddress ?? '',
    linkedObjectId: initialValue?.linkedObjectId ?? '',
    status: initialValue?.status ?? 'new',
    description: initialValue?.description ?? '',
    executionDate: initialValue?.executionDate ?? '',
    contactName: initialValue?.contactName ?? '',
    contactPhone: initialValue?.contactPhone ?? '',
    agreedSum:
      initialValue?.agreedSum !== undefined && initialValue?.agreedSum !== null
        ? String(initialValue.agreedSum)
        : '',
    financialNotes: initialValue?.financialNotes ?? '',
    expenseNotes: initialValue?.expenseNotes ?? '',
    managerUserIds: initialValue?.managerUserIds ?? ([] as string[]),
  });
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleToggleManager = (userId: string): void => {
    setForm((prev) => ({
      ...prev,
      managerUserIds: prev.managerUserIds.includes(userId)
        ? prev.managerUserIds.filter((id) => id !== userId)
        : [...prev.managerUserIds, userId],
    }));
  };

  const handleSubmit = async (
    event: React.FormEvent<HTMLFormElement>,
  ): Promise<void> => {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      await onSubmit({
        title: form.title,
        executionAddress: form.executionAddress,
        ...(allowStatusEdit ? { status: form.status } : {}),
        description: form.description || undefined,
        executionDate: form.executionDate || undefined,
        contactName: form.contactName,
        contactPhone: form.contactPhone || undefined,
        agreedSum: form.agreedSum ? Number(form.agreedSum) : undefined,
        financialNotes: form.financialNotes || undefined,
        expenseNotes: form.expenseNotes || undefined,
        ...(canSelectLinkedObject
          ? {
              linkedObjectId: form.linkedObjectId || null,
            }
          : {}),
        ...(includeManagers
          ? {
              managerUserIds: form.managerUserIds,
            }
          : {}),
      });
    } catch {
      setError('Не удалось сохранить разовый заказ.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form className="page-card" onSubmit={handleSubmit}>
      <div
        style={{
          display: 'grid',
          gap: 12,
          gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
        }}
      >
        <label>
          <div style={{ marginBottom: 6 }}>Название заказа</div>
          <input
            value={form.title}
            onChange={(event) =>
              setForm((prev) => ({ ...prev, title: event.target.value }))
            }
            style={{ width: '100%', padding: 10 }}
            required
          />
        </label>

        <label>
          <div style={{ marginBottom: 6 }}>Адрес / место выполнения</div>
          <input
            value={form.executionAddress}
            onChange={(event) =>
              setForm((prev) => ({
                ...prev,
                executionAddress: event.target.value,
              }))
            }
            style={{ width: '100%', padding: 10 }}
            required
          />
        </label>

        {allowStatusEdit ? (
          <label>
            <div style={{ marginBottom: 6 }}>Статус</div>
            <select
              value={form.status}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, status: event.target.value }))
              }
              style={{ width: '100%', padding: 10 }}
            >
              {ONE_TIME_ORDER_STATUS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        <label>
          <div style={{ marginBottom: 6 }}>Дата исполнения</div>
          <input
            type="date"
            value={form.executionDate ? form.executionDate.slice(0, 10) : ''}
            onChange={(event) =>
              setForm((prev) => ({ ...prev, executionDate: event.target.value }))
            }
            style={{ width: '100%', padding: 10 }}
          />
        </label>

        {canSelectLinkedObject ? (
          <label>
            <div style={{ marginBottom: 6 }}>Связанный объект</div>
            <select
              value={form.linkedObjectId}
              onChange={(event) =>
                setForm((prev) => ({
                  ...prev,
                  linkedObjectId: event.target.value,
                }))
              }
              style={{ width: '100%', padding: 10 }}
            >
              <option value="">Без привязки</option>
              {objects.map((object) => (
                <option key={object.id} value={object.id}>
                  {object.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        <label>
          <div style={{ marginBottom: 6 }}>Контакт</div>
          <input
            value={form.contactName}
            onChange={(event) =>
              setForm((prev) => ({ ...prev, contactName: event.target.value }))
            }
            style={{ width: '100%', padding: 10 }}
            required
          />
        </label>

        <label>
          <div style={{ marginBottom: 6 }}>Телефон контакта</div>
          <input
            value={form.contactPhone}
            onChange={(event) =>
              setForm((prev) => ({ ...prev, contactPhone: event.target.value }))
            }
            style={{ width: '100%', padding: 10 }}
          />
        </label>

        <label>
          <div style={{ marginBottom: 6 }}>Согласованная сумма</div>
          <input
            type="number"
            min={0}
            value={form.agreedSum}
            onChange={(event) =>
              setForm((prev) => ({ ...prev, agreedSum: event.target.value }))
            }
            style={{ width: '100%', padding: 10 }}
          />
        </label>

        <label style={{ gridColumn: '1 / -1' }}>
          <div style={{ marginBottom: 6 }}>Описание</div>
          <textarea
            value={form.description}
            onChange={(event) =>
              setForm((prev) => ({ ...prev, description: event.target.value }))
            }
            rows={4}
            style={{ width: '100%', padding: 10, resize: 'vertical' }}
          />
        </label>

        <label style={{ gridColumn: '1 / -1' }}>
          <div style={{ marginBottom: 6 }}>Финансовые заметки</div>
          <textarea
            value={form.financialNotes}
            onChange={(event) =>
              setForm((prev) => ({
                ...prev,
                financialNotes: event.target.value,
              }))
            }
            rows={3}
            style={{ width: '100%', padding: 10, resize: 'vertical' }}
          />
        </label>

        <label style={{ gridColumn: '1 / -1' }}>
          <div style={{ marginBottom: 6 }}>Расходные заметки</div>
          <textarea
            value={form.expenseNotes}
            onChange={(event) =>
              setForm((prev) => ({
                ...prev,
                expenseNotes: event.target.value,
              }))
            }
            rows={3}
            style={{ width: '100%', padding: 10, resize: 'vertical' }}
          />
        </label>

        {includeManagers ? (
          <div style={{ gridColumn: '1 / -1' }}>
            <div style={{ marginBottom: 8 }}>Менеджеры заказа</div>
            {managerOptions.length === 0 ? (
              <div className="page-muted">Кандидаты для назначения не найдены.</div>
            ) : (
              <div
                style={{
                  display: 'grid',
                  gap: 8,
                  gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                }}
              >
                {managerOptions.map((user) => (
                  <label
                    key={user.id}
                    style={{
                      display: 'flex',
                      gap: 8,
                      alignItems: 'center',
                      border: '1px solid #e5e7eb',
                      borderRadius: 10,
                      padding: 10,
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={form.managerUserIds.includes(user.id)}
                      onChange={() => handleToggleManager(user.id)}
                    />
                    <span>
                      {getUserDisplayName(user)}
                      {getUserSecondaryLabel(user) ? (
                        <span className="identity-secondary">
                          {getUserSecondaryLabel(user)}
                        </span>
                      ) : null}
                    </span>
                  </label>
                ))}
              </div>
            )}
          </div>
        ) : null}
      </div>

      {error ? <div style={{ marginTop: 12, color: '#b91c1c' }}>{error}</div> : null}

      <div style={{ marginTop: 16 }}>
        <button type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Сохраняем...' : submitLabel}
        </button>
      </div>
    </form>
  );
}
