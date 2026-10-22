'use client';

import React, { useState } from 'react';

import type { CreateOneTimeOrderPayload } from '@/entities/one-time-order/model/one-time-order.types';
import type { SystemUserOption } from '@/entities/user/model/user.types';
import {
  getUserDisplayName,
  getUserSecondaryLabel,
} from '@/shared/lib/display-name';
import {
  ONE_TIME_ORDER_PLANNED_PAYMENT_METHOD_OPTIONS,
  ONE_TIME_ORDER_STATUS_OPTIONS,
} from '@/shared/lib/one-time-order-presentation';
import {
  SearchableSelect,
  type SearchableSelectOption,
} from '@/shared/ui/searchable-select/searchable-select';
import { DatePicker } from '@/shared/ui/date-picker/date-picker';
import { Alert, Button, Field } from '@/shared/ui/foundation';

type OneTimeOrderFormPayload = {
  title: string;
  executionAddress: string;
  linkedObjectId?: string | null;
  status?: string;
  description?: string;
  executionStartDate?: string | null;
  executionEndDate?: string | null;
  contactName: string;
  contactPhone?: string;
  agreedSum?: number;
  plannedPaymentMethod?: CreateOneTimeOrderPayload['plannedPaymentMethod'] | null;
  financialNotes?: string;
  expenseNotes?: string;
  managerUserIds?: string[];
  specificationItems?: Array<{
    title: string;
    description?: string | null;
    requiresAttachment?: boolean;
  }>;
};

