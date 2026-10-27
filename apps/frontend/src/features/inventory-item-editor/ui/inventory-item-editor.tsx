'use client';

import React, { useState } from 'react';

import {
  getInventoryItemById,
  updateInventoryItem,
} from '@/entities/inventory/api/inventory-client';
import type { InventoryItem } from '@/entities/inventory/model/inventory.types';
import { ApiError } from '@/shared/api/fetcher';
import { Alert, Button, Field } from '@/shared/ui/foundation';

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  return 'Не удалось сохранить карточку расходника.';
}

export function InventoryItemEditor({
  item,
  onSaved,
  onClose,
}: {
  item: InventoryItem;
  onSaved: (item: InventoryItem) => void;
  onClose: () => void;
}): React.JSX.Element {
  const [name, setName] = useState(item.name);
  const [category, setCategory] = useState(item.category);
  const [unit, setUnit] = useState(item.unit);
  const [notes, setNotes] = useState(item.notes ?? '');
  const [isSaving, setIsSaving] = useState(false);
  const [hasVersionConflict, setHasVersionConflict] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const resetDraft = (): void => {
    setName(item.name);
    setCategory(item.category);
    setUnit(item.unit);
    setNotes(item.notes ?? '');
    setHasVersionConflict(false);
    setError(null);
  };

  return (
    <form
      id="edit"
      className="ui-surface ui-surface--padded"
      style={{ display: 'grid', gap: 14, width: '100%', maxWidth: 800, minWidth: 0 }}
      onSubmit={(event) => {
        event.preventDefault();
        setIsSaving(true);
        setError(null);
        setHasVersionConflict(false);

        void updateInventoryItem(item.id, {
          expectedVersion: item.version,
          name,
          category,
          unit,
          notes: notes.trim() || null,
        })
          .then(onSaved)
          .catch((saveError: unknown) => {
            if (
              saveError instanceof ApiError &&
              saveError.code === 'INVENTORY_ITEM_VERSION_CONFLICT'
            ) {
              setHasVersionConflict(true);
              return;
            }

            setError(getErrorMessage(saveError));
          })
          .finally(() => setIsSaving(false));
      }}
    >
      <div className="ui-section-header">
        <div>
          <div className="ui-section-title">Редактирование карточки</div>
          <div className="ui-text-muted">
            Цена поставки рассчитывается по движениям и здесь не изменяется.
          </div>
        </div>
        <Button onClick={onClose}>
          Закрыть
        </Button>
      </div>

      <Field label="Название" required>
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          required
          minLength={2}
          maxLength={200}
        />
      </Field>

      <div className="ui-detail-grid">
        <Field label="Категория" required>
          <input
            value={category}
            onChange={(event) => setCategory(event.target.value)}
            required
            minLength={2}
            maxLength={100}
          />
        </Field>
        <Field label="Единица измерения" required>
          <input
            value={unit}
            onChange={(event) => setUnit(event.target.value)}
            required
            minLength={1}
            maxLength={50}
          />
        </Field>
      </div>

      <Field label="Примечание">
        <textarea
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          rows={4}
          maxLength={4000}
        />
      </Field>

      {hasVersionConflict ? (
        <Alert tone="warning">
          <strong>Карточка была изменена другим пользователем.</strong>
          <div className="ui-inline">
            <Button
              onClick={() => {
                setIsSaving(true);
                void getInventoryItemById(item.id)
                  .then((latest) => {
                    onSaved(latest);
                    setHasVersionConflict(false);
                  })
                  .catch((loadError: unknown) =>
                    setError(getErrorMessage(loadError)),
                  )
                  .finally(() => setIsSaving(false));
              }}
              disabled={isSaving}
            >
              Загрузить актуальные данные
            </Button>
            <Button
              onClick={resetDraft}
              disabled={isSaving}
            >
              Отменить мои изменения
            </Button>
          </div>
        </Alert>
      ) : null}

      {error ? <Alert tone="danger" role="alert">{error}</Alert> : null}

      <div className="ui-inline">
        <Button variant="primary" type="submit" disabled={isSaving || hasVersionConflict}>
          {isSaving ? 'Сохраняем...' : 'Сохранить изменения'}
        </Button>
        <Button
          onClick={resetDraft}
          disabled={isSaving}
        >
          Сбросить
        </Button>
      </div>
    </form>
  );
}
