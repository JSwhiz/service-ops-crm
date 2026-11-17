'use client';

import Link from 'next/link';
import React, { useEffect, useRef, useState } from 'react';

import type { EquipmentUnit } from '@/entities/equipment/model/equipment.types';
import styles from '@/features/object-shared-ui/object-surfaces.module.css';
import { getEquipmentStatusLabel } from '@/shared/lib/equipment-presentation';
import { EquipmentOrderActions } from './equipment-order-actions';
import { Alert, StatusBadge, Surface } from '@/shared/ui/foundation';

export function EquipmentScopePanel({
  title,
  units,
  className,
  orderId,
  onRefresh,
  onSavedWithoutAccess,
}: {
  title: string;
  units: EquipmentUnit[];
  className?: string;
  orderId?: string;
  onRefresh?: () => Promise<void>;
  onSavedWithoutAccess?: () => void;
}): React.JSX.Element {
  const mounted = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const [acknowledgedOrderId, setAcknowledgedOrderId] = useState<string | null>(null);
  if (orderId && acknowledgedOrderId === orderId) {
    return <Alert tone="success" role="status">Действие сохранено. Доступ к данным изменился.</Alert>;
  }
  return (
    <Surface padding="md" className={`${styles.workPanel} ${className ?? ''}`}>
      <div className={styles.panelHeader}>
        <div className="ui-section-title">{title}</div>
        {units.length > 0 ? <span className={styles.panelMeta}>{units.length}</span> : null}
      </div>

      {orderId && onRefresh ? <EquipmentOrderActions key={orderId} orderId={orderId} units={units} onRefresh={onRefresh} onSavedWithoutAccess={() => {
        onSavedWithoutAccess?.();
        if (mounted.current) setAcknowledgedOrderId(orderId);
      }} /> : null}

      {units.length === 0 ? (
        <div className={styles.emptyState}>Оборудование не закреплено.</div>
      ) : (
        <div className="record-list local-scroll local-scroll--sm">
          {units.map((unit) => (
            <Surface padding="sm" key={unit.id}>
              {unit.capabilities.canOpenCard === true ? (
                <Link href={`/equipment/${unit.id}`}>
                  {unit.catalogItem.name} · {unit.inventoryNumber}
                </Link>
              ) : (
                <strong>{unit.catalogItem.name} · {unit.inventoryNumber}</strong>
              )}
              <div className={styles.panelMeta}>
                <StatusBadge status={unit.status}>
                  {getEquipmentStatusLabel(unit.status)}
                </StatusBadge>
                {unit.notes ? ` · ${unit.notes}` : ''}
              </div>
            </Surface>
          ))}
        </div>
      )}
    </Surface>
  );
}
