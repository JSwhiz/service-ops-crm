'use client';

import Link from 'next/link';
import React, { useContext, useEffect, useRef } from 'react';

import { ApiError } from '@/shared/api/fetcher';
import { getAccessGeneration, getAccessSessionGeneration, isAccessGenerationCurrent } from '@/shared/auth/access-generation';
import { AccessSnapshotBlockedContext } from '@/shared/auth/access-snapshot-boundary';
import { useAuth } from '@/shared/auth/use-auth';
import { useCreateDraft } from '@/shared/drafts';

import type { InventoryMovement } from '@/entities/inventory/model/inventory.types';
import { getUserDisplayName } from '@/shared/lib/display-name';
import {
  formatInventoryQuantity,
  getInventoryMovementTypeLabel,
} from '@/shared/lib/inventory-presentation';
import { AttachmentPreviewList } from '@/shared/ui/media-entry/attachment-preview-list';
import { PendingMediaList } from '@/shared/ui/media-entry/pending-media-list';
import { Alert, Button, Surface } from '@/shared/ui/foundation';


type StandalonePhotoDraft = {
  file: File | null;
  acknowledgedFile: File | null;
  uncertain: boolean;
  message: string | null;
};
const emptyPhotoDraft: StandalonePhotoDraft = { file: null, acknowledgedFile: null, uncertain: false, message: null };
type StandalonePhotoCallbacks = {
  onAttachStandalonePhoto?: (movementId: string, file: File) => Promise<void>;
  onPhotoAcknowledgedWithoutView?: () => void;
  onRefresh?: () => Promise<void>;
};

