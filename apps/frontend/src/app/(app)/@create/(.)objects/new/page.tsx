'use client';

import React from 'react';
import { ObjectCreateDialog } from '@/features/object-create/ui/object-create-dialog';

export default function InterceptedObjectCreateSlot(): React.JSX.Element {
  return <ObjectCreateDialog />;
}
