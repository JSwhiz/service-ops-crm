'use client';

import Link from 'next/link';
import React, { useState } from 'react';

import type { EquipmentMovement, EquipmentUnit } from '@/entities/equipment/model/equipment.types';
import { getEquipmentStatusLabel } from '@/shared/lib/equipment-presentation';
import { formatRegistryDate } from '@/shared/lib/registry-presentation';
import { DataTable } from '@/shared/ui/data-table/data-table';
import { RegistryOpenLink } from '@/shared/ui/data-table/registry-open-link';
import { MediaActionPicker } from '@/shared/ui/media-entry/media-action-picker';
import { PendingMediaList } from '@/shared/ui/media-entry/pending-media-list';

import styles from './equipment-list-table.module.css';
import { Alert, Button, Field, Stack, StatusBadge } from '@/shared/ui/foundation';

function getLocation(item: EquipmentUnit): React.ReactNode {
  if (item.currentObject) {
    return item.currentObject.canOpenObjectCard
      ? <Link href={`/objects/${item.currentObject.id}`}>{item.currentObject.name}</Link>
      : item.currentObject.name;
  }

  if (item.currentOneTimeOrder) {
    return item.currentOneTimeOrder.canOpenOrderCard
      ? <Link href={`/one-time-orders/${item.currentOneTimeOrder.id}`}>{item.currentOneTimeOrder.title}</Link>
      : item.currentOneTimeOrder.title;
  }

  return <span className={styles.muted}>Склад</span>;
}

