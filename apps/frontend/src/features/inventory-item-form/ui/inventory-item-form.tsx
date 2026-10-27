'use client';

import React, { useState } from 'react';

import type {
  CreateInventoryItemPayload,
  InventoryItem,
} from '@/entities/inventory/model/inventory.types';
import { Alert, Button, Field } from '@/shared/ui/foundation';

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
  const [name, setName] = useState(initialValue?.name ?? '');
  const [category, setCategory] = useState(initialValue?.category ?? '');
  const [unit, setUnit] = useState(initialValue?.unit ?? '');
  const [notes, setNotes] = useState(initialValue?.notes ?? '');
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  return (
    <form
      className="ui-surface ui-surface--padded"
      style={{ display: 'grid', gap: 16, width: '100%', maxWidth: 800, minWidth: 0 }}
      onSubmit={(event) => {
        event.preventDefault();
        setIsSaving(true);
        setError(null);

        void onSubmit({
          name,
          category,
          unit,
          ...(notes.trim() ? { notes: notes.trim() } : {}),
        })
          .catch((submitError) => {
            setError(
              getErrorMessage(
                submitError,
                'Не удалось сохранить номенклатурную позицию.',
              ),
            );
          })
          .finally(() => {
            setIsSaving(false);
          });
      }}
    >
      <div style={{ fontWeight: 600 }}>{submitLabel}</div>

      <Field label="Название" required>
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          required
          minLength={2}
        />
      </Field>

      <div
        style={{
          display: 'grid',
          gap: 12,
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 220px), 1fr))',
        }}
      >
        <Field label="Категория" required>
          <input
            value={category}
            onChange={(event) => setCategory(event.target.value)}
            required
            minLength={2}
          />
        </Field>

        <Field label="Единица измерения" required>
          <input
            value={unit}
            onChange={(event) => setUnit(event.target.value)}
            required
            minLength={1}
            placeholder="шт, л, кг"
          />
        </Field>
      </div>

      <Field label="Примечание">
        <textarea
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          rows={4}
        />
      </Field>

      {error ? <Alert tone="danger" role="alert">{error}</Alert> : null}

      <div>
        <Button variant="primary" type="submit" disabled={isSaving}>
          {isSaving ? 'Сохраняем...' : submitLabel}
        </Button>
      </div>
    </form>
  );
}
