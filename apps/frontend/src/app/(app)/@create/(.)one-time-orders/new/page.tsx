'use client';

import React from 'react';
import { OneTimeOrderCreateDialog } from '@/features/one-time-order-form/ui/one-time-order-create-dialog';

export default function InterceptedOneTimeOrderCreateSlot(): React.JSX.Element {
  return <OneTimeOrderCreateDialog />;
}
