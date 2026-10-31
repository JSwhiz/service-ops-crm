'use client';

import { useRouter } from 'next/navigation';
import React, { useRef, useState } from 'react';

import type {
  CreateInventoryItemPayload,
  InventoryItem,
} from '@/entities/inventory/model/inventory.types';
import { useAuth } from '@/shared/auth/use-auth';
import { useCreateDraft } from '@/shared/drafts';
import { useCreateNavigation } from '@/shared/create-navigation';
import { Alert, Button, Field } from '@/shared/ui/foundation';
import { FormDialog } from '@/shared/ui/overlays';
import { toCreateInventoryItemPayload } from '@/features/inventory-item-form/model/create-inventory-item-payload';

import styles from './inventory-item-form.module.css';

interface InventoryItemDraft {
  name: string;
  category: string;
  unit: string;
  notes: string;
}

const EMPTY_DRAFT: InventoryItemDraft = {
  name: '',
  category: '',
  unit: '',
  notes: '',
};

const FORM_ID = 'inventory-item-create-form';

function hasFormValues(value: InventoryItemDraft): boolean {
  return Object.values(value).some((field) => field.trim().length > 0);
}

function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  return fallback;
}

export function InventoryItemForm({
  initialValue,
  submitLabel,
  onSubmit,
}: {
  initialValue?: {
    name: string;
    category: string;
    unit: string;
    notes?: string;
  };
  submitLabel: string;
  onSubmit: (payload: CreateInventoryItemPayload) => Promise<InventoryItem | void>;
}): React.JSX.Element {
  const router = useRouter();
  const navigation = useCreateNavigation();
  const { user } = useAuth();
  const fallbackSearch = navigation.getTargetSearchParams().toString();
  const closeContext = navigation.closeContext(
    `/inventory${fallbackSearch ? `?${fallbackSearch}` : ''}`,
  );
  const draft = useCreateDraft<InventoryItemDraft>('inventory-item-create', initialValue ? {
    name: initialValue.name,
    category: initialValue.category,
    unit: initialValue.unit,
    notes: initialValue.notes ?? '',
  } : EMPTY_DRAFT);
  const [error, setError] = useState<string | null>(null);
  const [localSaving, setIsSaving] = useState(false);
  const isSaving = localSaving || draft.submitting;
  const [createdHref, setCreatedHref] = useState<string | null>(null);
  const [didCreate, setDidCreate] = useState(false);
  const submitLockRef = useRef(false);
  const canManageInventoryCatalog =
    user?.capabilities?.canManageInventoryCatalog ?? false;

  const updateField = (key: keyof InventoryItemDraft, value: string): void => {
    const next = { ...draft.value, [key]: value };
    draft.setValue(next);
    draft.setDirty(hasFormValues(next));
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (submitLockRef.current || isSaving || createdHref || !canManageInventoryCatalog) return;

    submitLockRef.current = true;
    setIsSaving(true);
    setError(null);

    let created: InventoryItem | void;
    try {
      created = await draft.submit(() => onSubmit(toCreateInventoryItemPayload(draft.value)));
    } catch (submitError) {
      setError(
        getErrorMessage(
          submitError,
          'Не удалось сохранить номенклатурную позицию.',
        ),
      );
      submitLockRef.current = false;
      setIsSaving(false);
      return;
    }

    draft.clear();
    setDidCreate(true);
    setIsSaving(false);
    if (created) {
      const href = `/inventory/${created.id}`;
      setCreatedHref(href);
      router.push(href);
    }
  };

  return (
    <FormDialog
      open
      title="Новая номенклатура"
      size="regular"
      busy={isSaving}
      dirty={draft.dirty}
      closeContext={closeContext}
      clearDraft={draft.clear}
      footer={({ requestClose }) => (
        <div className={styles.footer}>
          <Button onClick={() => void requestClose()} disabled={isSaving}>
            Отмена
          </Button>
          {canManageInventoryCatalog ? (
            <Button
              variant="primary"
              type="submit"
              form={FORM_ID}
              pending={isSaving}
              pendingLabel="Сохраняем..."
              disabled={didCreate}
            >
              {createdHref ? 'Создано' : submitLabel}
            </Button>
          ) : null}
        </div>
      )}
    >
      {canManageInventoryCatalog ? (
        <form id={FORM_ID} className={styles.form} onSubmit={(event) => void handleSubmit(event)}>
          <p className={styles.requiredNote}><span aria-hidden="true">*</span> — обязательные поля</p>
          <div className={styles.fields}>
            <Field label="Название" required className={styles.fullWidth}>
              <input
                value={draft.value.name}
                onChange={(event) => updateField('name', event.target.value)}
                required
                minLength={2}
              />
            </Field>
            <Field label="Категория" required>
              <input
                value={draft.value.category}
                onChange={(event) => updateField('category', event.target.value)}
                required
                minLength={2}
              />
            </Field>
            <Field label="Единица измерения" required>
              <input
                value={draft.value.unit}
                onChange={(event) => updateField('unit', event.target.value)}
                required
                minLength={1}
                placeholder="шт, л, кг"
              />
            </Field>
            <Field label="Примечание" className={styles.fullWidth}>
              <textarea
                value={draft.value.notes}
                onChange={(event) => updateField('notes', event.target.value)}
                rows={4}
              />
            </Field>
          </div>
          {error ? <Alert tone="danger" role="alert">{error}</Alert> : null}
          {createdHref ? (
            <Alert tone="success" role="status">
              Позиция создана. <a href={createdHref}>Открыть карточку</a>
            </Alert>
          ) : null}
          {didCreate && !createdHref ? (
            <Alert tone="success" role="status">Позиция создана.</Alert>
          ) : null}
        </form>
      ) : (
        <Alert tone="danger" role="alert">
          У вас нет доступа к управлению каталогом расходников.
        </Alert>
      )}
    </FormDialog>
  );
}
