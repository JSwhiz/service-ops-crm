'use client';

import React, { useState } from 'react';

import {
  getInventoryItemById,
  updateInventoryItem,
} from '@/entities/inventory/api/inventory-client';
import type { InventoryItem } from '@/entities/inventory/model/inventory.types';
import { ApiError } from '@/shared/api/fetcher';

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
      className="page-card"
      style={{ display: 'grid', gap: 14 }}
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
      <div className="section-header">
        <div>
          <div className="section-title">Редактирование карточки</div>
          <div className="page-muted">
            Цена поставки рассчитывается по движениям и здесь не изменяется.
          </div>
        </div>
        <button type="button" className="button-quiet" onClick={onClose}>
          Закрыть
        </button>
      </div>

      <label>
        <div className="detail-label">Название</div>
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          required
          minLength={2}
          maxLength={200}
        />
      </label>

      <div className="detail-grid">
        <label>
          <div className="detail-label">Категория</div>
          <input
            value={category}
            onChange={(event) => setCategory(event.target.value)}
            required
            minLength={2}
            maxLength={100}
          />
        </label>
        <label>
          <div className="detail-label">Единица измерения</div>
          <input
            value={unit}
            onChange={(event) => setUnit(event.target.value)}
            required
            minLength={1}
            maxLength={50}
          />
        </label>
      </div>

      <label>
        <div className="detail-label">Примечание</div>
        <textarea
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          rows={4}
          maxLength={4000}
        />
      </label>

      {hasVersionConflict ? (
        <div className="inline-notice inline-notice--warning">
          <strong>Карточка была изменена другим пользователем.</strong>
          <div className="action-row">
            <button
              type="button"
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
            </button>
            <button
              type="button"
              className="button-secondary"
              onClick={resetDraft}
              disabled={isSaving}
            >
              Отменить мои изменения
            </button>
          </div>
        </div>
      ) : null}

      {error ? <div className="form-error">{error}</div> : null}

      <div className="action-row">
        <button type="submit" disabled={isSaving || hasVersionConflict}>
          {isSaving ? 'Сохраняем...' : 'Сохранить изменения'}
        </button>
        <button
          type="button"
          className="button-secondary"
          onClick={resetDraft}
          disabled={isSaving}
        >
          Сбросить
        </button>
      </div>
    </form>
  );
}
