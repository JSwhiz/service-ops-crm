'use client';

import { useRouter } from 'next/navigation';
import React from 'react';

import { createInventoryItem } from '@/entities/inventory/api/inventory-client';
import { InventoryItemForm } from '@/features/inventory-item-form/ui/inventory-item-form';
import { useAuth } from '@/shared/auth/use-auth';
import { PageTitle } from '@/shared/ui/page-title/page-title';

export default function InventoryNewPage(): React.JSX.Element {
  const { user } = useAuth();
  const router = useRouter();
  const canManageInventoryCatalog =
    user?.capabilities?.canManageInventoryCatalog ?? false;

  return (
    <>
      <PageTitle title="Новая номенклатура" />

      {!canManageInventoryCatalog ? (
        <div className="page-card">
          У вас нет доступа к управлению каталогом расходников.
        </div>
      ) : (
        <InventoryItemForm
          submitLabel="Создать позицию"
          onSubmit={async (payload) => {
            const created = await createInventoryItem(payload);
            router.push(`/inventory/${created.id}`);
          }}
        />
      )}
    </>
  );
}
