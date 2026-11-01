'use client';

import React, { useState } from 'react';

import type {
  EquipmentCatalogItem,
} from '@/entities/equipment/model/equipment.types';
import { Alert, Button, Surface } from '@/shared/ui/foundation';


function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() ? error.message : fallback;
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

      {error ? <Alert tone="danger" role="alert">{error}</Alert> : null}
    </Surface>
  );
}
