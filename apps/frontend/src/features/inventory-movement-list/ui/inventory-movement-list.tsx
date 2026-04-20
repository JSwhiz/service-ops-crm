'use client';

import Link from 'next/link';
import React from 'react';

import type { InventoryMovement } from '@/entities/inventory/model/inventory.types';
import {
  formatInventoryQuantity,
  getInventoryMovementTypeLabel,
} from '@/shared/lib/inventory-presentation';
import { AttachmentPreviewList } from '@/shared/ui/media-entry/attachment-preview-list';

export function InventoryMovementList({
  items,
}: {
  items: InventoryMovement[];
}): React.JSX.Element {
  if (items.length === 0) {
    return <div className="page-card">Движений по текущему фильтру пока нет.</div>;
  }

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {items.map((item) => (
        <div
          key={item.id}
          className="page-card"
          style={{ display: 'grid', gap: 12 }}
        >
          <div
            style={{
              display: 'grid',
              gap: 12,
              gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
            }}
          >
            <div>
              <div className="page-muted">Тип движения</div>
              <div>{getInventoryMovementTypeLabel(item.movementType)}</div>
            </div>
            <div>
              <div className="page-muted">Номенклатура</div>
              <div>{item.inventoryItem.name}</div>
            </div>
            <div>
              <div className="page-muted">Количество</div>
              <div>
                {formatInventoryQuantity(item.quantity, item.inventoryItem.unit)}
                {' • '}
                <span
                  style={{
                    color: item.signedQuantity >= 0 ? '#166534' : '#b91c1c',
                  }}
                >
                  {item.signedQuantity >= 0 ? '+' : ''}
                  {formatInventoryQuantity(
                    item.signedQuantity,
                    item.inventoryItem.unit,
                  )}
                </span>
              </div>
            </div>
            <div>
              <div className="page-muted">Создано</div>
              <div>{new Date(item.createdAt).toLocaleString('ru-RU')}</div>
            </div>
          </div>

          <div
            style={{
              display: 'grid',
              gap: 12,
              gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
            }}
          >
            <div>
              <div className="page-muted">Объект</div>
              <div>
                {item.relatedObject ? (
                  item.relatedObject.canOpenObjectCard ? (
                    <Link href={`/objects/${item.relatedObject.id}`}>
                      {item.relatedObject.name}
                    </Link>
                  ) : (
                    item.relatedObject.name
                  )
                ) : (
                  '—'
                )}
              </div>
            </div>
            <div>
              <div className="page-muted">Разовый заказ</div>
              <div>
                {item.relatedOneTimeOrder ? (
                  item.relatedOneTimeOrder.canOpenOrderCard ? (
                    <Link href={`/one-time-orders/${item.relatedOneTimeOrder.id}`}>
                      {item.relatedOneTimeOrder.title}
                    </Link>
                  ) : (
                    item.relatedOneTimeOrder.title
                  )
                ) : (
                  '—'
                )}
              </div>
            </div>
            <div>
              <div className="page-muted">Создал</div>
              <div>{item.createdBy.fullName}</div>
            </div>
            <div>
              <div className="page-muted">Статус evidence</div>
              <div>
                {item.projection.hasEvidence
                  ? 'Подтверждение приложено'
                  : item.projection.requiresApprovalBridge
                    ? 'Нужно подтверждение исключения'
                    : 'Без вложений'}
              </div>
            </div>
          </div>

          {item.comment ? (
            <div>
              <div className="page-muted">Комментарий</div>
              <div>{item.comment}</div>
            </div>
          ) : null}

          {item.projection.isSensitive ? (
            <div className="page-muted">
              Чувствительное действие: требует повышенного внимания в audit и
              approval bridge.
            </div>
          ) : null}

          <AttachmentPreviewList
            files={item.attachments}
            emptyText="Подтверждающие файлы пока не приложены."
          />
        </div>
      ))}
    </div>
  );
}
