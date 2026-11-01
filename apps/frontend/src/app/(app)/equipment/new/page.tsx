'use client';

import React from 'react';
import EquipmentPage from '@/app/(app)/equipment/page';
import { EquipmentCreateDialog } from '@/features/equipment-form/ui/equipment-create-dialog';

export default function NewPage(): React.JSX.Element {
  return <><EquipmentPage /><EquipmentCreateDialog /></>;
}
