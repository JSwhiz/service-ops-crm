'use client';

import Link from 'next/link';
import React from 'react';

import type { EquipmentUnit } from '@/entities/equipment/model/equipment.types';
import { getEquipmentStatusLabel } from '@/shared/lib/equipment-presentation';

export function EquipmentScopePanel({
  title,
  units,
}: {
  title: string;
  units: EquipmentUnit[];
}): React.JSX.Element {
  return (
    <div className="page-card" style={{ display: 'grid', gap: 12 }}>
      <div className="section-header">
        <div>
          <div className="section-title">{title}</div>
          <div className="section-subtitle">
            Штучное оборудование, закрепленное за этим контуром.
          </div>
        </div>
      </div>
      {units.length === 0 ? (
        <div className="page-muted">Оборудование не закреплено.</div>
      ) : (
        <div className="record-list local-scroll local-scroll--sm">
          {units.map((unit) => (
            <div key={unit.id} className="record-card" style={{ display: 'grid', gap: 4 }}>
              {unit.capabilities.canCreateMovement ? (
                <Link href={`/equipment/${unit.id}`}>
                  {unit.catalogItem.name} · {unit.inventoryNumber}
                </Link>
              ) : (
                <div style={{ fontWeight: 600 }}>
                  {unit.catalogItem.name} · {unit.inventoryNumber}
                </div>
              )}
              <div className="page-muted" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
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
