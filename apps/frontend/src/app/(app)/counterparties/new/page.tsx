'use client';

import React from 'react';

import CounterpartiesPage from '@/app/(app)/counterparties/page';
import { CounterpartyCreateDialog } from '@/features/counterparty-create/ui/counterparty-create-dialog';

/** Direct navigation keeps a useful, inert registry behind the create dialog. */
export default function NewCounterpartyPage(): React.JSX.Element {
  return (
    <>
      <CounterpartiesPage />
      <CounterpartyCreateDialog />
    </>
  );
}