export function EquipmentListTable({
  items,
  onWriteoffUnit,
  onAttachEvidence,
  onRefresh,
}: {
  items: EquipmentUnit[];
  onWriteoffUnit: (unitId: string, comment: string) => Promise<EquipmentMovement>;
  onAttachEvidence: (movementId: string, files: File[]) => Promise<void>;
  onRefresh: () => Promise<void>;
}): React.JSX.Element {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [writeoffMovementIds, setWriteoffMovementIds] = useState<Record<string, string>>({});
  const [writeoffReason, setWriteoffReason] = useState('');
  const [evidenceFiles, setEvidenceFiles] = useState<File[]>([]);
  const [isWritingOff, setIsWritingOff] = useState(false);
  const [writeoffError, setWriteoffError] = useState<string | null>(null);
  const [writeoffSuccess, setWriteoffSuccess] = useState<string | null>(null);
  const eligibleItems = items.filter((item) => item.capabilities.canWriteoff && item.status !== 'written_off');

  const submitWriteoff = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const targets = items.filter((item) => selectedIds.includes(item.id) && item.capabilities.canWriteoff && item.status !== 'written_off');
    if (!targets.length || !writeoffReason.trim()) return;
    setIsWritingOff(true);
    setWriteoffError(null);
    setWriteoffSuccess(null);
    void (async () => {
      let completed = 0;
      try {
        for (const unit of targets) {
          let movementId = writeoffMovementIds[unit.id];
          if (!movementId) {
            const movement = await onWriteoffUnit(unit.id, writeoffReason.trim());
            const createdMovementId = movement.id;
            movementId = createdMovementId;
            setWriteoffMovementIds((current) => ({ ...current, [unit.id]: createdMovementId }));
          }
          if (evidenceFiles.length) await onAttachEvidence(movementId, evidenceFiles);
          setSelectedIds((current) => current.filter((id) => id !== unit.id));
          setWriteoffMovementIds((current) => {
            return Object.fromEntries(Object.entries(current).filter(([unitId]) => unitId !== unit.id));
          });
          completed += 1;
        }
        setWriteoffReason('');
        setEvidenceFiles([]);
        setWriteoffSuccess(`Создано согласований на списание: ${completed}. Каждая единица сохранена отдельно.`);
        try {
          await onRefresh();
        } catch {
          setWriteoffError('Согласования созданы, но список оборудования не удалось обновить. Перезагрузите страницу.');
        }
      } catch (error) {
        setWriteoffError(completed > 0
          ? `Подготовлено операций: ${completed}. Остальные единицы оставлены выбранными. ${error instanceof Error ? error.message : 'Не удалось продолжить списание.'}`
          : error instanceof Error ? error.message : 'Не удалось создать списания.');
      } finally {
        setIsWritingOff(false);
      }
    })();
  };

  if (items.length === 0) {
    return <div className="ui-empty-state">Оборудование пока не заведено.</div>;
  }

  return (
    <>
      {eligibleItems.length > 0 && (selectedIds.length > 0 || writeoffSuccess) ? (
        <form className="ui-surface ui-surface--padded ui-stack ui-stack--md" onSubmit={submitWriteoff}>
          <div className="ui-section-header">
            <div>
              <div className="ui-section-title">Пакетное списание оборудования</div>
              <div className="ui-section-subtitle">Выберите несколько единиц в таблице. На каждую будет создано отдельное согласование.</div>
            </div>
            <strong>{selectedIds.length} выбрано</strong>
          </div>
          {selectedIds.length > 0 ? <>
            <Field label="Причина списания *">
              <textarea value={writeoffReason} onChange={(event) => setWriteoffReason(event.target.value)} rows={2} required disabled={isWritingOff} placeholder="Укажите причину списания" />
            </Field>
            <Stack gap="sm">
              <div className="ui-text-muted">Подтверждающие фото или файлы (необязательно)</div>
              <MediaActionPicker disabled={isWritingOff} onPick={async (file) => setEvidenceFiles((current) => [...current, file])} />
              <PendingMediaList files={evidenceFiles} onRemove={(index) => setEvidenceFiles((current) => current.filter((_, fileIndex) => fileIndex !== index))} emptyText="Подтверждения пока не добавлены." />
            </Stack>
            {writeoffError ? <Alert tone="warning" role="alert">{writeoffError}</Alert> : null}
            {writeoffSuccess ? <Alert tone="success" role="status">{writeoffSuccess}</Alert> : null}
            <div className="ui-inline">
              <Button variant="primary" type="submit" disabled={isWritingOff || !writeoffReason.trim()}>{isWritingOff ? 'Создаём согласования…' : `Отправить на согласование · ${selectedIds.length}`}</Button>
              <Button disabled={isWritingOff} onClick={() => setSelectedIds([])}>Снять выбор</Button>
            </div>
          </> : writeoffSuccess ? <Alert tone="success" role="status">{writeoffSuccess}</Alert> : null}
        </form>
      ) : null}
      <DataTable
        label="Таблица оборудования"
        className={styles.table}
        frameClassName={` ${styles.frame}`}
      >
        <thead>
          <tr>
            {eligibleItems.length ? <th scope="col"><input aria-label="Выбрать все доступные к списанию единицы" type="checkbox" checked={eligibleItems.length > 0 && eligibleItems.every((item) => selectedIds.includes(item.id))} onChange={(event) => setSelectedIds(event.target.checked ? eligibleItems.map((item) => item.id) : [])} disabled={isWritingOff} /></th> : null}
            <th scope="col">Оборудование</th>
            <th scope="col">Категория</th>
            <th scope="col">Статус</th>
            <th scope="col">Местоположение</th>
            <th scope="col">Обновлено</th>
            <th scope="col" aria-label="Открыть" />
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id}>
              {eligibleItems.length ? <td><input aria-label={`Выбрать ${item.catalogItem.name} ${item.inventoryNumber}`} type="checkbox" checked={selectedIds.includes(item.id)} disabled={!item.capabilities.canWriteoff || item.status === 'written_off' || isWritingOff} onChange={(event) => setSelectedIds((current) => event.target.checked ? [...current, item.id] : current.filter((id) => id !== item.id))} /></td> : null}
              <td>
                <Link className={styles.name} href={`/equipment/${item.id}`}>
                  {item.catalogItem.name}
                </Link>
                <span className={styles.secondary}>
                  {item.inventoryNumber}{item.serialNumber ? ` · ${item.serialNumber}` : ''}
                </span>
              </td>
              <td>{item.catalogItem.category}</td>
              <td><StatusBadge status={item.status}>{getEquipmentStatusLabel(item.status)}</StatusBadge></td>
              <td>{getLocation(item)}</td>
              <td title={new Date(item.updatedAt).toLocaleString('ru-RU')}>
                {formatRegistryDate(item.updatedAt)}
              </td>
              <td className={styles.arrowCell}>
                <RegistryOpenLink href={`/equipment/${item.id}`} label={`Открыть ${item.catalogItem.name}`} />
              </td>
            </tr>
          ))}
        </tbody>
      </DataTable>

      <div className={styles.mobileList} aria-label="Оборудование">
        {items.map((item) => (
          <div key={item.id} className={styles.mobileRow}>
            {eligibleItems.length && item.capabilities.canWriteoff && item.status !== 'written_off' ? <input aria-label={`Выбрать ${item.catalogItem.name} ${item.inventoryNumber}`} type="checkbox" checked={selectedIds.includes(item.id)} onChange={(event) => setSelectedIds((current) => event.target.checked ? [...current, item.id] : current.filter((id) => id !== item.id))} disabled={isWritingOff} /> : null}
            <Link href={`/equipment/${item.id}`} className={`ui-surface ui-surface--padded ${styles.mobileCard}`}>
              <span className={styles.mobileHeading}>
                <span>
                  <strong>{item.catalogItem.name}</strong>
                  <span className={styles.secondary}>{item.inventoryNumber}{item.serialNumber ? ` · ${item.serialNumber}` : ''}</span>
                </span>
                <StatusBadge status={item.status}>{getEquipmentStatusLabel(item.status)}</StatusBadge>
              </span>
              <span className={styles.mobileMeta}>
                {item.catalogItem.category} · {item.currentObject?.name ?? item.currentOneTimeOrder?.title ?? 'Склад'}
              </span>
            </Link>
          </div>
        ))}
      </div>
    </>
  );
}
