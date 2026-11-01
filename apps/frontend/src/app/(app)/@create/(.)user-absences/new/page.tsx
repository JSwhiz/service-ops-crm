'use client';

import React from 'react';
import { UserAbsenceCreateDialog } from '@/features/user-absence-create/ui/user-absence-create-dialog';

export default function InterceptedUserAbsenceCreateSlot(): React.JSX.Element {
  return <UserAbsenceCreateDialog />;
}
