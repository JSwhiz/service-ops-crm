'use client';

import Link from 'next/link';
import React from 'react';

import type { EquipmentUnit } from '@/entities/equipment/model/equipment.types';
import styles from '@/features/object-shared-ui/object-surfaces.module.css';
import { getEquipmentStatusLabel } from '@/shared/lib/equipment-presentation';

export function EquipmentScopePanel({
  title,
  units,
}: {
  title: string;
  units: EquipmentUnit[];
}): React.JSX.Element {
  return (
    <div className={`page-card ${styles.workPanel}`}>
      <div className={styles.panelHeader}>
        <div className="section-title">{title}</div>
        <span className={styles.panelMeta}>{units.length}</span>
      </div>

      {units.length === 0 ? (
        <div className={styles.emptyState}>Оборудование не закреплено.</div>
      ) : (
        <div className="record-list local-scroll local-scroll--sm">
          {units.map((unit) => (
            <div key={unit.id} className="record-card">
              {unit.capabilities.canCreateMovement ? (
                <Link href={`/equipment/${unit.id}`}>
                  {unit.catalogItem.name} · {unit.inventoryNumber}
                </Link>
              ) : (
                <strong>{unit.catalogItem.name} · {unit.inventoryNumber}</strong>
              )}
              <div className={styles.panelMeta}>
                <span className="status-pill" data-status={unit.status}>
                  {getEquipmentStatusLabel(unit.status)}
                </span>
                {unit.notes ? ` · ${unit.notes}` : ''}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
