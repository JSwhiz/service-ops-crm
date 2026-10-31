'use client';

import React from 'react';
import RubberMatsPage from '@/app/(app)/rubber-mats/page';
import { RubberMatSizeCreateDialog } from '@/features/rubber-mat-size-create/ui/rubber-mat-size-create-dialog';

/** A direct create URL keeps the registry as its background. */
export default function NewRubberMatSizePage(): React.JSX.Element {
  return (
    <>
      <RubberMatsPage />
      <RubberMatSizeCreateDialog />
    </>
  );
}