function StandaloneMovementPhoto({ item, onAttachStandalonePhoto, onPhotoAcknowledgedWithoutView, onRefresh }: { item: InventoryMovement } & StandalonePhotoCallbacks): React.JSX.Element | null {
  const { user, capabilitiesRefreshError } = useAuth();
  const renderSession = getAccessSessionGeneration();
  const renderGeneration = getAccessGeneration();
  const blocked = useContext(AccessSnapshotBlockedContext);
  // The existing provider retains the actual File and the submission lock when
  // a history reload temporarily unmounts this row. It is scoped to user/route/query.
  const sourceKey = JSON.stringify([item.id, item.inventoryItem.id, item.relatedObject?.id, item.relatedOneTimeOrder?.id]);
  const draft = useCreateDraft(`inventory-standalone-photo:${sourceKey}`, emptyPhotoDraft);
  const allowed = item.projection.canAttachStandalonePhoto === true && user?.capabilities?.canUploadFile === true && !capabilitiesRefreshError && !blocked && !!onAttachStandalonePhoto;
  const current = useRef({ sourceKey, allowed, onAttachStandalonePhoto, onPhotoAcknowledgedWithoutView, onRefresh });
  current.current = { sourceKey, allowed, onAttachStandalonePhoto, onPhotoAcknowledgedWithoutView, onRefresh };
  const mounted = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const picker = useRef<HTMLInputElement>(null);
  const pickerSession = useRef<number | null>(null);
  const { file, acknowledgedFile, uncertain, message } = draft.value;
  const acknowledged = acknowledgedFile !== null;

  const upload = async (): Promise<void> => {
    if (!file || acknowledged || uncertain || draft.submitting || !current.current.allowed || renderSession !== getAccessSessionGeneration() || !isAccessGenerationCurrent(renderGeneration)) return;
    const submittedFile = file;
    const session = getAccessSessionGeneration();
    const generation = getAccessGeneration();
    const available = (): boolean => mounted.current && current.current.sourceKey === sourceKey && current.current.allowed && isAccessGenerationCurrent(generation) && getAccessSessionGeneration() === session;
    try {
      await draft.submit(async () => {
        const attach = current.current.onAttachStandalonePhoto;
        if (!attach || !available()) return;
        try {
          await attach(item.id, submittedFile);
        } catch (error: unknown) {
          if (getAccessSessionGeneration() !== session) return;
          const apiError = error instanceof ApiError ? error : null;
          const unknownOutcome = !apiError || apiError.statusCode === 0 || apiError.statusCode >= 500 || apiError.code === 'ACCESS_VERSION_CHANGED';
          draft.setValue((value) => value.file === submittedFile && !value.acknowledgedFile ? {
            ...value,
            uncertain: unknownOutcome,
            message: unknownOutcome
              ? 'Результат загрузки нужно проверить в истории. Выбранное фото сохранено; повторная загрузка не запущена.'
              : apiError?.statusCode === 403 || apiError?.statusCode === 404
                ? 'Добавление фото недоступно. Выбранное фото сохранено в черновике.'
                : apiError?.message ?? 'Не удалось добавить фото. Черновик сохранён.',
          } : value);
          return;
        }
        if (getAccessSessionGeneration() !== session) return;
        // Store the real acknowledgement BEFORE any access/target check or read
        // refresh. A private/erroring history must never turn this into a retry.
        const lostView = !available();
        const parentAcknowledgement = lostView && !!current.current.onPhotoAcknowledgedWithoutView;
        draft.setValue((value) => value.file === submittedFile ? { ...value, file: null, acknowledgedFile: submittedFile, uncertain: false, message: parentAcknowledgement ? null : 'Фото прикреплено.' } : value);
        draft.setDirty(false);
        if (lostView) { current.current.onPhotoAcknowledgedWithoutView?.(); return; }
        try {
          await current.current.onRefresh?.();
        } catch {
          if (getAccessSessionGeneration() !== session) return;
          draft.setValue((value) => value.acknowledgedFile === submittedFile
            ? { ...value, message: 'Фото прикреплено. История сейчас недоступна; повторять загрузку не нужно.' }
            : value);
          draft.setDirty(false);
        }
      });
    } catch {
      // The provider's synchronous lock can reject a second click before React
      // paints pending state. It must not alter the first request or its ACK.
    }
  };

  if (!onAttachStandalonePhoto || (!allowed && !file && !acknowledged)) return null;
  return <div className="ui-stack ui-stack--sm">
    <input
      ref={picker}
      type="file"
      accept="image/*"
      aria-label="Фото движения"
      hidden
      disabled={!allowed || draft.submitting}
      onChange={(event) => {
        const selected = event.currentTarget.files?.[0];
        event.currentTarget.value = '';
        // A same-session file selected in an already open picker remains an
        // own draft on deny; it does not cause an upload. Never cross accounts.
        if (!selected || draft.submitting || pickerSession.current !== getAccessSessionGeneration() || renderSession !== getAccessSessionGeneration() || current.current.sourceKey !== sourceKey) return;
        draft.setValue({ file: selected, acknowledgedFile: null, uncertain: false, message: null });
      }}
    />
    <div className="ui-inline">
      <Button type="button" disabled={!allowed || draft.submitting} onClick={() => {
        if (!current.current.allowed || draft.submitting || renderSession !== getAccessSessionGeneration() || !isAccessGenerationCurrent(renderGeneration)) return;
        pickerSession.current = getAccessSessionGeneration();
        picker.current?.click();
      }}>{file ? 'Выбрать другое фото' : acknowledged ? 'Добавить ещё фото' : 'Добавить фото'}</Button>
      {file && !acknowledged ? <Button type="button" pending={draft.submitting} disabled={!allowed || uncertain} onClick={() => { void upload(); }}>Загрузить фото</Button> : null}
      {uncertain && onRefresh ? <Button type="button" disabled={draft.submitting || blocked} onClick={() => { void onRefresh().catch(() => undefined); }}>Обновить историю</Button> : null}
    </div>
    {file && !acknowledged ? <PendingMediaList files={[file]} onRemove={draft.submitting ? undefined : () => draft.clear()} /> : null}
    {!allowed && file && !acknowledged ? <Alert tone="warning" role="status">Добавление фото недоступно. Черновик сохранён. После возврата доступа загрузите фото вручную.</Alert> : null}
    {message ? <Alert tone={acknowledged ? 'success' : 'warning'} role="status">{message}</Alert> : null}
  </div>;
}

