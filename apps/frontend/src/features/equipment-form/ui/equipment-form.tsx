'use client';

import React, { useState } from 'react';

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
