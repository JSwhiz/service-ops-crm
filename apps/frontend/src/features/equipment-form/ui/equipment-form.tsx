'use client';

import React, { useEffect, useState } from 'react';

import type {
  CreateEquipmentCatalogItemPayload,
  CreateEquipmentUnitPayload,
  EquipmentCatalogItem,
} from '@/entities/equipment/model/equipment.types';
import { Select } from '@/shared/ui/searchable-select/select';
import { Alert, Button, Field, Surface } from '@/shared/ui/foundation';

import styles from './equipment-form.module.css';

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
      className="ui-surface ui-surface--padded ui-stack ui-stack--md"
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
      <div className="ui-section-title">Новый тип оборудования</div>
      <div className={styles.grid}>
        <Field label="Категория" required><input value={category} onChange={(event) => setCategory(event.target.value)} placeholder="Например, пылесос" required /></Field>
        <Field label="Название" required><input value={name} onChange={(event) => setName(event.target.value)} placeholder="Как называть тип в списках" required /></Field>
        <Field label="Бренд"><input value={brand} onChange={(event) => setBrand(event.target.value)} /></Field>
        <Field label="Модель"><input value={model} onChange={(event) => setModel(event.target.value)} /></Field>
      </div>
      <Field label="Заметки"><textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={2} /></Field>
      {error ? <Alert tone="danger" role="alert">{error}</Alert> : null}
      <div className="ui-inline">
        <Button variant="primary" type="submit" pending={isSaving} pendingLabel="Создаём…">
          Создать тип
        </Button>
      </div>
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
    <Surface padding="md" className="ui-stack ui-stack--md">
      <div className="ui-section-header">
        <div>
          <div className="ui-section-title">Типы оборудования</div>
          <div className="ui-text-muted">
            Пустой тип можно удалить. Тип с заведёнными единицами сохраняется.
          </div>
        </div>
      </div>

      {catalog.length === 0 ? (
        <div className="ui-text-muted">Типы оборудования пока не созданы.</div>
      ) : (
        <div className="record-list">
          {catalog.map((item) => {
            const isConfirming = confirmId === item.id;
            const canDeleteItem = canDelete && item.unitsCount === 0;

            return (
              <Surface padding="sm" key={item.id}>
                <div className="ui-section-header">
                  <div>
                    <strong>{item.name}</strong>
                    <div className="ui-text-muted">
                      {item.category}
                      {item.brand ? ` · ${item.brand}` : ''}
                      {item.model ? ` · ${item.model}` : ''}
                      {item.unitsCount > 0
                        ? ` · ${item.unitsCount} ед.`
                        : ' · не используется'}
                    </div>
                  </div>
                  {canDeleteItem ? (
                    <Button variant="ghost" size="sm"
                      disabled={pendingId === item.id}
                      onClick={() => {
                        setError(null);
                        setConfirmId(item.id);
                      }}
                    >
                      Удалить тип
                    </Button>
                  ) : null}
                </div>

                {isConfirming && canDeleteItem ? (
                  <Alert tone="warning">
                    <strong>Удалить тип «{item.name}»?</strong>
                    <div>Он не используется ни одной единицей оборудования.</div>
                    <div className="ui-inline">
                      <Button variant="danger"
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
                      </Button>
                      <Button
                        disabled={pendingId === item.id}
                        onClick={() => setConfirmId(null)}
                      >
                        Отмена
                      </Button>
                    </div>
                  </Alert>
                ) : null}
              </Surface>
            );
          })}
        </div>
      )}

      {error ? <div className="form-error">{error}</div> : null}
    </Surface>
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
      className="ui-surface ui-surface--padded"
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
      <Select value={catalogItemId} onChange={(event) => setCatalogItemId(event.target.value)} required>
        {catalog.map((item) => (
          <option key={item.id} value={item.id}>
            {item.category} · {item.name}
          </option>
        ))}
      </Select>
      <input value={inventoryNumber} onChange={(event) => setInventoryNumber(event.target.value)} placeholder="Инвентарный номер" required />
      <input value={serialNumber} onChange={(event) => setSerialNumber(event.target.value)} placeholder="Серийный номер" />
      <textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Заметки" rows={2} />
      {error ? <Alert tone="danger" role="alert">{error}</Alert> : null}
      <Button variant="primary" type="submit" disabled={isSaving || catalog.length === 0}>
        {isSaving ? 'Создаем...' : 'Создать единицу'}
      </Button>
    </form>
  );
}
