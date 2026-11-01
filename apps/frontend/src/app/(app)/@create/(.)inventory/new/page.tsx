'use client';

import React from 'react';
import { InventoryItemForm } from '@/features/inventory-item-form/ui/inventory-item-form';
import { createInventoryItem } from '@/entities/inventory/api/inventory-client';

export default function InterceptedInventoryCreateSlot(): React.JSX.Element {
  return (
    <InventoryItemForm
      submitLabel="Создать позицию"
      onSubmit={createInventoryItem}
    />
  );
}