export function InventoryMovementList({
  items,
  onAttachStandalonePhoto,
  onPhotoAcknowledgedWithoutView,
  onRefresh,
}: {
  items: InventoryMovement[];
} & StandalonePhotoCallbacks): React.JSX.Element {
  if (items.length === 0) {
    return <Surface padding="md">Движений по текущему фильтру пока нет.</Surface>;
  }

  return (
    <div className="record-list local-scroll local-scroll--lg">
      {items.map((item) => (
        <Surface padding="md"
          key={item.id}

          style={{ display: 'grid', gap: 12, minWidth: 0, overflowWrap: 'anywhere' }}
        >
          <div
            style={{
              display: 'grid',
              gap: 12,
              gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 180px), 1fr))',
            }}
          >
            <div>
              <div className="ui-text-muted">Тип движения</div>
              <div>{getInventoryMovementTypeLabel(item.movementType)}</div>
            </div>
            <div>
              <div className="ui-text-muted">Номенклатура</div>
              <div>{item.inventoryItem.name}</div>
            </div>
            <div>
              <div className="ui-text-muted">Количество</div>
              <div>
                {formatInventoryQuantity(item.quantity, item.inventoryItem.unit)}
                {' • '}
                <span
                  style={{
                    color: item.signedQuantity >= 0 ? 'var(--ui-success)' : 'var(--ui-danger)',
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
              <div className="ui-text-muted">Стоимость</div>
              <div>
                {item.unitPriceSnapshot.toLocaleString('ru-RU')} ₽ /{' '}
                {item.inventoryItem.unit}
                {' • '}
                {item.totalAmountSnapshot.toLocaleString('ru-RU')} ₽
              </div>
            </div>
            <div>
              <div className="ui-text-muted">Создано</div>
              <div>{new Date(item.createdAt).toLocaleString('ru-RU')}</div>
            </div>
            <div>
              <div className="ui-text-muted">Статус движения</div>
              <div>
                {item.status === 'pending_approval'
                  ? 'Ожидает согласования'
                  : item.status === 'rejected'
                    ? 'Отклонено'
                    : item.status === 'cancelled'
                      ? 'Отменено'
                      : 'Применено'}
              </div>
            </div>
          </div>

          <div
            style={{
              display: 'grid',
              gap: 12,
              gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 180px), 1fr))',
            }}
          >
            <div>
              <div className="ui-text-muted">Объект</div>
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
              <div className="ui-text-muted">Разовый заказ</div>
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
              <div className="ui-text-muted">Создал</div>
              <div>{getUserDisplayName(item.createdBy)}</div>
            </div>
            <div>
              <div className="ui-text-muted">Фото и подтверждение</div>
              <div>
                {item.projection.hasEvidence
                  ? 'Фото или файл приложены'
                  : item.projection.approvalBridgeResolvedAt
                    ? `Отсутствие фото согласовано${
                        item.projection.approvalBridgeResolvedBy
                          ? ` · ${getUserDisplayName(
                              item.projection.approvalBridgeResolvedBy,
                            )}`
                          : ''
                      }`
                  : item.projection.requiresApprovalBridge
                    ? 'Ожидает согласования отсутствия фото'
                    : 'Фото и файлы не приложены'}
              </div>
            </div>
          </div>

          {item.comment ? (
            <div>
              <div className="ui-text-muted">Комментарий</div>
              <div>{item.comment}</div>
            </div>
          ) : null}

          {item.projection.isSensitive ? (
            <div className="ui-text-muted">Операция требует дополнительного контроля.</div>
          ) : null}

          {item.approvalRequest ? (
            <Link
              href={`/approvals?sourceEntityType=inventory_movement&sourceEntityId=${item.id}`}
            >
              Открыть согласование
            </Link>
          ) : null}

          <StandaloneMovementPhoto key={item.id} item={item} onAttachStandalonePhoto={onAttachStandalonePhoto} onPhotoAcknowledgedWithoutView={onPhotoAcknowledgedWithoutView} onRefresh={onRefresh} />

          <AttachmentPreviewList
            files={item.attachments}
            emptyText="Подтверждающие файлы пока не приложены."
          />
        </Surface>
      ))}
    </div>
  );
}