export function OneTimeOrderForm({
  initialLinkedObjectOption = null,
  initialManagerOptions = [],
  searchObjects,
  searchManagers,
  initialValue,
  canSelectLinkedObject,
  canEditFinancialFields = true,
  requirePlannedPaymentMethod = false,
  includeSpecificationItems = false,
  initialSpecificationItems = [],
  includeManagers,
  allowStatusEdit,
  submitLabel,
  onSubmit,
}: {
  initialLinkedObjectOption?: SearchableSelectOption | null;
  initialManagerOptions?: SystemUserOption[];
  searchObjects?: (query: string) => Promise<SearchableSelectOption[]>;
  searchManagers?: (query: string) => Promise<SystemUserOption[]>;
  initialValue?: Partial<CreateOneTimeOrderPayload>;
  canSelectLinkedObject: boolean;
  canEditFinancialFields?: boolean;
  requirePlannedPaymentMethod?: boolean;
  includeSpecificationItems?: boolean;
  initialSpecificationItems?: Array<{
    title: string;
    description: string | null;
    requiresAttachment: boolean;
  }>;
  includeManagers: boolean;
  allowStatusEdit: boolean;
  submitLabel: string;
  onSubmit: (payload: OneTimeOrderFormPayload) => Promise<void>;
}): React.JSX.Element {
  const initialStartDate =
    initialValue?.executionStartDate ?? initialValue?.executionDate ?? '';
  const initialEndDate = initialValue?.executionEndDate ?? initialStartDate;
  const [form, setForm] = useState({
    title: initialValue?.title ?? '',
    executionAddress: initialValue?.executionAddress ?? '',
    linkedObjectId: initialValue?.linkedObjectId ?? '',
    status: initialValue?.status ?? 'new',
    description: initialValue?.description ?? '',
    dateMode: !initialStartDate
      ? ('none' as const)
      : initialEndDate !== initialStartDate
        ? ('range' as const)
        : ('single' as const),
    executionStartDate: initialStartDate,
    executionEndDate: initialEndDate,
    contactName: initialValue?.contactName ?? '',
    contactPhone: initialValue?.contactPhone ?? '',
    agreedSum:
      initialValue?.agreedSum !== undefined && initialValue?.agreedSum !== null
        ? String(initialValue.agreedSum)
        : '',
    plannedPaymentMethod: initialValue?.plannedPaymentMethod ?? '',
    financialNotes: initialValue?.financialNotes ?? '',
    expenseNotes: initialValue?.expenseNotes ?? '',
    managerUserIds: initialValue?.managerUserIds ?? ([] as string[]),
  });
  const [error, setError] = useState<string | null>(null);
  const [selectedManagers, setSelectedManagers] = useState<SystemUserOption[]>(
    initialManagerOptions,
  );
  const [managerSearchOptions, setManagerSearchOptions] = useState<
    SystemUserOption[]
  >([]);
  const [managerPickerValue, setManagerPickerValue] = useState('');
  const [specificationItems, setSpecificationItems] = useState(
    initialSpecificationItems.map((item) => ({ ...item })),
  );
  const [isSubmitting, setIsSubmitting] = useState(false);

  const removeManager = (userId: string): void => {
    setSelectedManagers((current) =>
      current.filter((manager) => manager.id !== userId),
    );
    setForm((prev) => ({
      ...prev,
      managerUserIds: prev.managerUserIds.filter((id) => id !== userId),
    }));
  };

  const searchManagerOptions = async (
    query: string,
  ): Promise<SearchableSelectOption[]> => {
    if (!searchManagers) return [];
    const users = await searchManagers(query);
    setManagerSearchOptions(users);
    return users
      .filter((user) => !form.managerUserIds.includes(user.id))
      .map((user) => ({
        value: user.id,
        label: getUserDisplayName(user),
        description: getUserSecondaryLabel(user) || undefined,
        searchText: `${user.fullName} ${user.login}`,
      }));
  };

  const addManager = (userId: string): void => {
    const user = managerSearchOptions.find((option) => option.id === userId);
    if (!user || form.managerUserIds.includes(userId)) {
      setManagerPickerValue('');
      return;
    }
    setSelectedManagers((current) => [...current, user]);
    setForm((prev) => ({
      ...prev,
      managerUserIds: [...prev.managerUserIds, userId],
    }));
    setManagerPickerValue('');
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
        executionStartDate:
          form.dateMode === 'none' ? null : form.executionStartDate || null,
        executionEndDate:
          form.dateMode === 'none'
            ? null
            : form.dateMode === 'single'
              ? form.executionStartDate || null
              : form.executionEndDate || null,
        contactName: form.contactName,
        contactPhone: form.contactPhone || undefined,
        ...(canEditFinancialFields
          ? {
              agreedSum: form.agreedSum ? Number(form.agreedSum) : undefined,
              plannedPaymentMethod: form.plannedPaymentMethod
                ? (form.plannedPaymentMethod as CreateOneTimeOrderPayload['plannedPaymentMethod'])
                : null,
              financialNotes: form.financialNotes || undefined,
              expenseNotes: form.expenseNotes || undefined,
            }
          : {}),
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
        ...(includeSpecificationItems
          ? { specificationItems }
          : {}),
      });
    } catch {
      setError('Не удалось сохранить разовый заказ.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form className="page-card one-time-order-form" onSubmit={handleSubmit}>
      <div
        className="one-time-order-form__fields"
        style={{
          display: 'grid',
          gap: 12,
          gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
        }}
      >
        <Field label="Название заказа">
          <input
            value={form.title}
            onChange={(event) =>
              setForm((prev) => ({ ...prev, title: event.target.value }))
            }
            required
          />
        </Field>

        <Field label="Адрес / место выполнения">
          <input
            value={form.executionAddress}
            onChange={(event) =>
              setForm((prev) => ({
                ...prev,
                executionAddress: event.target.value,
              }))
            }
            required
          />
        </Field>

        {allowStatusEdit ? (
          <SearchableSelect
              label="Статус"
              value={form.status}
              options={ONE_TIME_ORDER_STATUS_OPTIONS.map((option) => ({ value: option.value, label: option.label }))}
              searchable={false}
              clearable={false}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, status: event }))
              }
          />
        ) : null}

        <fieldset className="one-time-order-date-mode" style={{ gridColumn: '1 / -1' }}>
          <legend>Дата выполнения</legend>
          <div className="one-time-order-date-mode__options">
            {[
              { value: 'none', label: 'Без даты' },
              { value: 'single', label: 'Один день' },
              { value: 'range', label: 'Несколько дней' },
            ].map((option) => (
              <label className="one-time-order-date-mode__option" key={option.value}>
                <input
                  type="radio"
                  name="one-time-order-date-mode"
                  value={option.value}
                  checked={form.dateMode === option.value}
                  onChange={() =>
                    setForm((prev) => ({
                      ...prev,
                      dateMode: option.value as 'none' | 'single' | 'range',
                    }))
                  }
                />{' '}
                {option.label}
              </label>
            ))}
          </div>
          {form.dateMode !== 'none' ? (
            <div
              style={{
                display: 'grid',
                gap: 12,
                gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                marginTop: 12,
              }}
            >
              <Field label={form.dateMode === 'range' ? 'Дата начала' : 'Дата'}>
                <DatePicker value={form.executionStartDate.slice(0, 10)} onChange={(nextValue) => setForm((prev) => ({
                      ...prev,
                      executionStartDate: nextValue,
                      ...(prev.dateMode === 'single'
                        ? { executionEndDate: nextValue }
                        : {}),
                    }))} required />
              </Field>
              {form.dateMode === 'range' ? (
                <Field label="Дата окончания">
                  <DatePicker value={form.executionEndDate.slice(0, 10)} min={form.executionStartDate.slice(0, 10)} onChange={(nextValue) => setForm((prev) => ({
                        ...prev,
                        executionEndDate: nextValue,
                      }))} required />
                </Field>
              ) : null}
            </div>
          ) : null}
        </fieldset>

        {canSelectLinkedObject ? (
          <SearchableSelect
            label="Связанный объект"
            value={form.linkedObjectId}
            options={[]}
            selectedOption={initialLinkedObjectOption}
            placeholder="Без привязки"
            searchPlaceholder="Название, адрес или внутреннее имя"
            emptyText="Доступные объекты не найдены"
            asyncSearch={searchObjects}
            onChange={(value) =>
              setForm((prev) => ({
                ...prev,
                linkedObjectId: value,
              }))
            }
          />
        ) : null}

        <Field label="Контакт">
          <input
            value={form.contactName}
            onChange={(event) =>
              setForm((prev) => ({ ...prev, contactName: event.target.value }))
            }
            required
          />
        </Field>

        <Field label="Телефон контакта">
          <input
            value={form.contactPhone}
            onChange={(event) =>
              setForm((prev) => ({ ...prev, contactPhone: event.target.value }))
            }
          />
        </Field>

        {canEditFinancialFields ? (
          <>
            <Field label="Согласованная сумма">
              <input
                type="number"
                min={0}
                value={form.agreedSum}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, agreedSum: event.target.value }))
                }
              />
            </Field>
            <SearchableSelect
                label="Плановый способ оплаты"
                value={form.plannedPaymentMethod}
                options={ONE_TIME_ORDER_PLANNED_PAYMENT_METHOD_OPTIONS.map((option) => ({ value: option.value, label: option.label }))}
                placeholder="Не указан"
                searchable={false}
                clearable={false}
                required={requirePlannedPaymentMethod}
                onChange={(value) =>
                  setForm((prev) => ({
                    ...prev,
                    plannedPaymentMethod: value,
                  }))
                }
            />
          </>
        ) : null}

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

        {canEditFinancialFields ? (
          <>
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
          </>
        ) : null}

        {includeManagers ? (
          <div style={{ gridColumn: '1 / -1', display: 'grid', gap: 10 }}>
            <div>
              <div style={{ marginBottom: 4 }}>Менеджеры заказа</div>
              <div className="page-muted">
                Добавляйте менеджеров поиском — полный список не загружается.
              </div>
            </div>

            {selectedManagers.length === 0 ? (
              <div className="page-muted">Менеджеры пока не выбраны.</div>
            ) : (
              <div className="record-list">
                {selectedManagers.map((user) => (
                  <div
                    key={user.id}
                    className="record-card"
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      gap: 12,
                      alignItems: 'center',
                    }}
                  >
                    <div>
                      <div>{getUserDisplayName(user)}</div>
                      {getUserSecondaryLabel(user) ? (
                        <div className="page-muted">
                          {getUserSecondaryLabel(user)}
                        </div>
                      ) : null}
                    </div>
                    <Button

                      onClick={() => removeManager(user.id)}
                    >
                      Убрать
                    </Button>
                  </div>
                ))}
              </div>
            )}

            <SearchableSelect
              label="Добавить менеджера"
              value={managerPickerValue}
              options={[]}
              clearable={false}
              placeholder="Найти менеджера"
              searchPlaceholder="ФИО или логин"
              emptyText="Подходящие менеджеры не найдены"
              asyncSearch={searchManagerOptions}
              onChange={(value) => {
                setManagerPickerValue(value);
                if (value) addManager(value);
              }}
            />
          </div>
        ) : null}

        {includeSpecificationItems ? (
          <div style={{ gridColumn: '1 / -1' }}>
            <div className="section-header" style={{ marginBottom: 10 }}>
              <div>
                <div className="section-title">Техническое задание копии</div>
                <div className="section-subtitle">
                  Выполнение и вложения исходного заказа не копируются.
                </div>
              </div>
              <Button
                onClick={() =>
                  setSpecificationItems((items) => [
                    ...items,
                    { title: '', description: null, requiresAttachment: false },
                  ])
                }
              >
                Добавить пункт
              </Button>
            </div>
            <div className="record-list">
              {specificationItems.map((item, index) => (
                <div className="record-item" key={index}>
                  <Field label="Название пункта">
                    <input
                      value={item.title}
                      maxLength={500}
                      required
                      onChange={(event) =>
                        setSpecificationItems((items) =>
                          items.map((current, itemIndex) =>
                            itemIndex === index
                              ? { ...current, title: event.target.value }
                              : current,
                          ),
                        )
                      }
                    />
                  </Field>
                  <Field label="Описание">
                    <textarea
                      value={item.description ?? ''}
                      rows={2}
                      onChange={(event) =>
                        setSpecificationItems((items) =>
                          items.map((current, itemIndex) =>
                            itemIndex === index
                              ? { ...current, description: event.target.value }
                              : current,
                          ),
                        )
                      }
                    />
                  </Field>
                  <div className="action-row">
                    <label>
                      <input
                        type="checkbox"
                        checked={item.requiresAttachment}
                        onChange={(event) =>
                          setSpecificationItems((items) =>
                            items.map((current, itemIndex) =>
                              itemIndex === index
                                ? {
                                    ...current,
                                    requiresAttachment: event.target.checked,
                                  }
                                : current,
                            ),
                          )
                        }
                      />{' '}
                      Требуется вложение
                    </label>
                    <Button

                      onClick={() =>
                        setSpecificationItems((items) =>
                          items.filter((_current, itemIndex) => itemIndex !== index),
                        )
                      }
                    >
                      Убрать
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>

      {error ? <Alert tone="danger" role="alert">{error}</Alert> : null}

      <div style={{ marginTop: 16 }}>
        <Button variant="primary" type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Сохраняем...' : submitLabel}
        </Button>
      </div>
    </form>
  );
}
