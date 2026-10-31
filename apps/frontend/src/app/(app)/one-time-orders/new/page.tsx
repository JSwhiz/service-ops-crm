import React from 'react';
import OneTimeOrdersRegistryPage from '@/app/(app)/one-time-orders/page';
import { OneTimeOrderCreateDialog } from '@/features/one-time-order-form/ui/one-time-order-create-dialog';

export default function NewOneTimeOrderPage(): React.JSX.Element {
  return <><OneTimeOrdersRegistryPage /><OneTimeOrderCreateDialog /></>;
}
