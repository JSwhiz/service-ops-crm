'use client';

import React, { useState } from 'react';

import type {
  CreateEquipmentMovementFormPayload,
  CreateEquipmentMovementPayload,
  EquipmentMovement,
  EquipmentUnit,
} from '@/entities/equipment/model/equipment.types';
import type { ServiceObject } from '@/entities/object/model/object.types';
import type { OneTimeOrderItem } from '@/entities/one-time-order/model/one-time-order.types';
import {
  EQUIPMENT_MOVEMENT_OPTIONS,
  getEquipmentMovementLabel,
  getEquipmentStatusLabel,
} from '@/shared/lib/equipment-presentation';
import { AttachmentPreviewList } from '@/shared/ui/media-entry/attachment-preview-list';
import { MediaActionPicker } from '@/shared/ui/media-entry/media-action-picker';
import { PendingMediaList } from '@/shared/ui/media-entry/pending-media-list';

export function EquipmentMovementPanel({
  unit,
  movements,
  objects,
  orders,
  onCreateMovement,
}: {
  unit: EquipmentUnit;
  movements: EquipmentMovement[];
  objects: ServiceObject[];
  orders: OneTimeOrderItem[];
  onCreateMovement: (params: CreateEquipmentMovementFormPayload) => Promise<void>;
}): React.JSX.Element {
  const [movementType, setMovementType] = useState('issue_to_object');
  const [toObjectId, setToObjectId] = useState('');
  const [toOneTimeOrderId, setToOneTimeOrderId] = useState('');
  const [comment, setComment] = useState('');
  const [evidenceFiles, setEvidenceFiles] = useState<File[]>([]);
  const [isSaving, setIsSaving] = useState(false);

  const canSubmit = unit.capabilities.canCreateMovement;

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      {canSubmit ? (
        <form
          className="page-card"
          style={{ display: 'grid', gap: 12 }}
          onSubmit={(event) => {
            event.preventDefault();
            setIsSaving(true);
            const payload: CreateEquipmentMovementPayload = {
              movementType,
              ...(movementType === 'issue_to_object' ? { toObjectId } : {}),
              ...(movementType === 'issue_to_one_time_order'
                ? { toOneTimeOrderId }
                : {}),
              ...(comment.trim() ? { comment } : {}),
            };

            void onCreateMovement({
              payload,
              evidenceFiles,
            }).finally(() => {
              setIsSaving(false);
              setComment('');
              setEvidenceFiles([]);
            });
          }}
        >
          <div className="section-header">
            <div>
              <div className="section-title">Операция с оборудованием</div>
              <div className="section-subtitle">
                Выдача, возврат, ремонт или списание unit.
              </div>
            </div>
          </div>
          <select value={movementType} onChange={(event) => setMovementType(event.target.value)}>
            {EQUIPMENT_MOVEMENT_OPTIONS.filter((type) =>
              type === 'writeoff' ? unit.capabilities.canWriteoff : true,
            ).map((type) => (
              <option key={type} value={type}>
                {getEquipmentMovementLabel(type)}
              </option>
            ))}
          </select>
          {movementType === 'issue_to_object' ? (
            <select value={toObjectId} onChange={(event) => setToObjectId(event.target.value)} required>
              <option value="">Выберите объект</option>
              {objects.map((object) => (
                <option key={object.id} value={object.id}>
                  {object.name}
                </option>
              ))}
            </select>
          ) : null}
          {movementType === 'issue_to_one_time_order' ? (
            <select value={toOneTimeOrderId} onChange={(event) => setToOneTimeOrderId(event.target.value)} required>
              <option value="">Выберите заказ</option>
              {orders.map((order) => (
                <option key={order.id} value={order.id}>
                  {order.title}
                </option>
              ))}
            </select>
          ) : null}
          <textarea value={comment} onChange={(event) => setComment(event.target.value)} rows={2} placeholder="Комментарий" />
          <div style={{ display: 'grid', gap: 8 }}>
            <div className="page-muted">
              Фото/файлы к операции сохраняются через общий storage слой.
            </div>
            <MediaActionPicker
              disabled={isSaving}
              onPick={async (file) =>
                setEvidenceFiles((current) => [...current, file])
              }
            />
            <PendingMediaList
              files={evidenceFiles}
              onRemove={(index) =>
                setEvidenceFiles((current) =>
                  current.filter((_, currentIndex) => currentIndex !== index),
                )
              }
            />
          </div>
          <div className="action-row">
            <button type="submit" disabled={isSaving}>
              {isSaving ? 'Сохраняем...' : 'Записать операцию'}
            </button>
          </div>
        </form>
      ) : null}

      <div className="record-list local-scroll local-scroll--lg">
        {movements.length === 0 ? (
          <div className="page-card">История пока пуста.</div>
        ) : (
          movements.map((movement) => (
            <div key={movement.id} className="record-card" style={{ display: 'grid', gap: 8 }}>
              <strong>{getEquipmentMovementLabel(movement.movementType)}</strong>
              <div className="page-muted">
                {movement.fromStatus ? getEquipmentStatusLabel(movement.fromStatus) : '—'} →{' '}
                {getEquipmentStatusLabel(movement.toStatus)}
              </div>
              <div className="page-muted">
                {new Date(movement.createdAt).toLocaleString('ru-RU')} · {movement.createdBy.fullName}
              </div>
              {movement.toObject ? <div>Объект: {movement.toObject.name}</div> : null}
              {movement.toOneTimeOrder ? <div>Заказ: {movement.toOneTimeOrder.title}</div> : null}
              {movement.comment ? <div>{movement.comment}</div> : null}
              <AttachmentPreviewList files={movement.attachments} emptyText="Файлы не приложены." />
            </div>
          ))
        )}
      </div>
    </div>
  );
}
