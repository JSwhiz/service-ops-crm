'use client';

import React from 'react';
import InventoryPage from '@/app/(app)/inventory/page';
import { InventoryItemForm } from '@/features/inventory-item-form/ui/inventory-item-form';
import { createInventoryItem } from '@/entities/inventory/api/inventory-client';

export default function InventoryNewPage(): React.JSX.Element {
  return (
    <>
      <InventoryPage />
      <InventoryItemForm submitLabel="Создать позицию" onSubmit={createInventoryItem} />
    </>
  );
}
