'use client';

import React from 'react';

import type { InventoryMovement } from '@/entities/inventory/model/inventory.types';
import { getUserDisplayName } from '@/shared/lib/display-name';
import {
  formatInventoryQuantity,
  getInventoryMovementTypeLabel,
} from '@/shared/lib/inventory-presentation';
import { AttachmentPreviewList } from '@/shared/ui/media-entry/attachment-preview-list';

export function OneTimeOrderInventoryPanel({
  items,
}: {
  items: InventoryMovement[];
}): React.JSX.Element {
  return (
    <section className="page-card workspace-surface">
      <div className="section-header">
        <div>
          <div className="section-title">Расходники заказа</div>
          <div className="section-subtitle">
            Что было выдано, возвращено или списано именно по этому разовому заказу.
          </div>
        </div>
        <strong>{items.length}</strong>
      </div>

      {items.length === 0 ? (
        <div className="page-muted">Движений расходников по заказу пока нет.</div>
      ) : (
        <div className="record-list" style={{ marginTop: 12 }}>
          {items.map((movement) => (
            <article key={movement.id} className="record-card">
              <div className="section-header">
                <div>
                  <strong>{movement.inventoryItem.name}</strong>
                  <div className="page-muted">
                    {getInventoryMovementTypeLabel(movement.movementType)} ·{' '}
                    {formatInventoryQuantity(
                      movement.quantity,
                      movement.inventoryItem.unit,
                    )}
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <strong>
                    {movement.totalAmountSnapshot.toLocaleString('ru-RU')} ₽
                  </strong>
                  <div className="page-muted">
                    {new Date(movement.createdAt).toLocaleString('ru-RU')}
                  </div>
                </div>
              </div>

              <div className="page-muted">
                Оформил: {getUserDisplayName(movement.createdBy)}
              </div>
              {movement.comment ? <div>{movement.comment}</div> : null}
              {movement.attachments.length > 0 ? (
                <AttachmentPreviewList files={movement.attachments} />
              ) : null}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
