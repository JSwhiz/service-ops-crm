'use client';

import Link from 'next/link';
import React, { useState } from 'react';
import { ApiError } from '@/shared/api/fetcher';

import type {
  CreateEquipmentMovementFormPayload,
  CreateEquipmentMovementPayload,
  EquipmentMovement,
  EquipmentUnit,
} from '@/entities/equipment/model/equipment.types';
import type { ServiceObject } from '@/entities/object/model/object.types';
import type { OneTimeOrderListItem } from '@/entities/one-time-order/model/one-time-order.types';
import { getUserDisplayName } from '@/shared/lib/display-name';
import {
  EQUIPMENT_MOVEMENT_OPTIONS,
  getEquipmentMovementLabel,
  getEquipmentStatusLabel,
} from '@/shared/lib/equipment-presentation';
import { AttachmentPreviewList } from '@/shared/ui/media-entry/attachment-preview-list';
import { MediaActionPicker } from '@/shared/ui/media-entry/media-action-picker';
import { AccessSnapshotBoundary } from '@/shared/auth/access-snapshot-boundary';
import { PendingMediaList } from '@/shared/ui/media-entry/pending-media-list';
import { Alert, Button, Field, Stack, StatusBadge, Surface } from '@/shared/ui/foundation';
import { SearchableSelect } from '@/shared/ui/searchable-select/searchable-select';

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
  orders: OneTimeOrderListItem[];
  onCreateMovement: (params: CreateEquipmentMovementFormPayload) => Promise<void>;
}): React.JSX.Element {
  const [requestedMovementType, setMovementType] = useState('issue_to_object');
  const [toObjectId, setToObjectId] = useState('');
  const [toOneTimeOrderId, setToOneTimeOrderId] = useState('');
  const [comment, setComment] = useState('');
  const [evidenceFiles, setEvidenceFiles] = useState<File[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const canSubmit = unit.capabilities.canCreateMovement;
  const allowedTypes = EQUIPMENT_MOVEMENT_OPTIONS.filter((type) => {
    switch (type) {
      case 'issue_to_object': return unit.capabilities.canAssignToObject;
      case 'issue_to_one_time_order': return unit.capabilities.canAssignToOneTimeOrder;
      case 'return_to_storage': return unit.capabilities.canReturn;
      case 'send_to_repair': return unit.capabilities.canSendToRepair;
      case 'return_from_repair': return unit.capabilities.canReturnFromRepair;
      case 'mark_broken': return unit.capabilities.canMarkBroken;
      case 'mark_lost': return unit.capabilities.canMarkLost ?? unit.capabilities.canMarkBroken;
      case 'writeoff': return unit.capabilities.canWriteoff;
    }
  });
  const movementType = allowedTypes.find((value) => value === requestedMovementType) ?? allowedTypes[0] ?? '';

  return (
    <Stack gap="lg">
      <AccessSnapshotBoundary key={unit.id} blocked={!canSubmit || allowedTypes.length === 0}>
        <form
          className="ui-surface ui-surface--padded"
          style={{ display: 'grid', gap: 12 }}
          onSubmit={(event) => {
            event.preventDefault();
            if (isSaving || !canSubmit || !allowedTypes.some((type) => type === movementType)) return;
            setIsSaving(true);
            setSubmitError(null);
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
            }).then(() => {
              setComment('');
              setEvidenceFiles([]);
            }).catch((failure: unknown) => {
              setSubmitError(failure instanceof ApiError && failure.statusCode === 403
                ? 'Нет доступа к этой операции. Черновик сохранён.'
                : 'Не удалось записать операцию. Черновик сохранён.');
            }).finally(() => {
              setIsSaving(false);
            });
          }}
        >
          <div className="ui-section-header">
            <div>
              <div className="ui-section-title">Операция с оборудованием</div>
              <div className="ui-section-subtitle">
                Выдача, возврат, ремонт или списание оборудования.
              </div>
            </div>
          </div>
          <SearchableSelect label="Операция" value={movementType} onChange={setMovementType} clearable={false} searchable={false} viewportAware disabled={isSaving} options={allowedTypes.map((type) => ({ value: type, label: getEquipmentMovementLabel(type) }))} />
          {movementType === 'issue_to_object' ? (
            <SearchableSelect label="Объект" value={toObjectId} onChange={setToObjectId} required viewportAware disabled={isSaving} placeholder="Выберите объект" options={objects.map((object) => ({ value: object.id, label: object.name }))} />
          ) : null}
          {movementType === 'issue_to_one_time_order' ? (
            <SearchableSelect label="Заказ" value={toOneTimeOrderId} onChange={setToOneTimeOrderId} required viewportAware disabled={isSaving} placeholder="Выберите заказ" options={orders.map((order) => ({ value: order.id, label: order.title }))} />
          ) : null}
          <Field label="Комментарий">
            <textarea value={comment} onChange={(event) => setComment(event.target.value)} rows={2} placeholder="Комментарий" />
          </Field>
          <div style={{ display: 'grid', gap: 8 }}>
            <div className="ui-text-muted">
              Можно приложить фото или документы к операции.
            </div>
            <MediaActionPicker
              disabled={isSaving || !canSubmit || allowedTypes.length === 0}
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
          {submitError ? <Alert tone="warning" role="alert">{submitError}</Alert> : null}
          <div className="ui-inline">
            <Button type="submit" variant="primary" pending={isSaving} disabled={(movementType === 'issue_to_object' && !toObjectId) || (movementType === 'issue_to_one_time_order' && !toOneTimeOrderId)}>
              {isSaving ? 'Сохраняем...' : 'Записать операцию'}
            </Button>
          </div>
        </form>
      </AccessSnapshotBoundary>

      <div className="record-list local-scroll local-scroll--lg">
        {movements.length === 0 ? (
          <Surface padding="md">История пока пуста.</Surface>
        ) : (
          movements.map((movement) => (
            <Surface padding="sm" key={movement.id} style={{ display: 'grid', gap: 8 }}>
              <strong>{getEquipmentMovementLabel(movement.movementType)}</strong>
              <div className="ui-text-muted">
                {movement.fromStatus ? (
                  <StatusBadge status={movement.fromStatus}>
                    {getEquipmentStatusLabel(movement.fromStatus)}
                  </StatusBadge>
                ) : (
                  '—'
                )}{' '}
                →{' '}
                <StatusBadge status={movement.toStatus}>
                  {getEquipmentStatusLabel(movement.toStatus)}
                </StatusBadge>
              </div>
              <div className="ui-text-muted">
                {new Date(movement.createdAt).toLocaleString('ru-RU')} ·{' '}
                {getUserDisplayName(movement.createdBy)}
              </div>
              <div className="ui-text-muted">
                {movement.status === 'pending_approval'
                  ? 'Ожидает согласования'
                  : movement.status === 'rejected'
                    ? 'Отклонено'
                    : movement.status === 'cancelled'
                      ? 'Отменено'
                      : 'Применено'}
              </div>
              {movement.toObject ? <div>Объект: {movement.toObject.name}</div> : null}
              {movement.toOneTimeOrder ? <div>Заказ: {movement.toOneTimeOrder.title}</div> : null}
              {movement.comment ? <div>{movement.comment}</div> : null}
              {movement.approvalRequest ? (
                <Link
                  href={`/approvals?sourceEntityType=equipment_movement&sourceEntityId=${movement.id}`}
                >
                  Открыть согласование
                </Link>
              ) : null}
              <AttachmentPreviewList files={movement.attachments} emptyText="Файлы не приложены." />
            </Surface>
          ))
        )}
      </div>
    </Stack>
  );
}
