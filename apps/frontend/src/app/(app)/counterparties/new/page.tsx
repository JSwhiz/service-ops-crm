'use client';

import { useRouter } from 'next/navigation';
import React, { useState } from 'react';

import { createCounterparty } from '@/entities/counterparty/api/counterparty-client';
import { useAuth } from '@/shared/auth/use-auth';
import { PageTitle } from '@/shared/ui/page-title/page-title';

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
      <>
        <PageTitle title="Новый контрагент" />
        <div className="page-card">Недостаточно прав.</div>
      </>
    );
  }

  return (
    <div className="workspace-page page-stack">
      <PageTitle title="Новый контрагент" />
      <form
        className="page-card workspace-surface"
        style={{ display: 'grid', gap: 16 }}
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
        <div className="section-title">Основные данные</div>
        <div className="field-grid">
          <label>
            <span>Название *</span>
            <input
              required
              minLength={2}
              value={form.name}
              onChange={(event) =>
                setForm((current) => ({ ...current, name: event.target.value }))
              }
            />
          </label>
          <label>
            <span>Юридическое название</span>
            <input
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
              value={form.contactPhone}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  contactPhone: event.target.value,
                }))
              }
            />
          </label>
          <label style={{ gridColumn: '1 / -1' }}>
            <span>Комментарий</span>
            <textarea
              rows={4}
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
        {error ? <div className="form-error">{error}</div> : null}
        <div className="action-row">
          <button
            type="button"
            className="button-secondary"
            onClick={() => router.push('/counterparties')}
          >
            Отмена
          </button>
          <button type="submit" disabled={saving || form.name.trim().length < 2}>
            {saving ? 'Сохраняем...' : 'Создать'}
          </button>
        </div>
      </form>
    </div>
  );
}
