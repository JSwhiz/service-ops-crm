'use client';

import React from 'react';
import UserAbsencesPage from '@/app/(app)/user-absences/page';
import { UserAbsenceCreateDialog } from '@/features/user-absence-create/ui/user-absence-create-dialog';

/** A direct create URL keeps the calendar as its background. */
export default function NewUserAbsencePage(): React.JSX.Element {
  return (
    <>
      <UserAbsencesPage />
      <UserAbsenceCreateDialog />
    </>
  );
}
