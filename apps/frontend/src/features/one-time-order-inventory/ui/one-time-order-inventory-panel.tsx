'use client';

import React from 'react';
import { AccessSnapshotBoundary } from '@/shared/auth/access-snapshot-boundary';

import type { InventoryMovement, InventoryItem } from '@/entities/inventory/model/inventory.types';
import { getUserDisplayName } from '@/shared/lib/display-name';
import {
  formatInventoryQuantity,
  getInventoryMovementTypeLabel,
} from '@/shared/lib/inventory-presentation';
import { AttachmentPreviewList } from '@/shared/ui/media-entry/attachment-preview-list';
import { Surface } from '@/shared/ui/foundation';
import { OneTimeOrderInventoryIssueForm, type OrderInventoryIssueInput } from './one-time-order-inventory-issue-form';

export function OneTimeOrderInventoryPanel({
  orderId,
  items,
  availableItems,
  canIssue,
  onIssue,
  onAttachEvidence,
  onRefresh,
}: {
  orderId: string;
  items: InventoryMovement[];
  availableItems: InventoryItem[];
  canIssue: boolean;
  onIssue: (input: OrderInventoryIssueInput, hasPendingPhotos: boolean) => Promise<string | null>;
  onAttachEvidence: (movementId: string, files: File[]) => Promise<void>;
  onRefresh: () => Promise<void>;
}): React.JSX.Element {
  return (
    <Surface as="section" padding="md">
      <div className="ui-section-header">
        <div>
          <div className="ui-section-title">Расходники заказа</div>
          <div className="ui-section-subtitle">
            Что было выдано, возвращено или списано именно по этому разовому заказу.
          </div>
        </div>
        <strong>{items.length}</strong>
      </div>

      <AccessSnapshotBoundary blocked={!canIssue}><OneTimeOrderInventoryIssueForm orderId={orderId} availableItems={availableItems} onIssue={onIssue} onAttachEvidence={onAttachEvidence} onRefresh={onRefresh} /></AccessSnapshotBoundary>

      {items.length === 0 ? (
        <div className="ui-text-muted">Движений расходников по заказу пока нет.</div>
      ) : (
        <div className="record-list" style={{ marginTop: 12 }}>
          {items.map((movement) => (
            <Surface as="article" padding="sm" key={movement.id}>
              <div className="ui-section-header">
                <div>
                  <strong>{movement.inventoryItem.name}</strong>
                  <div className="ui-text-muted">
                    {getInventoryMovementTypeLabel(movement.movementType)} ·{' '}
                    {formatInventoryQuantity(
                      movement.quantity,
                      movement.inventoryItem.unit,
                    )}
                    {' · '}{movement.status === 'applied' ? 'Проведено' : movement.status === 'cancelled' ? 'Отменено' : 'Не проведено'}
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <strong>
                    {movement.totalAmountSnapshot.toLocaleString('ru-RU')} ₽
                  </strong>
                  <div className="ui-text-muted">
                    {new Date(movement.createdAt).toLocaleString('ru-RU')}
                  </div>
                </div>
              </div>

              <div className="ui-text-muted">
                Оформил: {getUserDisplayName(movement.createdBy)}
              </div>
              {movement.relatedObject ? (
                <div className="ui-text-muted">Объект: {movement.relatedObject.name}</div>
              ) : null}
              {movement.comment ? <div>{movement.comment}</div> : null}
              {movement.attachments.length > 0 ? (
                <AttachmentPreviewList files={movement.attachments} />
              ) : null}
            </Surface>
          ))}
        </div>
      )}
    </Surface>
  );
}
