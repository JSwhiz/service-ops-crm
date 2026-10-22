'use client';

import { useRouter } from 'next/navigation';
import React, { useState } from 'react';

import { createCounterparty } from '@/entities/counterparty/api/counterparty-client';
import { useAuth } from '@/shared/auth/use-auth';

import styles from '../counterparties.module.css';
import { Button, Surface } from '@/shared/ui/foundation';

export default function NewCounterpartyPage(): React.JSX.Element {
  const router = useRouter();
  const { user } = useAuth();
  const [form, setForm] = useState({
    name: '',
    legalName: '',
    contactName: '',
    contactPhone: '',
    notes: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!(user?.capabilities?.canManageCounterparties ?? false)) {
    return (
      <div className={`ui-page counterparty-workspace ${styles.page}`}>
        <Surface padding="md" className={`${styles.surface} ${styles.emptyState}`}>Недостаточно прав.</Surface>
      </div>
    );
  }

  return (
    <div className={`ui-page counterparty-workspace ${styles.page} ${styles.createPage}`}>
      <form
        className={styles.createForm}
        onSubmit={(event) => {
          event.preventDefault();
          setSaving(true);
          setError(null);
          void createCounterparty({
            name: form.name.trim(),
            legalName: form.legalName.trim() || null,
            contactName: form.contactName.trim() || null,
            contactPhone: form.contactPhone.trim() || null,
            notes: form.notes.trim() || null,
          })
            .then((created) => router.push(`/counterparties/${created.id}`))
            .catch((caughtError) =>
              setError(
                caughtError instanceof Error
                  ? caughtError.message
                  : 'Не удалось создать контрагента.',
              ),
            )
            .finally(() => setSaving(false));
        }}
      >
        <h1 className={styles.createTitle}>Основные данные</h1>
        <div className={styles.formFields}>
          <label>
            <span>Название <b aria-hidden="true">*</b></span>
            <input
              required
              minLength={2}
              placeholder="Например, ООО «Чистота»"
              value={form.name}
              onChange={(event) =>
                setForm((current) => ({ ...current, name: event.target.value }))
              }
            />
          </label>
          <label>
            <span>Юридическое название</span>
            <input
              placeholder="Полное название организации"
              value={form.legalName}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  legalName: event.target.value,
                }))
              }
            />
          </label>
          <label>
            <span>Основной контакт</span>
            <input
              placeholder="ФИО контактного лица"
              value={form.contactName}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  contactName: event.target.value,
                }))
              }
            />
          </label>
          <label>
            <span>Телефон</span>
            <input
              type="tel"
              placeholder="+7 (___) ___-__-__"
              value={form.contactPhone}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  contactPhone: event.target.value,
                }))
              }
            />
          </label>
          <label className={styles.fullRow}>
            <span>Комментарий</span>
            <textarea
              rows={4}
              placeholder="Условия сотрудничества, важные договорённости…"
              value={form.notes}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  notes: event.target.value,
                }))
              }
            />
          </label>
        </div>
        {error ? <div className={styles.error} role="alert">{error}</div> : null}
        <div className={styles.formActions}>
          <Button onClick={() => router.push('/counterparties')}>Отмена</Button>
          <Button variant="primary" type="submit" disabled={saving || form.name.trim().length < 2}>
            {saving ? 'Сохраняем...' : 'Создать'}
          </Button>
        </div>
      </form>
    </div>
  );
}
