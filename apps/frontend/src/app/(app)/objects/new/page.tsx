import React from 'react';
import ObjectsRegistryPage from '@/app/(app)/objects/page';
import { ObjectCreateDialog } from '@/features/object-create/ui/object-create-dialog';

export default function NewObjectPage(): React.JSX.Element {
  return <><ObjectsRegistryPage /><ObjectCreateDialog /></>;
}
