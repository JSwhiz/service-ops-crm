"use client";

import React, { useEffect, useRef, useState } from "react";

import type { CreateOneTimeOrderPayload } from "@/entities/one-time-order/model/one-time-order.types";
import type { SystemUserOption } from "@/entities/user/model/user.types";
import { ApiError } from "@/shared/api/fetcher";
import {
  getUserDisplayName,
  getUserSecondaryLabel,
} from "@/shared/lib/display-name";
import {
  ONE_TIME_ORDER_PLANNED_PAYMENT_METHOD_OPTIONS,
  ONE_TIME_ORDER_STATUS_OPTIONS,
} from "@/shared/lib/one-time-order-presentation";
import {
  SearchableSelect,
  type SearchableSelectOption,
} from "@/shared/ui/searchable-select/searchable-select";
import { DatePicker } from "@/shared/ui/date-picker/date-picker";
import { Alert, Button, Field } from "@/shared/ui/foundation";
import { findSectionValidationIssue, revealSectionValidationIssue } from '@/features/object-create/model/section-validation';
import { isNativeValidationIssueResolved, type NativeValidationIssue } from '@/features/object-create/model/stale-native-validation';
import { isOrderCreateSection, prepareCreateSubmission, type CreationRequestMetadata } from '../model/create-request';
import orderStyles from "@/entities/one-time-order/ui/one-time-order-ui.module.css";
import {
  SpecificationComposer,
  type SpecificationDraft,
} from "./specification-composer";

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
  plannedPaymentMethod?:
    | CreateOneTimeOrderPayload["plannedPaymentMethod"]
    | null;
  financialNotes?: string;
  expenseNotes?: string;
  managerUserIds?: string[];
  specificationItems?: Array<{
    title: string;
    description?: string | null;
    requiresAttachment?: boolean;
  }>;
  specificationCatalogItemIds?: string[];
  specificationTemplateIds?: string[];
  creationRequestId?: string;
};

export interface OneTimeOrderFormDraft {
  creationRequest?: CreationRequestMetadata | null;
  form: {
    title: string; executionAddress: string; linkedObjectId: string; status: string; description: string;
    dateMode: 'none' | 'single' | 'range'; executionStartDate: string; executionEndDate: string;
    contactName: string; contactPhone: string; agreedSum: string; plannedPaymentMethod: string;
    financialNotes: string; expenseNotes: string; managerUserIds: string[];
  };
  notesDisclosureOpen: boolean;
  selectedManagers: SystemUserOption[];
  specificationItems: Array<{ title: string; description: string | null; requiresAttachment: boolean }>;
  specificationDraft: SpecificationDraft;
}

