'use client';

import { useRouter } from 'next/navigation';
import Link from 'next/link';
import React, { useRef, useState } from 'react';

import { createCounterparty } from '@/entities/counterparty/api/counterparty-client';
import { toCreateCounterpartyPayload } from '@/features/counterparty-create/model/create-counterparty-payload';
import { useAuth } from '@/shared/auth/use-auth';
import { useCreateDraft } from '@/shared/drafts';
import { useCreateNavigation } from '@/shared/create-navigation';
import { Alert, Button, Field } from '@/shared/ui/foundation';
import { FormDialog } from '@/shared/ui/overlays';

import styles from './counterparty-create.module.css';

interface CounterpartyDraft {
  name: string;
  legalName: string;
  contactName: string;
  contactPhone: string;
  notes: string;
}

const EMPTY_DRAFT: CounterpartyDraft = {
  name: '',
  legalName: '',
  contactName: '',
  contactPhone: '',
  notes: '',
};

const FORM_ID = 'counterparty-create-form';

function hasFormValues(value: CounterpartyDraft): boolean {
  return Object.values(value).some((field) => field.trim().length > 0);
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error && error.message.trim()
    ? error.message
    : 'Не удалось создать контрагента.';
}

export function CounterpartyCreateDialog(): React.JSX.Element {
  const router = useRouter();
  const navigation = useCreateNavigation();
  const { user } = useAuth();
  const draft = useCreateDraft<CounterpartyDraft>('counterparty-create', EMPTY_DRAFT);
  const fallbackSearch = navigation.getTargetSearchParams().toString();
  const closeContext = navigation.closeContext(
    `/counterparties${fallbackSearch ? `?${fallbackSearch}` : ''}`,
  );
  const [localBusy, setBusy] = useState(false);
  const busy = localBusy || draft.submitting;
  const [error, setError] = useState<string | null>(null);
  const [createdHref, setCreatedHref] = useState<string | null>(null);
  const submitLockRef = useRef(false);
  const canManage = user?.capabilities?.canManageCounterparties ?? false;

  const updateField = (key: keyof CounterpartyDraft, value: string): void => {
    const next = { ...draft.value, [key]: value };
    draft.setValue(next);
    draft.setDirty(hasFormValues(next));
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (submitLockRef.current || busy || createdHref || !canManage) return;

    submitLockRef.current = true;
    setBusy(true);
    setError(null);

    let createdId: string;
    try {
      const created = await draft.submit(() => createCounterparty(toCreateCounterpartyPayload(draft.value)));
      createdId = created.id;
    } catch (caughtError) {
      setError(getErrorMessage(caughtError));
      submitLockRef.current = false;
      setBusy(false);
      return;
    }

    const href = `/counterparties/${createdId}`;
    submitLockRef.current = true;
    setCreatedHref(href);
    draft.clear();
    setBusy(false);

    router.push(href);
  };

  return (
    <FormDialog
      open
      title="Новый контрагент"
      size="regular"
      busy={busy}
      dirty={draft.dirty}
      closeContext={closeContext}
      clearDraft={draft.clear}
      footer={({ requestClose }) => (
        <div className={styles.footer}>
          <Button onClick={() => void requestClose()} disabled={busy}>
            Отмена
          </Button>
          {canManage ? (
            <Button
              variant="primary"
              type="submit"
              form={FORM_ID}
              pending={busy}
              pendingLabel="Сохраняем..."
              disabled={draft.value.name.trim().length < 2 || Boolean(createdHref)}
            >
              {createdHref ? 'Создано' : 'Создать'}
            </Button>
          ) : null}
        </div>
      )}
    >
      {canManage ? (
        <form id={FORM_ID} className={styles.form} onSubmit={(event) => void handleSubmit(event)}>
          <p className={styles.requiredNote}><span aria-hidden="true">*</span> — обязательное поле</p>
          <div className={styles.fields}>
            <Field label="Название" required className={styles.fullWidth}>
              <input
                value={draft.value.name}
                onChange={(event) => updateField('name', event.target.value)}
                required
                minLength={2}
                placeholder="Например, ООО «Чистота»"
              />
            </Field>
            <Field label="Юридическое название" className={styles.fullWidth}>
              <input
                value={draft.value.legalName}
                onChange={(event) => updateField('legalName', event.target.value)}
                placeholder="Полное название организации"
              />
            </Field>
            <Field label="Основной контакт">
              <input
                value={draft.value.contactName}
                onChange={(event) => updateField('contactName', event.target.value)}
                placeholder="ФИО контактного лица"
              />
            </Field>
            <Field label="Телефон">
              <input
                type="tel"
                value={draft.value.contactPhone}
                onChange={(event) => updateField('contactPhone', event.target.value)}
                placeholder="+7 (___) ___-__-__"
              />
            </Field>
            <Field label="Комментарий" className={styles.fullWidth}>
              <textarea
                rows={4}
                value={draft.value.notes}
                onChange={(event) => updateField('notes', event.target.value)}
                placeholder="Условия сотрудничества, важные договорённости…"
              />
            </Field>
          </div>
          {error ? <Alert tone="danger" role="alert">{error}</Alert> : null}
          {createdHref ? (
            <Alert tone="success" role="status">
              Контрагент создан. <Link href={createdHref}>Открыть карточку</Link>
            </Alert>
          ) : null}
        </form>
      ) : (
        <Alert tone="danger" role="alert">Недостаточно прав для создания контрагента.</Alert>
      )}
    </FormDialog>
  );
}
