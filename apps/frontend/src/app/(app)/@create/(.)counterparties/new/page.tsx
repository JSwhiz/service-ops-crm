'use client';

import React from 'react';
import { CounterpartyCreateDialog } from '@/features/counterparty-create/ui/counterparty-create-dialog';

export default function InterceptedCounterpartyCreateSlot(): React.JSX.Element {
  return <CounterpartyCreateDialog />;
}
