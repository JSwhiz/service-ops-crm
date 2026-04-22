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
      <div>
        <div style={{ fontWeight: 700 }}>{title}</div>
        <div className="page-muted">Штучное оборудование, закрепленное за этим контуром.</div>
      </div>
      {units.length === 0 ? (
        <div className="page-muted">Оборудование не закреплено.</div>
      ) : (
        units.map((unit) => (
          <div key={unit.id} style={{ display: 'grid', gap: 4 }}>
            {unit.capabilities.canCreateMovement ? (
              <Link href={`/equipment/${unit.id}`}>
                {unit.catalogItem.name} · {unit.inventoryNumber}
              </Link>
            ) : (
              <div style={{ fontWeight: 600 }}>
                {unit.catalogItem.name} · {unit.inventoryNumber}
              </div>
            )}
            <div className="page-muted">
              {getEquipmentStatusLabel(unit.status)}
              {unit.notes ? ` · ${unit.notes}` : ''}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
