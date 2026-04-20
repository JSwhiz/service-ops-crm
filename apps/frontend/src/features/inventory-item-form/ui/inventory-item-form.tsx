'use client';

import React, { useState } from 'react';

import type {
  CreateInventoryItemPayload,
  InventoryItem,
} from '@/entities/inventory/model/inventory.types';

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
    isActive: boolean;
    notes?: string;
  };
  submitLabel: string;
  onSubmit: (payload: CreateInventoryItemPayload) => Promise<InventoryItem | void>;
}): React.JSX.Element {
  const [name, setName] = useState(initialValue?.name ?? '');
  const [category, setCategory] = useState(initialValue?.category ?? '');
  const [unit, setUnit] = useState(initialValue?.unit ?? '');
  const [isActive, setIsActive] = useState(initialValue?.isActive ?? true);
  const [notes, setNotes] = useState(initialValue?.notes ?? '');
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  return (
    <form
      className="page-card"
      style={{ display: 'grid', gap: 16 }}
      onSubmit={(event) => {
        event.preventDefault();
        setIsSaving(true);
        setError(null);

        void onSubmit({
          name,
          category,
          unit,
          isActive,
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

      <label>
        <div style={{ marginBottom: 6 }}>Название</div>
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          required
          minLength={2}
          style={{ width: '100%', padding: 10 }}
        />
      </label>

      <div
        style={{
          display: 'grid',
          gap: 12,
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
        }}
      >
        <label>
          <div style={{ marginBottom: 6 }}>Категория</div>
          <input
            value={category}
            onChange={(event) => setCategory(event.target.value)}
            required
            minLength={2}
            style={{ width: '100%', padding: 10 }}
          />
        </label>

        <label>
          <div style={{ marginBottom: 6 }}>Единица измерения</div>
          <input
            value={unit}
            onChange={(event) => setUnit(event.target.value)}
            required
            minLength={1}
            style={{ width: '100%', padding: 10 }}
            placeholder="шт, л, кг"
          />
        </label>
      </div>

      <label>
        <div style={{ marginBottom: 6 }}>Примечание</div>
        <textarea
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          rows={4}
          style={{ width: '100%', padding: 10 }}
        />
      </label>

      <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input
          type="checkbox"
          checked={isActive}
          onChange={(event) => setIsActive(event.target.checked)}
        />
        Позиция активна
      </label>

      {error ? <div style={{ color: '#b91c1c' }}>{error}</div> : null}

      <div>
        <button type="submit" disabled={isSaving}>
          {isSaving ? 'Сохраняем...' : submitLabel}
        </button>
      </div>
    </form>
  );
}
