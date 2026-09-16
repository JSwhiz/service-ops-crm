'use client';

import React, { useEffect, useState } from 'react';

import type {
  CreateEquipmentCatalogItemPayload,
  CreateEquipmentUnitPayload,
  EquipmentCatalogItem,
} from '@/entities/equipment/model/equipment.types';

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() ? error.message : fallback;
}

export function EquipmentCatalogItemForm({
  onSubmit,
}: {
  onSubmit: (payload: CreateEquipmentCatalogItemPayload) => Promise<void>;
}): React.JSX.Element {
  const [category, setCategory] = useState('');
  const [name, setName] = useState('');
  const [brand, setBrand] = useState('');
  const [model, setModel] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  return (
    <form
      className="page-card"
      style={{ display: 'grid', gap: 12 }}
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        setIsSaving(true);
        void onSubmit({
          category,
          name,
          ...(brand.trim() ? { brand } : {}),
          ...(model.trim() ? { model } : {}),
          ...(notes.trim() ? { notes } : {}),
        })
          .catch((submitError) =>
            setError(getErrorMessage(submitError, 'Не удалось создать тип.')),
          )
          .finally(() => setIsSaving(false));
      }}
    >
      <strong>Новый тип оборудования</strong>
      <input value={category} onChange={(event) => setCategory(event.target.value)} placeholder="Категория" required />
      <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Название" required />
      <input value={brand} onChange={(event) => setBrand(event.target.value)} placeholder="Бренд" />
      <input value={model} onChange={(event) => setModel(event.target.value)} placeholder="Модель" />
      <textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Заметки" rows={2} />
      {error ? <div style={{ color: '#b91c1c' }}>{error}</div> : null}
      <button type="submit" disabled={isSaving}>
        {isSaving ? 'Создаем...' : 'Создать тип'}
      </button>
    </form>
  );
}

export function EquipmentCatalogManager({
  catalog,
  canDelete,
  onDelete,
}: {
  catalog: EquipmentCatalogItem[];
  canDelete: boolean;
  onDelete: (id: string) => Promise<void>;
}): React.JSX.Element {
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="page-card" style={{ display: 'grid', gap: 12 }}>
      <div className="section-header">
        <div>
          <div className="section-title">Типы оборудования</div>
          <div className="page-muted">
            Пустой тип можно удалить. Тип с заведёнными единицами сохраняется.
          </div>
        </div>
      </div>

      {catalog.length === 0 ? (
        <div className="page-muted">Типы оборудования пока не созданы.</div>
      ) : (
        <div className="record-list">
          {catalog.map((item) => {
            const isConfirming = confirmId === item.id;
            const canDeleteItem = canDelete && item.unitsCount === 0;

            return (
              <div key={item.id} className="record-card">
                <div className="section-header">
                  <div>
                    <strong>{item.name}</strong>
                    <div className="page-muted">
                      {item.category}
                      {item.brand ? ` · ${item.brand}` : ''}
                      {item.model ? ` · ${item.model}` : ''}
                      {item.unitsCount > 0
                        ? ` · ${item.unitsCount} ед.`
                        : ' · не используется'}
                    </div>
                  </div>
                  {canDelete ? (
                    <button
                      type="button"
                      className="button-danger"
                      disabled={!canDeleteItem || pendingId === item.id}
                      onClick={() => {
                        setError(null);
                        setConfirmId(item.id);
                      }}
                    >
                      Удалить тип
                    </button>
                  ) : null}
                </div>

                {isConfirming && canDeleteItem ? (
                  <div className="inline-notice inline-notice--warning">
                    <strong>Удалить тип «{item.name}»?</strong>
                    <div>Он не используется ни одной единицей оборудования.</div>
                    <div className="action-row">
                      <button
                        type="button"
                        className="button-danger"
                        disabled={pendingId === item.id}
                        onClick={() => {
                          setPendingId(item.id);
                          setError(null);
                          void onDelete(item.id)
                            .then(() => setConfirmId(null))
                            .catch((deleteError: unknown) =>
                              setError(
                                getErrorMessage(
                                  deleteError,
                                  'Не удалось удалить тип оборудования.',
                                ),
                              ),
                            )
                            .finally(() => setPendingId(null));
                        }}
                      >
                        {pendingId === item.id ? 'Удаляем...' : 'Удалить'}
                      </button>
                      <button
                        type="button"
                        className="button-secondary"
                        disabled={pendingId === item.id}
                        onClick={() => setConfirmId(null)}
                      >
                        Отмена
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}

      {error ? <div className="form-error">{error}</div> : null}
    </div>
  );
}

export function EquipmentUnitForm({
  catalog,
  onSubmit,
}: {
  catalog: EquipmentCatalogItem[];
  onSubmit: (payload: CreateEquipmentUnitPayload) => Promise<void>;
}): React.JSX.Element {
  const [catalogItemId, setCatalogItemId] = useState(catalog[0]?.id ?? '');
  const [inventoryNumber, setInventoryNumber] = useState('');
  const [serialNumber, setSerialNumber] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!catalog.some((item) => item.id === catalogItemId)) {
      setCatalogItemId(catalog[0]?.id ?? '');
    }
  }, [catalog, catalogItemId]);

  return (
    <form
      className="page-card"
      style={{ display: 'grid', gap: 12 }}
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        setIsSaving(true);
        void onSubmit({
          catalogItemId,
          inventoryNumber,
          ...(serialNumber.trim() ? { serialNumber } : {}),
          ...(notes.trim() ? { notes } : {}),
        })
          .catch((submitError) =>
            setError(getErrorMessage(submitError, 'Не удалось создать единицу.')),
          )
          .finally(() => setIsSaving(false));
      }}
    >
      <strong>Новая единица оборудования</strong>
      <select value={catalogItemId} onChange={(event) => setCatalogItemId(event.target.value)} required>
        {catalog.map((item) => (
          <option key={item.id} value={item.id}>
            {item.category} · {item.name}
          </option>
        ))}
      </select>
      <input value={inventoryNumber} onChange={(event) => setInventoryNumber(event.target.value)} placeholder="Инвентарный номер" required />
      <input value={serialNumber} onChange={(event) => setSerialNumber(event.target.value)} placeholder="Серийный номер" />
      <textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Заметки" rows={2} />
      {error ? <div style={{ color: '#b91c1c' }}>{error}</div> : null}
      <button type="submit" disabled={isSaving || catalog.length === 0}>
        {isSaving ? 'Создаем...' : 'Создать единицу'}
      </button>
    </form>
  );
}