export function OneTimeOrderForm({
  initialLinkedObjectOption = null,
  initialManagerOptions = [],
  searchObjects,
  searchManagers,
  initialValue,
  initialDraft,
  initialDraftDirty = false,
  formId,
  activeSection,
  hideSubmitActions = false,
  dialogMode = false,
  autoFocus = false,
  onDirtyChange,
  onDraftChange,
  onRequiredSection,
  onBusyChange,
  onCancel,
  canSelectLinkedObject,
  canEditFinancialFields = true,
  requirePlannedPaymentMethod = false,
  includeSpecificationItems = false,
  initialSpecificationItems = [],
  canComposeSpecification = false,
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
  initialDraft?: OneTimeOrderFormDraft;
  initialDraftDirty?: boolean;
  formId?: string;
  activeSection?: 'basic' | 'planning' | 'conditions' | 'specification' | 'notes';
  hideSubmitActions?: boolean;
  dialogMode?: boolean;
  autoFocus?: boolean;
  onDirtyChange?: (dirty: boolean) => void;
  onDraftChange?: (draft: OneTimeOrderFormDraft) => void;
  onRequiredSection?: (section: 'basic' | 'planning' | 'conditions' | 'specification' | 'notes') => void;
  onBusyChange?: (busy: boolean) => void;
  onCancel?: () => void;
  canSelectLinkedObject: boolean;
  canEditFinancialFields?: boolean;
  requirePlannedPaymentMethod?: boolean;
  includeSpecificationItems?: boolean;
  initialSpecificationItems?: Array<{
    title: string;
    description: string | null;
    requiresAttachment: boolean;
  }>;
  canComposeSpecification?: boolean;
  includeManagers: boolean;
  allowStatusEdit: boolean;
  submitLabel: string;
  onSubmit: (payload: OneTimeOrderFormPayload) => Promise<void>;
}): React.JSX.Element {
  const creationRequestRef = useRef<CreationRequestMetadata | null>(
    initialDraft?.creationRequest ?? null,
  );
  const paymentMethodRef = useRef<HTMLDivElement>(null);
  const initialStartDate =
    initialValue?.executionStartDate ?? initialValue?.executionDate ?? "";
  const initialEndDate = initialValue?.executionEndDate ?? initialStartDate;
  const [form, setForm] = useState(initialDraft?.form ?? {
    title: initialValue?.title ?? "",
    executionAddress: initialValue?.executionAddress ?? "",
    linkedObjectId: initialValue?.linkedObjectId ?? "",
    status: initialValue?.status ?? "new",
    description: initialValue?.description ?? "",
    dateMode: !initialStartDate
      ? ("none" as const)
      : initialEndDate !== initialStartDate
        ? ("range" as const)
        : ("single" as const),
    executionStartDate: initialStartDate,
    executionEndDate: initialEndDate,
    contactName: initialValue?.contactName ?? "",
    contactPhone: initialValue?.contactPhone ?? "",
    agreedSum:
      initialValue?.agreedSum !== undefined && initialValue?.agreedSum !== null
        ? String(initialValue.agreedSum)
        : "",
    plannedPaymentMethod: initialValue?.plannedPaymentMethod ?? "",
    financialNotes: initialValue?.financialNotes ?? "",
    expenseNotes: initialValue?.expenseNotes ?? "",
    managerUserIds: initialValue?.managerUserIds ?? ([] as string[]),
  });
  const [error, setError] = useState<string | null>(null);
  const [nativeValidationIssue, setNativeValidationIssue] = useState<NativeValidationIssue | null>(null);
  useEffect(() => {
    if (nativeValidationIssue && isNativeValidationIssueResolved(nativeValidationIssue.control)) setNativeValidationIssue(null);
  });
  const [notesDisclosureOpen, setNotesDisclosureOpen] = useState(() => initialDraft?.notesDisclosureOpen ?? (
    Boolean(
      initialValue?.description?.trim() ||
      (canEditFinancialFields &&
        (initialValue?.financialNotes?.trim() ||
          initialValue?.expenseNotes?.trim())),
    )
  ));
  useEffect(() => {
    if (activeSection === 'notes') setNotesDisclosureOpen(true);
  }, [activeSection]);
  const [selectedManagers, setSelectedManagers] = useState<SystemUserOption[]>(
    initialDraft?.selectedManagers ?? initialManagerOptions,
  );
  const [managerSearchOptions, setManagerSearchOptions] = useState<
    SystemUserOption[]
  >([]);
  const [managerPickerValue, setManagerPickerValue] = useState("");
  const [specificationItems, setSpecificationItems] = useState(
    initialDraft?.specificationItems ?? initialSpecificationItems.map((item) => ({ ...item })),
  );
  const [specificationDraft, setSpecificationDraft] =
    useState<SpecificationDraft>(initialDraft?.specificationDraft ?? {
      catalogItemIds: [],
      templateIds: [],
      customItems: [],
    });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const initialSnapshotRef = useRef(initialDraftDirty ? '' : JSON.stringify({
    form: {
      title: initialValue?.title ?? "",
      executionAddress: initialValue?.executionAddress ?? "",
      linkedObjectId: initialValue?.linkedObjectId ?? "",
      status: initialValue?.status ?? "new",
      description: initialValue?.description ?? "",
      dateMode: !initialStartDate ? "none" : initialEndDate !== initialStartDate ? "range" : "single",
      executionStartDate: initialStartDate,
      executionEndDate: initialEndDate,
      contactName: initialValue?.contactName ?? "",
      contactPhone: initialValue?.contactPhone ?? "",
      agreedSum: initialValue?.agreedSum !== undefined && initialValue?.agreedSum !== null ? String(initialValue.agreedSum) : "",
      plannedPaymentMethod: initialValue?.plannedPaymentMethod ?? "",
      financialNotes: initialValue?.financialNotes ?? "",
      expenseNotes: initialValue?.expenseNotes ?? "",
      managerUserIds: initialValue?.managerUserIds ?? [],
    },
    specificationItems: initialSpecificationItems.map((item) => ({ ...item })),
    specificationDraft: { catalogItemIds: [], templateIds: [], customItems: [] },
  }));
  const hadInitialDraft = useRef(initialDraftDirty);

  useEffect(() => {
    const currentDraft: OneTimeOrderFormDraft = { form, notesDisclosureOpen, selectedManagers, specificationItems, specificationDraft, creationRequest: creationRequestRef.current };
    const currentSnapshot = JSON.stringify({ form, specificationItems, specificationDraft });
    onDraftChange?.(currentDraft);
    onDirtyChange?.(hadInitialDraft.current || currentSnapshot !== initialSnapshotRef.current);
  }, [form, notesDisclosureOpen, selectedManagers, specificationItems, specificationDraft, onDirtyChange, onDraftChange]);

  useEffect(() => {
    if (!autoFocus) return;
    const frame = window.requestAnimationFrame(() => {
      formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      formRef.current?.querySelector<HTMLInputElement>('input:not([type="checkbox"]):not([type="radio"])')?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [autoFocus]);

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
      setManagerPickerValue("");
      return;
    }
    setSelectedManagers((current) => [...current, user]);
    setForm((prev) => ({
      ...prev,
      managerUserIds: [...prev.managerUserIds, userId],
    }));
    setManagerPickerValue("");
  };

  const handleSubmit = async (
    event: React.FormEvent<HTMLFormElement>,
  ): Promise<void> => {
    event.preventDefault();
    if (isSubmitting) return;
    setError(null);
    setNativeValidationIssue(null);
    const invalid = findSectionValidationIssue(event.currentTarget.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('input, select, textarea'));
    if (invalid) {
      if (invalid.control instanceof HTMLElement) setNativeValidationIssue({ control: invalid.control, message: invalid.message });
      revealSectionValidationIssue(invalid, (id) => {
        if (isOrderCreateSection(id)) onRequiredSection?.(id);
      }, (callback) => window.requestAnimationFrame(callback));
      return;
    }
    if (!form.title || !form.executionAddress) {
      setError('Укажите название заказа и адрес выполнения.');
      onRequiredSection?.('basic');
      window.requestAnimationFrame(() => formRef.current?.querySelector<HTMLInputElement>('input[required]:invalid')?.focus());
      return;
    }
    if (!form.contactName || (form.dateMode !== 'none' && !form.executionStartDate)
      || (form.dateMode === 'range' && !form.executionEndDate)) {
      setError('Заполните контакт и выбранную дату выполнения.');
      onRequiredSection?.('planning');
      window.requestAnimationFrame(() => formRef.current?.querySelector<HTMLInputElement>('input[required]:invalid')?.focus());
      return;
    }
    if (requirePlannedPaymentMethod && !form.plannedPaymentMethod) {
      setError("Укажите плановый способ оплаты.");
      onRequiredSection?.('conditions');
      window.requestAnimationFrame(() => paymentMethodRef.current?.querySelector("button")?.focus());
      return;
    }
    const missingSpecificationTitle = (includeSpecificationItems && specificationItems.some((item) => !item.title.trim()))
      || (canComposeSpecification && specificationDraft.customItems.some((item) => !item.title.trim()));
    if (missingSpecificationTitle) {
      setError('Заполните название каждого пункта технического задания.');
      onRequiredSection?.('specification');
      window.requestAnimationFrame(() => formRef.current?.querySelector<HTMLInputElement>('input[required]:invalid')?.focus());
      return;
    }
    setIsSubmitting(true);
    onBusyChange?.(true);

    try {
      const requestPayload: OneTimeOrderFormPayload = {
        title: form.title,
        executionAddress: form.executionAddress,
        ...(allowStatusEdit ? { status: form.status } : {}),
        description: form.description || undefined,
        executionStartDate:
          form.dateMode === "none" ? null : form.executionStartDate || null,
        executionEndDate:
          form.dateMode === "none"
            ? null
            : form.dateMode === "single"
              ? form.executionStartDate || null
              : form.executionEndDate || null,
        contactName: form.contactName,
        contactPhone: form.contactPhone || undefined,
        ...(canEditFinancialFields
          ? {
              agreedSum: form.agreedSum ? Number(form.agreedSum) : undefined,
              plannedPaymentMethod: form.plannedPaymentMethod
                ? (form.plannedPaymentMethod as CreateOneTimeOrderPayload["plannedPaymentMethod"])
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
        ...(includeSpecificationItems ? { specificationItems } : {}),
        ...(canComposeSpecification
          ? {
              specificationCatalogItemIds: specificationDraft.catalogItemIds,
              specificationTemplateIds: specificationDraft.templateIds,
              specificationItems: [
                ...specificationItems,
                ...specificationDraft.customItems,
              ],
            }
          : {}),
      };
      const submission = prepareCreateSubmission(
        { form, notesDisclosureOpen, selectedManagers, specificationItems, specificationDraft, creationRequest: creationRequestRef.current },
        requestPayload,
        () => crypto.randomUUID(),
      );
      creationRequestRef.current = submission.draft.creationRequest;
      // Persist synchronously before the POST can have an unknown outcome or the route unmounts.
      onDraftChange?.(submission.draft);
      await onSubmit({
        ...requestPayload,
        creationRequestId: submission.creationRequestId,
      });
    } catch (cause) {
      setError(
        cause instanceof ApiError && cause.statusCode === 403
          ? "Недостаточно прав для сохранения заказа."
          : cause instanceof ApiError && cause.statusCode === 409
            ? "Данные изменились. Проверьте состав заказа перед повторной отправкой."
            : "Не удалось сохранить разовый заказ. Проверьте данные и повторите попытку; прежний запрос не создаст дубль.",
      );
    } finally {
      setIsSubmitting(false);
      onBusyChange?.(false);
    }
  };

  return (
    <form
      ref={formRef}
      id={formId}
      noValidate
      className={`${dialogMode ? '' : 'ui-surface ui-surface--padded'} ${orderStyles.oneTimeOrderForm}`}
      onSubmit={handleSubmit}
    >
      {!dialogMode ? <div className="ui-section-header">
        <div>
          <h2 className="ui-section-title">{onCancel ? "Редактирование заказа" : "Параметры заказа"}</h2>
          {onCancel ? <div className="ui-text-muted">Сохраните изменения, чтобы применить их к заказу.</div> : null}
        </div>
      </div> : null}
      <div className={orderStyles.oneTimeOrderFormFields}>
        <fieldset data-create-section="basic" aria-label="Основные сведения" className={orderStyles.orderCreateSection} hidden={Boolean(activeSection && activeSection !== 'basic')}>
        <h3 className={`${orderStyles.orderFormGroupHeading} ${orderStyles.orderWideField}`}>Основные сведения</h3>
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
            options={ONE_TIME_ORDER_STATUS_OPTIONS.map((option) => ({
              value: option.value,
              label: option.label,
            }))}
            searchable={false}
            clearable={false}
            onChange={(event) =>
              setForm((prev) => ({ ...prev, status: event }))
            }
          />
        ) : null}

        </fieldset>
        <fieldset data-create-section="planning" aria-label="Планирование и контакт" className={orderStyles.orderCreateSection} hidden={Boolean(activeSection && activeSection !== 'planning')}>
        <h3 className={`${orderStyles.orderFormGroupHeading} ${orderStyles.orderWideField}`}>Планирование и контакт</h3>
        <fieldset
          className={`${orderStyles.oneTimeOrderDateMode} ${orderStyles.orderWideField}`}
        >
          <legend>Дата выполнения</legend>
          <div className={orderStyles.oneTimeOrderDateModeOptions}>
            {[
              { value: "none", label: "Без даты" },
              { value: "single", label: "Один день" },
              { value: "range", label: "Несколько дней" },
            ].map((option) => (
              <label
                className={orderStyles.oneTimeOrderDateModeOption}
                key={option.value}
              >
                <input
                  type="radio"
                  name="one-time-order-date-mode"
                  value={option.value}
                  checked={form.dateMode === option.value}
                  onChange={() =>
                    setForm((prev) => ({
                      ...prev,
                      dateMode: option.value as "none" | "single" | "range",
                    }))
                  }
                />{" "}
                {option.label}
              </label>
            ))}
          </div>
          {form.dateMode !== "none" ? (
            <div className={orderStyles.oneTimeOrderFormFields}>
              <Field label={form.dateMode === "range" ? "Дата начала" : "Дата"}>
                <DatePicker
                  value={form.executionStartDate.slice(0, 10)}
                  onChange={(nextValue) =>
                    setForm((prev) => ({
                      ...prev,
                      executionStartDate: nextValue,
                      ...(prev.dateMode === "single"
                        ? { executionEndDate: nextValue }
                        : {}),
                    }))
                  }
                  required
                />
              </Field>
              {form.dateMode === "range" ? (
                <Field label="Дата окончания">
                  <DatePicker
                    value={form.executionEndDate.slice(0, 10)}
                    min={form.executionStartDate.slice(0, 10)}
                    onChange={(nextValue) =>
                      setForm((prev) => ({
                        ...prev,
                        executionEndDate: nextValue,
                      }))
                    }
                    required
                  />
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
        </fieldset>

        <fieldset data-create-section="conditions" aria-label="Условия заказа" className={orderStyles.orderCreateSection} hidden={Boolean(activeSection && activeSection !== 'conditions')}>
        <h3 className={`${orderStyles.orderFormGroupHeading} ${orderStyles.orderWideField}`}>Условия заказа</h3>
        {canEditFinancialFields ? (
          <>
            <Field label="Согласованная сумма">
              <input
                type="number"
                min={0}
                value={form.agreedSum}
                onChange={(event) =>
                  setForm((prev) => ({
                    ...prev,
                    agreedSum: event.target.value,
                  }))
                }
              />
            </Field>
            <div ref={paymentMethodRef}>
              <SearchableSelect
                label={`Плановый способ оплаты${requirePlannedPaymentMethod ? " *" : ""}`}
                value={form.plannedPaymentMethod}
                options={ONE_TIME_ORDER_PLANNED_PAYMENT_METHOD_OPTIONS.map(
                  (option) => ({ value: option.value, label: option.label }),
                )}
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
            </div>
          </>
        ) : null}
        </fieldset>

        <fieldset data-create-section="notes" aria-label="Заметки" className={orderStyles.orderCreateSection} hidden={Boolean(activeSection && activeSection !== 'notes')}>
        <details
          className={orderStyles.orderOptionalNotes}
          open={notesDisclosureOpen}
          onToggle={(event) => setNotesDisclosureOpen(event.currentTarget.open)}
        >
          <summary className={orderStyles.orderOptionalNotesSummary}>
            <span>Дополнительные заметки</span>
            <span className={orderStyles.orderOptionalNotesState}>
              {form.description.trim() ||
              (canEditFinancialFields &&
                (form.financialNotes.trim() || form.expenseNotes.trim()))
                ? "Заполнены"
                : "Не заполнены"}
            </span>
          </summary>
          <div className={orderStyles.orderOptionalNotesContent}>
            <Field label="Описание" className={orderStyles.orderWideField}>
              <textarea
                value={form.description}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, description: event.target.value }))
                }
                rows={4}
              />
            </Field>

            {canEditFinancialFields ? (
              <>
                <Field label="Финансовые заметки" className={orderStyles.orderWideField}>
                  <textarea
                    value={form.financialNotes}
                    onChange={(event) =>
                      setForm((prev) => ({ ...prev, financialNotes: event.target.value }))
                    }
                    rows={3}
                  />
                </Field>

                <Field label="Расходные заметки" className={orderStyles.orderWideField}>
                  <textarea
                    value={form.expenseNotes}
                    onChange={(event) =>
                      setForm((prev) => ({ ...prev, expenseNotes: event.target.value }))
                    }
                    rows={3}
                  />
                </Field>
              </>
            ) : null}
          </div>
        </details>
        </fieldset>

        {includeManagers ? (
          <fieldset data-create-section="planning" aria-label="Менеджеры заказа" className={orderStyles.orderCreateSection} hidden={Boolean(activeSection && activeSection !== 'planning')}>
          <>
          <h3 className={`${orderStyles.orderFormGroupHeading} ${orderStyles.orderWideField}`}>Менеджеры</h3>
          <div
            className={`ui-stack ui-stack--lg ${orderStyles.orderWideField}`}
          >
            <div>
              <h3 className="ui-section-title">Менеджеры заказа</h3>
              <div className="ui-text-muted">
                Добавляйте менеджеров поиском — полный список не загружается.
              </div>
            </div>

            {selectedManagers.length === 0 ? (
              <div className="ui-text-muted">Менеджеры пока не выбраны.</div>
            ) : (
              <div className="ui-stack ui-stack--sm">
                {selectedManagers.map((user) => (
                  <div
                    className={`ui-section-header ${orderStyles.specificationItem}`}
                    key={user.id}
                  >
                    <div>
                      <div>{getUserDisplayName(user)}</div>
                      {getUserSecondaryLabel(user) ? (
                        <div className="ui-text-muted">
                          {getUserSecondaryLabel(user)}
                        </div>
                      ) : null}
                    </div>
                    <Button onClick={() => removeManager(user.id)}>
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
          </>
          </fieldset>
        ) : null}

        {canComposeSpecification ? (
          <fieldset data-create-section="specification" aria-label="Техническое задание" className={orderStyles.orderCreateSection} hidden={Boolean(activeSection && activeSection !== 'specification')}>
          <>
          <h3 className={`${orderStyles.orderFormGroupHeading} ${orderStyles.orderWideField}`}>Техническое задание</h3>
          <div className={orderStyles.orderWideField}>
            <SpecificationComposer
              value={specificationDraft}
              onChange={setSpecificationDraft}
            />
          </div>
          </>
          </fieldset>
        ) : null}

        {includeSpecificationItems && !canComposeSpecification ? (
          <fieldset data-create-section="specification" aria-label="Техническое задание" className={orderStyles.orderCreateSection} hidden={Boolean(activeSection && activeSection !== 'specification')}>
          <>
          <h3 className={`${orderStyles.orderFormGroupHeading} ${orderStyles.orderWideField}`}>Техническое задание</h3>
          <div
            className={`ui-stack ui-stack--lg ${orderStyles.orderWideField}`}
          >
            <div className="ui-section-header">
              <div>
                <h3 className="ui-section-title">Техническое задание копии</h3>
                <div className="ui-section-subtitle">
                  Выполнение и вложения исходного заказа не копируются.
                </div>
              </div>
              <Button
                onClick={() =>
                  setSpecificationItems((items) => [
                    ...items,
                    { title: "", description: null, requiresAttachment: false },
                  ])
                }
              >
                Добавить пункт
              </Button>
            </div>
            <div className="ui-stack ui-stack--lg">
              {specificationItems.map((item, index) => (
                <div
                  className={`ui-stack ui-stack--lg ${orderStyles.specificationItem}`}
                  key={index}
                >
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
                      value={item.description ?? ""}
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
                  <div className="ui-inline">
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
                      />{" "}
                      Требуется вложение
                    </label>
                    <Button
                      onClick={() =>
                        setSpecificationItems((items) =>
                          items.filter(
                            (_current, itemIndex) => itemIndex !== index,
                          ),
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
          </>
          </fieldset>
        ) : null}
      </div>

      {nativeValidationIssue || error ? (
        <Alert tone="danger" role="alert">
          {nativeValidationIssue?.message ?? error}
        </Alert>
      ) : null}

      {!hideSubmitActions ? <div className="ui-inline">
        <Button
          variant="primary"
          type="submit"
          pending={isSubmitting}
          pendingLabel="Сохраняем…"
        >
          {submitLabel}
        </Button>
        {onCancel ? <Button disabled={isSubmitting} onClick={onCancel}>Отменить</Button> : null}
      </div> : null}
    </form>
  );
}
